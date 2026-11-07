// Daily tick: finished sweeps, data audits, red-team completions and latent quirks surfacing.

import type { GameState, SweepJob } from '../../types';
import { optionById } from '../../data/trainingOptions';
import { quirkById } from '../../data/quirks';
import { LATENT_DISCOVERY_COPY } from '../../data/evalCopy';
import { clamp, notify, pushNews } from '../../util';
import { datasetById, hashUniform, trueQualityOf } from '../data';
import { LAB_TUNING } from './tuning';
import { labOf, pickFrom } from './notebook';
import { dataSurpriseLine } from './verify';

// ---------------------------------------------------------------------------
// Daily tick
// ---------------------------------------------------------------------------

/** Sweeps, audits, red-teaming and latent quirks surfacing. Runs after the training tick. */
export function labTick(s: GameState): void {
  const lab = s.lab;
  if (lab) {
    const jobs = lab.sweepJobs ?? [];
    const done = jobs.filter((j: SweepJob) => j.doneDay <= s.day);
    if (done.length) {
      lab.sweepJobs = jobs.filter((j) => j.doneDay > s.day);
      for (const j of done) {
        lab.sweeps[j.arch] = [...(lab.sweeps[j.arch] ?? []), ...j.points];
        const best = j.points.reduce((b, p) => (p.reading > b.reading ? p : b), j.points[0]);
        const name = optionById(j.arch)?.name ?? j.arch;
        notify(s, `LR sweep for ${name} is in: the best learning rate was about ${best.lr.toFixed(2)}.`, 'good');
      }
    }
  }

  // Audits: flags 'audit.<datasetId>' hold the day they finish.
  for (const key of Object.keys(s.flags)) {
    if (!key.startsWith('audit.') || s.day < s.flags[key]) continue;
    const id = key.slice('audit.'.length);
    delete s.flags[key];
    const d = datasetById(s, id);
    if (!d) continue;
    const labNow = labOf(s);
    if (!labNow.verifiedData.includes(id)) labNow.verifiedData.push(id);
    const truth = trueQualityOf(s, d);
    const line = dataSurpriseLine(s, `audit:${id}:${s.day}`, { name: d.name, claimed: d.quality, truth });
    notify(s, line.text, line.kind);
  }

  // Red-team completions: the latent quirks become known to the lab, quietly.
  for (const m of s.models) {
    const rt = m.redTeam;
    if (!rt || rt === true || s.day < rt.doneDay) continue;
    m.redTeam = true;
    const found = m.latentQuirks ?? [];
    const known = new Set(m.quirks ?? []);
    m.quirks = [...(m.quirks ?? []), ...found.filter((q) => !known.has(q))];
    m.latentQuirks = [];
    const names = found.map((q) => quirkById(q)?.name ?? q);
    notify(s, found.length ? `Red team on ${m.name} is done: ${names.join('; ')}. Nobody outside the building knows.` : `Red team on ${m.name} is done and found nothing. Suspicious.`, found.length ? 'info' : 'info');
  }

  // Latent quirks surface after release, 2% a day each.
  for (const m of s.models) {
    if (m.releasedDay === null || !m.latentQuirks?.length) continue;
    for (const q of [...m.latentQuirks]) {
      if (hashUniform(s.seed, `surf:${m.id}:${q}:${s.day}`) >= LAB_TUNING.LATENT_SURFACE_PER_DAY) continue;
      m.latentQuirks = m.latentQuirks.filter((x) => x !== q);
      m.quirks = [...(m.quirks ?? []), q];
      const def = quirkById(q);
      const good = def?.good === true;
      const text = pickFrom(s, `surf:${m.id}:${q}:${s.day}:copy`, LATENT_DISCOVERY_COPY[good ? 'good' : 'bad'], { model: m.name, quirk: def?.name ?? q });
      if (good) {
        s.company.hype = clamp(s.company.hype + LAB_TUNING.GOOD_QUIRK_HYPE, 0, 100);
      } else {
        s.company.reputation = clamp(s.company.reputation + LAB_TUNING.BAD_QUIRK_REP, 0, 100);
        s.company.hype = clamp(s.company.hype + LAB_TUNING.BAD_QUIRK_HYPE, 0, 100);
      }
      pushNews(s, text, good ? 'good' : 'bad');
      notify(s, text, good ? 'good' : 'bad');
    }
  }
}
