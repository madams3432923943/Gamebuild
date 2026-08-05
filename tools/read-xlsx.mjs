// A minimal .xlsx reader: enough to pull rows out of a Basketball-Reference
// export and nothing more.
//
// Why not a library: this repo has no build step and no runtime dependencies
// beyond esbuild and Playwright, both dev-only. Adding a spreadsheet parser to
// read one file at import time would be the largest dependency in the project,
// used by a script that runs once when the data changes.
//
// An .xlsx is a zip of XML. Everything below is the small subset that implies:
// find the sheets, read the shared-string table, walk the rows. It handles the
// two things that actually bite - shared strings and blank cells - and would
// not survive a formula, a date, or a merged cell. It does not need to: the
// input is a stats export, which is text and numbers in a grid.

import { readFileSync } from "fs";
import { inflateRawSync } from "zlib";

/** Reads the zip central directory and returns { name -> Buffer }. */
function unzip(buf) {
  const files = {};
  // End of central directory record, scanned from the back because the
  // comment field it may carry is variable length.
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    // The local header repeats the name and extra fields, and its extra length
    // can differ from the central one - so it has to be read, not assumed.
    const lhNameLen = buf.readUInt16LE(localOffset + 26);
    const lhExtraLen = buf.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(start, start + compSize);

    files[name] = method === 0 ? raw : inflateRawSync(raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const stripTags = (s) => s.replace(/<[^>]+>/g, "");

/** Excel escapes these in XML; a player name with an ampersand would otherwise
 * come through as "&amp;". */
function unescapeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * Every sheet in the workbook, as { name, rows } where rows[0] is the header.
 *
 * Cells are returned as strings - the caller knows which columns are numbers,
 * and Basketball-Reference writes percentages as decimals that would lose
 * precision through a float round-trip here for no benefit.
 */
export function readWorkbook(path) {
  const files = unzip(readFileSync(path));
  const text = (name) => (files[name] ? files[name].toString("utf8") : "");

  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>(.*?)<\/si>/gs)].map((m) =>
    unescapeXml(stripTags(m[1]))
  );

  // Sheet order in workbook.xml matches sheetN.xml only by relationship id, so
  // the rels file is what maps a sheet's NAME to its file.
  const rels = new Map(
    [...text("xl/_rels/workbook.xml.rels").matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [
      m[1],
      m[2].replace(/^\/?xl\//, ""),
    ])
  );

  const sheets = [];
  for (const m of text("xl/workbook.xml").matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const [, name, rid] = m;
    const target = rels.get(rid);
    if (!target) continue;
    const xml = text(`xl/${target}`);
    const rows = [];
    for (const rowMatch of xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
      const cells = [];
      for (const c of rowMatch[1].matchAll(/<c([^>]*)>(?:<v>([^<]*)<\/v>|<is>(.*?)<\/is>)?/gs)) {
        const [, attrs, v, inline] = c;
        if (inline !== undefined) {
          cells.push(unescapeXml(stripTags(inline)));
        } else if (v === undefined) {
          cells.push("");
        } else if (/t="s"/.test(attrs)) {
          cells.push(shared[Number(v)] ?? "");
        } else {
          cells.push(v);
        }
      }
      rows.push(cells);
    }
    sheets.push({ name: unescapeXml(name), rows });
  }
  return sheets;
}
