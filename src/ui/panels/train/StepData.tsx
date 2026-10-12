// Step 2: what it reads. Owned sets as a checklist grouped by kind, quick toggles, filters as trade-off tiles,
// and the per-kind mix sliders behind one disclosure.
import { useState } from 'preact/hooks';
import type { DatasetDef, Id } from '../../../sim/types';
import { believedQuality, isVerified } from '../../../sim/systems/lab';
import { mixRows } from '../../../sim/systems/trainingMath';
import { equalMixFor, optionsByGroup, ownedKinds } from '../../../sim/data/trainingOptions';
import { navigate } from '../../nav';
import { EmptyState, Pill } from '../../components';
import { tokensShort, KIND_LABEL, GOOD_QUALITY, pct, tradeoffs } from './model';
import type { Ctx } from './model';
import { Chip, Slider } from './kit';
import type { DataKind } from '../../../sim/types';

const KIND_ORDER = Object.keys(KIND_LABEL) as DataKind[];

function sameSet(a: Id[], b: Id[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function StepData({ ctx }: { ctx: Ctx }) {
  const { s, sheet, ownedSets, selected, uniqueTokens, cfgErr, patch, patchCfg } = ctx;
  const cfg = sheet.cfg;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [mixOpen, setMixOpen] = useState(false);
  const pickedSet = new Set(selected);

  if (ownedSets.length === 0) {
    return (
      <EmptyState
        title="No datasets owned yet."
        text="A run needs something to read. Buy datasets in the data panel, then come back here."
        action={
          <button type="button" class="btn" onClick={() => navigate('data')}>
            Open the data panel
          </button>
        }
      />
    );
  }

  const ownedIds = ownedSets.map((d) => d.id);
  const bestIds = ownedSets.filter((d) => believedQuality(s, d) >= GOOD_QUALITY).map((d) => d.id);
  const best = bestIds.length > 0 ? bestIds : [[...ownedSets].sort((a, b) => believedQuality(s, b) - believedQuality(s, a))[0].id];
  const mode = sheet.picked === null || sameSet(selected, ownedIds) ? 'all' : sameSet(selected, best) ? 'best' : 'custom';

  const togglePick = (id: Id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    patch({ picked: next });
  };

  const shares = mixRows(s, selected, cfg);
  const shareOf = (k: DataKind): number => shares.find((r) => r.kind === k)?.share ?? 0;
  const kinds = ownedKinds(s);
  const filters = optionsByGroup(s, 'filter');
  const pickedTokens = selected.reduce((a, id) => a + (ownedSets.find((d) => d.id === id)?.tokensB ?? 0), 0);

  const groupsOf = (kind: DataKind): DatasetDef[] => ownedSets.filter((d) => d.kind === kind);
  const presentKinds = KIND_ORDER.filter((k) => ownedSets.some((d) => d.kind === k));

  return (
    <div class="tw-stack">
      <div class="tw-toolbar">
        <div class="tw-chips">
          <Chip on={mode === 'all'} title="Every dataset you own" onClick={() => patch({ picked: null })}>
            Use all owned
          </Chip>
          <Chip on={mode === 'best'} title={`Sets at or above ${Math.round(GOOD_QUALITY * 100)}% believed quality`} onClick={() => patch({ picked: best })}>
            Best quality only
          </Chip>
        </div>
        <span class="num tw-small tw-muted">
          {`${selected.length} of ${ownedSets.length} sets · ${tokensShort(pickedTokens)} tokens · ${tokensShort(uniqueTokens)} unique`}
        </span>
      </div>

      {cfgErr && <div class="tw-warn">{cfgErr}</div>}

      <div class="tw-groups">
        {presentKinds.map((kind) => {
          const rows = groupsOf(kind);
          const inRun = rows.filter((d) => pickedSet.has(d.id));
          const isOpen = !collapsed[kind];
          const tok = inRun.reduce((a, d) => a + d.tokensB, 0);
          return (
            <div class="tw-group-set" key={kind}>
              <button
                type="button"
                class="tw-group-head"
                aria-expanded={isOpen}
                onClick={() => setCollapsed({ ...collapsed, [kind]: isOpen })}
              >
                <span class="tw-caret">{isOpen ? '▾' : '▸'}</span>
                <span class="tw-group-name">{KIND_LABEL[kind]}</span>
                <span class="num tw-muted">{`${inRun.length} of ${rows.length}`}</span>
                <span class="num tw-faint">{`${tokensShort(tok)} in run`}</span>
              </button>
              {isOpen &&
                rows.map((d) => {
                  const on = pickedSet.has(d.id);
                  const q = believedQuality(s, d);
                  const verified = isVerified(s, d.id);
                  return (
                    <label class={`tw-set ${on ? 'is-on' : ''}`} key={d.id}>
                      <input type="checkbox" checked={on} onChange={() => togglePick(d.id)} aria-label={`Use ${d.name}`} />
                      <span class="tw-set-name">{d.name}</span>
                      {!verified && <Pill tone="warn">Unverified</Pill>}
                      <span class="num tw-set-tok">{tokensShort(d.tokensB)}</span>
                      <span class="tw-set-q">
                        <span class="hbar tw-qbar">
                          <span class="hbar-fill" style={`width:${Math.round(q * 100)}%;--c:${q >= 0.7 ? 'var(--up)' : q >= 0.45 ? 'var(--fg-2)' : 'var(--down)'}`} />
                        </span>
                        <span class="num tw-set-qv">{pct(q)}</span>
                      </span>
                    </label>
                  );
                })}
            </div>
          );
        })}
      </div>

      <div class="tw-section-line">
        <span class="tw-label">Data filters</span>
        <span class="tw-faint tw-small">Each filter trades tokens or compute for quality.</span>
      </div>
      <div class="tw-tiles tw-tiles-sm" role="group" aria-label="Data filters">
        {filters
          .filter((r) => r.unlocked)
          .map(({ option }) => {
            const on = cfg.filters.includes(option.id);
            return (
              <div
                key={option.id}
                class={`tw-tile ${on ? 'is-on' : ''}`}
                role="checkbox"
                aria-checked={on}
                tabIndex={0}
                title={option.description}
                onClick={() => patchCfg({ filters: on ? cfg.filters.filter((x) => x !== option.id) : [...cfg.filters, option.id] })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    patchCfg({ filters: on ? cfg.filters.filter((x) => x !== option.id) : [...cfg.filters, option.id] });
                  }
                }}
              >
                <div class="tw-tile-head">
                  <span class="tw-tile-name">{option.name}</span>
                  <span class={`tw-check ${on ? 'is-on' : ''}`} aria-hidden="true">
                    {on ? 'on' : 'off'}
                  </span>
                </div>
                <div class="tw-trades">
                  {tradeoffs(option).map((t, i) => (
                    <span key={i} class={`tw-trade tone-${t.tone}`}>
                      {t.text}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
      {filters.some((r) => !r.unlocked) && (
        <div class="tw-faint tw-small">{`${filters.filter((r) => !r.unlocked).length} filters locked behind research.`}</div>
      )}

      <div class="tw-mix">
        <button type="button" class="tw-link" aria-expanded={mixOpen} onClick={() => setMixOpen(!mixOpen)}>
          {`${mixOpen ? '▾' : '▸'} Data mix: per-kind weights`}
        </button>
        {mixOpen && (
          <div class="md-stack">
            <div class="tw-toolbar">
              <span class="tw-small tw-muted">Weights are relative. Kinds not in the run are ignored.</span>
              <button type="button" class="btn btn-sm btn-ghost" onClick={() => patchCfg({ dataMix: equalMixFor(s, selected) })}>
                Equal mix
              </button>
            </div>
            <div class="md-mix">
              {kinds.map((k) => {
                const inRun = shares.some((r) => r.kind === k);
                const w = cfg.dataMix[k] ?? 1;
                return (
                  <div class={`md-mix-row ${inRun ? '' : 'dim'}`} key={k}>
                    <span class="md-mix-k">{KIND_LABEL[k]}</span>
                    <Slider
                      value={w}
                      min={0}
                      max={10}
                      step={1}
                      label={`${KIND_LABEL[k]} weight`}
                      disabled={!inRun}
                      onInput={(v) => patchCfg({ dataMix: { ...cfg.dataMix, [k]: v } })}
                    />
                    <span class="num md-mix-v">{inRun ? pct(shareOf(k)) : 'Not in run'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
