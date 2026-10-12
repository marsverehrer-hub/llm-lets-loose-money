// Writes the PWA icons into public/ as PNG, using only Node built-ins (zlib, fs).
// Mark: "LLM" in the terminal's pixel letters, amber on the dark background, with a block cursor after it.
// Colours come from the dark theme tokens (src/ui/theme.css): --bg #121417, --amber #f2a94e.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [0x12, 0x14, 0x17];
const FG = [0xf2, 0xa9, 0x4e];

// 5 x 7 pixel letters, '#' = ink.
const GLYPHS = {
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
};
// Layout in cells: "L", gap, "L", gap, "M", gap, cursor (3 cells wide, full height of the letters).
const WORD = ['L', 'L', 'M'];
const COLS = WORD.length * 5 + (WORD.length - 1) + 1 + 3;
const ROWS = 7;

/** Cell mask for the mark: true where amber ink goes. */
function markCell(col, row) {
  let x = col;
  for (let i = 0; i < WORD.length; i++) {
    if (x < 5) return GLYPHS[WORD[i]][row][x] === '#';
    x -= 5;
    if (i < WORD.length - 1) {
      if (x < 1) return false;
      x -= 1;
    }
  }
  // gap before the cursor
  if (x < 1) return false;
  x -= 1;
  return x < 3; // solid cursor block
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** Encodes an RGB PNG. `pixel(x, y)` returns [r, g, b]. */
function encodePng(size, pixel) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Icon of `size` px. `fill` is the share of the width the mark may use (the maskable icon keeps it inside the
 * safe zone). The background is the theme background everywhere, so no transparency is needed.
 */
function icon(size, fill) {
  const cell = Math.max(1, Math.floor((size * fill) / COLS));
  const w = COLS * cell;
  const h = ROWS * cell;
  const x0 = Math.floor((size - w) / 2);
  const y0 = Math.floor((size - h) / 2);
  return encodePng(size, (x, y) => {
    const cx = Math.floor((x - x0) / cell);
    const cy = Math.floor((y - y0) / cell);
    if (x < x0 || y < y0 || cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return BG;
    return markCell(cx, cy) ? FG : BG;
  });
}

const outputs = [
  ['icon-192.png', icon(192, 0.7)],
  ['icon-512.png', icon(512, 0.7)],
  ['icon-512-maskable.png', icon(512, 0.5)],
  ['apple-touch-icon.png', icon(180, 0.7)],
];
for (const [name, png] of outputs) {
  writeFileSync(join(root, name), png);
  console.log(`wrote public/${name} (${png.length} bytes)`);
}
