// OWNER: PROGRESSION (v13, GAME_DESIGN §23.3). Run tempo: how hard the team pushes the live run.
// A live decision the player can change at any time: careful trades speed for far fewer incidents, crunch buys
// speed with incidents and morale. Two perks bend it (careful_science, crunch_culture).
import type { ActionHandlers, GameState, RunTempo, TrainingRun } from '../types';
import { clamp, notify } from '../util';
import { trainingRatePerDay } from './capabilities';
import { runConfig } from './trainingMath';
import { hasPerk } from './progression';

export const TEMPO_TUNING = {
  careful: { speed: 0.85, risk: 0.45, moralePerDay: 0 },
  standard: { speed: 1, risk: 1, moralePerDay: 0 },
  crunch: { speed: 1.3, risk: 2.2, moralePerDay: 0.12 },
  /** careful_science perk: careful runs at this speed instead. */
  CAREFUL_SCIENCE_SPEED: 0.95,
  /** crunch_culture perk: crunch morale drain and incident risk multipliers. */
  CRUNCH_CULTURE_MORALE: 0.5,
  CRUNCH_CULTURE_RISK: 0.75,
  /** Crunch stops by itself when morale falls below this. */
  CRUNCH_MORALE_FLOOR: 25,
};

const T = TEMPO_TUNING;

export const TEMPOS: { id: RunTempo; label: string; hint: string }[] = [
  { id: 'careful', label: 'Careful', hint: 'Slower, about half the incidents' },
  { id: 'standard', label: 'Standard', hint: 'The plan as written' },
  { id: 'crunch', label: 'Crunch', hint: 'Faster, twice the incidents, morale drains' },
];

export function tempoOf(run: TrainingRun | null | undefined): RunTempo {
  return run?.tempo ?? 'standard';
}

export function tempoSpeed(s: GameState, tempo: RunTempo): number {
  if (tempo === 'careful' && hasPerk(s, 'careful_science')) return T.CAREFUL_SCIENCE_SPEED;
  return T[tempo].speed;
}

export function tempoRisk(s: GameState, tempo: RunTempo): number {
  if (tempo === 'crunch' && hasPerk(s, 'crunch_culture')) return T.crunch.risk * T.CRUNCH_CULTURE_RISK;
  return T[tempo].risk;
}

export function tempoMoraleDrain(s: GameState, tempo: RunTempo): number {
  const d = T[tempo].moralePerDay;
  return tempo === 'crunch' && hasPerk(s, 'crunch_culture') ? d * T.CRUNCH_CULTURE_MORALE : d;
}

/** FLOP per day the live run makes at its tempo. */
export function liveRunRate(s: GameState, run: TrainingRun): number {
  return trainingRatePerDay(s, runConfig(s, run)) * tempoSpeed(s, tempoOf(run));
}

/** Days left on the live run at its tempo (Infinity without compute). */
export function liveRunEta(s: GameState, run: TrainingRun, tempo: RunTempo = tempoOf(run)): number {
  const rate = trainingRatePerDay(s, runConfig(s, run)) * tempoSpeed(s, tempo);
  const remaining = Math.max(0, run.totalFlops - run.doneFlops);
  return rate > 0 ? remaining / rate + (run.overheadLeft ?? 0) + (run.stallDays ?? 0) : Infinity;
}

/** Daily side effects of the tempo (called by trainingTick while the run makes progress). */
export function applyTempoDay(s: GameState, run: TrainingRun): void {
  const tempo = tempoOf(run);
  if (tempo !== 'crunch') return;
  s.staff.morale = clamp(s.staff.morale - tempoMoraleDrain(s, tempo), 0, 100);
  if (s.staff.morale < T.CRUNCH_MORALE_FLOOR) {
    run.tempo = 'standard';
    notify(s, `${run.name}: the team is burnt out. Crunch is over, back to standard tempo.`, 'bad');
  }
}

export const handlers: ActionHandlers = {
  setRunTempo: (s, a) => {
    const run = s.training;
    if (!run) return;
    if (!TEMPOS.some((t) => t.id === a.tempo)) return;
    if (a.tempo === 'crunch' && s.staff.morale < T.CRUNCH_MORALE_FLOOR) {
      notify(s, 'Morale is too low to ask for a crunch.', 'bad');
      return;
    }
    run.tempo = a.tempo === 'standard' ? undefined : a.tempo;
  },
};
