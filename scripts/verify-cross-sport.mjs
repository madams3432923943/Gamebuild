#!/usr/bin/env node
// Cross-sport leakage: the keys that decide whether two sports share a number
// they should never share.
//
// WHY THIS EXISTS
//
// Three columns on `profiles` are plain maps that predate the second sport:
// era_records is keyed by era id, personal_bests by bare stat name, and
// draft_counts by bare player name. Every one of them collides the moment a
// second sport writes into it - every sport reasonably wants an "all" era, a
// passing-yards record would sort against a points record, and Most Drafted
// would rank Jordan against Brady in one list.
//
// The fix already shipped: eraRecordKey and statsKey prefix everything except
// the default sport, which leaves every row already in the database valid and
// readable as basketball so no backfill was needed. What did NOT exist was
// anything holding that rule in place. It is two small pure functions whose
// entire job is to be boring, which is exactly the kind of thing that gets
// "simplified" by someone who has not read this comment.
//
// verify:profile-history covers the history list and win streaks. This covers
// the keys, and the specific property that matters: no pair of (sport, key)
// from two different sports may ever produce the same string.

import { eraRecordKey, statsKey, SPORTS, DEFAULT_SPORT_ID } from "../js/sports/index.js";
import { badgeSummary } from "../js/badges.js";
import { renderCheck, renderSection, summarize, PASS, FAIL } from "./lib/report.mjs";

const checks = [];
const add = (title, ok, detail) => checks.push({ title, status: ok ? PASS : FAIL, detail: String(detail) });

const ids = SPORTS.map((s) => s.id);

// ---- era record keys --------------------------------------------------------
// Every era of every sport, against every other. Collisions are collected
// rather than short-circuited so the report names the real damage, not the
// first instance of it.
const eraSeen = new Map();
const eraCollisions = [];
let eraKeyCount = 0;
for (const sport of SPORTS) {
  for (const era of sport.eras || []) {
    const key = eraRecordKey(sport.id, era.id);
    eraKeyCount += 1;
    if (eraSeen.has(key) && eraSeen.get(key) !== sport.id) {
      eraCollisions.push(`${sport.id}/${era.id} collides with ${eraSeen.get(key)} on "${key}"`);
    }
    eraSeen.set(key, sport.id);
  }
}
add(
  "No two sports share an era-record key",
  eraCollisions.length === 0,
  eraCollisions.length === 0
    ? `${eraKeyCount} era keys across ${ids.length} sports, all distinct`
    : eraCollisions.slice(0, 3).join("; ")
);

// The one every sport genuinely wants, checked by name because it is the
// collision that actually happened.
const allKeys = ids.map((id) => eraRecordKey(id, "all"));
add(
  'Every sport can have an "all" bracket without overwriting another',
  new Set(allKeys).size === allKeys.length,
  allKeys.join(", ")
);

// ---- stat keys --------------------------------------------------------------
const statSeen = new Map();
const statCollisions = [];
let statKeyCount = 0;
for (const sport of SPORTS) {
  const keys = [...(sport.lineKeys || []), ...Object.keys(sport.statLabels || {})];
  for (const key of keys) {
    const namespaced = statsKey(sport.id, key);
    statKeyCount += 1;
    if (statSeen.has(namespaced) && statSeen.get(namespaced) !== sport.id) {
      statCollisions.push(`${sport.id}/${key} collides with ${statSeen.get(namespaced)} on "${namespaced}"`);
    }
    statSeen.set(namespaced, sport.id);
  }
}
add(
  "No two sports share a personal-best key",
  statCollisions.length === 0,
  statCollisions.length === 0
    ? `${statKeyCount} stat keys across ${ids.length} sports, all distinct`
    : statCollisions.slice(0, 3).join("; ")
);

// `pts` is the case worth naming: both sports score points, both call it pts,
// and left unprefixed one sport's record would silently overwrite the other's.
const ptsKeys = ids.map((id) => statsKey(id, "pts"));
add(
  "Points scored in football never land on basketball's record",
  new Set(ptsKeys).size === ptsKeys.length,
  ptsKeys.join(", ")
);

// ---- backward compatibility -------------------------------------------------
// The reason the prefix is conditional. Every row written before the second
// sport existed is basketball's and is keyed bare; if the default sport ever
// started prefixing, all of that history would be orphaned in place rather
// than migrated - readable in the database, invisible in the app.
add(
  "The default sport's keys stay bare, so existing rows keep working",
  eraRecordKey(DEFAULT_SPORT_ID, "1990s") === "1990s" && statsKey(DEFAULT_SPORT_ID, "pts") === "pts",
  `${eraRecordKey(DEFAULT_SPORT_ID, "1990s")} / ${statsKey(DEFAULT_SPORT_ID, "pts")}`
);
add(
  "Every other sport's keys are prefixed",
  ids.filter((id) => id !== DEFAULT_SPORT_ID).every((id) => statsKey(id, "pts").startsWith(`${id}:`)),
  ids.filter((id) => id !== DEFAULT_SPORT_ID).map((id) => statsKey(id, "pts")).join(", ")
);

// ---- per-sport ratings ------------------------------------------------------
// Rank is stored in profiles.sport_ratings, a map keyed by sport id, so it is
// namespaced by construction. What is worth asserting is that the ids are
// distinct and non-empty - the registry is the only thing keeping two sports
// from sharing a rating, and an empty id would collapse them.
add(
  "Every sport has a distinct, non-empty id for its rating to hang on",
  new Set(ids).size === ids.length && ids.every((id) => typeof id === "string" && id.length > 0),
  ids.join(", ")
);

// ---- badges READ the namespace they are written under ----------------------
// The gap this file had, found the hard way. The checks above prove statsKey and
// eraRecordKey produce distinct keys. They said nothing about whether anything
// READS through them - and js/badges.js did not. Career totals and personal
// bests are written under statsKey(sport, key), the badge helpers looked up the
// bare key, and so all twenty NFL badges sat at zero through every football game
// ever played while the stats themselves recorded perfectly.
//
// A key function that is correct and unused is indistinguishable from a missing
// one, so the property is now asserted end to end: a profile holding ONLY one
// sport's numbers must earn that sport's badges and NONE of the other's.
for (const sport of SPORTS.filter((s) => s.live)) {
  const other = SPORTS.find((s) => s.live && s.id !== sport.id);
  if (!other) continue;

  // Deliberately enormous, so "earned nothing" can only mean the lookup missed -
  // never that the thresholds were not reached.
  const HUGE = 1e6;
  const profileFor = (which) => {
    const careerTotals = {};
    const personalBests = {};
    for (const key of which.lineKeys || []) {
      careerTotals[statsKey(which.id, key)] = HUGE;
      personalBests[statsKey(which.id, key)] = { value: HUGE };
    }
    for (const key of Object.keys(which.statLabels || {})) {
      careerTotals[statsKey(which.id, key)] = HUGE;
      personalBests[statsKey(which.id, key)] = { value: HUGE };
    }
    // Zeroed, so only the stat namespace can move a badge - the win-count and
    // draft badges would otherwise mask a broken stat lookup.
    return {
      careerTotals,
      personalBests,
      draftCounts: {},
      history: [],
      onlineWins: 0, onlineLosses: 0, offlineWins: 0, offlineLosses: 0,
    };
  };

  const own = badgeSummary(profileFor(sport), sport.id);
  add(
    `${sport.id.toUpperCase()} badges read ${sport.id.toUpperCase()} career stats`,
    own.earned > 0,
    own.earned > 0
      ? `${own.earned} of ${own.total} earned from ${sport.id}-namespaced stats`
      : `NONE of ${own.total} earned despite maximal ${sport.id} stats - the badge helpers are reading the wrong namespace`
  );

  const foreign = badgeSummary(profileFor(other), sport.id);
  add(
    `${other.id.toUpperCase()} stats never earn ${sport.id.toUpperCase()} badges`,
    foreign.earned === 0,
    foreign.earned === 0
      ? `${other.id} data leaves all ${foreign.total} ${sport.id} badges untouched`
      : `${foreign.earned} ${sport.id} badges earned from ${other.id} data`
  );
}

console.log(renderSection("Cross-sport leakage: era records, personal bests, ratings, badges"));
for (const c of checks) console.log(renderCheck(c));
const { counts, ok } = summarize(checks);
console.log(`\n  passed ${counts[PASS]}  failed ${counts[FAIL]}\n`);
process.exit(ok ? 0 : 1);
