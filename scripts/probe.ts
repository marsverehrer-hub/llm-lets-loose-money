// Scratch probe: rivals only, player idle. Prints the shape of the economy. Usage: npx tsx scripts/probe.ts [seed]
import { newGame } from '../src/sim/state';
import { endWeek } from '../src/sim/endWeek';
import { SEGMENTS } from '../src/sim/content/modalities';
import { fitOf } from '../src/sim/demand';

let s = newGame(Number(process.argv[2] ?? 1));
const row = (): void => {
  const labs = Object.values(s.companies).filter((c) => c.id !== 'lab');
  const cells = labs.map((c) => {
    const ms = Object.values(s.models).filter((m) => m.lab === c.id && !m.retired);
    const best = Math.max(0, ...ms.map((m) => m.cap.reduce((a, b) => a + b, 0) / 4));
    return c.id.slice(0, 5) + ' f' + best.toFixed(0) + ' r' + (c.rev / 1e6).toFixed(1) + ' c' + (c.cash / 1e6).toFixed(0) + ' p' + c.price.toFixed(2);
  });
  console.log('w' + s.week + ' cu$' + Math.round(s.market.computePrice) + ' sc' + s.market.scarcity.toFixed(2) + ' ' + cells.join(' | '));
};
row();
for (let i = 0; i < Number(process.argv[3] ?? 144); i++) {
  s = endWeek(s);
  s = { ...s, moments: [], over: false };
  s.companies.lab.negWeeks = 0;
  if (s.week % 48 === 0) row();
}
for (const seg of Object.values(s.segments)) {
  const def = SEGMENTS[seg.id];
  const best = Math.max(...Object.values(s.models).filter((m) => !m.retired && m.modality === def.modality).map((m) => fitOf(def, m.cap)));
  console.log(seg.id, Math.round(seg.size), Object.entries(seg.share).map(([k, v]) => k.slice(0, 5) + ':' + (v * 100).toFixed(0)).join(' '), 'best', best.toFixed(0));
}
for (const m of Object.values(s.models).slice(-7)) {
  console.log(m.lab, m.name, m.cap.map((x) => x.toFixed(0)).join(','), 'x' + m.price, 'c' + m.attrs.cost.toFixed(3), 'N' + (m.params / 1e9).toFixed(1) + 'B', m.techniques.join('+'));
}
