import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ACHIEVEMENTS } from '../../sim/data/achievements';
import { formatMoney } from '../../sim/util';
import { Button, formatInt } from '../components';
import { newGame, useGame, useGameSelect } from '../store';
import { saveMessage } from '../saveText';
import { openNewGame } from './NewGame';
import { openSaves } from './SavesSheet';
import { plain, tdate } from './fmt';

function Row({ k, v }: { k: string; v: ComponentChildren }) {
  return (
    <div class="kv-row">
      <span class="kv-k">{k}</span>
      <span class="kv-v num">{v}</span>
    </div>
  );
}

/** Bankruptcy summary window. Shown when s.gameOver is set. */
export function GameOver() {
  // Closed most days: re-renders only when bankruptcy opens the window.
  const go = useGameSelect((s) => s.gameOver ?? null);
  return go ? <GameOverBody /> : null;
}

function GameOverBody() {
  const s = useGame();
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const go = s.gameOver;
  if (!go) return null;

  const unlocked = Object.keys(s.achievements).length;
  const money = (v: number) => formatMoney(v, 1);

  return (
    <div class="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="gameover-title">
      <div class="modal modal-danger gameover">
        <div class="modal-header">
          <h2 class="modal-title" id="gameover-title">
            Chapter 11 · {tdate(go.day)}
          </h2>
        </div>
        <div class="modal-body">
          <div class="gameover-title">Bankrupt</div>
          <p class="gameover-reason">{plain(go.reason)}</p>

          <div class="kv gameover-kv">
            <Row k="Days survived" v={formatInt(go.day)} />
            <Row k="Peak valuation" v={money(s.stats.peakValuation)} />
            <Row k="Total revenue" v={money(s.stats.totalRevenue)} />
            <Row k="Total raised" v={money(s.finance.totalRaised)} />
            <Row k="Models trained" v={formatInt(s.stats.modelsTrained)} />
            <Row k="Best Elo" v={formatInt(Math.round(s.stats.bestElo))} />
            <Row k="Trophies" v={`${unlocked} / ${ACHIEVEMENTS.length}`} />
          </div>

          <div class="gameover-new">
            <input
              class="input"
              value={name}
              placeholder="New company name"
              maxLength={32}
              aria-label="New company name"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <Button
              variant="primary"
              onClick={() => {
                const r = newGame(name.trim() || undefined);
                setErr(r.ok ? '' : saveMessage(r.error));
              }}
            >
              New company
            </Button>
            <Button onClick={() => openNewGame()}>Pick a scenario</Button>
            <Button onClick={() => openSaves()}>Load a save</Button>
          </div>
          {err && <p class="small bad" role="alert">{err}</p>}
        </div>
      </div>
    </div>
  );
}
