// OWNER: Agent UI-FLOWS. Release wizard: How, Name, Review. Each step is visited on purpose; nothing is pre-chosen.
// Reads the sim through its APIs only. Overall is shown only after eval day, as the Models panel already does.
// Never reads model.vibes, model.latentQuirks or run.hidden.
import { useState } from 'preact/hooks';
import { dispatch, getState, useGame } from '../../store';
import { formatDate } from '../../../sim/util';
import { releasePreview } from '../../../sim/systems/release';
import { teaseOptions } from '../../../sim/systems/vault';
import { NAMING_SCHEMES, suggestPublicName } from '../../../sim/data/names';
import type { ReleaseMode } from '../../../sim/types';
import { plain } from '../../shell/fmt';
import { uiRng } from '../panelKit';
import { r0 } from './model';
import { Ack, Chip, Delta, FlowFrame, Kv, Stat, Stats, Tile } from './flowKit';

type Naming = 'public' | 'codename';

const MODES: { id: ReleaseMode; name: string; line: string }[] = [
  { id: 'full', name: 'Full release', line: 'Everyone can use it. Any teaser resolves now.' },
  { id: 'preview', name: 'Limited preview', line: 'A few products for 30 days. Auto-promotes when the window closes.' },
  { id: 'open', name: 'Open weights', line: 'Anyone can download it. Products lose users to self-hosting. Can’t be undone.' },
];
const MODE_NAME: Record<ReleaseMode, string> = { full: 'Full release', preview: 'Limited preview', open: 'Open weights' };
const TEASE_NAME: Record<string, string> = { vague: 'Vague teaser', benchmarks: 'Benchmarks teaser', hype: 'Hype teaser' };
const STEPS = ['How', 'Name', 'Review'];
const QUESTIONS = ['How do you ship it?', 'What is it called?', 'Ready to release?'];

export function ReleaseWizard({ modelId, onClose }: { modelId: string; onClose: () => void }) {
  const s = useGame();
  const m = s.models.find((x) => x.id === modelId);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<ReleaseMode | null>(null);
  const [scheme, setScheme] = useState<string | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [openAck, setOpenAck] = useState(false);

  if (!m) {
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

  const codename = plain(m.codename ?? m.name);
  const publicName = (nameDraft ?? '').trim();
  const released = m.releasedDay !== null;
  const previews = MODES.map((md) => releasePreview(s, m, md.id));
  const picked = mode ? previews[MODES.findIndex((md) => md.id === mode)] : null;
  const nameOk = naming === 'codename' || (naming === 'public' && scheme !== null && publicName.length > 0);
  const openOk = mode !== 'open' || openAck;

  const promised = m.teased ?? null;
  const promisedLabel = promised
    ? teaseOptions(s, m).find((o) => o.level === promised.level)?.label ?? TEASE_NAME[promised.level] ?? promised.level
    : '';
  const gap = promised ? promised.expected - m.overall : 0;

  const cur = Math.min(step, STEPS.length - 1);
  let stepBlock = '';
  if (cur === 0 && !mode) stepBlock = 'Pick a release mode.';
  else if (cur === 1 && !nameOk) {
    if (naming === null) stepBlock = 'Pick a name option.';
    else if (naming === 'public' && scheme === null) stepBlock = 'Pick a naming scheme.';
    else stepBlock = 'Name it, or keep the codename.';
  } else if (cur === 2 && !openOk) stepBlock = 'Acknowledge that open weights can’t be taken back.';
  const blocker = released ? `${plain(m.name)} is already out.` : stepBlock;
  const nextDisabled = (cur === 0 && !mode) || (cur === 1 && !nameOk);

  const pickScheme = (id: string) => {
    setScheme(id);
    dispatch({ type: 'setNamingScheme', schemeId: id });
    setNameDraft(suggestPublicName(s, m, id, uiRng()));
  };
  const suggest = () => {
    if (scheme) setNameDraft(suggestPublicName(s, m, scheme, uiRng()));
  };

  const release = () => {
    if (!mode || released || !nameOk || !openOk) return;
    const before = { releasedDay: m.releasedDay, releaseMode: m.releaseMode, previewUntil: m.previewUntil };
    dispatch({ type: 'releaseModel', modelId: m.id, mode, ...(naming === 'public' ? { publicName } : {}) });
    // The sim refuses a release with a toast. The wizard closes only when the model actually changed.
    const after = getState().models.find((x) => x.id === modelId);
    if (after && (after.releasedDay !== before.releasedDay || after.releaseMode !== before.releaseMode || after.previewUntil !== before.previewUntil)) {
      onClose();
    }
  };

  const schemeName = (id: string | null) => NAMING_SCHEMES.find((x) => x.id === id)?.name ?? '';
  const houseStyle = s.company.namingScheme ? schemeName(s.company.namingScheme) : '';
  const renameLine = naming === 'public' && publicName ? `${codename} → ${plain(publicName)}` : '';

  // ---- step bodies ------------------------------------------------------------

  const howBody = (
    <div class="tf-grid3" role="radiogroup" aria-label="Release mode">
      {MODES.map((md, i) => {
        const p = previews[i];
        return (
          <Tile key={md.id} on={mode === md.id} name={md.name} onPick={() => setMode(md.id)}>
            <span class="tf-tile-line">{md.line}</span>
            <Stats>
              <Stat label="Hype">
                <Delta v={p.hype} />
              </Stat>
              <Stat label="Brand">
                <Delta v={p.brand} />
              </Stat>
              <Stat label="Reputation">
                <Delta v={p.reputation} />
              </Stat>
            </Stats>
            {p.notes.length > 0 && (
              <ul class="tf-notes">
                {p.notes.map((n, k) => (
                  <li key={k}>{plain(n)}</li>
                ))}
              </ul>
            )}
          </Tile>
        );
      })}
    </div>
  );

  const nameBody = (
    <>
      <div class="tf-field">
        <span class="tf-label">Naming scheme</span>
        <div class="tf-grid3" role="radiogroup" aria-label="Naming scheme">
          {NAMING_SCHEMES.map((sc) => (
            <Tile key={sc.id} on={scheme === sc.id} name={sc.name} onPick={() => pickScheme(sc.id)}>
              <span class="tf-tile-line">{sc.description}</span>
              <span class="tf-example">{sc.example}</span>
            </Tile>
          ))}
        </div>
        {houseStyle && <span class="tf-faint">{`Current house style: ${houseStyle}.`}</span>}
      </div>

      <div class="tf-field">
        <span class="tf-label">Name</span>
        <div class="tf-chips" role="radiogroup" aria-label="Name">
          <Chip on={naming === 'public'} onClick={() => setNaming('public')}>
            Public name
          </Chip>
          <Chip on={naming === 'codename'} onClick={() => setNaming('codename')}>
            Keep codename
          </Chip>
        </div>

        {naming === 'public' && (
          <div class="tf-name-row">
            <input
              class="input tf-name"
              type="text"
              maxLength={40}
              value={nameDraft ?? ''}
              disabled={scheme === null}
              placeholder={scheme === null ? 'Pick a scheme first' : 'Name it'}
              aria-label="Public name"
              onInput={(e) => setNameDraft((e.currentTarget as HTMLInputElement).value)}
            />
            <span class="num tf-count">{`${(nameDraft ?? '').length}/40`}</span>
            <button type="button" class="btn btn-sm" disabled={scheme === null} onClick={suggest}>
              Suggest another
            </button>
          </div>
        )}
        {naming === 'codename' && <span class="tf-muted">{`Ships as ${codename}. No rename.`}</span>}
        {renameLine && <span class="tf-rename">{renameLine}</span>}
      </div>
    </>
  );

  const reviewBody = (
    <div class="tf-review">
      <section class="tf-panel" aria-label="Promise">
        <span class="tf-label">Promise</span>
        {promised ? (
          <>
            <span class="tf-big">
              You promised <span class="num">{`~${r0(promised.expected)}`}</span>
            </span>
            <span class="tf-muted">{`${promisedLabel}, ${formatDate(promised.day)}.`}</span>
            <Kv rows={[['Overall', <span class="num">{r0(m.overall)}</span>]]} />
            {gap > 0.05 ? (
              <span class="tf-warn">{`Lands ${gap.toFixed(1)} below the promise. Expect backlash.`}</span>
            ) : (
              <span class="tf-ok">{gap < -0.05 ? `Lands ${(-gap).toFixed(1)} above the promise.` : 'Lands on the promise.'}</span>
            )}
          </>
        ) : (
          <span class="tf-muted">No teaser. Nothing was promised, so nothing to break.</span>
        )}
      </section>

      <section class="tf-panel" aria-label="Release">
        <span class="tf-label">Release</span>
        <Kv
          rows={[
            ['Mode', mode ? MODE_NAME[mode] : '—'],
            ['Name', naming === 'public' && publicName ? plain(publicName) : naming === 'codename' ? `${codename} (codename)` : '—'],
            ['Hype', picked ? <Delta v={picked.hype} /> : <span class="num">—</span>],
            ['Brand', picked ? <Delta v={picked.brand} /> : <span class="num">—</span>],
            ['Reputation', picked ? <Delta v={picked.reputation} /> : <span class="num">—</span>],
          ]}
        />
        {picked && picked.notes.length > 0 && (
          <ul class="tf-notes">
            {picked.notes.map((n, k) => (
              <li key={k}>{plain(n)}</li>
            ))}
          </ul>
        )}
        {m.leakedDay !== undefined && (
          <span class="tf-warn">{`Weights leaked ${formatDate(m.leakedDay)}. This release gets less hype.`}</span>
        )}
        {mode === 'open' && (
          <Ack on={openAck} onToggle={() => setOpenAck(!openAck)}>
            Open weights can’t be taken back. Confirm.
          </Ack>
        )}
      </section>
    </div>
  );

  const body = cur === 0 ? howBody : cur === 1 ? nameBody : reviewBody;
  const finalLabel = mode === 'preview' ? 'Start preview' : 'Release';

  return (
    <FlowFrame
      kicker="Release"
      parent={plain(m.name)}
      steps={STEPS}
      cur={cur}
      question={QUESTIONS[cur]}
      blocker={blocker}
      nextDisabled={nextDisabled}
      info={
        picked ? (
          <Stats>
            <Stat label="Hype">
              <Delta v={picked.hype} />
            </Stat>
            <Stat label="Brand">
              <Delta v={picked.brand} />
            </Stat>
            <Stat label="Rep">
              <Delta v={picked.reputation} />
            </Stat>
          </Stats>
        ) : null
      }
      action={{
        label: finalLabel,
        disabled: released || !mode || !nameOk || !openOk,
        title: blocker || finalLabel,
        onClick: release,
      }}
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
