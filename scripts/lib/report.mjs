// Shared reporting primitives for the verification harness.
//
// Every check produced anywhere in the harness is the same shape, so the
// console renderer, the JSON report and the exit code all read one structure
// rather than each script inventing its own.

export const PASS = "pass";
export const FAIL = "fail";
export const WARN = "warn";
export const SKIP = "skip";

/**
 * @param {string} id      stable machine-readable key, safe for CI to assert on
 * @param {string} title   one line a human can read without the codebase open
 * @param {string} status  PASS | FAIL | WARN | SKIP
 * @param {object} extra   { detail, evidence, table, durationMs, artifacts }
 */
export function check(id, title, status, extra = {}) {
  return { id, title, status, ...extra };
}

const ICONS = { [PASS]: "PASS", [FAIL]: "FAIL", [WARN]: "WARN", [SKIP]: "SKIP" };
const COLORS = {
  [PASS]: "\x1b[32m",
  [FAIL]: "\x1b[31m",
  [WARN]: "\x1b[33m",
  [SKIP]: "\x1b[90m",
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (text, color) => (useColor ? `${color}${text}${RESET}` : text);

export function renderCheck(c) {
  const tag = paint(`[${ICONS[c.status]}]`, COLORS[c.status] || "");
  const ms = c.durationMs != null ? paint(` (${formatMs(c.durationMs)})`, COLORS[SKIP]) : "";
  const lines = [`  ${tag} ${c.title}${ms}`];
  if (c.detail) {
    for (const line of String(c.detail).split("\n")) lines.push(`         ${line}`);
  }
  if (c.table) lines.push(indent(renderTable(c.table), 9));
  if (c.artifacts?.length) {
    for (const a of c.artifacts) lines.push(`         ${paint("artifact:", COLORS[SKIP])} ${a}`);
  }
  return lines.join("\n");
}

export function renderSection(name) {
  return `\n${useColor ? BOLD : ""}${name}${useColor ? RESET : ""}`;
}

function indent(text, n) {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

/** Fixed-width table. `rows` is an array of arrays; the first row is a header
 * when `header` is true. Column widths are measured, not guessed, so a long
 * player name doesn't shear the columns apart. */
export function renderTable(rows, header = true) {
  if (!rows.length) return "";
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] || 0, String(cell).length);
    });
  }
  const line = (row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join("  ").trimEnd();
  const out = [line(rows[0])];
  if (header) out.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows.slice(1)) out.push(line(row));
  return out.join("\n");
}

export function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** A run is a failure if anything failed. Warnings are surfaced loudly but
 * do not fail the build: they mark things that are true today and worth
 * knowing (a skipped online leg, a tolerance actually being used) rather
 * than defects. */
export function summarize(checks) {
  const counts = { [PASS]: 0, [FAIL]: 0, [WARN]: 0, [SKIP]: 0 };
  for (const c of checks) counts[c.status] = (counts[c.status] || 0) + 1;
  return { counts, ok: counts[FAIL] === 0 };
}
