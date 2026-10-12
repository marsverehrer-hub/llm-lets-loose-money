// OWNER: UI-PAGE. Small pieces shared by the model page tabs and the Models table.
// Latent quirks: the UI shows a count and "unknown" only. Contents stay hidden until a red-team reveals them.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { formatMoney } from '../../../sim/util';
import { latentCount, redTeamQuote } from '../../../sim/systems/lab';
import type { GameState, Model } from '../../../sim/types';
import { clamp, formatDays } from '../../components';

/** Two-click destructive button: the first click arms it, the second confirms. Disarms after 3 seconds. */
export function ArmButton({
  label,
  confirmLabel,
  onConfirm,
  title,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  title?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      class={`btn btn-sm btn-danger ${armed ? 'md-armed' : ''}`}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

/** Signed bipolar bar for persona knobs (-1..1). */
export function Bipolar({ label, value }: { label: string; value: number }) {
  const v = clamp(value, -1, 1);
  const w = Math.abs(v) * 50;
  const left = v < 0 ? 50 - w : 50;
  return (
    <div class="md-bi">
      <span class="md-bi-k">{label}</span>
      <div class="md-bi-track">
        <span class="md-bi-fill" style={`left:${left.toFixed(1)}%;width:${w.toFixed(1)}%`} />
      </div>
      <span class="num md-bi-v">{`${v > 0 ? '+' : ''}${v.toFixed(1)}`}</span>
    </div>
  );
}

/** A labelled block inside a tab. The aside sits at the right of the heading. */
export function Section({ title, aside, children }: { title: ComponentChildren; aside?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <section class="mpg-sec">
      <header class="mpg-sec-h">
        <h4 class="mpg-sec-t">{title}</h4>
        {aside != null && <span class="mpg-sec-aside">{aside}</span>}
      </header>
      <div class="mpg-sec-b">{children}</div>
    </section>
  );
}

/** Signed number for deltas: "+6", "−2", or a dash when not finite. */
export function signed(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v).toFixed(digits);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${a}`;
}

/**
 * Hidden quirks. The count is unknown until a red-team reveals them privately (no reputation hit).
 * The public finds the rest after release, which lands in the visible quirks list.
 */
export function LatentQuirks({ s, m }: { s: GameState; m: Model }) {
  const rt = m.redTeam;
  if (rt === true) {
    const hidden = latentCount(m);
    return (
      <div class="mpg-row-between">
        <span class="mpg-desc">
          {hidden === 0 ? 'Red-team done. No hidden quirks.' : `Red-team done. ${hidden} hidden quirk${hidden === 1 ? '' : 's'} still unrevealed.`}
        </span>
      </div>
    );
  }
  if (rt && typeof rt === 'object') {
    const left = Math.max(1, Math.ceil(rt.doneDay - s.day));
    return (
      <div class="mpg-row-between">
        <div class="mpg-col-tight">
          <span class="mpg-label">Red-team running</span>
          <span class="mpg-desc">{`Results in ${left} day${left === 1 ? '' : 's'}. Revealed quirks land in the list above.`}</span>
        </div>
        <button type="button" class="btn btn-sm" disabled>
          Running
        </button>
      </div>
    );
  }
  const q = redTeamQuote(s, m.id);
  const hidden = latentCount(m);
  return (
    <div class="mpg-row-between">
      <div class="mpg-col-tight">
        <span class="mpg-label">{`${hidden} latent: unknown`}</span>
        <span class="mpg-desc">
          {`Red-teaming reveals hidden quirks privately, with no reputation hit. About ${Number.isFinite(q.cost) ? formatMoney(q.cost) : '—'} and ${formatDays(q.days)}.`}
        </span>
      </div>
      <button type="button" class="btn btn-sm" onClick={() => dispatch({ type: 'redTeamModel', modelId: m.id })}>
        Red-team
      </button>
    </div>
  );
}
