// Arena Elo: the public provisional rating of a model before and as its vibes settle.

import type { GameState, Model } from '../../types';
import { clamp } from '../../util';
import { hashNormal } from '../data';
import { LAB_TUNING } from './tuning';

// ---------------------------------------------------------------------------
// Arena Elo
// ---------------------------------------------------------------------------

/** Arena Elo as the public currently sees it. Vibes show up as the window closes; before that it is noise. */
export function provisionalElo(s: GameState, m: Model): { elo: number; provisional: boolean; band: number } {
  const base = LAB_TUNING.ELO_BASE + LAB_TUNING.ELO_PER_POINT * m.overall;
  // v6: a measured internal arena (GAME_DESIGN §17.3) replaces the guess as the starting point, pre-release and after.
  const measured = m.arena?.elo;
  const noise = hashNormal(s.seed, `elo:${m.id}`, LAB_TUNING.VIBES_SD);
  const start = measured ?? base + noise;
  const startBand = measured !== undefined ? (m.arena?.band ?? LAB_TUNING.VIBES_SD) : LAB_TUNING.VIBES_SD;
  if (m.releasedDay === null || m.eloSettlesDay === undefined) {
    return { elo: start, provisional: true, band: startBand };
  }
  const window = Math.max(1, m.eloSettlesDay - m.releasedDay);
  const p = clamp((s.day - m.releasedDay) / window, 0, 1);
  // Converges on the true arena rating (base + vibes) as the window closes.
  const elo = start + (base + (m.vibes ?? 0) - start) * p;
  return { elo, provisional: p < 1, band: startBand * (1 - p) };
}
