// Squads and friends.
//
// Four subtabs sharing one screen: Friends (add/accept, leaderboard,
// challenges), Home (browse/create when squad-less, or squad info + roster
// once in one), Chat and Tournaments (both "coming soon" placeholders).
//
// Chat was built and then switched off before launch - see the panel in
// index.html for why, and js/squads.js for the client half that went with it.
//
// Split out of main.js because it is the largest block there with almost no
// connection to the game loop - none of it runs during a draft, and keeping it
// alongside the simulation meant every search of the gameplay code walked
// through five hundred lines of squad administration.
//
// The one thing it does need from the game side is "join this challenge",
// which lives in the online flow. That arrives through initSquadsScreen()
// rather than by importing it: squads would import the online flow, and
// main.js imports squads, which is a cycle.

import {
  squadRankInfo, myMembership, loadSquadRoster, loadMySquad, listPublicSquads,
  createSquad, joinPublicSquad, joinSquadByCode,
  leaveSquad, kickMember, setMemberRole, transferLeadership, regenerateInviteCode,
  updateSquadSettings, disbandSquad,
} from "../squads.js";
import {
  sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend,
  challengeFriend, listFriendsLeaderboard, listIncomingRequests,
  listOutgoingRequests, listPendingChallenges,
} from "../friends.js";
import {
  renderSquadEmojiPalette, renderSquadBrowseList, renderSquadHeader,
  renderSquadRoster, renderSquadsTopTabs,
  renderFriendChallenges, renderFriendRequests, renderFriendsLeaderboard,
} from "../ui.js";
import { getSession } from "../supabaseClient.js";
import { showScreen, openModal, closeModal } from "../shell.js";
import { game } from "../state.js";

// Supplied by main.js at boot - see the header comment.
let onJoinMatch = () => {};
let currentSportId = () => "nba";

export function initSquadsScreen({ joinMatch, getSport }) {
  onJoinMatch = joinMatch;
  currentSportId = getSport;
}


const squadsTabsEl = document.getElementById("squads-tabs");
const squadsPanelFriendsEl = document.getElementById("squads-panel-friends");
const squadsPanelHomeEl = document.getElementById("squads-panel-home");
const squadsPanelChatEl = document.getElementById("squads-panel-chat");
const squadsPanelTournamentsEl = document.getElementById("squads-panel-tournaments");

const squadsBrowseEl = document.getElementById("squads-browse");
const squadsDetailEl = document.getElementById("squads-detail");
const squadStatusEl = document.getElementById("squad-status");
const squadSearchInput = document.getElementById("input-squad-search");
const squadsListEl = document.getElementById("squads-list");
const squadHeaderEl = document.getElementById("squad-header");
const squadRosterEl = document.getElementById("squad-roster");

const friendUsernameInput = document.getElementById("input-friend-username");
const friendChallengesListEl = document.getElementById("friend-challenges-list");
const friendRequestsListEl = document.getElementById("friend-requests-list");
const friendsLeaderboardEl = document.getElementById("friends-leaderboard");

// Which of the four subtabs is showing, kept across visits like every other
// subtab pattern in this app.
let activeSquadsTab = "home";

// Cache of the last-loaded squad detail, so toggling the settings editor is
// a pure re-render (no round trip) - only actual mutations refetch. Cleared
// whenever the player leaves the squads tab or their squad changes.
let squadDetailData = null;
let squadEditing = false;

function setSquadStatus(message, kind) {
  squadStatusEl.textContent = message || "";
  squadStatusEl.classList.toggle("hidden", !message);
  squadStatusEl.classList.toggle("auth-error", kind === "error");
}

/** Runs a squads.js mutation, shows its error message inline (these are
 * already player-facing text - see the `raise exception` strings in the
 * squads_*_rpcs migrations) instead of throwing, and refreshes the screen
 * on success. Used by every button that changes squad/roster state. */
async function runSquadAction(fn) {
  try {
    await fn();
    setSquadStatus("");
  } catch (e) {
    setSquadStatus(e.message || "Something went wrong.", "error");
    return;
  }
  await openSquadsScreen();
}

/** Same shape as runSquadAction, for friends.js mutations - kept separate
 * because it refreshes only the Friends panel, not the whole screen. */
async function runFriendAction(fn) {
  try {
    await fn();
    setSquadStatus("");
  } catch (e) {
    setSquadStatus(e.message || "Something went wrong.", "error");
    return;
  }
  await loadFriendsPanel();
}

let squadSearchDebounce = null;
squadSearchInput.addEventListener("input", () => {
  clearTimeout(squadSearchDebounce);
  squadSearchDebounce = setTimeout(() => refreshSquadBrowseList(squadSearchInput.value), 300);
});

async function refreshSquadBrowseList(search = "") {
  try {
    const squads = await listPublicSquads(search);
    renderSquadBrowseList(squadsListEl, squads, (squadId) => runSquadAction(() => joinPublicSquad(squadId)));
  } catch (e) {
    console.error("Failed to load squads:", e);
    setSquadStatus("Couldn't load squads right now.", "error");
  }
}

export async function openSquadsScreen() {
  showScreen("squads");
  renderSquadsTopTabs(squadsTabsEl, activeSquadsTab, (tab) => {
    activeSquadsTab = tab;
    openSquadsScreen();
  });
  setSquadStatus("");

  squadsPanelFriendsEl.classList.toggle("hidden", activeSquadsTab !== "friends");
  squadsPanelHomeEl.classList.toggle("hidden", activeSquadsTab !== "home");
  squadsPanelChatEl.classList.toggle("hidden", activeSquadsTab !== "chat");
  squadsPanelTournamentsEl.classList.toggle("hidden", activeSquadsTab !== "tournaments");

  // Chat and Tournaments are both static "coming soon" panels - no membership
  // lookup, no network call, nothing to load.
  if (activeSquadsTab === "friends") {
    await loadFriendsPanel();
    return;
  }
  if (activeSquadsTab === "tournaments" || activeSquadsTab === "chat") {
    return;
  }

  squadDetailData = null;
  squadEditing = false;
  try {
    const membership = await myMembership();
    if (!membership) {
      squadsBrowseEl.classList.remove("hidden");
      squadsDetailEl.classList.add("hidden");
      await refreshSquadBrowseList(squadSearchInput.value);
      return;
    }
    squadsBrowseEl.classList.add("hidden");
    squadsDetailEl.classList.remove("hidden");
    // Needed before the roster renders, so Add Friend is hidden on people
    // you're already connected to rather than appearing then vanishing.
    await refreshKnownFriendIds();
    await loadSquadDetail();
  } catch (e) {
    console.error("Failed to load squad membership:", e);
    setSquadStatus("Couldn't load your squad right now.", "error");
  }
}

/** Fetches the caller's squad + roster + rank and renders the Home tab. */
async function loadSquadDetail() {
  const detail = await loadMySquad();
  if (!detail) {
    // Left/kicked between the membership check and here - just re-enter.
    await openSquadsScreen();
    return;
  }
  const rankInfo = squadRankInfo(detail.squad);
  const session = await getSession();
  squadDetailData = { ...detail, rankInfo, myUserId: session.user.id };
  renderSquadDetailFromCache();
}

/** Re-renders the header + roster from the cached detail - no network call.
 * Used after toggling the settings editor, which is pure UI state. */
function renderSquadDetailFromCache() {
  if (!squadDetailData) return;
  const { squad, myRole, roster, inviteCode, rankInfo, myUserId } = squadDetailData;
  renderSquadHeader(
    squadHeaderEl,
    { squad, myRole, memberCount: roster.length, rankInfo, inviteCode, editing: squadEditing },
    {
      onToggleEdit: () => {
        squadEditing = !squadEditing;
        renderSquadDetailFromCache();
      },
      onRegenerateCode: () => runSquadAction(() => regenerateInviteCode()),
      onDisband: () => {
        if (!window.confirm(`Disband ${squad.name}? This removes every member and can't be undone.`)) return;
        runSquadAction(() => disbandSquad());
      },
      // Don't optimistically close the editor here - runSquadAction only
      // re-renders (via a full openSquadsScreen(), which naturally resets
      // squadEditing) on success. On failure it leaves the form exactly as
      // the player left it, with their typed changes intact, so flipping
      // squadEditing here first would desync in-memory state from what's
      // still on screen if the save fails.
      onSaveSettings: ({ emoji, motto, visibility }) => {
        runSquadAction(() => updateSquadSettings({ emoji, motto, visibility }));
      },
    }
  );

  renderSquadRoster(
    squadRosterEl,
    roster,
    myUserId,
    myRole,
    {
      onSetRole: (userId, role) => runSquadAction(() => setMemberRole(userId, role)),
      onTransfer: (userId) => {
        if (!window.confirm("Make this player the new leader? You'll become a co-leader.")) return;
        runSquadAction(() => transferLeadership(userId));
      },
      onKick: (userId) => {
        if (!window.confirm("Remove this player from the squad?")) return;
        runSquadAction(() => kickMember(userId));
      },
      onAddFriend: (username) => addFriendFromSquad(username),
    },
    squadKnownFriendIds
  );
}

/** Ids we already have a friendship row with (accepted OR pending, either
 * direction) - the squad roster hides its Add Friend button for these, so it
 * never offers a request the server would reject as a duplicate. Refreshed
 * whenever the squad screen loads; an empty set just means every button
 * shows, which is the safe direction to fail in. */
let squadKnownFriendIds = new Set();

export async function refreshKnownFriendIds() {
  try {
    const [leaderboard, incoming, outgoing] = await Promise.all([
      listFriendsLeaderboard(),
      listIncomingRequests(),
      listOutgoingRequests(),
    ]);
    squadKnownFriendIds = new Set([
      ...leaderboard.map((e) => e.userId),
      ...incoming.map((r) => r.requesterId),
      ...outgoing.map((r) => r.addresseeId),
    ]);
  } catch (e) {
    console.error("Couldn't load existing friendships:", e);
    squadKnownFriendIds = new Set();
  }
}

async function addFriendFromSquad(username) {
  try {
    await sendFriendRequest(username);
  } catch (e) {
    window.alert(`Couldn't send that friend request: ${e.message}`);
    return;
  }
  await refreshKnownFriendIds();
  renderSquadDetailFromCache();
}

document.getElementById("btn-leave-squad").addEventListener("click", () => {
  const label = squadDetailData ? squadDetailData.squad.name : "your squad";
  if (!window.confirm(`Leave ${label}?`)) return;
  runSquadAction(() => leaveSquad());
});


// ---- Friends panel ----

async function loadFriendsPanel() {
  try {
    const [challenges, incoming, outgoing, leaderboard] = await Promise.all([
      listPendingChallenges(),
      listIncomingRequests(),
      listOutgoingRequests(),
      listFriendsLeaderboard(),
    ]);
    renderFriendChallenges(friendChallengesListEl, challenges, onJoinChallenge);
    renderFriendRequests(friendRequestsListEl, incoming, outgoing, {
      onAccept: (id) => runFriendAction(() => acceptFriendRequest(id)),
      onDecline: (id) => runFriendAction(() => declineFriendRequest(id)),
      // Cancelling a request you sent uses the same RPC as declining one you
      // received - decline_friend_request checks both directions.
      onCancel: (id) => runFriendAction(() => declineFriendRequest(id)),
    });
    renderFriendsLeaderboard(friendsLeaderboardEl, leaderboard, {
      onChallenge: onChallengeFriend,
      onRemove: (friendId) => {
        if (!window.confirm("Remove this friend?")) return;
        runFriendAction(() => removeFriend(friendId));
      },
    });
  } catch (e) {
    console.error("Failed to load friends:", e);
    setSquadStatus("Couldn't load friends right now.", "error");
  }
}

// Deliberately NOT routed through runFriendAction: success here means
// leaving the squads screen entirely for the draft screen, which a
// loadFriendsPanel()/openSquadsScreen() refresh afterward would undo.
async function onChallengeFriend(friendId) {
  try {
    const matchId = await challengeFriend(friendId, currentSportId(), getEra());
    await onJoinMatch(matchId);
  } catch (e) {
    setSquadStatus(e.message || "Couldn't start that challenge.", "error");
  }
}

async function onJoinChallenge(matchId) {
  try {
    await onJoinMatch(matchId);
  } catch (e) {
    setSquadStatus(e.message || "Couldn't open that match.", "error");
  }
}

document.getElementById("btn-send-friend-request").addEventListener("click", async () => {
  const username = friendUsernameInput.value.trim();
  if (!username) return;
  try {
    await sendFriendRequest(username);
    friendUsernameInput.value = "";
    setSquadStatus("");
  } catch (e) {
    setSquadStatus(e.message || "Couldn't send that request.", "error");
    return;
  }
  await loadFriendsPanel();
});

document.getElementById("btn-join-by-code").addEventListener("click", () => {
  const wrap = document.createElement("div");

  const field = document.createElement("div");
  field.className = "field-row";
  field.innerHTML = `<label for="input-join-code">Invite code</label>`;
  const codeInput = document.createElement("input");
  codeInput.id = "input-join-code";
  codeInput.type = "text";
  codeInput.maxLength = 6;
  codeInput.placeholder = "e.g. BDF870";
  field.appendChild(codeInput);
  wrap.appendChild(field);

  const errorEl = document.createElement("div");
  errorEl.className = "auth-status hidden";
  wrap.appendChild(errorEl);

  const joinBtn = document.createElement("button");
  joinBtn.type = "button";
  joinBtn.className = "btn btn-primary btn-block";
  joinBtn.textContent = "Join Squad";
  joinBtn.addEventListener("click", async () => {
    const code = codeInput.value.trim();
    if (!code) return;
    try {
      await joinSquadByCode(code);
    } catch (e) {
      errorEl.textContent = e.message || "That code didn't work.";
      errorEl.classList.remove("hidden");
      errorEl.classList.add("auth-error");
      return;
    }
    closeModal();
    await openSquadsScreen();
  });
  wrap.appendChild(joinBtn);

  openModal("Join by Invite Code", wrap);
});

document.getElementById("btn-create-squad").addEventListener("click", () => {
  const wrap = document.createElement("div");
  let chosenEmoji = "🏀";

  const nameField = document.createElement("div");
  nameField.className = "field-row";
  nameField.innerHTML = `<label for="input-squad-name">Name</label>`;
  const nameInput = document.createElement("input");
  nameInput.id = "input-squad-name";
  nameInput.type = "text";
  nameInput.maxLength = 30;
  nameInput.placeholder = "3-30 characters";
  nameField.appendChild(nameInput);
  wrap.appendChild(nameField);

  const tagField = document.createElement("div");
  tagField.className = "field-row";
  tagField.innerHTML = `<label for="input-squad-tag">Tag</label>`;
  const tagInput = document.createElement("input");
  tagInput.id = "input-squad-tag";
  tagInput.type = "text";
  tagInput.maxLength = 5;
  tagInput.placeholder = "2-5 letters/numbers";
  tagField.appendChild(tagInput);
  wrap.appendChild(tagField);

  const emojiLabel = document.createElement("div");
  emojiLabel.className = "field-row";
  emojiLabel.innerHTML = `<label>Crest</label>`;
  wrap.appendChild(emojiLabel);
  const emojiPalette = document.createElement("div");
  emojiPalette.className = "squad-emoji-palette";
  wrap.appendChild(emojiPalette);
  const paintCreatePalette = () => {
    renderSquadEmojiPalette(emojiPalette, chosenEmoji, (emoji) => {
      chosenEmoji = emoji;
      paintCreatePalette();
    });
  };
  paintCreatePalette();

  const mottoField = document.createElement("div");
  mottoField.className = "field-row";
  mottoField.innerHTML = `<label for="input-squad-motto">Motto (optional)</label>`;
  const mottoInput = document.createElement("textarea");
  mottoInput.id = "input-squad-motto";
  mottoInput.maxLength = 120;
  mottoInput.rows = 2;
  mottoField.appendChild(mottoInput);
  wrap.appendChild(mottoField);

  const visField = document.createElement("div");
  visField.className = "field-row";
  visField.innerHTML = `<label for="input-squad-visibility">Visibility</label>`;
  const visSelect = document.createElement("select");
  visSelect.id = "input-squad-visibility";
  visSelect.innerHTML = `<option value="public">Public - anyone can join</option><option value="private">Private - invite code only</option>`;
  visField.appendChild(visSelect);
  wrap.appendChild(visField);

  const errorEl = document.createElement("div");
  errorEl.className = "auth-status hidden";
  wrap.appendChild(errorEl);

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "btn btn-primary btn-block";
  createBtn.textContent = "Create Squad";
  const showCreateError = (message) => {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
    errorEl.classList.add("auth-error");
  };

  createBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    const tag = tagInput.value.trim();
    if (!name || !tag) return;
    // Client-side checks matching the squads table's own constraints, so a
    // bad tag surfaces a readable message here instead of a raw Postgres
    // check-constraint error from the RPC (which only catches name/tag
    // uniqueness itself, not format - see create_squad in the migrations).
    if (name.length < 3 || name.length > 30) {
      showCreateError("Name must be 3-30 characters.");
      return;
    }
    if (!/^[A-Za-z0-9]{2,5}$/.test(tag)) {
      showCreateError("Tag must be 2-5 letters or numbers, no spaces or symbols.");
      return;
    }
    try {
      await createSquad({ name, tag, emoji: chosenEmoji, motto: mottoInput.value.trim(), visibility: visSelect.value });
    } catch (e) {
      showCreateError(e.message || "Couldn't create that squad.");
      return;
    }
    closeModal();
    await openSquadsScreen();
  });
  wrap.appendChild(createBtn);

  openModal("Create a Squad", wrap);
});

