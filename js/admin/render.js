// Drawing the dashboard. Numbers in, DOM out; no fetching, no authorization,
// no opinions about where the data came from.
//
// SEPARATE FROM main.js because they fail differently. main.js is the part
// that can be told "you are not allowed"; this is the part that can be handed
// a shape it did not expect. Keeping them apart is also what makes the render
// testable from Node without a session (scripts/verify-admin-dashboard.mjs).
//
// "DO NOT FAKE A METRIC THAT CANNOT BE CALCULATED" IS THE DESIGN RULE HERE. A
// null from the server is drawn as an em dash with the reason beside it, never
// as 0 and never as 0%. Retention before there is a cohort, and games-per-user
// before there is an active user, are both genuinely unknown - and a zero on a
// business dashboard is a fact, not a shrug.

const NO_DATA = "—";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A whole number with thousands separators, or an em dash. */
function count(value) {
  if (value === null || value === undefined) return NO_DATA;
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : NO_DATA;
}

function percent(value) {
  if (value === null || value === undefined) return NO_DATA;
  const n = Number(value);
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : NO_DATA;
}

function decimal(value) {
  if (value === null || value === undefined) return NO_DATA;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : NO_DATA;
}

/** One labelled figure. `note` is for the reason a value is unknown, which is
 * the only thing worth saying next to an em dash. */
function stat(label, value, note) {
  const box = el("div", "stat");
  box.appendChild(el("span", "stat-value", value));
  box.appendChild(el("span", "stat-label", label));
  if (note) box.appendChild(el("span", "stat-note", note));
  return box;
}

function section(title, ...children) {
  const wrap = el("section", "panel");
  wrap.appendChild(el("h2", "panel-title", title));
  for (const child of children) if (child) wrap.appendChild(child);
  return wrap;
}

function statRow(...stats) {
  const row = el("div", "stat-row");
  for (const s of stats) row.appendChild(s);
  return row;
}

/**
 * A breakdown as a table with its own total, because a breakdown whose parts
 * do not visibly add up is the one people mistrust. Rows are sorted by size:
 * on a dashboard the question is "which is biggest", and alphabetical order
 * answers a question nobody asked.
 */
function breakdown(map, emptyNote) {
  const entries = Object.entries(map || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) return el("p", "panel-note", emptyNote);

  const total = entries.reduce((sum, [, n]) => sum + Number(n || 0), 0);
  const table = el("table", "admin-table");
  const body = el("tbody");
  for (const [key, n] of entries) {
    const tr = el("tr");
    tr.appendChild(el("th", null, key));
    tr.appendChild(el("td", "num", count(n)));
    // The share, which is the thing being looked for. Guarded because a
    // breakdown can legitimately total zero.
    tr.appendChild(el("td", "num muted", total ? `${((Number(n) / total) * 100).toFixed(1)}%` : NO_DATA));
    body.appendChild(tr);
  }
  const foot = el("tr", "admin-table-total");
  foot.appendChild(el("th", null, "Total"));
  foot.appendChild(el("td", "num", count(total)));
  foot.appendChild(el("td"));
  body.appendChild(foot);
  table.appendChild(body);
  return table;
}

/** The funnel, drawn in the order the steps actually happen rather than in
 * whatever order the object came back in - a funnel sorted by size is not a
 * funnel. Steps with no data still appear, at zero: a stage nobody reached is
 * the most interesting row on the chart. */
const FUNNEL_ORDER = [
  ["signup_completed", "Signed up"],
  ["onboarding_viewed", "Saw the welcome"],
  ["onboarding_completed", "Finished the welcome"],
  ["sport_selected", "Chose a sport"],
  ["mode_selected", "Chose a mode"],
  ["practice_difficulty_selected", "Chose a difficulty"],
  ["draft_started", "Started a draft"],
  ["draft_completed", "Finished a draft"],
  ["simulation_started", "Watched a simulation"],
  ["game_completed", "Completed a game"],
  ["ranked_queue_joined", "Queued for ranked"],
  ["ranked_match_found", "Matched with someone"],
  ["ranked_game_completed", "Completed a ranked game"],
  ["friend_added", "Added a friend"],
  ["friend_challenge_sent", "Challenged a friend"],
  ["friend_game_completed", "Completed a friend game"],
  ["share_card_created", "Made a share card"],
  ["share_card_shared", "Shared one"],
  ["sponsor_impression", "Saw a sponsor slot"],
  ["sponsor_click", "Clicked one"],
];

function funnelTable(funnel) {
  if (!funnel) return el("p", "panel-note", "The funnel query failed - see the console.");
  const events = funnel.events || {};
  // The widest step is the bar scale. Using signups instead would make every
  // bar unreadable the moment one step legitimately exceeds them (an existing
  // player drafting has no new signup behind it).
  const widest = Math.max(1, ...FUNNEL_ORDER.map(([key]) => Number(events[key]?.users || 0)));

  const table = el("table", "admin-table admin-funnel");
  const body = el("tbody");
  for (const [key, label] of FUNNEL_ORDER) {
    const users = Number(events[key]?.users || 0);
    const total = Number(events[key]?.count || 0);
    const tr = el("tr");
    tr.appendChild(el("th", null, label));
    const barCell = el("td", "funnel-bar-cell");
    const bar = el("div", "funnel-bar");
    // Set through the CSSOM, which the CSP allows; this app never writes a
    // style ATTRIBUTE (see the policy note in index.html).
    bar.style.width = `${(users / widest) * 100}%`;
    barCell.appendChild(bar);
    tr.appendChild(barCell);
    tr.appendChild(el("td", "num", count(users)));
    tr.appendChild(el("td", "num muted", count(total)));
    body.appendChild(tr);
  }
  table.appendChild(body);

  const wrap = el("div");
  wrap.appendChild(
    el("p", "panel-note", `Distinct players per step over the last ${funnel.days || 30} days. The second column is the raw event count.`)
  );
  const scroller = el("div", "table-scroll");
  scroller.appendChild(table);
  wrap.appendChild(scroller);
  return wrap;
}

function retentionRow(retention) {
  const wrap = el("div");
  if (!retention || (!retention.day_1 && !retention.day_7)) {
    wrap.appendChild(
      el(
        "p",
        "panel-note",
        retention?.tracking_since
          ? `No cohort has closed yet. Activity tracking began ${retention.tracking_since}; Day 1 needs a signup at least one day old, Day 7 at least seven.`
          : "Nothing to measure yet: activity tracking has not recorded a day. These stay blank rather than reading 0%."
      )
    );
    return wrap;
  }
  const d1 = retention.day_1;
  const d7 = retention.day_7;
  wrap.appendChild(
    statRow(
      stat("Day 1 retention", d1 ? percent(d1.rate) : NO_DATA, d1 ? `${count(d1.retained)} of ${count(d1.cohort)}` : "no closed cohort"),
      stat("Day 7 retention", d7 ? percent(d7.rate) : NO_DATA, d7 ? `${count(d7.retained)} of ${count(d7.cohort)}` : "no closed cohort")
    )
  );
  wrap.appendChild(
    el("p", "panel-note", `Cohorts are accounts created since activity tracking began (${retention.tracking_since || "unknown"}), counted as retained if they were active on exactly that day.`)
  );
  return wrap;
}

/**
 * Draws the whole dashboard into `root`, replacing whatever was there.
 *
 * @param overview the admin_overview() document.
 * @param funnel the admin_funnel() document, or null if that query failed -
 *   the funnel is then reported as missing rather than as empty.
 */
export function renderDashboard(root, overview, funnel) {
  root.replaceChildren();
  if (!overview) {
    root.appendChild(el("p", "admin-status admin-status-error", "The overview query returned nothing."));
    return;
  }

  const users = overview.users || {};
  const activity = overview.activity || {};
  const games = overview.games || {};
  const engagement = overview.engagement || {};

  root.appendChild(
    section(
      "Users",
      statRow(
        stat("Total accounts", count(users.total)),
        stat("New today", count(users.today)),
        stat("New this week", count(users.this_week)),
        stat("New this month", count(users.this_month))
      )
    )
  );

  root.appendChild(
    section(
      "Activity",
      statRow(
        stat("DAU", count(activity.dau)),
        stat("WAU", count(activity.wau)),
        stat("MAU", count(activity.mau))
      ),
      el(
        "p",
        "panel-note",
        activity.tracking_since
          ? `One row per player per day they opened the app. Tracking began ${activity.tracking_since}, so any window reaching further back is short by definition.`
          : "No active days recorded yet - these are zero because nothing has been measured, not because nobody played."
      )
    )
  );

  root.appendChild(
    section(
      "Games",
      statRow(
        stat("Today", count(games.today)),
        stat("This week", count(games.this_week)),
        stat("This month", count(games.this_month)),
        stat("All time", count(games.total))
      ),
      el(
        "p",
        "panel-note",
        "Online and friend games come from the match tables, which are authoritative. Practice games have no match row at all and are counted from their completion event."
      )
    )
  );

  const breakdowns = el("div", "panel-grid");
  breakdowns.appendChild(section("By sport", breakdown(overview.by_sport, "No games recorded.")));
  breakdowns.appendChild(section("By mode", breakdown(overview.by_mode, "No games recorded.")));
  breakdowns.appendChild(
    section(
      "Practice difficulty",
      breakdown(overview.by_difficulty, "No practice game has recorded a difficulty yet.")
    )
  );
  root.appendChild(breakdowns);

  root.appendChild(
    section(
      "Engagement",
      statRow(
        stat(
          "Games per active user",
          decimal(engagement.games_per_active_user),
          // THE WINDOW, ALWAYS. Both halves of this ratio are measured over
          // the same period, and that period is only as long as active-day
          // tracking is old - see 20260911_04, which exists because the first
          // version divided thirty days of games by one day of actives and
          // returned 67. Saying "last 1 day" is the difference between a
          // short measurement and a wrong one.
          engagement.games_per_active_user === null || engagement.games_per_active_user === undefined
            ? "no active players to divide by yet"
            : `last ${count(engagement.games_per_active_user_days)} ${Number(engagement.games_per_active_user_days) === 1 ? "day" : "days"} — as far back as activity tracking goes`
        ),
        stat("Signed up, never finished a game", count(engagement.accounts_with_no_completed_game)),
        stat("First-game completion rate", percent(engagement.first_game_completion_rate), "share of all accounts")
      )
    )
  );

  root.appendChild(section("Retention", retentionRow(funnel?.retention)));
  root.appendChild(section("Funnel", funnelTable(funnel)));
}
