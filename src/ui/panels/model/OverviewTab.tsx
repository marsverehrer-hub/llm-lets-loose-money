// OWNER: UI-PAGE. Overview tab: capabilities, quirks, emergences, persona, forecast vs actual, configuration, lineage.
// Unreleased models show the expected shape from the launch forecast. True capabilities wait for release.
import { formatParams } from '../../../sim/util';
import { quirkById } from '../../../sim/data/quirks';
import { emergenceById } from '../../../sim/data/emergences';
import { describeConfig, optionById, RUN_TUNING } from '../../../sim/data/trainingOptions';
import { mixRows } from '../../../sim/systems/trainingMath';
import { modelCaps } from '../../../sim/systems/capabilities';
import type { GameState, Model } from '../../../sim/types';
import { Pill, Radar } from '../../components';
import { plain } from '../../shell/fmt';
import { BandBar } from '../train/kit';
import { KIND_LABEL, optionName, pct, r0, tokensShort } from '../train/model';
import { CAP_AXES, bestRival } from './rival';
import { Bipolar, LatentQuirks, Section } from './parts';

export function OverviewTab({ s, m }: { s: GameState; m: Model }) {
  return (
    <div class="mpg-cols">
      <div class="mpg-col">
        <Section title="Capabilities" aside={m.releasedDay === null ? 'Expected, from the launch forecast' : undefined}>
          <Capabilities s={s} m={m} />
        </Section>
        <Section title="Quirks">
          <Quirks m={m} />
          <LatentQuirks s={s} m={m} />
        </Section>
        {(m.emergences?.length ?? 0) > 0 && (
          <Section title="Emergent abilities">
            <div class="md-tags">
              {(m.emergences ?? []).flatMap((id) => {
                const def = emergenceById(id);
                return def ? [<Pill key={def.id} tone="milestone" title={plain(def.description)}>{def.name}</Pill>] : [];
              })}
            </div>
          </Section>
        )}
        {m.persona && (
          <Section title="Persona">
            <Bipolar label="Helpfulness" value={m.persona.helpfulness} />
            <Bipolar label="Verbosity" value={m.persona.verbosity} />
            <Bipolar label="Sycophancy" value={m.persona.sycophancy} />
          </Section>
        )}
      </div>

      <div class="mpg-col">
        <Section title="Forecast vs actual">
          <ForecastCheck m={m} />
        </Section>
        <Section title="Configuration">
          <Config s={s} m={m} />
        </Section>
      </div>
    </div>
  );
}

/** Capabilities as a shape: this model (or its expected shape, before release) against the best rival model. */
function Capabilities({ s, m }: { s: GameState; m: Model }) {
  const rival = bestRival(s);
  const rivalSeries = rival ? [{ name: `${rival.name} (${rival.lab})`, color: 'var(--blue)', values: rival.caps, dashed: true }] : [];
  if (m.releasedDay === null) {
    const expected = m.forecast?.caps;
    if (!expected) return <span class="mpg-desc">Capabilities stay unknown until release. Benchmarks give hints.</span>;
    return <Radar axes={CAP_AXES} series={[{ name: 'Expected', color: 'var(--amber)', values: expected }, ...rivalSeries]} />;
  }
  const caps = modelCaps(m, s);
  return <Radar axes={CAP_AXES} series={[{ name: m.name, color: 'var(--amber)', values: caps }, ...rivalSeries]} />;
}

function Quirks({ m }: { m: Model }) {
  const quirks = m.quirks ?? [];
  if (quirks.length === 0) return <span class="mpg-desc">None found yet. Suspiciously normal.</span>;
  return (
    <div class="md-tags">
      {quirks.map((id) => {
        const q = quirkById(id);
        return (
          <Pill key={id} tone={q?.good ? 'good' : 'bad'} title={q ? plain(q.description) : id}>
            {q?.name ?? id}
          </Pill>
        );
      })}
    </div>
  );
}

function ForecastCheck({ m }: { m: Model }) {
  const fc = m.forecast;
  if (!fc) return <span class="mpg-desc">No forecast was recorded for this model.</span>;
  const landed = m.overall;
  const where = landed >= fc.low && landed <= fc.high ? 'inside' : landed > fc.high ? 'above' : 'below';
  return (
    <div class="mpg-stack">
      <BandBar low={fc.low} mid={fc.mid} high={fc.high} label={`Forecast ${r0(fc.low)} to ${r0(fc.high)}, mid ${r0(fc.mid)}`} />
      <div class="mpg-row-between mpg-wrap">
        <span class="num">{`forecast ${r0(fc.low)}–${r0(fc.high)}, landed ${r0(landed)}`}</span>
        <Pill tone={where === 'inside' ? 'good' : where === 'above' ? 'info' : 'bad'}>
          {where === 'inside' ? 'Inside the band' : where === 'above' ? 'Above the band' : 'Below the band'}
        </Pill>
      </div>
      <span class="mpg-desc">{`${(fc.confidence ?? 'rough').charAt(0).toUpperCase()}${(fc.confidence ?? 'rough').slice(1)} forecast.${(fc.reasons ?? []).length ? ` ${(fc.reasons ?? []).join(' ')}` : ''}`}</span>
    </div>
  );
}

function Config({ s, m }: { s: GameState; m: Model }) {
  const cfg = m.config;
  if (!cfg) return <span class="mpg-desc">No run sheet recorded for this model.</span>;
  const experts = cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS;
  const mixes = mixRows(s, m.datasetIds, cfg);
  const active = m.activeParamsB !== undefined && m.activeParamsB !== m.paramsB ? m.activeParamsB : null;
  return (
    <div class="mpg-stack">
      <span class="mpg-desc">{describeConfig(cfg)}</span>
      <div class="kv">
        <Row k="Architecture" v={cfg.arch === 'moe' ? `${optionName(cfg.arch)} · ${experts} experts` : optionName(cfg.arch)} />
        <Row k="Size" v={active ? `${formatParams(m.paramsB)} total, ${formatParams(active)} active` : formatParams(m.paramsB)} />
        <Row k="Tokenizer" v={optionName(cfg.tokenizer)} />
        <Row k="Context" v={optionName(cfg.context)} />
        <Row k="Optimizer" v={optionName(cfg.optimizer)} />
        <Row k="Precision" v={optionName(cfg.precision)} />
        <Row k="Schedule" v={optionName(cfg.schedule)} />
        <Row k="Learning rate" v={cfg.lr.toFixed(2)} num />
        <Row k="Checkpointing" v={cfg.checkpointing[0].toUpperCase() + cfg.checkpointing.slice(1)} />
        <Row k="Filters" v={cfg.filters.length ? cfg.filters.map((id) => optionById(id)?.name ?? id).join(', ') : 'None'} />
        <Row k="Data mix" v={mixes.length ? mixes.map((r) => `${KIND_LABEL[r.kind]} ${pct(r.share)}`).join(' · ') : 'None'} />
        <Row k="Tokens" v={tokensShort(m.tokensB)} />
        <Row k="Modalities" v={(m.modalities ?? ['text']).join(', ')} />
      </div>
    </div>
  );
}

function Row({ k, v, num }: { k: string; v: string; num?: boolean }) {
  return (
    <div class="kv-row">
      <span class="kv-k">{k}</span>
      <span class={`kv-v ${num ? '' : 'md-text'}`}>{v}</span>
    </div>
  );
}
