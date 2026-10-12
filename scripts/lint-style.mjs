// Enforces the hard rules from DESIGN.md. Usage: node scripts/lint-style.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const dirs = ['src/ui', 'src/office'];
const files = [];
function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(css|tsx)$/.test(n)) files.push(p);
  }
}
for (const d of dirs) walk(join(root, d));

const problems = [];
const EMOJI = /\p{Extended_Pictographic}/u;
for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, '/');
  const isTheme = rel === 'src/ui/theme.css';
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (EMOJI.test(line)) problems.push(`${at}  emoji: ${line.trim().slice(0, 80)}`);
    if (rel.endsWith('.css')) {
      const code = line.replace(/\/\*.*?\*\//g, '');
      if (!isTheme && /gradient\(/.test(code)) problems.push(`${at}  gradient`);
      if (/(box-shadow|text-shadow|drop-shadow|backdrop-filter|filter:\s*blur)/.test(code) && !/:\s*none/.test(code)) problems.push(`${at}  shadow/blur`);
      const r = code.match(/border-radius:\s*([\d.]+)(px|%|rem|em)?/);
      if (r && !(r[2] === 'px' || r[2] === undefined ? +r[1] <= 2 : false)) problems.push(`${at}  border-radius > 2px`);
      if (!isTheme && /#[0-9a-fA-F]{3,8}\b/.test(code)) problems.push(`${at}  raw hex colour (use tokens)`);
      if (/@keyframes\s+(fade|pop|slide|glow|float|bounce)/i.test(code)) problems.push(`${at}  decorative animation`);
    } else {
      // inline styles in TSX
      if (/(boxShadow|textShadow|drop-shadow|backdropFilter)/.test(line)) problems.push(`${at}  shadow/blur in inline style`);
      if (/(linear|radial|conic)-gradient\(/.test(line)) problems.push(`${at}  gradient in inline style`);
      if (/borderRadius:\s*['"]?([3-9]|\d{2,})/.test(line)) problems.push(`${at}  borderRadius > 2px`);
    }
  });
}
if (problems.length) {
  console.log(problems.join('\n'));
  console.log(`\nstyle lint: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('style lint: OK');
