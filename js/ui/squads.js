// The squad screens, and the friends screens that share their furniture.
//
// Extracted from js/ui.js. This block is the most self-contained thing in that
// file - nothing outside it uses smallBtn, SQUAD_EMOJI_CHOICES, SQUAD_ROLE_LABEL
// or SQUADS_TOP_TABS, and nothing inside it reaches back into the draft board or
// the box score. It needs exactly three things from elsewhere, all imported
// below. js/ui.js re-exports every function here, so no caller changed.

import { escapeHtml } from "../lib/escape-html.js";
import { squadTierForRep } from "../squads.js";
import { bannerById } from "../banners.js";
import { bannerArt } from "./banner-art.js";
// The member mark. Same renderer as the home card and the profile hero, so a
// player is drawn the same way wherever they appear.
import { renderPlayerIcon } from "./profile.js";
import { renderNote } from "./note.js";

// ---- Squads --------------------------------------------------------------

const SQUAD_EMOJI_CHOICES = [
  "🏀", "🔥", "⚡", "🐐", "🦁", "🐺", "🦅", "👑",
  "💎", "⭐", "🎯", "🛡️", "⚔️", "🌊", "🌪️", "☄️",
  "🚀", "🏆", "💀", "👹", "🐉", "🦈", "🍀", "🎮",
];

function smallBtn(text, onClick, extraClass) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary btn-small" + (extraClass ? ` ${extraClass}` : "");
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

/** A row of emoji buttons for picking a squad's crest. Reused by both the
 * create-squad form and the in-place squad settings editor. Self-contained:
 * re-renders its own selection state in place on click rather than pushing
 * the pick up through a full-screen re-render, so it stays smooth to use. */
export function renderSquadEmojiPalette(container, selected, onSelect) {
  container.innerHTML = "";
  for (const emoji of SQUAD_EMOJI_CHOICES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "squad-emoji-choice" + (emoji === selected ? " active" : "");
    btn.textContent = emoji;
    btn.addEventListener("click", () => onSelect(emoji));
    container.appendChild(btn);
  }
}

/** Public squads browsable from the "Find a Squad" screen. Private squads
 * never appear here (see listPublicSquads in squads.js) - joining one needs
 * its invite code instead. */
export function renderSquadBrowseList(container, squads, onJoin) {
  container.innerHTML = "";
  if (!squads.length) {
    renderNote(container, "No public squads yet - be the first to create one!");
    return;
  }
  for (const squad of squads) {
    const card = document.createElement("div");
    card.className = "squad-card";

    const head = document.createElement("div");
    head.className = "squad-card-head";
    head.innerHTML =
      `<span class="squad-card-emoji" aria-hidden="true">${escapeHtml(squad.emoji)}</span>` +
      `<span class="squad-card-name">${escapeHtml(squad.name)} <span class="squad-card-tag">[${escapeHtml(squad.tag)}]</span></span>`;
    card.appendChild(head);

    if (squad.motto) {
      const motto = document.createElement("div");
      motto.className = "squad-card-motto";
      motto.textContent = squad.motto;
      card.appendChild(motto);
    }

    const meta = document.createElement("div");
    meta.className = "squad-card-meta";
    const tierName = squadTierForRep(squad.rep).name;
    meta.textContent = `${squad.memberCount} / ${squad.memberCap} members · ${tierName} · ${squad.rep} Rep`;
    card.appendChild(meta);

    const full = squad.memberCount >= squad.memberCap;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = full ? "Full" : "Join";
    btn.disabled = full;
    btn.addEventListener("click", () => onJoin(squad.id));
    card.appendChild(btn);

    container.appendChild(card);
  }
}

/** The squad detail header: crest, name/tag, motto, member count, Squad
 * Rep (a persistent trophy-style score - see squadRankInfo in squads.js),
 * and - leader/co-leader only - the invite code and an inline settings
 * editor. `data.editing` toggles the editor; callbacks.onToggleEdit flips it
 * via a full re-render (cheap, and matches how every other tab-like toggle
 * in this app already works), while the editor's own emoji pick is handled
 * in-place so typing a motto doesn't get interrupted by a re-render. */
export function renderSquadHeader(container, data, callbacks) {
  const { squad, myRole, memberCount, rankInfo, inviteCode, editing, leaderName } = data;
  const canManage = myRole === "leader" || myRole === "co-leader";

  container.innerHTML = "";

  // --- Identity -------------------------------------------------------------
  // The crest, the name, the tag and the motto, on a plate tinted from the
  // squad's own colour. This was a small emoji, a heading and a grey line of
  // "Public · 7 / 20 members" - an administrative summary of a record rather
  // than a team you belong to.
  const identity = document.createElement("div");
  identity.className = "squad-identity";
  identity.innerHTML =
    `<span class="squad-crest" aria-hidden="true"></span>` +
    `<div class="squad-identity-text">` +
    `<div class="squad-header-name"><span class="squad-name-text"></span><span class="squad-header-tag"></span></div>` +
    `<div class="squad-header-motto"></div>` +
    `</div>`;
  identity.querySelector(".squad-crest").textContent = squad.emoji;
  identity.querySelector(".squad-name-text").textContent = squad.name;
  identity.querySelector(".squad-header-tag").textContent = `[${squad.tag}]`;
  const motto = identity.querySelector(".squad-header-motto");
  // No motto is a real state - a squad is not required to have one - so the
  // line is removed rather than left as an empty gap under the name.
  if (squad.motto) motto.textContent = squad.motto;
  else motto.remove();
  container.appendChild(identity);

  // --- The four facts, in even cells ---------------------------------------
  // Privacy, size, tier and who runs it were three of them buried in one grey
  // sentence and one of them - the leader - not shown at all, which on a squad
  // you have just joined is the single thing you most want to know.
  const facts = document.createElement("div");
  facts.className = "squad-facts";
  for (const cell of [
    { label: "Members", value: `${memberCount} / ${squad.memberCap}` },
    { label: "Privacy", value: squad.visibility === "public" ? "🌐 Public" : "🔒 Private" },
    { label: "Tier", value: rankInfo.tier.name },
    { label: "Leader", value: leaderName || "—" },
  ]) {
    const el = document.createElement("div");
    el.className = "squad-fact";
    el.innerHTML = `<span class="squad-fact-label"></span><span class="squad-fact-value"></span>`;
    el.querySelector(".squad-fact-label").textContent = cell.label;
    el.querySelector(".squad-fact-value").textContent = cell.value;
    facts.appendChild(el);
  }
  container.appendChild(facts);

  // --- Rep ------------------------------------------------------------------
  const rankWrap = document.createElement("div");
  rankWrap.className = "squad-rank-wrap";

  const track = document.createElement("div");
  track.className = "progress-bar-track";
  const fill = document.createElement("div");
  fill.className = "progress-bar-fill";
  const pct = rankInfo.next
    ? Math.min(100, (100 * (rankInfo.rep - rankInfo.tier.minRep)) / (rankInfo.next.minRep - rankInfo.tier.minRep))
    : 100;
  fill.style.width = `${pct}%`;
  track.appendChild(fill);
  rankWrap.appendChild(track);

  const caption = document.createElement("div");
  caption.className = "squad-rank-caption";
  // Rep only moves in squad-vs-squad tournaments, which aren't built yet, so
  // every squad is legitimately on 0 - say so rather than showing a dead
  // progress bar that looks like something is broken.
  caption.textContent =
    rankInfo.rep === 0
      ? "0 Rep — Rep is earned in squad tournaments, coming soon."
      : rankInfo.next
        ? `${rankInfo.rep} Rep — ${rankInfo.next.minRep - rankInfo.rep} more to reach ${rankInfo.next.name}`
        : `${rankInfo.rep} Rep — the top tier, Legend.`;
  rankWrap.appendChild(caption);
  container.appendChild(rankWrap);

  if (!canManage) return;

  // --- Management, deliberately quiet --------------------------------------
  // The invite code used to be the loudest thing under the name: a mono chip
  // and a New Code button in their own row, above the buttons that edit and
  // disband the squad. It is a string you copy once. It sits in the footer
  // with everything else administrative now, and the footer is separated from
  // the identity above it rather than being part of it.
  const manage = document.createElement("div");
  manage.className = "squad-manage";

  const codeRow = document.createElement("div");
  codeRow.className = "squad-invite-row";
  const codeLabel = document.createElement("span");
  codeLabel.className = "squad-invite-label";
  codeLabel.textContent = "Invite code";
  const codeValue = document.createElement("span");
  codeValue.className = "squad-invite-code";
  codeValue.textContent = inviteCode || "—";
  codeRow.appendChild(codeLabel);
  codeRow.appendChild(codeValue);
  codeRow.appendChild(smallBtn("New Code", callbacks.onRegenerateCode));
  manage.appendChild(codeRow);

  const manageBtns = document.createElement("div");
  manageBtns.className = "squad-manage-buttons";
  manageBtns.appendChild(smallBtn(editing ? "Cancel Edit" : "Edit Squad", callbacks.onToggleEdit));
  if (myRole === "leader") {
    manageBtns.appendChild(smallBtn("Disband Squad", callbacks.onDisband, "btn-danger-small"));
  }
  manage.appendChild(manageBtns);

  if (editing) {
    const form = document.createElement("div");
    form.className = "squad-edit-form";

    let chosenEmoji = squad.emoji;
    const emojiPalette = document.createElement("div");
    emojiPalette.className = "squad-emoji-palette";
    form.appendChild(emojiPalette);
    const paintPalette = () => {
      renderSquadEmojiPalette(emojiPalette, chosenEmoji, (emoji) => {
        chosenEmoji = emoji;
        paintPalette();
      });
    };
    paintPalette();

    const mottoField = document.createElement("div");
    mottoField.className = "field-row";
    mottoField.innerHTML = `<label>Motto</label>`;
    const mottoInput = document.createElement("textarea");
    mottoInput.maxLength = 120;
    mottoInput.rows = 2;
    mottoInput.value = squad.motto;
    mottoField.appendChild(mottoInput);
    form.appendChild(mottoField);

    const visField = document.createElement("div");
    visField.className = "field-row";
    visField.innerHTML = `<label>Visibility</label>`;
    const visSelect = document.createElement("select");
    visSelect.innerHTML = `<option value="public">Public - anyone can join</option><option value="private">Private - invite code only</option>`;
    visSelect.value = squad.visibility;
    visField.appendChild(visSelect);
    form.appendChild(visField);

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn-primary";
    saveBtn.textContent = "Save Changes";
    saveBtn.addEventListener("click", () => {
      callbacks.onSaveSettings({ emoji: chosenEmoji, motto: mottoInput.value, visibility: visSelect.value });
    });
    form.appendChild(saveBtn);

    manage.appendChild(form);
  }

  container.appendChild(manage);
}

const SQUAD_ROLE_LABEL = { leader: "👑 Leader", "co-leader": "⭐ Co-Leader", member: "Member" };

/** Roster rows with role-appropriate actions: the leader can promote/demote/
 * transfer/kick anyone but themself, a co-leader can only kick plain
 * members, and a plain member sees no action buttons at all.
 *
 * THE ACTIONS ARE BEHIND A TOGGLE. A leader's view of their own squad used to
 * be four red-and-grey buttons per row - "+ Friend  Promote  Make Leader
 * Kick" - taking more width than the member they belonged to, on every row, so
 * the roster read as an administration console rather than as a list of the
 * people you play with. They are one "Manage" button now, and the row that
 * opens holds the same actions unchanged. Nothing is removed and nothing is
 * harder to reach than one tap; what changes is what the screen is ABOUT when
 * you are not managing anybody, which is most of the time.
 *
 * `friendIds` is the set of user ids you already have a friendship row with
 * (accepted or pending), so the Add Friend button only appears where it would
 * actually do something.
 */
export function renderSquadRoster(container, roster, myUserId, myRole, callbacks, friendIds = new Set()) {
  container.innerHTML = "";
  for (const member of roster) {
    const isSelf = member.userId === myUserId;

    const row = document.createElement("div");
    row.className = "squad-member" + (isSelf ? " is-me" : "");

    // The mark they chose for themselves. Same renderer as the home card and
    // the profile hero, so a member is drawn here exactly as they are drawn
    // everywhere else - see renderPlayerIcon.
    const avatar = document.createElement("span");
    avatar.className = "player-avatar squad-member-avatar";
    renderPlayerIcon(avatar, { equippedIcon: member.equippedIcon });

    const info = document.createElement("div");
    info.className = "squad-member-info";
    info.innerHTML =
      `<span class="squad-member-name"></span>` +
      `<span class="squad-member-meta">` +
      `<span class="squad-member-role"></span>` +
      `<span class="squad-member-record"></span>` +
      `</span>`;
    info.querySelector(".squad-member-name").textContent =
      member.username + (isSelf ? " (you)" : "");
    const role = info.querySelector(".squad-member-role");
    role.textContent = SQUAD_ROLE_LABEL[member.role];
    role.classList.add(`role-${member.role}`);
    info.querySelector(".squad-member-record").textContent =
      `${member.onlineWins}-${member.onlineLosses} online`;

    row.append(avatar, info);

    const actions = document.createElement("div");
    actions.className = "squad-member-actions hidden";

    // Squadmates are the people you're most likely to want as friends, and
    // the only way to add one used to be retyping their name on the Friends
    // tab. Hidden once a friendship or request already exists so the button
    // never invites a duplicate request the server would just reject.
    if (!isSelf && !friendIds.has(member.userId) && callbacks.onAddFriend) {
      actions.appendChild(smallBtn("+ Friend", () => callbacks.onAddFriend(member.username)));
    }

    if (!isSelf && myRole === "leader") {
      if (member.role === "member") {
        actions.appendChild(smallBtn("Promote", () => callbacks.onSetRole(member.userId, "co-leader")));
      }
      if (member.role === "co-leader") {
        actions.appendChild(smallBtn("Demote", () => callbacks.onSetRole(member.userId, "member")));
      }
      actions.appendChild(smallBtn("Make Leader", () => callbacks.onTransfer(member.userId)));
      actions.appendChild(smallBtn("Kick", () => callbacks.onKick(member.userId), "btn-danger-small"));
    } else if (!isSelf && myRole === "co-leader" && member.role === "member") {
      actions.appendChild(smallBtn("Kick", () => callbacks.onKick(member.userId), "btn-danger-small"));
    }

    // A row with nothing to do on it gets no toggle - an empty Manage panel is
    // worse than no button, because it promises something.
    if (actions.children.length) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "squad-member-manage";
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", `Manage ${member.username}`);
      toggle.innerHTML = `<span aria-hidden="true">⋯</span>`;
      toggle.addEventListener("click", () => {
        const open = actions.classList.toggle("hidden");
        toggle.setAttribute("aria-expanded", String(!open));
        row.classList.toggle("managing", !open);
      });
      row.appendChild(toggle);
      row.appendChild(actions);
    }

    container.appendChild(row);
  }
}

/** Chat pane. Preserves scroll position unless the reader was already at
 * the bottom, so a poll landing while they've scrolled up to read history
 * doesn't yank the view back down. */
export function renderSquadChat(container, messages, myUserId) {
  const wasAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 20;
  container.innerHTML = "";
  if (!messages.length) {
    renderNote(container, "No messages yet - say hello!");
  } else {
    for (const msg of messages) {
      const row = document.createElement("div");
      row.className = "squad-chat-message" + (msg.user_id === myUserId ? " mine" : "");
      const time = new Date(msg.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      row.innerHTML =
        `<span class="squad-chat-author">${escapeHtml(msg.username)}</span>` +
        `<span class="squad-chat-time">${time}</span>` +
        `<div class="squad-chat-body">${escapeHtml(msg.body)}</div>`;
      container.appendChild(row);
    }
  }
  if (wasAtBottom) container.scrollTop = container.scrollHeight;
}

// ---- Squads top-level subtabs: Friends | Home ---------------------------

const SQUADS_TOP_TABS = [
  { id: "friends", label: "Friends" },
  { id: "home", label: "Home" },
  // Chat is off the row for now. Everything behind it is intact - the panel,
  // the watcher, sendSquadMessage, the render - so putting it back is this
  // one line. Removed from the entry point rather than deleted, because
  // "not yet" and "never" are different decisions and only one of them has
  // been made.
  // { id: "chat", label: "Chat" },
  //
  // Tournaments is off the row for the OPPOSITE reason to Chat. Chat is built
  // and withheld; tournaments have never existed - no table, no RPC, no code
  // anywhere - and the tab led to a card that said "Coming soon!" and nothing
  // else. A navigation item whose only content is an apology for itself costs
  // a player a tap to learn nothing, and it is the third of three tabs, so it
  // took a third of the row to do it.
  //
  // Saying "coming soon" in a place someone chose to go is worse than not
  // offering the destination: it reads as a feature that is nearly here, and
  // this one has no schema behind it. Where the absence actually needs
  // explaining - a squad's Rep sitting at 0 forever - it is explained in
  // place, on the Rep line itself, which is where the question gets asked.
  //
  // The panel, its markup and the branch in openSquadsScreen are all left
  // where they are, so shipping this is putting the line back and building
  // the thing. See db/migrations/20260730_04_squad_rep.sql and
  // 20260731_03_squad_rep_tournaments_only.sql for what rep is waiting on.
  // { id: "tournaments", label: "Tournaments" },
];

export function renderSquadsTopTabs(container, active, onSelect) {
  container.innerHTML = "";
  for (const tab of SQUADS_TOP_TABS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "subtab" + (tab.id === active ? " active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => onSelect(tab.id));
    container.appendChild(btn);
  }
}

// ---- Friends --------------------------------------------------------------

/** Open challenges (created via challengeFriend, not yet entered) where the
 * caller is a participant - "X challenged you" if they didn't start it,
 * "Waiting on X" if they did (opening it just re-enters the same draft). */
export function renderFriendChallenges(container, challenges, onJoin) {
  container.innerHTML = "";
  if (!challenges.length) {
    renderNote(container, "No open challenges.");
    return;
  }
  for (const c of challenges) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("span");
    info.textContent = c.iChallenged ? `Waiting on ${c.opponentUsername}` : `${c.opponentUsername} challenged you!`;
    row.appendChild(info);
    row.appendChild(smallBtn(c.iChallenged ? "Open" : "Join", () => onJoin(c.matchId)));
    container.appendChild(row);
  }
}

/** Incoming (accept/decline) and outgoing (cancel) friend requests in one
 * list, distinguished by which action they offer - there's rarely more
 * than one or two of either at a time, so a shared list reads fine. */
export function renderFriendRequests(container, incoming, outgoing, callbacks) {
  container.innerHTML = "";
  if (!incoming.length && !outgoing.length) {
    renderNote(container, "No pending requests.");
    return;
  }
  for (const r of incoming) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("span");
    info.textContent = `${r.username} wants to be friends`;
    row.appendChild(info);
    const actions = document.createElement("div");
    actions.className = "friend-row-actions";
    actions.appendChild(smallBtn("Accept", () => callbacks.onAccept(r.requesterId)));
    actions.appendChild(smallBtn("Decline", () => callbacks.onDecline(r.requesterId), "btn-danger-small"));
    row.appendChild(actions);
    container.appendChild(row);
  }
  for (const r of outgoing) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const info = document.createElement("span");
    info.textContent = `Request sent to ${r.username}`;
    row.appendChild(info);
    row.appendChild(smallBtn("Cancel", () => callbacks.onCancel(r.addresseeId), "btn-danger-small"));
    container.appendChild(row);
  }
}

/** Accepted friends ranked among themselves by online win rate (see
 * listFriendsLeaderboard in friends.js) - your own row is included so
 * "where do I stand against my friends" doesn't need a second screen. */
export function renderFriendsLeaderboard(container, entries, callbacks) {
  container.innerHTML = "";
  if (entries.length <= 1) {
    renderNote(container, "Add some friends to build a leaderboard.");
    return;
  }
  entries.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "friend-row friend-leaderboard-row" + (entry.isMe ? " mine" : "");

    const rank = document.createElement("span");
    rank.className = "friend-rank";
    rank.textContent = `#${i + 1}`;
    row.appendChild(rank);

    // Each player's equipped banner, at thumbnail size - the leaderboard was
    // the one place friends are listed side by side with no sign of what
    // anyone has actually earned, which is the whole point of banners.
    const banner = entry.equippedBanner ? bannerById(entry.equippedBanner) : null;
    if (banner) {
      const art = bannerArt(banner);
      art.classList.add("friend-banner");
      art.title = banner.name;
      row.appendChild(art);
    }

    // Name and record split into their own lines rather than one run-on
    // string ("Name — 3-1 (75%)") - the record reads as a stat, not a
    // continuation of the name, and it no longer visually collides with the
    // rank/action buttons when the row wraps on a narrow screen.
    const identity = document.createElement("div");
    identity.className = "friend-identity";

    const name = document.createElement("span");
    name.className = "friend-name";
    name.textContent = entry.username + (entry.isMe ? " (you)" : "");
    identity.appendChild(name);

    const record = document.createElement("span");
    record.className = "friend-record";
    const pct = entry.gamesPlayed > 0 ? `${Math.round(100 * entry.winRate)}%` : "—";
    record.textContent = `${entry.onlineWins}-${entry.onlineLosses} online · ${pct} win rate`;
    identity.appendChild(record);

    row.appendChild(identity);

    if (!entry.isMe) {
      const actions = document.createElement("div");
      actions.className = "friend-row-actions";
      actions.appendChild(smallBtn("Challenge", () => callbacks.onChallenge(entry.userId)));
      actions.appendChild(smallBtn("Remove", () => callbacks.onRemove(entry.userId), "btn-danger-small"));
      row.appendChild(actions);
    }

    container.appendChild(row);
  });
}
