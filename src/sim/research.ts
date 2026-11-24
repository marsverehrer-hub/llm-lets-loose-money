// Research: labs spend part of their revenue to get techniques before they go public. Shipping with one leaks it.
import type { Company, GameState, Id, Style } from './types';
import { fitOf, openSegment, segDef } from './demand';
import { SEGMENTS } from './content/modalities';
import { TECHS, type TechDef } from './content/tech';

export const RATES = [0, 0.05, 0.15];
export const LEAK_WEEKS = 26;
const AI_RATE: Record<Style, number> = { research: 0.15, hype: 0.05, safety: 0.05, follower: 0, pricewar: 0 };

/** The week a technique becomes everyone's: its date, or 26 weeks after someone ships with it. */
export const publicWeek = (s: GameState, t: TechDef): number => Math.min(t.week, s.leaks[t.id] ?? Infinity);
/** Weekly research bill: a share of revenue, with a floor so a young lab can still research. */
export const researchSpend = (co: Company): number => { const r = co.lab?.research.rate ?? 0; return r ? Math.max(r * co.rev, r * 2e6) : 0; };
/** Getting a technique costs more the further it is from going public, and more as the field matures. */
export const researchCost = (s: GameState, t: TechDef): number => 1.2e6 * (1 + s.week / 96) * (1 + Math.max(0, publicWeek(s, t) - s.week) / 16);

/** Techniques a lab could research now: not public yet, not owned, and due within two years. */
export function researchable(s: GameState, labId: Id): TechDef[] {
  const own = s.companies[labId]?.lab?.techniques ?? [];
  return TECHS.filter((t) => { const p = publicWeek(s, t); return p > s.week && p - s.week <= 96 && !own.includes(t.id); })
    .sort((a, b) => publicWeek(s, a) - publicWeek(s, b));
}

export function researchTick(s: GameState, flow: Record<Id, { rev: number; cogs: number; cu: number }>): void {
  for (const co of Object.values(s.companies)) {
    const lab = co.lab;
    if (!lab) continue;
    const player = co.id === s.labId && s.helm;
    if (!player) lab.research.rate = AI_RATE[co.ceo.style];
    const spend = co.cash > 0 ? researchSpend(co) : 0;
    if (!spend) continue;
    (flow[co.id] ??= { rev: 0, cogs: 0, cu: 0 }).cogs += spend;
    lab.research.points += spend;
    const options = researchable(s, co.id);
    if (!options.some((t) => t.id === lab.research.aim)) lab.research.aim = options[0]?.id ?? null;
    const aim = options.find((t) => t.id === lab.research.aim);
    if (!aim || lab.research.points < researchCost(s, aim)) continue;
    lab.research.points -= researchCost(s, aim);
    lab.techniques.push(aim.id);
    lab.research.aim = null;
    if (player) s.log.push({ week: s.week, co: co.id, tone: 'good', text: `Research breakthrough: ${aim.name}, ${publicWeek(s, aim) - s.week} weeks before anyone else.` });
  }
}

/** Shipping a model built with private techniques shows everyone how: they go public 26 weeks later. */
export function leak(s: GameState, labId: Id, techniques: Id[]): void {
  for (const id of techniques) {
    const t = TECHS.find((x) => x.id === id);
    if (!t || publicWeek(s, t) <= s.week + LEAK_WEEKS) continue;
    s.leaks[id] = s.week + LEAK_WEEKS;
    s.log.push({ week: s.week, co: labId, tone: labId === s.labId ? 'bad' : 'info', text: `${s.companies[labId].name} shipped with ${t.name}. Everyone will have it in ${LEAK_WEEKS} weeks.` });
  }
}

/** New markets open on schedule; benchmarks that everyone aces are replaced by harder ones. */
export function worldTick(s: GameState): void {
  for (const d of Object.values(SEGMENTS)) if (d.unlockWeek === s.week && !s.segments[d.id]) {
    openSegment(s, d.id);
    s.log.push({ week: s.week, tone: 'good', text: `A new market opens: ${d.name}. ${d.blurb}` });
  }
  for (const seg of Object.values(s.segments)) {
    const base = SEGMENTS[seg.id], next = base.gens?.[seg.gen];
    if (!next) continue;
    const now = segDef(s, seg.id);
    const best = Object.values(s.models).filter((m) => !m.retired && m.modality === base.modality).reduce((b, m) => Math.max(b, fitOf(now, m.cap)), 0);
    if (best < next.at) continue;
    seg.gen++;
    s.log.push({ week: s.week, tone: 'info', text: `${now.bench} is saturated at ${best.toFixed(0)}. ${base.name} now judge models on ${next.name}.` });
  }
}
