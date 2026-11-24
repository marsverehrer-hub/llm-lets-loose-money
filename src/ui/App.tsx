import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { handsOnRun } from '../sim/apply';
import { blocker } from '../sim/endWeek';
import { Btn, Icon, Logo, Portrait, useCountUp } from './kit';
import { nextWeek, skip, start, useGame, getGame } from './store';
import { money, pct, weekLabel, type Tab } from './fmt';
import { MomentView } from './moments';
import { Desk } from './screens/Desk';
import { Empire } from './screens/Empire';
import { Lab } from './screens/Lab';
import { Market } from './screens/Market';
import { Street } from './screens/Street';
import { Wizard } from './screens/Wizard';

const TABS: { id: Tab; label: string }[] = [
  { id: 'desk', label: 'Desk' }, { id: 'lab', label: 'Lab' }, { id: 'market', label: 'Market' }, { id: 'street', label: 'Street' }, { id: 'empire', label: 'Empire' },
];

function NewGame(): JSX.Element {
  const [name, setName] = useState('Loose Money Labs');
  const seed = Number(new URLSearchParams(location.search).get('seed')) || Math.floor(Math.random() * 1e6) + 1;
  return (
    <main class="newgame">
      <div class="faces">{['Chet Vantage', 'Prudence Lindqvist', 'Dr. Ada Brackett'].map((n, i) => <Portrait name={n} style={['hype', 'safety', 'research'][i]} mood={(['smug', 'neutral', 'happy'] as const)[i]} size={64} />)}</div>
      <h1>LLM: Lets Loose Money</h1>
      <p class="lead">You just took an AI lab public on the strength of a slide deck. Build models, steal customers, and out-raise, out-ship and outlast the other labs.</p>
      <label class="field"><span>Name your lab</span><input value={name} maxLength={24} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <Btn kind="primary" id="start" disabled={!name.trim()} onClick={() => start(seed, name.trim())}>Ring the bell</Btn>
      <p class="muted small">Weekly turns. Three game years. Your game saves itself in this browser.</p>
    </main>
  );
}

export function App(): JSX.Element {
  const s = useGame();
  const [tab, setTab] = useState<Tab>('desk');
  const [wizard, setWizard] = useState(false);
  const cash = useCountUp(s ? s.companies[s.labId].cash : 0);
  if (!s) return <NewGame />;
  const co = s.companies[s.labId];
  const why = blocker(s);
  const run = handsOnRun(s);
  const last = co.hist[co.hist.length - 2] ?? co.price;
  const go = (t: Tab | 'wizard'): void => { if (t === 'wizard') setWizard(true); else setTab(t); };
  const after = (f: () => void) => (): void => {
    f();
    const n = getGame();
    if (n && (handsOnRun(n)?.call || n.moments.length)) setTab('desk');
    window.scrollTo(0, 0);
  };
  return (
    <div class="app">
      <header class="top">
        <Logo co={co} size={36} />
        <div class="grow"><b class="name">{co.name}</b><br /><span class="small">{weekLabel(s.week)}</span></div>
        <div class="right"><b class={`cash ${co.cash < 0 ? 'bad' : ''}`}>{money(cash)}</b><br />
          <span class={`small ${co.price >= last ? 'good' : 'bad'}`}>${co.price.toFixed(2)} {pct(co.price / last - 1, 1)}</span></div>
      </header>

      <main>
        {tab === 'desk' && <Desk s={s} go={go} />}
        {tab === 'lab' && <Lab s={s} openWizard={() => setWizard(true)} />}
        {tab === 'market' && <Market s={s} />}
        {tab === 'street' && <Street s={s} />}
        {tab === 'empire' && <Empire s={s} />}
      </main>

      <div class="bottom">
        <div class="turn">
          {why ? <span class="grow small why">{why}</span> : <Btn kind="ghost" id="skip" onClick={after(skip)}>Fast-forward</Btn>}
          <Btn kind="primary" id="end-week" class="grow" why={why} onClick={after(nextWeek)}>End week</Btn>
        </div>
        <nav class="tabs" aria-label="Screens">
          {TABS.map((t) => (
            <button type="button" class={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setTab(t.id); window.scrollTo(0, 0); }}>
              <Icon name={t.id} /><span>{t.label}</span>{t.id === 'desk' && run?.call && <i class="badge" aria-label="needs you" />}
            </button>
          ))}
        </nav>
      </div>

      {wizard && <Wizard s={s} onClose={() => setWizard(false)} />}
      <MomentView s={s} />
    </div>
  );
}
