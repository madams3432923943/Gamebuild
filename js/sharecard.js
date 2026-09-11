// The postgame share card: one image a player would actually post.
//
// WHY A CANVAS AND NOT A SCREENSHOT LIBRARY. html2canvas and friends are the
// obvious reach and the wrong one here twice over. The page's CSP allows
// scripts from esm.sh and nothing else, so a screenshot library is a
// dependency to justify; and the postgame screen is a 1100px-wide desktop
// layout, so a screenshot of it is a wide, cropped, illegible Story. A card
// drawn from the RESULT is composed for the format it is going into.
//
// WHY IT NEVER RECOMPUTES ANYTHING. Every number on the card comes in as an
// argument, taken from the same authoritative result the post-game screen just
// rendered - the score, the winner, the MVP and the MVP's line, all of them
// server-computed for an online game. This module has no access to an engine, a
// dataset or a rating formula, which is the structural version of the rule:
// there is nothing here that COULD disagree with the screen behind it. A share
// card that said 112-108 over a box score reading 110-108 would be worse than
// no share card at all.
//
// 1080x1920 because that is what a Story is. The same drawing code produces a
// square by changing two numbers (see FORMATS), which was cheap because
// everything below is laid out from the canvas dimensions rather than from
// hardcoded pixel positions.

/** The output sizes. 1080x1920 is the Instagram/TikTok Story and the vertical
 * shape a phone shares by default; the square is for X and Discord, where a
 * 9:16 image is shown as a tall sliver. */
export const FORMATS = {
  story: { id: "story", label: "Story", width: 1080, height: 1920 },
  square: { id: "square", label: "Square", width: 1080, height: 1080 },
};

const INK = "#eef2f8";
const MUTED = "#93a1b5";
const BG = "#0d1117";
const PANEL = "#171d27";
const PANEL_LINE = "#2a323e";
const WIN = "#3fcf8e";
const LOSS = "#e8433d";

// A stack rather than a family: a canvas has no webfont to wait for, and the
// platform UI face is what every other native share card is set in anyway.
const DISPLAY = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
const MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

function font(size, weight = 400, family = DISPLAY) {
  return `${weight} ${size}px ${family}`;
}

/** Draws `text` shrinking the size until it fits `maxWidth`, down to a floor.
 * A username can be twenty characters and a unit name can be forty, and a card
 * whose text runs off the edge is a card nobody posts. */
function fitText(ctx, text, size, weight, maxWidth, { family = DISPLAY, min = 12 } = {}) {
  let current = size;
  ctx.font = font(current, weight, family);
  while (ctx.measureText(text).width > maxWidth && current > min) {
    current -= 2;
    ctx.font = font(current, weight, family);
  }
  return current;
}

/** Truncates with an ellipsis once shrinking has hit its floor. Belt and
 * braces for the pathological case - a 40-character unit name in a roster
 * row - where even the minimum size does not fit. */
function clip(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A centred pill with a label in it. Returns its height so the caller can
 * advance; every block on this card reports its own height rather than the
 * layout knowing all of them, which is what lets the square format reflow. */
function pill(ctx, text, centreX, y, { accent, size = 30 }) {
  ctx.font = font(size, 700);
  const padX = size * 0.8;
  const width = ctx.measureText(text).width + padX * 2;
  const height = size * 2;
  const x = centreX - width / 2;
  ctx.fillStyle = accent;
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fill();
  ctx.fillStyle = BG;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, centreX, y + height / 2 + 1);
  // The RECTANGLE, not just the height: a test asserting that a loss is not
  // drawn in the win colour has to know where to look.
  return { x, y, width, height };
}

/**
 * Paints the ground and nothing else.
 *
 * Exported because scripts/verify-share-card.mjs needs a content-free card of
 * the same size to diff against: the accent wash reaches the very edge of the
 * canvas on purpose, so "is anything drawn in the outer frame" cannot be
 * answered by comparing against a flat colour. It draws this, then diffs the
 * frame, and any difference is content that has run off the layout.
 */
export function drawCardBackground(ctx, width, height, accent) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, width, height);

  // A wash in the SPORT's accent, top and bottom, so a basketball card and a
  // football card are recognisably different objects at thumbnail size. Very
  // low contrast on purpose: the failure mode is a neon esports template.
  const wash = ctx.createLinearGradient(0, 0, 0, height);
  wash.addColorStop(0, hexWithAlpha(accent, 0.22));
  wash.addColorStop(0.45, "rgba(0,0,0,0)");
  wash.addColorStop(1, hexWithAlpha(accent, 0.12));
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Draws the card.
 *
 * @param card the authoritative result, already in the shape the post-game
 *   screen used. See buildShareCard in js/main.js - nothing is derived here.
 * @param format one of FORMATS.
 * @returns { canvas, regions } - the image, and where the blocks landed.
 *
 * WHY IT REPORTS ITS REGIONS. Everything here is laid out from the canvas
 * dimensions and from how tall the preceding block turned out to be, so no
 * block has a fixed position: a practice card has no rating row, and football's
 * roster is twice basketball's. That is what lets one drawing routine serve two
 * aspect ratios, and it means a test cannot assert "the outcome pill is green"
 * by sampling a hardcoded pixel - it would be asserting against last week's
 * layout. Reporting the rectangles makes the check exact and keeps it correct
 * across a redesign.
 */
export function drawShareCard(card, format = FORMATS.story) {
  // TWO PASSES, BECAUSE THE CONTENT HEIGHT IS NOT KNOWN UNTIL IT IS DRAWN.
  //
  // Every block's position depends on how tall the one before it turned out to
  // be - a practice card has no rating row, football's roster is twice
  // basketball's, and a long name shrinks to fit rather than wrapping. So the
  // first pass draws the card to a scratch canvas purely to find out where the
  // content ended, and the second draws it again, offset so the block sits
  // centred in the space above the footer.
  //
  // Without it the card was top-anchored against a bottom-anchored footer, and
  // a short one - a practice game with a two-man roster - had 500px of empty
  // grey between the last line and the domain. It rendered "correctly" and
  // looked like a template somebody had abandoned halfway through.
  //
  // The cost is drawing a 1080x1920 canvas twice, which is a few milliseconds
  // and happens once when the share dialog opens. The alternative - a layout
  // engine that measures without drawing - is a second implementation of every
  // block's height, and the two would drift.
  const probe = paintCard(card, format, null);
  const topMargin = Math.round(format.height * 0.055);
  const contentHeight = probe.regions.contentBottom - probe.startY;
  const footerTop = format.height - Math.round(format.height * 0.035) - Math.round(format.width * 0.032) * 1.5;
  const centred = Math.round((footerTop - contentHeight) / 2);
  return paintCard(card, format, Math.max(topMargin, centred));
}

/** One pass of the card. `startY` null means "use the plain top margin", which
 * is what the measuring pass wants. */
function paintCard(card, format, startY) {
  const canvas = document.createElement("canvas");
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext("2d");
  const W = format.width;
  const H = format.height;
  const M = Math.round(W * 0.074); // the side margin, ~80px at 1080
  const inner = W - M * 2;
  const accent = card.accent || "#d9741f";
  const youWon = !!card.won;

  // Where each block landed, filled in as they are drawn. See the note on the
  // return value.
  const regions = {};

  drawCardBackground(ctx, W, H, accent);

  const top = startY === null || startY === undefined ? Math.round(H * 0.055) : startY;
  let y = top;

  // ---- brand --------------------------------------------------------------
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  const brandSize = Math.round(W * 0.062);
  ctx.font = font(brandSize, 800);
  ctx.fillText("DRAFT NOVA", W / 2, y);
  y += brandSize * 1.15;

  // The sport and the mode, on one line, in the sport's colour. This is the
  // context the score below is meaningless without - a 24-21 means one thing
  // in football and nothing at all in basketball.
  // OVERTIME BELONGS HERE, not in the score panel. It used to be drawn along
  // the bottom edge of that panel, which worked at the Story's proportions and
  // collided with the digits at the square's - a "0" and a "4OT" on top of
  // each other. It is context, like the sport and the mode, so it reads as
  // context.
  ctx.fillStyle = accent;
  const kickerSize = Math.round(W * 0.028);
  ctx.font = font(kickerSize, 700);
  const kicker = [card.sportName, card.modeLabel, card.overtimePeriods > 0 ? `${card.overtimePeriods}OT` : null]
    .filter(Boolean)
    .map((part) => part.toUpperCase())
    .join("  ·  ");
  fitText(ctx, kicker, kickerSize, 700, inner);
  ctx.fillText(kicker, W / 2, y);
  y += kickerSize * 2.6;

  // ---- outcome ------------------------------------------------------------
  const outcome = pill(ctx, youWon ? "WON" : "LOST", W / 2, y, {
    accent: youWon ? WIN : LOSS,
    size: Math.round(W * 0.03),
  });
  regions.outcome = outcome;
  y += outcome.height;
  y += Math.round(H * 0.022);

  // ---- the score, which is the whole point --------------------------------
  // Names above, numbers below, in a mono face so the two scores are the same
  // width apart whatever the digits are. The winner's number is bright and the
  // loser's is muted, but "WON"/"LOST" above says it in words too - win and
  // loss are exactly the pair that has to survive being colourblind.
  // THE PANEL IS AS TALL AS WHAT IS IN IT. It used to be a fraction of the
  // canvas height - 0.17 of the Story and 0.22 of the square - and the digits
  // are sized from the WIDTH, which both formats share. So the same 135px
  // numerals sat in a 326px panel on one and a 238px panel on the other, and
  // on the square they overflowed it by two pixels. Measuring the content and
  // padding it is the only version of this that cannot come apart when a
  // format is added.
  const pad = Math.round(W * 0.032);
  const nameSize = Math.round(W * 0.033);
  const numSize = Math.round(W * 0.125);
  const scoreBoxH = pad * 2 + Math.round(nameSize * 1.35) + Math.round(numSize * 1.12);

  ctx.fillStyle = PANEL;
  roundRect(ctx, M, y, inner, scoreBoxH, 28);
  ctx.fill();
  ctx.strokeStyle = PANEL_LINE;
  ctx.lineWidth = 2;
  ctx.stroke();

  const colW = (inner - 90) / 2;
  const leftX = M + colW / 2 + 14;
  const rightX = W - M - colW / 2 - 14;
  const nameY = y + pad;
  const numY = nameY + Math.round(nameSize * 1.35);

  ctx.textBaseline = "top";
  for (const side of [
    { x: leftX, name: card.you, score: card.scoreFor, winner: youWon },
    { x: rightX, name: card.opponent, score: card.scoreAgainst, winner: !youWon },
  ]) {
    ctx.fillStyle = MUTED;
    const fitted = fitText(ctx, side.name, nameSize, 700, colW);
    ctx.font = font(fitted, 700);
    ctx.fillText(clip(ctx, side.name, colW), side.x, nameY);

    ctx.fillStyle = side.winner ? INK : MUTED;
    ctx.font = font(numSize, 800, MONO);
    ctx.fillText(String(side.score), side.x, numY);
  }

  ctx.strokeStyle = PANEL_LINE;
  ctx.beginPath();
  ctx.moveTo(W / 2, y + pad);
  ctx.lineTo(W / 2, y + scoreBoxH - pad);
  ctx.stroke();

  regions.score = { x: M, y, width: inner, height: scoreBoxH };
  y += scoreBoxH + Math.round(H * 0.022);

  // ---- rating, ranked only ------------------------------------------------
  // OMITTED RATHER THAN GUESSED. A practice game moves no rating, and a ranked
  // game whose new rating had not been read back by the time the card was built
  // has an unknown delta - printing "+0" for either would be inventing a
  // number, so the row simply is not there.
  if (card.ratingDelta !== null && card.ratingDelta !== undefined) {
    const sign = card.ratingDelta > 0 ? "+" : "";
    ctx.fillStyle = card.ratingDelta >= 0 ? WIN : LOSS;
    ctx.font = font(Math.round(W * 0.036), 700);
    const line = card.ratingAfter
      ? `${sign}${card.ratingDelta} RATING  ·  NOW ${card.ratingAfter}`
      : `${sign}${card.ratingDelta} RATING`;
    ctx.fillText(line, W / 2, y);
    y += Math.round(W * 0.036) * 1.9;
  }

  // ---- MVP ----------------------------------------------------------------
  if (card.mvpName) {
    // MEASURED, FOR THE SAME REASON AS THE SCORE PANEL ABOVE, and this is
    // where it actually showed: the three lines were placed at 0.16, 0.38 and
    // 0.68 of a box whose height was a fraction of the canvas, so on the
    // square - a shorter box holding the same width-derived text - the MVP's
    // name and his stat line were drawn on top of each other. A long name
    // ("Cleveland Browns Offensive Line") made it unmistakable.
    const mvpPad = Math.round(W * 0.026);
    const kickSize = Math.round(W * 0.023);
    const nameMax = inner - mvpPad * 2 - 20;
    const mvpSize = fitText(ctx, card.mvpName, Math.round(W * 0.047), 800, nameMax);
    const lineSize = card.mvpLine ? fitText(ctx, card.mvpLine, Math.round(W * 0.028), 400, nameMax) : 0;
    const mvpH =
      mvpPad * 2 +
      Math.round(kickSize * 1.5) +
      Math.round(mvpSize * 1.25) +
      (card.mvpLine ? Math.round(lineSize * 1.35) : 0);

    regions.mvp = { x: M, y, width: inner, height: mvpH };
    ctx.fillStyle = PANEL;
    roundRect(ctx, M, y, inner, mvpH, 24);
    ctx.fill();
    ctx.strokeStyle = hexWithAlpha(accent, 0.45);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let my = y + mvpPad;

    ctx.fillStyle = accent;
    ctx.font = font(kickSize, 700);
    ctx.fillText("MAN OF THE MATCH", W / 2, my);
    my += Math.round(kickSize * 1.5);

    ctx.fillStyle = INK;
    ctx.font = font(mvpSize, 800);
    ctx.fillText(clip(ctx, card.mvpName, nameMax), W / 2, my);
    my += Math.round(mvpSize * 1.25);

    if (card.mvpLine) {
      ctx.fillStyle = MUTED;
      ctx.font = font(lineSize, 400);
      ctx.fillText(clip(ctx, card.mvpLine, nameMax), W / 2, my);
    }
    y += mvpH + Math.round(H * 0.022);
  }

  // ---- roster -------------------------------------------------------------
  // THE PLAYER'S OWN ROSTER AND NOBODY ELSE'S. This is the part of a draft
  // game worth arguing about in a group chat - "you took WHO at centre" - and
  // on the Story card it is a reason to post it at all.
  //
  // AND THE SQUARE CARD DOES NOT HAVE IT. Measured rather than judged: at
  // 1080x1080 the brand, the sport line, the outcome, the score panel, a ranked
  // rating line and the MVP block already reach y=788, and the footer starts at
  // 1007. Five roster rows need about 260px. An earlier version tried anyway
  // and the content ran to y=1149 on a 1080 canvas - the roster printed over
  // the footer and off the bottom edge, which scripts/verify-share-card.mjs
  // caught as a real failure on a real fixture.
  //
  // The square is for X and Discord, where the card is read small; the result,
  // the MVP and the rating are what survive at that size, and a three-row
  // roster teaser would not have been worth the crowding even if it fitted. So
  // the two formats are deliberately different cards: the Story is the full
  // one, the square is the result.
  const roster = format.id === "square" ? [] : (Array.isArray(card.roster) ? card.roster : []);
  const maxRows = 8;
  if (roster.length) {
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = font(Math.round(W * 0.023), 700);
    ctx.fillText("MY ROSTER", M + 6, y);
    y += Math.round(W * 0.023) * 2.1;

    const rowSize = Math.round(W * 0.03);
    const rowGap = rowSize * 1.62;
    for (const entry of roster.slice(0, maxRows)) {
      ctx.fillStyle = accent;
      ctx.font = font(rowSize * 0.82, 700);
      const slotW = Math.round(W * 0.13);
      ctx.fillText(clip(ctx, entry.slot, slotW - 10), M + 6, y);

      ctx.fillStyle = INK;
      ctx.font = font(rowSize, 400);
      const nameMax = inner - slotW - 12 - Math.round(W * 0.09);
      ctx.fillText(clip(ctx, entry.name, nameMax), M + 6 + slotW, y);

      // The season, because "which Kobe" is the actual question a draft game
      // asks and a bare name does not answer it.
      if (entry.season) {
        ctx.fillStyle = MUTED;
        ctx.font = font(rowSize * 0.85, 400, MONO);
        ctx.textAlign = "right";
        ctx.fillText(String(entry.season), W - M - 6, y);
        ctx.textAlign = "left";
      }
      y += rowGap;
    }
    if (roster.length > maxRows) {
      ctx.fillStyle = MUTED;
      ctx.font = font(rowSize * 0.85, 400);
      ctx.fillText(`+${roster.length - maxRows} more`, M + 6, y);
      y += rowGap;
    }
  }

  // ---- footer -------------------------------------------------------------
  // Anchored to the BOTTOM, not to wherever the content ran out. The blocks
  // above vary in height - a practice game has no rating row, football's
  // roster is longer - and a footer that floated up with them would sit in the
  // middle of the card on a short one.
  ctx.textAlign = "center";
  ctx.fillStyle = MUTED;
  ctx.font = font(Math.round(W * 0.032), 700);
  ctx.textBaseline = "bottom";
  ctx.fillText("DraftNovaGame.com", W / 2, H - Math.round(H * 0.035));

  // The last y the content reached, so a test can tell a card whose blocks
  // overflowed the canvas from one that merely has a lot on it.
  regions.contentBottom = y;
  return { canvas, regions, startY: top };
}

/** A hex colour with an alpha, for the accent washes. Accepts the #rrggbb the
 * sport themes are written in; anything else is passed through, which for a
 * CSS colour function is still a valid fillStyle. */
function hexWithAlpha(hex, alpha) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!match) return hex;
  const n = parseInt(match[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** A PNG blob of the card. Async because toBlob is. */
export function cardBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the card."))), "image/png");
  });
}

/** The filename a saved card gets. Dated and named for the matchup, so a
 * folder of them is readable rather than card(3).png. */
export function cardFilename(card, format) {
  const safe = (s) => String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "game";
  const date = new Date().toISOString().slice(0, 10);
  return `draft-nova-${safe(card.sportName)}-${safe(card.you)}-vs-${safe(card.opponent)}-${date}-${format.id}.png`;
}

/**
 * Hands the card to the OS share sheet, or saves it, or reports why neither
 * worked.
 *
 * THE FALLBACK CHAIN IS THE FEATURE. navigator.share with a file is the good
 * path and is not available on most desktop browsers; canShare() has to be
 * asked about the actual file rather than just checked for existence, because
 * several browsers expose share() and refuse files. A dismissed share sheet
 * throws AbortError, which is a person changing their mind and not a failure to
 * report.
 *
 * @returns "shared" | "saved" - what actually happened, so the caller can say
 *   so. Throws only when nothing worked.
 */
export async function shareCard(canvas, card, format) {
  const blob = await cardBlob(canvas);
  const filename = cardFilename(card, format);
  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: "Draft Nova" });
      return "shared";
    } catch (e) {
      // The person closed the sheet. Not an error, and not a reason to then
      // download a file they did not ask for.
      if (e?.name === "AbortError") return "shared";
      console.error("Share sheet failed, falling back to a download:", e);
    }
  }

  saveCard(canvas, card, format);
  return "saved";
}

/**
 * Saves the card as a file.
 *
 * A blob: URL rather than base64 in the href: the PNG is a few hundred KB, and
 * as a data: URL that is the same again as a string sitting in the DOM. The
 * page's CSP does not restrict an anchor's href - img-src is what governs
 * blob:, which is why the PREVIEW in the dialog uses a data: URL and this does
 * not.
 *
 * Revoked on a timeout rather than immediately: the click is dispatched
 * synchronously but the browser reads the URL after the handler returns, and
 * revoking it in between cancels the download.
 */
export function saveCard(canvas, card, format) {
  canvas.toBlob((blob) => {
    if (!blob) {
      console.error("Could not encode the share card for download.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = cardFilename(card, format);
    // Appended before clicking: Firefox ignores the click on a detached anchor.
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  }, "image/png");
}

/** A data: URL of the card, for showing it on screen. The CSP allows `data:`
 * in img-src and not `blob:`, so the preview and the download deliberately use
 * different encodings of the same canvas. */
export function cardPreviewUrl(canvas) {
  return canvas.toDataURL("image/png");
}
