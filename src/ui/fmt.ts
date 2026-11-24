import type { GameState, Id } from '../sim/types';
import { YEAR } from '../sim/goals';
import { money } from '../sim/run';

export { money };
export const weekLabel = (week: number): string => `Year ${Math.floor(week / YEAR) + 1}, week ${(week % YEAR) + 1}`;
export const pct = (x: number, digits = 0): string => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
export const big = (n: number): string => (n >= 1e12 ? `${(n / 1e12).toFixed(1)}T` : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(0)}M` : `${Math.round(n / 1e3)}k`);
export const coName = (s: GameState, id: Id | null): string => (id ? s.companies[id]?.name ?? id : 'Nobody');
export type Tab = 'desk' | 'lab' | 'market' | 'street' | 'empire';
