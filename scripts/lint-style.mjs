// Enforces the hard rules from DESIGN.md ("Signal" design system, v18). Usage: node scripts/lint-style.mjs [--strict]
// --strict adds the v18 migration rules (no slants, no caps outside pills, house Check/Select only). It becomes the
// default once every screen is migrated.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dirs = ['src/ui', 'src/office', 'src/scenes'];
const files = [];
function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx)$/.test(n)) files.push(p);
  }
}
for (const d of dirs) walk(join(root, d));

/** Literal radii up to this size are fine for small parts (chips, keys, swatches). Bigger shapes use the tokens. */
const MAX_LITERAL_RADIUS = 16;
const STRICT = process.argv.includes('--strict');

const problems = [];
const EMOJI = /\p{Extended_Pictographic}/u;
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  const isTheme = rel === 'src/ui/theme.css';
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  const inComponents = rel.startsWith('src/ui/components/');
  let selector = '';
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (EMOJI.test(line)) problems.push(`${at}  emoji: ${line.trim().slice(0, 80)}`);
    if (rel.endsWith('.css')) {
      const code = line.replace(/\/\*.*?\*\//g, '');
      if (/\{/.test(code)) selector = code;
      if (isTheme) return;
      if (STRICT) {
        // v18: no slanted parallelograms; caps only on pills, eyebrows and keys.
        if (/clip-path:\s*polygon/.test(code)) problems.push(`${at}  clip-path polygon (slants are gone in Signal)`);
        if (/text-transform:\s*uppercase/.test(code) && !/(pill|eyebrow|kbd|chip)/.test(selector)) problems.push(`${at}  uppercase outside pills/eyebrows (sentence case)`);
      }
      // Colours, gradients and depth live in theme tokens.
      if (/#[0-9a-fA-F]{3,8}\b/.test(code)) problems.push(`${at}  raw hex colour (use tokens)`);
      if (/gradient\(/.test(code)) problems.push(`${at}  gradient outside theme.css (add a token)`);
      if (/box-shadow:/.test(code) && !/:\s*none/.test(code) && !/var\(--/.test(code)) problems.push(`${at}  box-shadow without a token (use --shadow-*, --ring or a var() colour)`);
      if (/(text-shadow|backdrop-filter|filter:\s*blur|drop-shadow)/.test(code) && !/:\s*none/.test(code)) problems.push(`${at}  glow/blur (not part of the look)`);
      const r = code.match(/border-radius:\s*([^;]+)/);
      if (r) {
        for (const part of r[1].trim().split(/\s+/)) {
          if (/^var\(--r-/.test(part) || part === '0' || part === '50%' || part === 'inherit') continue;
          const px = part.match(/^([\d.]+)px$/);
          if (!px || +px[1] > MAX_LITERAL_RADIUS) problems.push(`${at}  border-radius ${part} (use var(--r-*) above ${MAX_LITERAL_RADIUS}px)`);
        }
      }
      if (/@keyframes\s+(bounce|wobble|shake|glow|float|jiggle)/i.test(code)) problems.push(`${at}  decorative animation`);
    } else {
      // Inline styles in TSX follow the same rules.
      if (/(textShadow|backdropFilter|drop-shadow)/.test(line)) problems.push(`${at}  glow/blur in inline style`);
      if (/boxShadow:\s*['"`](?![^'"`]*var\(--)/.test(line)) problems.push(`${at}  boxShadow without a token in inline style`);
      if (/(linear|radial|conic)-gradient\(/.test(line)) problems.push(`${at}  gradient in inline style`);
      if (STRICT && !inComponents) {
        if (/<select\b/.test(line)) problems.push(`${at}  raw <select> (use components/Select)`);
        if (/type=["']checkbox["']/.test(line)) problems.push(`${at}  raw checkbox (use components/Check)`);
      }
      const r = line.match(/borderRadius:\s*['"]?(\d+)/);
      if (r && +r[1] > MAX_LITERAL_RADIUS) problems.push(`${at}  borderRadius > ${MAX_LITERAL_RADIUS}px in inline style`);
    }
  });
}
if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\nstyle lint: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('style lint: OK');
