// OWNER: Agent UI-FLOWS. Frame and small controls shared by the release, distill and merge wizards.
// Visual language copies the fine-tune wizard (ft-*); classes here are tf-*, in ./flows.css.
// Nothing here reads the sim. Callers pass numbers and text in.
import type { ComponentChildren } from 'preact';
import { formatDays } from '../../components';
import { formatMoney } from '../../../sim/util';
import './flows.css';

/** Signed mono number: +3, −3, 0. `invert` flips the colour for things that are bad when they rise. */
export function Delta({ v, unit = '', invert = false }: { v: number; unit?: string; invert?: boolean }) {
  if (!isFinite(v)) return <span class="num tf-d tf-zero">—</span>;
  const a = Math.abs(v);
  const whole = Number.isInteger(Number(a.toFixed(1)));
  const digits = whole ? 0 : 1;
  const x = Number(a.toFixed(digits));
  if (x === 0) return <span class="num tf-d tf-zero">{`0${unit}`}</span>;
  const up = v > 0;
  const good = up !== invert;
  return <span class={`num tf-d ${good ? 'tf-pos' : 'tf-neg'}`}>{`${up ? '+' : '−'}${x.toFixed(digits)}${unit}`}</span>;
}

/** Sizes shown and sent to the sim: two decimals from 1B up, three significant figures below. */
export function roundSize(v: number): number {
  return v >= 1 ? Math.round(v * 100) / 100 : Number(v.toPrecision(3));
}

/** Days as a mono number with a plain unit, e.g. "5 days". */
export function Days({ days, ok }: { days: number; ok: boolean }) {
  if (!ok || !isFinite(days)) return <span class="num">—</span>;
  const text = formatDays(days);
  const m = /^(<?\d+(?:\.\d+)?)\s*(.*)$/.exec(text);
  if (!m) return <span>{text}</span>;
  return (
    <span>
      <span class="num">{m[1]}</span>
      {m[2] ? ` ${m[2]}` : ''}
    </span>
  );
}

/** Cash cost. Zero means no cash spend (owned compute), which reads as "None". */
export function Money({ cost, ok }: { cost: number; ok: boolean }) {
  if (!ok || !isFinite(cost)) return <span class="num">—</span>;
  if (cost <= 0) return <span>None</span>;
  return <span class="num">{formatMoney(cost)}</span>;
}

/** A labelled figure inside a stat row, e.g. "Hype +4". */
export function Stat({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <span class="tf-stat">
      <span class="tf-faint">{label}</span> {children}
    </span>
  );
}

/** A row of stats. Wraps on narrow widths. */
export function Stats({ children }: { children: ComponentChildren }) {
  return <span class="tf-stats">{children}</span>;
}

/** One selectable window. Selecting it never advances the wizard. */
export function Tile({
  on,
  disabled,
  title,
  name,
  onPick,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  title?: string;
  name: ComponentChildren;
  onPick: () => void;
  children?: ComponentChildren;
}) {
  return (
    <button type="button" class={`tf-tile${on ? ' tf-tile-on' : ''}`} aria-pressed={on} disabled={disabled} title={title} onClick={onPick}>
      <span class="tf-tile-name">{name}</span>
      {children}
    </button>
  );
}

/** Small toggle chip for two-way choices. */
export function Chip({ on, disabled, onClick, children }: { on: boolean; disabled?: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class={`tf-chip${on ? ' tf-chip-on' : ''}`} aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Key/value rows, as in the fine-tune review. */
export function Kv({ rows }: { rows: [string, ComponentChildren][] }) {
  return (
    <dl class="tf-kv">
      {rows.map(([k, v]) => (
        <div class="tf-kv-row" key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Checkbox-style acknowledgement for a choice that cannot be undone. */
export function Ack({ on, onToggle, children }: { on: boolean; onToggle: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class={`tf-check${on ? ' tf-check-on' : ''}`} role="checkbox" aria-checked={on} onClick={onToggle}>
      <span class="tf-check-box" aria-hidden="true" />
      <span>{children}</span>
    </button>
  );
}

export interface FinalAction {
  label: string;
  disabled: boolean;
  title?: string;
  onClick: () => void;
}

/**
 * The frame: header, step rail, the question, the body, and a sticky footer with the live numbers, a blocker line and buttons.
 * The last step shows `action` in place of Next. Steps after the current one cannot be clicked, so each one is visited on purpose.
 */
export function FlowFrame({
  kicker,
  parent,
  steps,
  cur,
  question,
  info,
  blocker,
  nextDisabled,
  action,
  onStep,
  onBack,
  onNext,
  onCancel,
  children,
}: {
  kicker: string;
  parent: string;
  steps: string[];
  cur: number;
  question: string;
  info?: ComponentChildren;
  blocker?: string;
  nextDisabled: boolean;
  action: FinalAction;
  onStep: (i: number) => void;
  onBack: () => void;
  onNext: () => void;
  onCancel: () => void;
  children: ComponentChildren;
}) {
  const last = cur === steps.length - 1;
  return (
    <div class="tf-root">
      <header class="tf-head">
        <span class="tf-kicker">{kicker}</span>
        <span class="tf-parent">{parent}</span>
      </header>

      <ol class="tf-steps">
        {steps.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              class={`tf-step${i === cur ? ' tf-step-on' : i < cur ? ' tf-step-done' : ''}`}
              aria-current={i === cur ? 'step' : undefined}
              disabled={i > cur}
              onClick={() => onStep(i)}
            >
              <span class="num tf-step-n">{i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <section class="tf-body" aria-labelledby="tf-question">
        <h2 class="tf-q" id="tf-question">
          {question}
        </h2>
        {children}
      </section>

      <footer class="tf-foot">
        <div class="tf-foot-info">
          {info}
          {blocker && <span class="tf-blocker">{blocker}</span>}
        </div>
        <div class="tf-foot-btns">
          <button type="button" class="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          {cur > 0 && (
            <button type="button" class="btn" onClick={onBack}>
              Back
            </button>
          )}
          {last ? (
            <button type="button" class="btn btn-primary" disabled={action.disabled} title={action.title} onClick={action.onClick}>
              {action.label}
            </button>
          ) : (
            <button type="button" class="btn btn-primary" disabled={nextDisabled} onClick={onNext}>
              Next
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/** Codename field with a suggestion button. Shared by the distill and merge name steps. */
export function CodenameField({ value, onChange, onSuggest, note }: { value: string; onChange: (v: string) => void; onSuggest: () => void; note: string }) {
  return (
    <div class="tf-field">
      <span class="tf-label" id="tf-codename-label">
        Codename
      </span>
      <div class="tf-name-row">
        <input
          class="input tf-name"
          type="text"
          maxLength={40}
          value={value}
          placeholder="Name the codename"
          aria-labelledby="tf-codename-label"
          onInput={(e) => onChange((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="num tf-count">{`${value.length}/40`}</span>
        <button type="button" class="btn btn-sm" onClick={onSuggest}>
          Suggest another
        </button>
      </div>
      <span class="tf-faint">{note}</span>
    </div>
  );
}
