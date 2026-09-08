// Draft mechanics: shared/mirrored category pool, open-position drafting,
// bot auto-pick. See build spec #4.

import {
  BOT_POOL_SIZE, BOT_TOP_PICK_BAN_SHARE, BOT_MIN_CHOICES, MIN_SEARCH_CHARS,
  QUALITY_WEIGHT_FLOOR,
} from "./constants.js";
import { difficultyById } from "./modes.js";
// Slot lists are default parameter values (see ui.js). The helpers below are
// per-pick calls and go through the active sport.
import { activeSport } from "./sports/index.js";

/** Default roster shape: the ACTIVE SPORT's, never basketball's.
 *
 * These defaults used to be imported straight from js/sports/nba/constants.js,
 * so any caller that forgot to pass its slots silently got basketball's - which
 * is how an NFL draft came to deal PG/SG/SF/PF/C off a Cowboys roster. Evaluated
 * per call, so it follows whichever sport is live rather than whatever was
 * loaded first. */
/* The RANKED shape, since Quick Play was removed and every mode now drafts it.
 * This used to default to the 5-slot compact shape, which is still declared by
 * each sport (the engine handles it, and games played under it are in saved
 * history) but is no longer what any mode deals. */
const defaultSlots = () => activeSport().slots.ranked;
const defaultStarters = () => activeSport().slots.starters;

/** Groups the flat PLAYERS array into squads keyed by "Team|Decade". */
export function buildSquads(players) {
  // Group by the SPORT's own key. This read p.decade unconditionally, and
  // football rows carry `era` - so every Raiders season from 2000 to 2024
  // collapsed into one squad keyed "Las Vegas Raiders|undefined". That is why
  // an All Years draft showed no era in the banner and drafted from every
  // season at once instead of rolling one.
  //
  // With this, All Years means what it should: each round rolls a specific
  // team AND a specific era, drawn from the whole range. The era is part of
  // the roll, not something the mode discards.
  const groupKey = activeSport().groupKey;
  const map = new Map();
  for (const p of players) {
    const group = p[groupKey];
    const key = `${p.team}|${group}`;
    if (!map.has(key)) {
      // Written under the sport's key AND as `decade`, because shared code and
      // stored match rows have said "decade" since before a second sport
      // existed. Renaming that field reaches into the database; carrying both
      // does not.
      map.set(key, { id: key, team: p.team, [groupKey]: group, decade: group, players: [] });
    }
    map.get(key).players.push(p);
  }
  return [...map.values()];
}

/** True if `player` can legally fill `slot` given their pos[] array.
 * Slots with no fixed position - the 6th man, and every ranked bench spot -
 * accept anyone; the engine works out which position a bench player actually
 * covers once the roster is set. Position-locked slots compare against
 * basePosition, since a player's recorded pos[] holds only bare codes. */
export function isEligible(player, slot) {
  if (slot === "6TH" || activeSport().isBenchSlot(slot)) return true;
  return player.pos.includes(activeSport().basePosition(slot));
}

/** Open slots (not yet filled) for a roster-in-progress, in draft order.
 * `slots` defaults to the active sport's ranked shape; every real caller
 * passes its own, since a draft always knows the shape it is dealing. */
export function openSlots(roster, slots = defaultSlots()) {
  return slots.filter((s) => !roster[s]);
}

/** True if this same real player (by name) already occupies a slot on the
 * roster. Some players appear as separate squad entries across different
 * team/decade combos (e.g. LeBron James in both Cavaliers 2010s and Heat
 * 2010s) - they still can't occupy two roster slots at once. */
function rosterHasPlayerName(roster, name) {
  return Object.values(roster).some((p) => p && p.name === name);
}

/** Slots a given player could legally fill among a roster's open slots. */
export function eligibleOpenSlots(player, roster, slots = defaultSlots()) {
  if (rosterHasPlayerName(roster, player.name)) return [];
  return openSlots(roster, slots).filter((s) => isEligible(player, s));
}

/**
 * What a click on this player actually resolves to.
 *
 * Three outcomes, and the caller needs to tell them apart:
 *   { slot }              place him here, no question worth asking
 *   { choices }           a real decision - open the slot picker
 *   { slot: null }        he cannot be placed at all
 *
 * WHY THIS IS HERE RATHER THAN IN THE TWO HANDLERS. It was written twice, once
 * for the offline board and once for the online one, as:
 *
 *     if (slots.length === 1 || slots.every((s) => s.startsWith("BENCH")))
 *       finalizePick(player, slots[0]);
 *
 * `[].every(...)` is TRUE, so a player who could not be placed anywhere fell
 * into the shortcut and was drafted into `slots[0]` - which is `undefined`.
 * Offline that loses the pick; online it reaches the server as a slotless pick
 * the RPC then rejects. Two copies of a rule is how the rule ends up with a
 * hole in it, so there is one copy now and it lives with the draft rules
 * rather than with the screens that draw them.
 *
 * Bench spots are deliberately collapsed: five interchangeable bench buttons
 * are noise dressed up as a decision.
 */
export function resolvePickSlot(player, roster, slots = defaultSlots()) {
  const open = eligibleOpenSlots(player, roster, slots);
  if (open.length === 0) return { slot: null, choices: [] };
  if (open.length === 1 || open.every((s) => activeSport().isBenchSlot(s))) {
    return { slot: open[0], choices: open };
  }
  return { slot: null, choices: open };
}

/** Every legal (player, slot) combo for `roster` in `squad`, each scored by
 * activeSport().rate() - the shared building block behind both the bot's best-pick
 * logic and the pick-timer's worst-pick timeout penalty. */
function eligibleCombos(squad, roster, slots = defaultSlots()) {
  const combos = [];
  for (const player of squad.players) {
    for (const slot of eligibleOpenSlots(player, roster, slots)) {
      combos.push({ player, slot, score: activeSport().rate(player) });
    }
  }
  return combos;
}

/** The distinct PLAYERS in a combo list, best first.
 *
 * Combos are per (player, slot) over per-season rows, so the same person can
 * appear several times over - see botAutoPick for why that matters. A player
 * is worth his BEST entry here, matching how the practice board orders a
 * squad: you can draft that season, so it is what he offers. */
function rankedPlayerNames(combos) {
  const best = new Map();
  for (const c of combos) {
    const current = best.get(c.player.name);
    if (current === undefined || c.score > current) best.set(c.player.name, c.score);
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** `combos` with the best distinct players removed - by default the top
 * BOT_TOP_PICK_BAN_SHARE of them, or exactly `banTop` when one is given.
 *
 * Never returns an empty list while it was given a non-empty one: the ban
 * shrinks so that BOT_MIN_CHOICES distinct players always survive it. A pick
 * with fewer legal names than that keeps all of them - an opponent that
 * forfeits a slot is not a harder or an easier opponent, it is a broken one.
 *
 * `banTop` is an explicit COUNT and null means "use the share". It cannot
 * default to the share's value because 0 is a meaningful count - it is how the
 * calibration harnesses draft at full strength - so the two have to be
 * distinguishable, and a `banTop = 0` that fell back to the default would
 * quietly re-solve every balance constant against a nerfed bot. */
export function botBanFor(boardSize, banTop = null) {
  const requested =
    banTop === null || banTop === undefined
      ? Math.round(BOT_TOP_PICK_BAN_SHARE * boardSize)
      : banTop;
  return Math.min(requested, Math.max(0, boardSize - BOT_MIN_CHOICES));
}

function withoutTopPlayers(combos, banTop = null) {
  const ranked = rankedPlayerNames(combos);
  const ban = botBanFor(ranked.length, banTop);
  if (ban <= 0) return [...combos];
  const banned = new Set(ranked.slice(0, ban));
  return combos.filter((c) => !banned.has(c.player.name));
}

// ---- Typed-name search (the draft board shows no visible list - you type
// a player from memory and get an autocomplete dropdown once you've typed
// enough). See resolveTypedInput() below for the tiered matching this
// enables. ----

/** Lowercases and strips punctuation that trips up naive matching -
 * "O'Neal" / "Amar'e Stoudemire" / "Abdul-Jabbar" should match on the
 * letters a player would actually type. */
export function normalizeName(s) {
  return (
    s
      .toLowerCase()
      // Fold accents before anything else. The dataset spells names properly -
      // Dončić, Jokić, Porziņģis, Schröder - and nobody types them that way,
      // so without this 59 players are unreachable no matter how well you
      // remember them. NFD splits a letter from its diacritic and the range
      // strips the diacritic, leaving the plain letter behind.
      //
      // It is deliberately one-way: only the comparison is folded, never the
      // stored name, so the card still reads "Luka Dončić".
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[.']/g, "")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** Typo tolerance scales with query length: most real names are short
 * enough that a single typo (distance 1) is already generous - allowing 2
 * at that length starts colliding with unrelated short words (e.g. a typo
 * of "Jordan" matching the "John" in "John Paxson"). Longer queries get
 * more room since there's more string for a coincidental match to hide in. */
function maxAllowedDistance(queryLength) {
  return queryLength <= 7 ? 1 : 2;
}

/** Best (lowest) edit-distance of `query` against `fullName` - 0 means an
 * exact substring match against the full name. Otherwise compares against
 * the full name and each individual word within it (first/last/suffix),
 * skipping tokens whose length is wildly different from the query (a short
 * query shouldn't get to "edit" its way into a much longer word). This is
 * what lets a correctly-remembered-but-misspelled name still resolve
 * (testing "do you know this player," not "can you spell Szczerbiak") while
 * not accidentally matching an unrelated word that just happens to be close. */
function fuzzyMatchScore(normalizedQuery, fullName) {
  const n = normalizeName(fullName);
  if (!normalizedQuery) return Infinity;
  if (n.includes(normalizedQuery)) return 0;

  let best = Infinity;
  for (const token of [n, ...n.split(" ")]) {
    if (Math.abs(token.length - normalizedQuery.length) > 2) continue;
    const d = levenshteinDistance(normalizedQuery, token);
    if (d < best) best = d;
  }
  return best;
}

function rankMatches(query, players) {
  const normalizedQuery = normalizeName(query);
  const threshold = maxAllowedDistance(normalizedQuery.length);
  return players
    .map((p) => ({ p, score: fuzzyMatchScore(normalizedQuery, p.name) }))
    .filter((m) => m.score <= threshold)
    .sort((a, b) => a.score - b.score)
    .map((m) => m.p);
}

/**
 * Resolves typed input against the draft's data in tiers:
 *  - "too-short": fewer than MIN_SEARCH_CHARS typed - no search run yet
 *    (anti letter-fishing gate; also blocks brute-force enumeration of a
 *    10-player squad one letter at a time).
 *  - "in-squad": fuzzy match(es) within currentSquad.players - these are
 *    the ACTUAL objects from currentSquad.players (object identity is
 *    preserved), so they can be handed straight to makePick/submitPick.
 *  - "elsewhere": no in-squad match, but the name fuzzy-matches someone in
 *    the full dataset under a different team/decade - lets the UI say
 *    "wrong squad, not a wrong guess" using data we already have.
 *  - "none": no match anywhere in our (curated, non-exhaustive) dataset.
 */
export function resolveTypedInput(query, currentSquad, allPlayers) {
  const raw = query.trim();
  if (raw.length < MIN_SEARCH_CHARS) {
    return { tier: "too-short", candidates: [] };
  }

  const inSquad = rankMatches(raw, currentSquad.players);
  if (inSquad.length > 0) {
    return { tier: "in-squad", candidates: inSquad };
  }

  const elsewhere = rankMatches(raw, allPlayers).slice(0, 5);
  if (elsewhere.length > 0) {
    return { tier: "elsewhere", candidates: elsewhere };
  }

  return { tier: "none", candidates: [] };
}

/** The worst legal (player, slot) combo for the given roster in the
 * current squad - the mirror image of the bot's best-pick logic, used as
 * the pick-timer timeout penalty. Returns null if there's no eligible
 * combo at all (the caller should auto-skip instead, same precondition
 * as the Skip button). */
export function worstEligiblePick(squad, roster, slots = defaultSlots()) {
  const combos = eligibleCombos(squad, roster, slots);
  if (combos.length === 0) return null;
  return combos.reduce((worst, c) => (c.score < worst.score ? c : worst));
}

/** Softens how much an era's raw squad count drives how often it comes up.
 * The dataset is lopsided - the 2020s have 30 NBA squads while the 1970s have
 * 3 - so picking a squad uniformly at random made almost half of all rounds a
 * 2020s team and the eras blurred together. Weighting each era by the square
 * root of its size pulls the 2020s down from ~46% of rounds to ~30% and lifts
 * the 1970s from ~5% to ~9%, without swinging so far that the three 1970s
 * squads start repeating constantly (which flat per-era weighting would do).
 *
 * Since the balancing pass below, this only decides which era wins a TIE, so
 * it no longer governs how often an era appears - see rollNextSquad. */
function eraWeight(squadCount) {
  return Math.sqrt(squadCount);
}

/** One entry, drawn in proportion to its weight. Shared by the era rotation
 * above and by the quality-targeted bot pick below - two unrelated questions
 * with the same shape of answer. */
function pickWeighted(entries, weightOf) {
  const total = entries.reduce((sum, e) => sum + weightOf(e), 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

/**
 * Which era the next round should come from, given how many rounds each era
 * has already had in THIS draft.
 *
 * Weighted-random-per-round was random in the honest sense and still produced
 * runs nobody believes: football has three eras, so a ten-round draft rolling
 * each one independently deals seven 2000s squads in a row about as often as
 * a coin lands heads five times - rare per round, common across a session.
 * That reads as a broken shuffle whether or not it is one.
 *
 * So eras are drawn in cycles instead: no era comes up a second time until
 * every era that still has an unused squad has come up once. Which era leads a
 * cycle stays random (weighted, above), so the ORDER is never predictable -
 * what is guaranteed is the COVERAGE. In a three-era football draft that means
 * every era shows up in the first three rounds, and the longest possible run
 * of one era is two (the tail of one cycle into the head of the next).
 *
 * An era whose squads are all used up drops out of the rotation entirely -
 * it's absent from `byEra` - and the remaining eras keep cycling among
 * themselves rather than the draft stalling on a debt it can't pay.
 *
 * @param byEra Map of era -> that era's still-eligible squads. Never empty.
 * @param useCounts Map of era -> rounds already spent on it this draft.
 */
function pickNextEra(byEra, useCounts) {
  const entries = [...byEra.entries()];
  const leastUsed = Math.min(...entries.map(([era]) => useCounts.get(era) || 0));
  const due = entries.filter(([era]) => (useCounts.get(era) || 0) === leastUsed);
  return pickWeighted(due, ([, squads]) => eraWeight(squads.length));
}

export class DraftState {
  /**
   * @param recentSquadIds squads seen in the last game or two. They're kept
   *   out of this draft when there's anything else to roll, so consecutive
   *   games don't keep serving the same handful of teams.
   * @param slots the roster shape this draft fills - defaults to the active
   *   sport's ranked shape, which is what every mode deals since Quick Play
   *   was removed. Kept as a parameter rather than read from the sport,
   *   because the calibration harnesses and the box-score tests still drive
   *   smaller shapes through the same mechanics.
   */
  constructor(allPlayers, recentSquadIds = [], slots = defaultSlots()) {
    this.squads = buildSquads(allPlayers);
    this.recentSquadIds = new Set(recentSquadIds);
    this.usedSquadIds = new Set();
    // era -> rounds already rolled from it, so rollNextSquad can spread the
    // draft across every era instead of streaking on one. See pickNextEra.
    this.eraUseCounts = new Map();
    this.slots = slots;
    this.rosterA = {}; // human
    this.rosterB = {}; // bot
    this.history = [];
    this.currentSquad = null;
  }

  isComplete() {
    return openSlots(this.rosterA, this.slots).length === 0 && openSlots(this.rosterB, this.slots).length === 0;
  }

  /** Roll the next shared category. Both sides draft from this same squad.
   * Never repeats a squad within a game, prefers squads the player hasn't
   * just seen, and spreads the rounds across every era via pickNextEra. */
  rollNextSquad() {
    if (this.isComplete()) return null;

    const unused = this.squads.filter((s) => !this.usedSquadIds.has(s.id));
    if (unused.length === 0) return null;

    // Skip recently-seen squads unless that would leave nothing to pick.
    const fresh = unused.filter((s) => !this.recentSquadIds.has(s.id));
    const candidates = fresh.length > 0 ? fresh : unused;

    // Keyed on `decade`, which buildSquads writes for every sport - it carries
    // football's era just as it carries basketball's decade.
    const byEra = new Map();
    for (const squad of candidates) {
      if (!byEra.has(squad.decade)) byEra.set(squad.decade, []);
      byEra.get(squad.decade).push(squad);
    }

    const [era, eraSquads] = pickNextEra(byEra, this.eraUseCounts);
    const chosen = eraSquads[Math.floor(Math.random() * eraSquads.length)];

    this.eraUseCounts.set(era, (this.eraUseCounts.get(era) || 0) + 1);
    this.usedSquadIds.add(chosen.id);
    this.currentSquad = chosen;
    return this.currentSquad;
  }

  /** True if the given roster has at least one legal (player, slot) pick
   * available in the current rolled squad. */
  hasValidPick(roster) {
    if (!this.currentSquad) return false;
    return this.currentSquad.players.some((p) => eligibleOpenSlots(p, roster, this.slots).length > 0);
  }

  /** Human/manual pick: assign `player` (from the current squad) to `slot`
   * on `side` ("A" or "B"). Throws if the pick is illegal. */
  makePick(side, player, slot) {
    const roster = side === "A" ? this.rosterA : this.rosterB;
    // Match on the row's KEY, not object identity. includes() compares
    // references, so any code that mapped, spread or reshaped a player broke
    // the draft silently - a click that does nothing and says nothing. The
    // key is name + team + group + season, which is what a row actually is
    // since the dataset went per-season.
    const groupKey = activeSport().groupKey;
    const inSquad = this.currentSquad?.players.some(
      (p) =>
        p.name === player.name &&
        p.team === player.team &&
        p[groupKey] === player[groupKey] &&
        (p.season ?? null) === (player.season ?? null)
    );
    if (!inSquad) {
      throw new Error("Player is not part of the currently rolled squad.");
    }
    // Eligibility is judged across every season of this player ON THIS SQUAD,
    // the same union the board shows. Judging the picked row alone means the
    // board offers a slot and the draft refuses it - Kyshawn George is SG in
    // one year and SF in the next, so the card said SF and the pick threw.
    const seasonsHere = this.currentSquad.players.filter((p) => p.name === player.name);
    const unionPos = [...new Set(seasonsHere.flatMap((p) => p.pos || []))];
    const eligible = isEligible({ ...player, pos: unionPos }, slot);
    if (!eligible || roster[slot] || rosterHasPlayerName(roster, player.name)) {
      throw new Error(`${player.name} cannot fill slot ${slot}.`);
    }
    roster[slot] = player;
    this.history.push({ side, squad: this.currentSquad, player, slot });
  }

  /** Bot pick: the top BOT_TOP_PICK_BAN_SHARE of the players on the board are
   * off limits, and it draws uniformly from the BOT_POOL_SIZE best combos left
   * under them.
   *
   * WHY THE BAN EXISTS. The bot used to draw from the BOT_POOL_SIZE best
   * combos outright, which meant it took a top-five player every single round.
   * Widening that pool was the only difficulty knob and it did not work: a
   * wider pool still starts at the top of the board, so the bot's roster was
   * elite either way and the human could at best draw level with it. Banning
   * the top of the board is a different lever - the best players are there for
   * the human to take if they know who they are, and the bot builds from
   * what's under them. Knowing the players is what the game is about, so that
   * is what the difficulty should turn on.
   *
   * BY DISTINCT PLAYER, NOT BY COMBO. Two reasons, and both would have made a
   * naive top-15-combos ban far weaker than it looks. The dataset is one row
   * PER SEASON, so a squad holds Jordan '91, '92 and '93 as three separate
   * combos - fifteen combos can be four people. And a player eligible at two
   * open slots contributes a combo each, double-counting him. So combos are
   * collapsed by name and each name is worth its best season, the same way the
   * practice board ranks a squad (see ui.js).
   *
   * A thin board narrows the ban rather than emptying it - see
   * BOT_MIN_CHOICES. `banTop` is an override for the calibration harnesses,
   * which draft both sides with the bot and need full-strength rosters.
   *
   * DIFFICULTY, IN TWO SHAPES. Practice names one of three difficulties, and
   * the sport decides what that means to it.
   *
   *   A WINDOW over the one ranking, which is the shared default and what
   *   basketball uses: Hard drafts from the top of the board, Medium from
   *   under the ban (the bot above, unchanged), Easy from the bottom third.
   *
   *   A PLAN of target ratings per position group, when the sport returns one
   *   from botDraftPlan - football does, because "how good is this bot" is two
   *   questions there (its offense and its defense) and one ranked list cannot
   *   ask them separately. See js/sports/nfl/botdraft.js.
   *
   * Every difficulty under either shape fills every slot legally, and none of
   * them reaches anything the simulation reads - see js/modes.js. */
  botAutoPick(side = "B", { banTop = null, difficulty = null } = {}) {
    const roster = side === "A" ? this.rosterA : this.rosterB;
    if (!this.hasValidPick(roster)) return null;
    const combos = eligibleCombos(this.currentSquad, roster, this.slots);
    // An explicit banTop is a calibration harness asking for a specific bot and
    // always wins - a difficulty quietly overriding it would re-solve every
    // balance constant against a different opponent than the one named.
    const named = banTop === null || banTop === undefined ? difficulty : null;
    const plan = difficultyPlan(named);
    const window = plan ? null : difficultyWindow(named);
    const choice = plan
      ? pickByQualityTarget(combos, plan)
      : uniformPick(window ? windowedPool(combos, window) : legacyPool(combos, banTop));
    this.makePick(side, choice.player, choice.slot);
    return choice;
  }
}

const uniformPick = (pool) => pool[Math.floor(Math.random() * pool.length)];

/** The window a difficulty drafts from, or null for the legacy pool.
 *
 * Medium is deliberately null: it IS the legacy pool, unchanged, because every
 * gamestyle modifier and variance range in this app was solved against that
 * exact bot (tools/calibrate-*.mjs). Easy and Hard are new windows over the
 * same ranking, so neither of them can move a number the engine reads. */
export function difficultyWindow(difficulty) {
  return difficulty ? difficultyById(difficulty).window : null;
}

/** The ACTIVE SPORT's per-position quality plan for this difficulty, or null
 * when it has no opinion and the shared window above should decide.
 *
 * Asked of the sport rather than branched on here for the usual reason: shared
 * code that knows what football is is how a change made for one sport reaches
 * the other. Basketball answers null and keeps exactly the bot it had. */
export function difficultyPlan(difficulty) {
  return difficulty ? activeSport().botDraftPlan(difficulty) : null;
}

/** How much a pick rated `score` is wanted by a group whose target is `t`.
 *
 * A one-sided Gaussian on the distance from the target, so quality is a
 * PREFERENCE and never a cutoff. Three properties matter and all three are
 * deliberate:
 *
 *   IT NEVER RETURNS ZERO. A floor keeps every legal pick reachable, so a
 *   squad holding nothing near the target still gets drafted from - the
 *   closest rows simply dominate the draw. An opponent that forfeits a slot is
 *   not a harder or an easier opponent, it is a broken roster, which is the
 *   same rule BOT_MIN_CHOICES enforces on the legacy path.
 *
 *   IT IS ASYMMETRIC. Overshooting a target and undershooting it are different
 *   mistakes - see DEFAULT_SPREAD in js/sports/nfl/botdraft.js.
 *
 *   IT LEAVES VARIANCE ALONE. Anything within about a standard deviation of
 *   the target is drawn at a comparable rate, so two drafts at one difficulty
 *   are two different rosters rather than the same script twice. */
function qualityWeight(score, t) {
  const delta = score - t.rating;
  const sigma = Math.max(1e-6, delta >= 0 ? t.above : t.below);
  return Math.exp(-0.5 * (delta / sigma) ** 2) + QUALITY_WEIGHT_FLOOR;
}

/** One pick, drawn from every legal combo in proportion to how well it meets
 * its position group's target. Combos are weighted individually rather than
 * collapsed by name on purpose: the same defensive unit appears once per
 * season in an era, those seasons span most of the rating scale, and WHICH
 * SEASON is most of the quality lever football has at a defensive slot. */
function pickByQualityTarget(combos, plan) {
  const basePosition = activeSport().basePosition;
  return pickWeighted(combos, (c) =>
    qualityWeight(c.score, plan.targets[basePosition(c.slot)] || plan.fallback)
  );
}

/** The board's best BOT_POOL_SIZE combos once the top share of players is
 * banned - the bot this app has always had, and Practice (Medium). */
function legacyPool(combos, banTop) {
  const legal = withoutTopPlayers(combos, banTop);
  return legal.sort((a, b) => b.score - a.score).slice(0, BOT_POOL_SIZE);
}

/**
 * Every combo belonging to one slice of the board's ranked players.
 *
 * `start` is a FRACTION of however many legal names this pick actually offers,
 * not a fixed count - a late pick with one position-locked slot open can be
 * down to six names, and skipping "the first eight" there would leave nothing.
 * `take` is a count, because "the top four" and "the bottom eight" are the
 * claims the difficulties actually make.
 *
 * The result is never empty while `combos` is not. Two clamps do that: the
 * start index cannot pass n - 1, and the take is widened to reach at least one
 * name. A bot that forfeits a slot is not an easier opponent, it is a broken
 * roster - the same rule BOT_MIN_CHOICES exists to enforce on the legacy path.
 *
 * Uniform across the window's combos rather than weighted toward its top. The
 * window IS the weighting, and it keeps two games at the same difficulty from
 * producing the same roster: an Easy bot draws from about a third of the board.
 */
function windowedPool(combos, { start, take }) {
  const ranked = rankedPlayerNames(combos);
  const n = ranked.length;
  if (n === 0) return [];
  const startIndex = Math.min(Math.round(start * n), n - 1);
  const size = Math.max(1, Math.min(take, n - startIndex));
  const chosen = new Set(ranked.slice(startIndex, startIndex + size));
  return combos.filter((c) => chosen.has(c.player.name));
}
