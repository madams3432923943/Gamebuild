import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sourceDir = join(here, "seasons-nfl");
const output = join(here, "nfl-source-manifest.json");

if (!existsSync(sourceDir)) {
  throw new Error(`Missing ${sourceDir}. Run fetch-nfl-seasons.mjs first.`);
}

const files = readdirSync(sourceDir)
  .filter((name) => name.endsWith(".csv"))
  .sort()
  .map((name) => {
    const path = join(sourceDir, name);
    const bytes = readFileSync(path);
    const seasonMatch = name.match(/(\d{4})\.csv$/);
    const season = seasonMatch ? Number(seasonMatch[1]) : null;
    return {
      name,
      season,
      // Games carries every season in one file and comes from a DIFFERENT
      // nflverse repository, so it cannot share the per-season upstream.
      // Recording the wrong origin would be worse than recording none: the
      // manifest is what a future reader trusts to re-fetch the inputs.
      kind: season === null ? "games" : "weekly",
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      upstream: season === null
        ? "https://github.com/nflverse/nfldata/raw/master/data/games.csv"
        : `https://github.com/nflverse/nflverse-data/releases/download/stats_player/${name}`,
    };
  });

if (files.length === 0) throw new Error("No NFL source CSV files found.");

const manifest = {
  schema_version: 1,
  source: "nflverse/nflverse-data stats_player release assets; nflverse/nfldata games.csv",
  generated_at: new Date().toISOString(),
  file_count: files.length,
  seasons: [...new Set(files.map((file) => file.season).filter(Number.isInteger))],
  files,
};

writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${output} with ${files.length} files.`);
