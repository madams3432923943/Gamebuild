// The one place Node reads a dataset from.
//
// The datasets used to be ES modules, so every script that wanted players
// wrote `import { PLAYERS } from "../data/nba-players.js"` - twenty-two of
// them, each naming the path, the file extension and the export. That is
// twenty-two things to edit to change anything about how the data is stored,
// which is most of the reason it stayed an ES module long after that had
// become the expensive choice (see data/README.md).
//
// Now they are JSON and there is one reader. A script asks for a dataset by
// NAME and gets rows back; where the file is, what it is called and how it is
// parsed are this file's business.
//
// BROWSERS DO NOT COME HERE. `fs` does not exist there, and the browser has a
// better option anyway: js/sports/<id>/index.js fetches the same JSON on
// demand, when its sport is chosen, so opening basketball never costs football.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Dataset name -> file. The names are what callers use; the filenames are not
 * part of anyone else's vocabulary. */
const DATASETS = {
  "nba-players": "nba-players.json",
  "nfl-players": "nfl-players.json",
  "nfl-units": "nfl-units.json",
};

const cache = new Map();

/**
 * Rows of one dataset.
 *
 * Cached per process, because a check that loads the same 2MB file four times
 * spends most of its runtime parsing it. Returns the SAME array each call, so
 * a caller that sorts it in place changes what the next caller sees - which is
 * true of the module import this replaces too, and is why nothing here copies:
 * a defensive copy of 10,290 rows on every call would cost more than the parse
 * this cache exists to avoid.
 */
export async function loadDataset(name) {
  const file = DATASETS[name];
  if (!file) {
    // Named rather than returning empty. An unknown dataset is a typo in a
    // script, and an empty pool looks like a sport with no players.
    throw new Error(`Unknown dataset "${name}". Known: ${Object.keys(DATASETS).join(", ")}`);
  }
  if (!cache.has(name)) {
    cache.set(name, JSON.parse(await readFile(path.join(HERE, file), "utf8")));
  }
  return cache.get(name);
}

/** Where a dataset lives, for the generators that WRITE one and for any check
 * that needs to stat the file rather than read it. */
export const datasetPath = (name) => path.join(HERE, DATASETS[name] || `${name}.json`);

export const DATASET_NAMES = Object.keys(DATASETS);
