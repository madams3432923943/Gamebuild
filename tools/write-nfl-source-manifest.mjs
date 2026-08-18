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
    return {
      name,
      season: seasonMatch ? Number(seasonMatch[1]) : null,
      bytes: statSync(path).size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      upstream: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/${name}`,
    };
  });

if (files.length === 0) throw new Error("No NFL source CSV files found.");

const manifest = {
  schema_version: 1,
  source: "nflverse/nflverse-data stats_player release assets",
  generated_at: new Date().toISOString(),
  file_count: files.length,
  seasons: [...new Set(files.map((file) => file.season).filter(Number.isInteger))],
  files,
};

writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${output} with ${files.length} files.`);
