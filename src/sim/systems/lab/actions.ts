// Action handlers: the player-facing lab actions (LR sweep, data audit, red team, dismiss reveal).

import type { ActionHandlers, SweepPoint } from '../../types';
import { validateConfig, optionById } from '../../data/trainingOptions';
import { RUN_TUNING } from '../../data/runTuning';
import { clamp, notify, trySpend } from '../../util';
import { datasetById, isVerifiedData } from '../data';
import { isResearched } from '../research';
import { resolveRun, trueLrQuality, uniqueTokensOf } from '../trainingMath';
import { LAB_TUNING } from './tuning';
import { labOf } from './notebook';
import { sweepQuote } from './sweeps';
import { auditQuote } from './verify';
import { redTeamQuote } from './redteam';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const handlers: ActionHandlers = {
  runLrSweep: (s, a, rng) => {
    const cfg = a.config;
    const lrs = [...new Set((a.lrs ?? []).filter((x) => Number.isFinite(x)).map((x) => clamp(x, 0, 1)))];
    if (lrs.length < LAB_TUNING.SWEEP_MIN_LRS || lrs.length > LAB_TUNING.SWEEP_MAX_LRS) {
      notify(s, `Sweeps run ${LAB_TUNING.SWEEP_MIN_LRS} to ${LAB_TUNING.SWEEP_MAX_LRS} learning rates.`, 'bad');
      return;
    }
    if (!Number.isFinite(a.paramsB) || a.paramsB <= 0 || !Number.isFinite(a.tokensB) || a.tokensB <= 0) {
      notify(s, 'Size the planned run before sweeping it.', 'bad');
      return;
    }
    const err = validateConfig(s, cfg);
    if (err) {
      notify(s, err, 'bad');
      return;
    }
    const ids = [...new Set(a.datasetIds)];
    for (const id of ids) {
      if (!s.data.owned.includes(id)) {
        notify(s, `You don't own ${datasetById(s, id)?.name ?? id} yet.`, 'bad');
        return;
      }
    }
    if (a.tokensB > uniqueTokensOf(s, ids) * RUN_TUNING.MAX_EPOCHS + 1e-9) {
      notify(s, 'The planned run would need more data than you own for a sweep.', 'bad');
      return;
    }
    const quote = sweepQuote(s, a.paramsB, a.tokensB, ids, cfg, lrs);
    if (!Number.isFinite(quote.cost)) {
      notify(s, 'No cloud GPUs are available to run a sweep.', 'bad');
      return;
    }
    if (!trySpend(s, 'compute', quote.cost, 'the learning-rate sweep')) return;
    const phys = resolveRun(s, a.paramsB, a.tokensB, ids, [], cfg, 'belief');
    const proxyActive = phys.activeParamsB / Math.sqrt(LAB_TUNING.SWEEP_PROXY_COMPUTE_DIVISOR);
    const scale = Math.log10(Math.max(1e-6, proxyActive));
    const mup = isResearched(s, 'mup_transfer');
    const sigma = LAB_TUNING.SWEEP_NOISE_SD * (isResearched(s, 'scaling_laws') ? 0.5 : 1);
    const doneDay = s.day + quote.days;
    const points: SweepPoint[] = lrs.map((lr) => ({
      lr,
      scale,
      reading: trueLrQuality(s, cfg.arch, proxyActive, lr, mup, optionById(cfg.optimizer)?.lrCurveMult ?? 1) + rng.normal(0, sigma),
      day: doneDay,
    }));
    const lab = labOf(s);
    lab.sweepJobs = [...(lab.sweepJobs ?? []), { arch: cfg.arch, doneDay, points }];
    const name = optionById(cfg.arch)?.name ?? cfg.arch;
    notify(s, `LR sweep for ${name} started: ${lrs.length} proxy runs, results in ${quote.days} days.`, 'info');
  },

  auditDataset: (s, a) => {
    const d = datasetById(s, a.datasetId);
    if (!d) {
      notify(s, 'Unknown dataset.', 'bad');
      return;
    }
    if (!s.data.owned.includes(d.id)) {
      notify(s, `You need ${d.name} before you can audit it.`, 'bad');
      return;
    }
    if (isVerifiedData(s, d.id)) {
      notify(s, `${d.name} has already been audited by its own training runs.`, 'info');
      return;
    }
    if (s.flags[`audit.${d.id}`] !== undefined) {
      notify(s, `${d.name} is already under audit.`, 'info');
      return;
    }
    const q = auditQuote(s, d.id);
    if (!trySpend(s, 'data', q.cost, `the audit of ${d.name}`)) return;
    s.flags[`audit.${d.id}`] = s.day + q.days;
    notify(s, `Auditing ${d.name}: results in ${q.days} days.`, 'info');
  },

  redTeamModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is already public. Red teaming has to happen before release.`, 'bad');
      return;
    }
    if (m.redTeam) {
      notify(s, `${m.name} has already been red-teamed.`, 'info');
      return;
    }
    const q = redTeamQuote(s, m.id);
    if (!Number.isFinite(q.cost)) {
      notify(s, 'No cloud GPUs are available for red teaming.', 'bad');
      return;
    }
    if (!trySpend(s, 'research', q.cost, `red teaming ${m.name}`)) return;
    m.redTeam = { doneDay: s.day + q.days };
    notify(s, `Red teaming ${m.name}: ${q.days} days. Results stay in the building.`, 'info');
  },

  dismissReveal: (s) => {
    s.pendingReveal = null;
  },
};
