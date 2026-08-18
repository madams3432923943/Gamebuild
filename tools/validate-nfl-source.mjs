import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "seasons-nfl");
const manifestPath = join(here, "nfl-source-manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error("Missing tools/nfl-source-manifest.json. Run npm run data:nfl:manifest.");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.schema_version !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error("Invalid NFL source manifest.");
}

// One file per season now, carrying offence, defence and kicking together -
// nflverse merged them in the `stats_player` release. The columns checked here
// are the ones the build cannot work without, one from each family, so a
// truncated or reshaped file fails before it can produce a plausible-looking
// but wrong dataset.
const requiredHeaders = {
  weekly: [
    "season", "week", "season_type", "player_display_name", "position", "team",
    "passing_yards", "passing_interceptions", "sacks_suffered",
    "def_tackles_solo", "def_sacks", "fg_att",
  ],
};

function kindFor() {
  return "weekly";
}

const seen = new Map();
for (const file of manifest.files) {
  const path = join(sourceDir, file.name);
  if (!existsSync(path)) throw new Error(`Manifest file is missing: ${file.name}`);

  const bytes = readFileSync(path);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== file.sha256) throw new Error(`Checksum changed for ${file.name}`);
  if (bytes.length !== file.bytes) throw new Error(`Byte size changed for ${file.name}`);

  const firstLine = bytes.toString("utf8", 0, Math.min(bytes.length, 32768)).split(/\r?\n/, 1)[0];
  const headers = new Set(firstLine.split(",").map((value) => value.replace(/^"|"$/g, "")));
  const kind = kindFor(file.name);
  for (const required of requiredHeaders[kind]) {
    if (!headers.has(required)) throw new Error(`${file.name} is missing required column ${required}`);
  }

  if (!Number.isInteger(file.season)) throw new Error(`Season missing from ${file.name}`);
  const seasonKinds = seen.get(file.season) || new Set();
  seasonKinds.add(kind);
  seen.set(file.season, seasonKinds);
}

const expectedSeasons = [...new Set(manifest.seasons)].sort((a, b) => a - b);
for (const season of expectedSeasons) {
  const kinds = seen.get(season) || new Set();
  for (const required of Object.keys(requiredHeaders)) {
    if (!kinds.has(required)) throw new Error(`Season ${season} is missing ${required} data`);
  }
}

for (let i = 1; i < expectedSeasons.length; i++) {
  if (expectedSeasons[i] !== expectedSeasons[i - 1] + 1) {
    throw new Error(`NFL source seasons are not contiguous: ${expectedSeasons[i - 1]} to ${expectedSeasons[i]}`);
  }
}

console.log(`Validated ${manifest.files.length} files across ${expectedSeasons.length} NFL seasons.`);
