// Scene workbench: /src/scenes/demo.html?scene=compute&days=900&strategy=frontier
// Loads ./<scene>/index.ts (exports createScene and CAM), plays the bot for `days`, and shows the scene at three
// sizes with speed controls, so a scene can be built without touching any panel.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { createInitialState } from '../sim/state';
import { tick } from '../sim/engine';
import { botDay, type BotStrategy } from '../../scripts/bot';
import type { GameState } from '../sim/types';
import type { Scene, SceneHit } from './types';
import { SceneView } from './SceneView';
import '../ui/theme.css';

const q = new URLSearchParams(location.search);
const name = q.get('scene') ?? 'compute';
const days = Number(q.get('days') ?? 900);
const strategy = (q.get('strategy') ?? 'frontier') as BotStrategy;

const state: GameState = createInitialState(Number(q.get('seed') ?? 1), 'Demo Labs');
for (let d = 0; d < days; d++) {
  botDay(state, false, strategy);
  tick(state);
}
state.events.pending = null;
(window as any).__scene = { state, tick: (n = 1) => { for (let i = 0; i < n; i++) { botDay(state, false, strategy); tick(state); } } };

function Demo({ mod }: { mod: { createScene: () => Scene; CAM?: string } }) {
  const [, setN] = useState(0);
  const [hit, setHit] = useState<SceneHit | null>(null);
  const [run, setRun] = useState(false);
  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => {
      (window as any).__scene.tick(1);
      setN((n) => n + 1);
    }, 100);
    return () => clearInterval(id);
  }, [run]);
  return (
    <div style={{ padding: '16px', display: 'grid', gap: '16px', background: 'var(--bg)', color: 'var(--fg)', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <b>{name}</b> day {state.day}
        <button class="btn btn-sm" onClick={() => setRun((r) => !r)}>{run ? 'Pause' : 'Play 10 days/s'}</button>
        <span class="small">Clicked: {hit ? `${hit.id} (${hit.label})` : 'nothing'}</span>
      </div>
      <SceneView state={state} make={mod.createScene} cam={mod.CAM ?? name} label={name} onSelect={setHit} />
      <div style={{ width: '375px' }}>
        <SceneView state={state} make={mod.createScene} cam={mod.CAM ?? name} label={name} height={240} onSelect={setHit} />
      </div>
    </div>
  );
}

import(/* @vite-ignore */ `./${name}/index.ts`).then((mod) => render(<Demo mod={mod} />, document.getElementById('app')!));
