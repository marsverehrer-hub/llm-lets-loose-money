// OWNER: Agent UI-FLOWS. Distill wizard: Student size, Name, Review. Each step is visited on purpose; no size is pre-chosen.
// Forecasts come from distillQuote only. Never reads model.vibes, latentQuirks or run.hidden.
import { useState } from 'preact/hooks';
import { dispatch, getState, useGame } from '../../store';
import { formatParams } from '../../../sim/util';
import { distillQuote } from '../../../sim/systems/derive';
import { suggestCodename } from '../../../sim/data/names';
import { Pill } from '../../components';
import { plain } from '../../shell/fmt';
import { uiRng } from '../panelKit';
import { BandBar, NumField, Slider } from './kit';
import { r0 } from './model';
import { CodenameField, Days, Delta, FlowFrame, Kv, Money, Stat, Stats, Tile, roundSize } from './flowKit';

const STEPS = ['Student size', 'Name', 'Review'];
const QUESTIONS = ['How small should it be?', 'What is it codenamed?', 'Ready to distill?'];
/** Share of the teacher's quirks that carry over, visible and hidden. Shown as copy in the review. */
const QUIRK_SHARE_PCT = 60;
/** One-tap sizes: the teacher's active parameters divided by these. */
const FRACTIONS = [2, 4, 10, 30];
const CONF_TONE: Record<string, 'good' | 'info' | 'warn' | 'bad'> = { tight: 'good', decent: 'info', rough: 'warn', 'wild guess': 'bad' };

export function DistillWizard({ teacherId, onClose }: { teacherId: string; onClose: () => void }) {
  const s = useGame();
  const t = s.models.find((x) => x.id === teacherId);
  const [step, setStep] = useState(0);
  const [sizeB, setSizeB] = useState<number | null>(null);
  const [name, setName] = useState(() => suggestCodename(uiRng()));

  if (!t) {
    return (
      <div class="tf-root">
        <div class="tf-empty">That teacher no longer exists.</div>
        <div class="tf-foot-btns">
          <button type="button" class="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const teacherActive = t.activeParamsB ?? t.paramsB;
  const half = teacherActive * 0.5;
  const minB = half / 100;
  const stepB = half / 200;
  const run = s.training;
  const size = sizeB ?? 0;
  const sizeOk = size > 0;
  const q = sizeOk ? distillQuote(s, teacherId, size) : null;
  const fc = q?.forecast ?? null;
  const saving = sizeOk ? 1 - size / teacherActive : 0;
  const cur = Math.min(step, STEPS.length - 1);
  const nameOk = name.trim().length > 0;

  let blocker = '';
  if (run) blocker = `${plain(run.name)} is training. Stop or finish it first.`;
  else if (cur === 0 && !sizeOk) blocker = 'Pick a student size.';
  else if (cur === 1 && !nameOk) blocker = 'Name it.';
  else if (cur === 2 && q && !q.ok) blocker = q.reason ?? 'Distillation is not possible right now.';
  const nextDisabled = (cur === 0 && !sizeOk) || (cur === 1 && !nameOk);
  const actionDisabled = !sizeOk || !nameOk || !q || !q.ok || run !== null;

  const distill = () => {
    if (actionDisabled || sizeB === null) return;
    const before = getState().training;
    dispatch({ type: 'startDistill', teacherId, paramsB: sizeB, name: name.trim() });
    // The sim replaces the training slot only when it accepts the run. A refusal shows as a toast and the wizard stays open.
    if (getState().training !== before) onClose();
  };

  const setSize = (v: number) => setSizeB(roundSize(Math.min(Math.max(v, minB), half)));

  // ---- step bodies ------------------------------------------------------------

  const sizeBody = (
    <>
      <div class="tf-readout">
        <div class="tf-big-block">
          <span class="tf-label">Student</span>
          <span class="tf-big num">{sizeOk ? formatParams(size) : '—'}</span>
          <span class="tf-muted">
            {sizeOk ? `${r0((size / teacherActive) * 100)}% of ${formatParams(teacherActive)} active` : `Up to half of ${formatParams(teacherActive)} active`}
          </span>
        </div>
        <div class="tf-big-block">
          <span class="tf-label">Inference cost</span>
          <span class="tf-big">{sizeOk ? <Delta v={-saving * 100} unit="%" invert /> : <span class="num">—</span>}</span>
          <span class="tf-muted">{`vs ${plain(t.name)}`}</span>
        </div>
      </div>

      <div class="tf-slider-row">
        <Slider value={sizeB ?? 0} min={minB} max={half} step={stepB} label="Student parameters" onInput={setSize} />
        <NumField value={sizeB ?? NaN} min={minB} max={half} label="Student parameters in billions" onCommit={setSize} />
        <span class="tf-unit">B</span>
      </div>

      <div class="tf-grid4" role="radiogroup" aria-label="One-tap sizes">
        {FRACTIONS.map((den) => {
          const size = roundSize(teacherActive / den);
          const quote = distillQuote(s, teacherId, size);
          const on = sizeB === size;
          return (
            <Tile key={den} on={on} name={<span class="num">{`1/${den}`}</span>} onPick={() => setSizeB(size)}>
              <span class="num tf-tile-size">{formatParams(size)}</span>
              <span class="tf-tile-stack">
                <Stat label="Inference">
                  <Delta v={-(1 - 1 / den) * 100} unit="%" invert />
                </Stat>
                <Stat label="Overall">
                  <span class="num">{quote.forecast ? `~${r0(quote.forecast.mid)}` : '—'}</span>
                </Stat>
                <Stat label="Time">
                  <Days days={quote.days} ok={quote.ok} />
                </Stat>
                <Stat label="Cost">
                  <Money cost={quote.cost} ok={quote.ok} />
                </Stat>
              </span>
            </Tile>
          );
        })}
      </div>
    </>
  );

  const nameBody = (
    <CodenameField
      value={name}
      onChange={setName}
      onSuggest={() => setName(suggestCodename(uiRng()))}
      note="Internal name only. The public name is chosen at release."
    />
  );

  const reviewBody = (
    <div class="tf-review">
      <section class="tf-panel" aria-label="Forecast">
        <div class="tf-row-between">
          <span class="tf-label">Overall score</span>
          {fc && <Pill tone={CONF_TONE[fc.confidence] ?? 'bad'}>{fc.confidence}</Pill>}
        </div>
        {fc ? (
          <BandBar low={fc.low} mid={fc.mid} high={fc.high} variant="lg" label={`Forecast ${r0(fc.low)} to ${r0(fc.high)}, best guess ${r0(fc.mid)}`} />
        ) : (
          <span class="tf-muted">{q?.reason ?? 'Pick a size to see the forecast.'}</span>
        )}
        {fc && fc.reasons.length > 0 && (
          <ul class="tf-reasons">
            {fc.reasons.map((r) => (
              <li key={r}>{plain(r)}</li>
            ))}
          </ul>
        )}
        <Kv rows={[['Teacher overall', <span class="num">{r0(t.overall)}</span>], ['Ceiling', 'Teacher minus 1']]} />
      </section>

      <section class="tf-panel" aria-label="Cost and inheritance">
        <Kv
          rows={[
            ['Student', <span class="num">{sizeOk ? formatParams(size) : '—'}</span>],
            ['Inference cost', sizeOk ? <Delta v={-saving * 100} unit="%" invert /> : <span class="num">—</span>],
            ['Time', <Days days={q?.days ?? 0} ok={q?.ok ?? false} />],
            ['Cash cost', <Money cost={q?.cost ?? 0} ok={q?.ok ?? false} />],
          ]}
        />
        <span class="tf-label">Inherits</span>
        <ul class="tf-list">
          <li>{`${QUIRK_SHARE_PCT}% of its quirks, including ones you haven’t found.`}</li>
          <li>The teacher’s capability shape, pulled down by size.</li>
          <li>An eval day with no checkpoints.</li>
        </ul>
      </section>
    </div>
  );

  const body = cur === 0 ? sizeBody : cur === 1 ? nameBody : reviewBody;

  return (
    <FlowFrame
      kicker="Distill"
      parent={plain(t.name)}
      steps={STEPS}
      cur={cur}
      question={QUESTIONS[cur]}
      blocker={blocker}
      nextDisabled={nextDisabled}
      info={
        sizeOk && q ? (
          <Stats>
            <Stat label="Time">
              <Days days={q.days} ok={q.ok} />
            </Stat>
            <Stat label="Cost">
              <Money cost={q.cost} ok={q.ok} />
            </Stat>
          </Stats>
        ) : null
      }
      action={{ label: 'Distill', disabled: actionDisabled, title: blocker || 'Start the distillation', onClick: distill }}
      onStep={(i) => {
        if (i <= cur) setStep(i);
      }}
      onBack={() => setStep(Math.max(0, cur - 1))}
      onNext={() => {
        if (!nextDisabled) setStep(Math.min(STEPS.length - 1, cur + 1));
      }}
      onCancel={onClose}
    >
      {body}
    </FlowFrame>
  );
}
