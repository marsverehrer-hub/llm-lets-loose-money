// Rival lab CEOs: one cheap decision a week, driven by style. They use the same blueprints, runs and prices as the player.
import type { Blueprint, Company, GameState, Modality, Style } from './types';
import { dot, rand } from './rand';
import { availableTechs, RUSH, SLOTS } from './resolve';
import { autoPrice, PRICE_STEPS } from './demand';
import { canRaise, raise } from './books';
import { startRun } from './run';
import { MODALITIES } from './content/modalities';
import { archsOf } from './content/tech';
import { RIVAL_LABS } from './content/flavor';

interface StyleDef { seg: number; budget: number; exp: number; post: number; bias: number; gap: number; weeks: 4 | 6 | 8 }
// seg = index of the segment the style builds for (consumer, developers/ads, enterprise/studios, frontier/stock).
const STYLES: Record<Style, StyleDef> = {
  hype: { seg: 0, budget: 0.4, exp: 0.03, post: 0.05, bias: 0.2, gap: 12, weeks: 4 },
  research: { seg: 3, budget: 0.35, exp: 0.2, post: 0.05, bias: 0.3, gap: 20, weeks: 8 },
  safety: { seg: 2, budget: 0.3, exp: 0.12, post: 0.08, bias: 0, gap: 18, weeks: 8 },
  follower: { seg: 1, budget: 0.3, exp: 0.05, post: 0.05, bias: 0, gap: 14, weeks: 6 },
  pricewar: { seg: 0, budget: 0.3, exp: 0.05, post: 0.12, bias: -0.5, gap: 10, weeks: 6 },
};

export function aiBlueprint(s: GameState, co: Company, m: Modality, compute: number): Blueprint {
  const st = STYLES[co.ceo.style];
  const mod = MODALITIES[m];
  const w = mod.segments[st.seg].w;
  const cheap = co.ceo.style === 'pricewar' ? 1 : 0.2;
  const raw = mod.data.map((d) => Math.pow(dot(d.A, w), 2));
  const total = raw.reduce((a, b) => a + b, 0);
  const mix = Object.fromEntries(mod.data.map((d, i) => [d.id, raw[i] / total]));
  const arch = archsOf(m).map((a) => ({ a, v: dot(a.cap, w) - 5 * cheap * Math.log(a.cost) - 3 * a.instab }))
    .sort((x, y) => y.v - x.v)[0].a.id;
  const techniques = availableTechs(s, co.id, m)
    .map((t) => ({ t, v: dot(t.cap ?? [0, 0, 0, 0], w) - 8 * cheap * Math.log(t.cost ?? 1) + (co.ceo.style === 'safety' ? 20 : 2) * (t.trust ?? 0)
      + 6 * Math.log(t.computeMult ?? 1) - 3 * (t.instab ?? 0) + (co.ceo.style === 'research' ? t.week / 40 : 0) }))
    .filter((x) => x.v > 0.5).sort((x, y) => y.v - x.v).slice(0, SLOTS).map((x) => x.t.id);
  return {
    modality: m, arch, compute, weeks: st.weeks, split: { scale: 1 - st.exp - st.post, exp: st.exp, post: st.post },
    sizeBias: st.bias, mix, techniques, post: co.ceo.style === 'pricewar' ? 'distill' : w.indexOf(Math.max(...w)),
  };
}

export function aiTick(s: GameState, co: Company): void {
  const def = RIVAL_LABS.find((r) => r.id === co.id);
  if (!def || !co.lab) return;
  const st = STYLES[co.ceo.style];
  const burn = co.cost - co.rev;
  if (canRaise(s, co) && (co.cash < 0 || (burn > 0 && co.cash < 6 * burn))) {
    raise(s, co);
    s.log.push({ week: s.week, co: co.id, tone: 'info', text: `${co.name} sells new shares to keep the lights on.` });
  }
  const running = Object.values(s.runs).some((r) => r.lab === co.id && r.status === 'running');
  if (!running && s.week - co.lab.lastLaunch >= st.gap && co.cash > 3e6) {
    const price = s.market.computePrice * RUSH[st.weeks];
    const compute = Math.max(40, (st.budget * co.cash * (0.8 + 0.4 * rand(s.seed, s.week, co.id, 'budget'))) / price);
    startRun(s, co.id, aiBlueprint(s, co, def.modality, compute), 'internal', false);
  }
  // Reprice every four weeks; keep the two newest models on sale.
  if ((s.week + co.id.length) % 4 === 0) {
    const mine = Object.values(s.models).filter((m) => m.lab === co.id && !m.retired).sort((a, b) => b.shipped - a.shipped);
    mine.slice(2).forEach((m) => { m.retired = true; });
    for (const m of mine.slice(0, 2)) {
      const p = autoPrice(s, m);
      m.price = co.ceo.style === 'pricewar' ? PRICE_STEPS[Math.max(0, PRICE_STEPS.indexOf(p) - 1)] : p;
    }
  }
}
