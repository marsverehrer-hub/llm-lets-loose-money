// GPU wear: age, annual failure rate, resale value, and the daily failure roll that retires GPUs.
import { COMPUTE_TUNING } from './tuning';
import { gpuById } from './catalogue';
import { isFinished } from './sites';
import { notify } from '../../util';
import type { Datacenter, GameState } from '../../types';

/** v14: age in years of the GPUs of one model in a datacenter (their count-weighted purchase day). */
export function gpuAgeYears(s: GameState, dc: Datacenter, gpuId: string): number {
  const day = dc.bought?.[gpuId];
  return day === undefined ? 0 : Math.max(0, (s.day - day) / 365);
}

/** v14: annual failure rate for a GPU of this age. */
export function annualFailureRate(ageYears: number): number {
  const T = COMPUTE_TUNING;
  return Math.min(T.FAIL_MAX, T.FAIL_BASE + T.FAIL_PER_YEAR * Math.max(0, ageYears));
}

/** v14: share of the buy price a GPU of this age sells for. */
export function resaleFraction(ageYears: number): number {
  const T = COMPUTE_TUNING;
  return Math.max(T.RESALE_FLOOR, T.SELL_REFUND * T.RESALE_DECAY ** Math.max(0, ageYears));
}

/**
 * v14: GPUs wear out. Each day every installed GPU model loses count × rate(age)/365 GPUs, carried as a fraction
 * until a whole GPU fails. Deterministic (no random draws), so seeded games stay the same everywhere else.
 */
export function wearTick(s: GameState): void {
  let failed = 0;
  const names = new Map<string, number>();
  for (const dc of s.compute.datacenters) {
    if (!isFinished(dc)) continue;
    for (const [gid, n] of Object.entries(dc.gpus)) {
      if (n <= 0) continue;
      dc.bought ??= {};
      dc.bought[gid] ??= s.day; // old saves: count the fleet as new
      dc.wear ??= {};
      const cool = dc.liquid ? COMPUTE_TUNING.LIQUID_FAIL_MULT : 1; // v16
      const w = (dc.wear[gid] ?? 0) + (n * annualFailureRate(gpuAgeYears(s, dc, gid)) * cool) / 365;
      const k = Math.min(n, Math.floor(w));
      dc.wear[gid] = w - k;
      if (k <= 0) continue;
      const left = n - k;
      if (left > 0) dc.gpus[gid] = left;
      else {
        delete dc.gpus[gid];
        delete dc.bought[gid];
        delete dc.wear[gid];
      }
      failed += k;
      const name = gpuById(gid)?.name ?? gid;
      names.set(name, (names.get(name) ?? 0) + k);
    }
  }
  if (failed === 0) return;
  const KEY = 'gpuFailedSinceNotice';
  s.flags[KEY] = (s.flags[KEY] ?? 0) + failed;
  s.flags['stat.gpusFailed'] = (s.flags['stat.gpusFailed'] ?? 0) + failed;
  const last = s.flags['gpuFailNoticeDay'] ?? -Infinity;
  if (s.day - last >= COMPUTE_TUNING.FAIL_NOTICE_DAYS) {
    const total = s.flags[KEY];
    const top = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    notify(s, `Hardware: ${total.toLocaleString('en-US')} GPU${total === 1 ? '' : 's'} failed since the last report${top ? `, mostly ${top}` : ''}. Old GPUs fail more often; replace them in Compute.`, 'bad');
    s.flags[KEY] = 0;
    s.flags['gpuFailNoticeDay'] = s.day;
  }
}
