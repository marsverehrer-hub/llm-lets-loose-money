// OWNER: UI-PAGE. Lifecycle tab: release (opens ReleaseWizard), preview, internal use, build-on actions, deprecate.
// Wizards open as views in the Models panel (train/draft.ts). Previews come from releasePreview.
import { dispatch } from '../../store';
import { formatMoney } from '../../../sim/util';
import { internalCostPerDay, internalResearchMult, releasePreview } from '../../../sim/systems/release';
import { provisionalElo } from '../../../sim/systems/lab';
import type { GameState, Model, ReleaseMode } from '../../../sim/types';
import { Pill, Stat, formatDays } from '../../components';
import { tdate } from '../../shell/fmt';
import { arenaTop, flagshipOf } from '../train/model';
import { setView } from '../train/draft';
import { ArmButton, Section, signed } from './parts';

const MODES: { mode: ReleaseMode; label: string }[] = [
  { mode: 'full', label: 'Full release' },
  { mode: 'preview', label: 'Limited preview' },
  { mode: 'open', label: 'Open weights' },
];

export function LifecycleTab({ s, m }: { s: GameState; m: Model }) {
  const released = m.releasedDay !== null;
  const preview = m.releaseMode === 'preview' && m.previewUntil !== undefined;
  return (
    <div class="mpg-cols">
      <div class="mpg-col">
        <Section title="Release" aside={released ? <Pill tone={m.deprecated ? 'muted' : 'good'}>{m.deprecated ? 'Deprecated' : 'Released'}</Pill> : undefined}>
          {released ? <ReleasedNote m={m} /> : <ReleaseOptions s={s} m={m} />}
        </Section>

        {preview && (
          <Section title="Preview">
            <PreviewBlock s={s} m={m} />
          </Section>
        )}
      </div>

      <div class="mpg-col">
        <Section title="Internal use">
          <InternalUse s={s} m={m} />
        </Section>

        <Section title="Build on it">
          <div class="mpg-stack">
            <BuildRow
              title="Fine-tune"
              desc="Specialise it with persona knobs and quirk removal."
              label="Fine-tune"
              onClick={() => setView({ kind: 'finetune', parentId: m.id })}
              disabled={m.deprecated}
            />
            <BuildRow
              title="Distill"
              desc="Train a smaller student that keeps most of this model's shape."
              label="Distill"
              onClick={() => setView({ kind: 'distill', teacherId: m.id })}
              disabled={m.deprecated}
            />
            <BuildRow
              title="Merge with…"
              desc="Blend this model with another. Same architecture merges best."
              label="Merge with…"
              onClick={() => setView({ kind: 'merge', aId: m.id })}
              disabled={m.deprecated}
            />
          </div>
        </Section>

        <Section title="Deprecate">
          {m.deprecated ? (
            <span class="mpg-desc">Deprecated. It has left the lineup.</span>
          ) : (
            <div class="mpg-row-between mpg-wrap">
              <span class="mpg-desc">Takes the model out of the lineup. It stops counting as a live model.</span>
              <ArmButton
                label="Deprecate"
                confirmLabel="Confirm deprecate"
                onConfirm={() => dispatch({ type: 'deprecateModel', modelId: m.id })}
              />
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function ReleasedNote({ m }: { m: Model }) {
  const mode = m.releaseMode ?? 'full';
  const label = mode === 'open' ? 'Open weights' : mode === 'preview' ? 'Limited preview' : 'Full release';
  return (
    <div class="mpg-stack">
      <span class="mpg-label">{`${label}, released ${tdate(m.releasedDay as number)}`}</span>
      <span class="mpg-desc">
        {mode === 'open' ? 'Open weights are permanent. Products serving it lose some users to self-hosting.' : 'Public. Latent quirks may still surface.'}
      </span>
    </div>
  );
}

function ReleaseOptions({ s, m }: { s: GameState; m: Model }) {
  const elo = provisionalElo(s, m);
  const arena = arenaTop(s);
  const beatsArena = !arena || elo.elo > arena.elo;
  const flagship = flagshipOf(s);
  const beatsOwn = flagship === null || m.overall >= flagship.overall;
  return (
    <div class="mpg-stack">
      <div class="table-wrap table-stack">
        <table class="table">
          <thead>
            <tr>
              <th>Mode</th>
              <th class="num">Hype</th>
              <th class="num">Brand</th>
              <th class="num">Reputation</th>
            </tr>
          </thead>
          <tbody>
            {MODES.map(({ mode, label }) => {
              const p = releasePreview(s, m, mode);
              return (
                <tr key={mode}>
                  <td title={p.notes.join(' ')}>{label}</td>
                  <td class="num" data-label="Hype">{signed(p.hype)}</td>
                  <td class="num" data-label="Brand">{signed(p.brand)}</td>
                  <td class="num" data-label="Reputation">{signed(p.reputation)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <span class="mpg-desc">
        {beatsArena
          ? 'Would take the arena top spot.'
          : `Would trail ${arena?.lab ?? 'the leader'} by ${Math.round((arena?.elo ?? 0) - elo.elo)} Elo.`}{' '}
        {beatsOwn ? 'Your best released model so far.' : 'Below your best released model.'}
      </span>
      <div class="mpg-row-between mpg-wrap">
        <span class="mpg-desc">Preview and open weights are set in the release wizard.</span>
        <button type="button" class="btn btn-primary" onClick={() => setView({ kind: 'release', modelId: m.id })}>
          Release
        </button>
      </div>
    </div>
  );
}

function PreviewBlock({ s, m }: { s: GameState; m: Model }) {
  const until = m.previewUntil ?? s.day;
  const left = Math.max(0, Math.ceil(until - s.day));
  return (
    <div class="mpg-row-between mpg-wrap">
      <div class="mpg-col-tight">
        <span class="mpg-label">{`Preview ends in ${formatDays(left)}`}</span>
        <span class="mpg-desc">{`Ends ${tdate(until)}. It promotes to a full release on that day unless you promote it now.`}</span>
      </div>
      <button type="button" class="btn btn-primary" onClick={() => dispatch({ type: 'promotePreview', modelId: m.id })}>
        Promote now
      </button>
    </div>
  );
}

function InternalUse({ s, m }: { s: GameState; m: Model }) {
  const mult = internalResearchMult(s);
  const boost = Number.isFinite(mult) ? Math.round((mult - 1) * 100) : 0;
  const cost = internalCostPerDay(m);
  return (
    <div class="mpg-stack">
      <div class="mpg-stats">
        <Stat
          label="Research"
          value={boost > 0 ? `+${boost}% research` : 'No boost'}
          hint={
            boost > 0
              ? 'From your best internal model'
              : 'Grows as the model nears the frontier'
          }
          size="sm"
        />
        <Stat label="Inference cost" value={Number.isFinite(cost) ? `${formatMoney(cost)}/day` : '—'} hint="Charged while deployed" size="sm" />
      </div>
      <div class="mpg-row-between mpg-wrap">
        <span class="mpg-desc">Internal use speeds up research. It costs inference every day and keeps running after release.</span>
        <button
          type="button"
          class="btn btn-sm"
          disabled={m.deprecated}
          onClick={() => dispatch({ type: 'deployInternally', modelId: m.id, on: !m.internal })}
        >
          {m.internal ? 'Stop internal use' : 'Deploy internally'}
        </button>
      </div>
    </div>
  );
}

function BuildRow({
  title,
  desc,
  label,
  onClick,
  disabled,
}: {
  title: string;
  desc: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div class="mpg-row-between mpg-wrap">
      <div class="mpg-col-tight">
        <span class="mpg-label">{title}</span>
        <span class="mpg-desc">{desc}</span>
      </div>
      <button type="button" class="btn btn-sm" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </div>
  );
}
