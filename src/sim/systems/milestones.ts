// OWNER: Agent C. Achievement checks.
import type { GameState, Rng } from '../types';
import { ACHIEVEMENTS } from '../data/achievements';
import { notify, pushNews } from '../util';

export function milestonesTick(s: GameState, rng: Rng): void {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements[a.id] !== undefined) continue;
    if (!a.check(s)) continue;
    s.achievements[a.id] = s.day;
    notify(s, `${a.icon} Achievement unlocked: ${a.name}`, 'milestone');
    pushNews(s, `${a.icon} ${a.name}: ${a.description}`, 'milestone');
  }
}
