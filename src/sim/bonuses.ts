import type { Bonuses, ContractKind, GameState } from './types';
import { RESEARCH } from './data/research';
import { doctrineById } from './data/doctrines';
import { NEUTRAL_BONUSES } from './util';
import { perkById } from './data/perks';

const RESEARCH_BY_ID = new Map(RESEARCH.map((r) => [r.id, r] as const));

/** Aggregate passive multipliers from completed research, hired stars and the lab doctrine (multiplicative). */
export function getBonuses(s: GameState): Bonuses {
  const b: Bonuses = { ...NEUTRAL_BONUSES };
  // Missing (optional v8) fields count as 1.
  const apply = (p?: Partial<Bonuses>) => {
    if (!p) return;
    for (const k of Object.keys(p) as (keyof Bonuses)[]) b[k] = (b[k] ?? 1) * (p[k] ?? 1);
  };
  for (const id of s.research.completed) apply(RESEARCH_BY_ID.get(id)?.bonuses);
  for (const star of s.staff.stars) if (star.hiredDay !== null) apply(star.bonuses);
  // v8: the lab doctrine (GAME_DESIGN §19.1). Undefined = neutral.
  apply(doctrineById(s.company.doctrine)?.bonuses);
  // v13: bought lab perks and the board's confidence in the lab (GAME_DESIGN §23).
  for (const id of s.progress?.perks ?? []) apply(perkById(id)?.bonuses);
  if (s.board) apply({ valuation: boardValuationMult(s.board.confidence) });
  // Temporary event modifiers: flags named `bonus.<key>` hold a multiplier, `bonusUntil.<key>` the expiry day
  for (const k of Object.keys(b) as (keyof Bonuses)[]) {
    const m = s.flags[`bonus.${k}`];
    const until = s.flags[`bonusUntil.${k}`];
    if (m && (until === undefined || until >= s.day)) b[k] = (b[k] ?? 1) * m;
  }
  return b;
}

/**
 * v8: the lab doctrine's fit multiplier for one kind of B2B deal (1 when the doctrine doesn't care).
 * Contract bids read this instead of Bonuses.contractFit, which doctrines don't set.
 */
export function contractFitMult(s: GameState, kind: ContractKind): number {
  // v13: lab perks raise the fit on every kind of deal.
  return (doctrineById(s.company.doctrine)?.contractFit?.[kind] ?? 1) * (getBonuses(s).contractFit ?? 1);
}

/** v13: board confidence 0..100 moves the valuation multiple between ×0.94 and ×1.06 (50 = neutral). */
export function boardValuationMult(confidence: number): number {
  return 1 + 0.12 * (Math.max(0, Math.min(100, confidence)) - 50) / 100;
}
