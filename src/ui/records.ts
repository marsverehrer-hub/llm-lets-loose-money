// Personal records: the best ending score and best peak valuation per scenario and difficulty, kept on this device.
// UI only: the sim never reads it, and the game plays the same without it.
import { getActiveSlotId } from '../sim/save';
import type { GameState } from '../sim/types';
import { todayUtc } from './shell/daily';

export interface Best {
  value: number;
  /** YYYY-MM-DD (UTC) the record was set. */
  date: string;
}
export interface RecordEntry {
  score?: Best;
  peak?: Best;
}
export type Records = Record<string, RecordEntry>;

const RECORDS_KEY = 'llm-lets-loose-money/records';
/** Save slots whose game has already been recorded, so a reload does not record it twice. */
const RECORDED_KEY = 'llm-lets-loose-money/recorded';
const MAX_RECORDED = 200;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const recordKey = (scenarioId: string, difficulty: string): string => `${scenarioId}:${difficulty}`;

/** "14 Mar 2019" from a YYYY-MM-DD date. */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // A private window or blocked storage: the records are not kept, and nothing else depends on them.
  }
}

export function readRecords(): Records {
  const r = readJson<Records | null>(RECORDS_KEY, {});
  return r && typeof r === 'object' ? r : {};
}

/** Keeps the best of the old entry and a new result: a higher score or peak replaces it, a lower one does not. */
export function mergeRecord(entry: RecordEntry, result: { score?: number; peak: number }, date: string): RecordEntry {
  const next: RecordEntry = { ...entry };
  if (result.score !== undefined && (!next.score || result.score > next.score.value)) next.score = { value: result.score, date };
  if (!next.peak || result.peak > next.peak.value) next.peak = { value: result.peak, date };
  return next;
}

/** Records a finished game once. Multiplayer matches and sandbox games are not scored. Returns whether it was recorded. */
export function recordGame(s: GameState, today: string = todayUtc()): boolean {
  if (s.mp || s.setup?.sandbox || !(s.ending || s.gameOver)) return false;
  const gameId = getActiveSlotId() ?? `seed:${s.seed}`;
  const done = readJson<string[]>(RECORDED_KEY, []);
  if (done.includes(gameId)) return false;
  const key = recordKey(s.setup?.scenarioId ?? 'garage', s.setup?.difficulty ?? 'founder');
  const records = readRecords();
  records[key] = mergeRecord(records[key] ?? {}, { score: s.ending?.score, peak: s.stats.peakValuation }, today);
  writeJson(RECORDS_KEY, records);
  writeJson(RECORDED_KEY, [...done, gameId].slice(-MAX_RECORDED));
  return true;
}
