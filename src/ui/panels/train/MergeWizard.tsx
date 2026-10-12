// OWNER: Agent UI-FLOWS. Merge wizard: Partner, Method, Name, Review. Each step is visited on purpose; nothing is pre-chosen.
// Forecasts and compatibility come from mergeQuote only. Never reads model.vibes, latentQuirks or run.hidden.
import { useState } from 'preact/hooks';
import { dispatch, getState, useGame } from '../../store';
import { formatParams } from '../../../sim/util';
import { mergeQuote } from '../../../sim/systems/derive';
import { suggestCodename } from '../../../sim/data/names';
import type { MergeMethod } from '../../../sim/types';
import { Pill } from '../../components';
import { plain } from '../../shell/fmt';
import { uiRng } from '../panelKit';
import { BandBar } from './kit';
import { r0 } from './model';
import { CodenameField, Days, FlowFrame, Kv, Money, Stat, Stats, Tile } from './flowKit';

const STEPS = ['Partner', 'Method', 'Name', 'Review'];
const QUESTIONS = ['Who does it merge with?', 'How do the weights combine?', 'What is it codenamed?', 'Ready to merge?'];
/** Half-width of a 10th to 90th percentile band in standard deviations. Turns a forecast band back into a spread. */
const BAND_PER_SD = 2.56;
/** Cursed chance for a frankenmerge, shown as copy. */
const CURSED_PCT = 15;

const METHODS: { id: MergeMethod; name: string; line: string; caps: string; quirks: string; risk: string; tone: 'good' | 'info' | 'bad' }[] = [
  {
    id: 'average',
    name: 'Average',
    line: 'Blend the two sets of weights.',
    caps: 'Caps average.',
    quirks: 'Quirks from both.',
    risk: 'Low risk',
    tone: 'good',
  },
  {
    id: 'ties',
    name: 'Ties',
    line: 'Keep the stronger side of each cap.',
    caps: 'Caps take the higher value, minus a little.',
    quirks: 'Quirks from both.',
    risk: 'Medium risk',
    tone: 'info',
  },
  {
    id: 'frankenmerge',
    name: 'Frankenmerge',
    line: 'Ignores compatibility. Each cap comes from one parent, at random.',
    caps: 'Caps random per cap.',
    quirks: 'Quirks from both, plus one at random.',
    risk: 'High risk',
    tone: 'bad',
  },
];

export function MergeWizard({ aId, onClose }: { aId: string; onClose: () => void }) {
  const s = useGame();
  const a = s.models.find((x) => x.id === aId);
  const [step, setStep] = useState(0);
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [method, setMethod] = useState<MergeMethod | null>(null);
  const [name, setName] = useState(() => suggestCodename(uiRng()));

  if (!a) {
    return (
      <div class="tf-root">
        <div class="tf-empty">That model no longer exists.</div>
        <div class="tf-foot-btns">
          <button type="button" class="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const hidden = s.pendingReveal?.modelId;
  const partners = s.models.filter((x) => x.id !== aId && x.id !== hidden && !x.deprecated);
  const partner = partners.find((x) => x.id === partnerId) ?? null;
  const run = s.training;
  const cur = Math.min(step, STEPS.length - 1);
  const nameOk = name.trim().length > 0;
  const methodQuotes = partner ? METHODS.map((md) => ({ md, q: mergeQuote(s, aId, partner.id, md.id) })) : [];
  const chosen = methodQuotes.find((x) => x.md.id === method) ?? null;
  const q = chosen?.q ?? null;
  const fc = q?.forecast ?? null;
  const sd = fc ? ((fc.high - fc.low) / BAND_PER_SD).toFixed(1) : '—';

  let blocker = '';
  if (run) blocker = `${plain(run.name)} is training. Stop or finish it first.`;
  else if (cur === 0 && !partner) blocker = 'Pick a partner.';
  else if (cur === 1 && !method) blocker = 'Pick a method.';
  else if (cur === 2 && !nameOk) blocker = 'Name it.';
  else if (cur === 3 && q && !q.ok) blocker = q.reason ?? 'Merging is not possible right now.';
  const nextDisabled = (cur === 0 && !partner) || (cur === 1 && !method) || (cur === 2 && !nameOk);
  const actionDisabled = !partner || !method || !q || !q.ok || !nameOk || run !== null;

  const merge = () => {
    if (actionDisabled || !partner || !method) return;
    const before = getState().training;
    dispatch({ type: 'startMerge', aId, bId: partner.id, method, name: name.trim() });
    // The sim replaces the training slot only when it accepts the run. A refusal shows as a toast and the wizard stays open.
    if (getState().training !== before) onClose();
  };

  // ---- step bodies ------------------------------------------------------------

  const partnerBody =
    partners.length === 0 ? (
      <div class="tf-empty">No other model to merge with. Train one first.</div>
    ) : (
      <div class="tf-grid3" role="radiogroup" aria-label="Partner model">
        {partners.map((b) => {
          const avg = mergeQuote(s, aId, b.id, 'average');
          return (
            <Tile key={b.id} on={partnerId === b.id} name={plain(b.name)} onPick={() => setPartnerId(b.id)}>
              <Stats>
                <Stat label="Params">
                  <span class="num">{formatParams(b.paramsB)}</span>
                </Stat>
                <Stat label="Overall">
                  <span class="num">{r0(b.overall)}</span>
                </Stat>
              </Stats>
              <span class="tf-tile-line">{b.releasedDay !== null ? 'Released' : 'Unreleased'}</span>
              {run ? (
                <span class="tf-faint">Compatibility is checked once training ends.</span>
              ) : avg.ok ? (
                <span class="tf-ok">{avg.forecast ? `Compatible. Average merge ~${r0(avg.forecast.mid)}.` : 'Compatible.'}</span>
              ) : (
                <span class="tf-note">{avg.reason ?? 'Incompatible.'}</span>
              )}
            </Tile>
          );
        })}
      </div>
    );

  const methodBody = (
    <div class="tf-grid3" role="radiogroup" aria-label="Merge method">
      {methodQuotes.map(({ md, q: mq }) => {
        const mfc = mq.forecast;
        const mSd = mfc ? ((mfc.high - mfc.low) / BAND_PER_SD).toFixed(1) : '—';
        return (
          <Tile key={md.id} on={method === md.id} disabled={!mq.ok} title={mq.ok ? undefined : mq.reason} name={md.name} onPick={() => setMethod(md.id)}>
            <span class="tf-tile-line">{md.line}</span>
            <span class="tf-caps">{`${md.caps} ${md.quirks}`}</span>
            <Stats>
              <Stat label="Mean">
                <span class="num">{mfc ? mfc.mid.toFixed(1) : '—'}</span>
              </Stat>
              <Stat label="SD">
                <span class="num">{mSd}</span>
              </Stat>
            </Stats>
            <Stats>
              <Stat label="Time">
                <Days days={mq.days} ok={mq.ok} />
              </Stat>
              <Stat label="Cost">
                <Money cost={mq.cost} ok={mq.ok} />
              </Stat>
            </Stats>
            <Pill tone={md.tone}>{md.risk}</Pill>
            {md.id === 'frankenmerge' && <span class="tf-warn">{`${CURSED_PCT}% cursed: a −10 hit to overall if it lands.`}</span>}
            {!mq.ok && !run && <span class="tf-note">{mq.reason ?? 'Not available with this partner.'}</span>}
          </Tile>
        );
      })}
    </div>
  );

  const nameBody = (
    <CodenameField
      value={name}
      onChange={setName}
      onSuggest={() => setName(suggestCodename(uiRng()))}
      note="Internal name only. The public name is chosen at release."
    />
  );

  const reviewBody = partner && method && (
    <div class="tf-review">
      <section class="tf-panel" aria-label="Forecast">
        <div class="tf-row-between">
          <span class="tf-label">Overall score</span>
          {fc && <span class="num tf-muted">{`SD ${sd}`}</span>}
        </div>
        {fc ? (
          <BandBar low={fc.low} mid={fc.mid} high={fc.high} variant="lg" label={`Forecast ${r0(fc.low)} to ${r0(fc.high)}, best guess ${r0(fc.mid)}`} />
        ) : (
          <span class="tf-muted">{q?.reason ?? 'Pick a partner and method to see the forecast.'}</span>
        )}
        {fc && fc.reasons.length > 0 && (
          <ul class="tf-reasons">
            {fc.reasons.map((r) => (
              <li key={r}>{plain(r)}</li>
            ))}
          </ul>
        )}
        <Kv
          rows={[
            ['Parents', `${plain(a.name)} and ${plain(partner.name)}`],
            ['Method', METHODS.find((md) => md.id === method)?.name ?? method],
          ]}
        />
      </section>

      <section class="tf-panel" aria-label="Cost and inheritance">
        <Kv
          rows={[
            ['Time', <Days days={q?.days ?? 0} ok={q?.ok ?? false} />],
            ['Cash cost', <Money cost={q?.cost ?? 0} ok={q?.ok ?? false} />],
            ['Mean', <span class="num">{fc ? fc.mid.toFixed(1) : '—'}</span>],
            ['SD', <span class="num">{sd}</span>],
          ]}
        />
        <span class="tf-label">Inherits</span>
        <ul class="tf-list">
          <li>{METHODS.find((md) => md.id === method)?.caps}</li>
          <li>{`${METHODS.find((md) => md.id === method)?.quirks ?? ''} Includes ones nobody has found.`}</li>
          {method === 'frankenmerge' && <li class="tf-warn-item">{`${CURSED_PCT}% chance of a cursed result: a −10 hit to overall.`}</li>}
        </ul>
      </section>
    </div>
  );

  const body = cur === 0 ? partnerBody : cur === 1 ? methodBody : cur === 2 ? nameBody : reviewBody;

  return (
    <FlowFrame
      kicker="Merge"
      parent={plain(a.name)}
      steps={STEPS}
      cur={cur}
      question={QUESTIONS[cur]}
      blocker={blocker}
      nextDisabled={nextDisabled}
      info={
        q ? (
          <Stats>
            <Stat label="Mean">
              <span class="num">{fc ? fc.mid.toFixed(1) : '—'}</span>
            </Stat>
            <Stat label="Time">
              <Days days={q.days} ok={q.ok} />
            </Stat>
            <Stat label="Cost">
              <Money cost={q.cost} ok={q.ok} />
            </Stat>
          </Stats>
        ) : null
      }
      action={{ label: 'Merge', disabled: actionDisabled, title: blocker || 'Start the merge', onClick: merge }}
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
