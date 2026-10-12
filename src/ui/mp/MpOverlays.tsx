// Multiplayer chrome that sits over the game: the waiting bar, the disconnect modal and the match result.
import { useState } from 'preact/hooks';
import { Button, Modal } from '../components';
import { useGame } from '../store';
import { answerSpeedAsk, holdResume, leaveGame, readyToResume, reconnect, useSession } from '../../net/session';
import { MP_RIVAL_ID } from '../../sim/types';
import { crownTable } from '../../sim/systems/multiplayer';
import { labInfo } from '../../sim/systems/labs';
import { formatMoney } from '../../sim/util';
import { plain } from '../shell/fmt';
import './mp.css';

/** Thin bar under the top bar while lockstep holds our sim back. Not a modal: the game keeps drawing. */
function WaitingBar() {
  const s = useGame();
  const session = useSession();
  if (!session.waitingForRival) return null;
  const rival = s.mp?.rival?.companyName ?? session.rivalName ?? labInfo(s, MP_RIVAL_ID)?.name ?? 'your rival';
  return (
    <div class="mp-waiting" role="status">
      <span class="dot dot-warn dot-pulse" aria-hidden="true" />
      <span>Waiting for {rival}…</span>
    </div>
  );
}

const SPEED_LABEL: Record<number, string> = { 1: '1×', 3: '3×', 10: '10×' };
const speedText = (n: number) => SPEED_LABEL[n] ?? `${n}×`;

/**
 * v12 shared speed: the speed-up request, the 30-second countdown out of a pause, and short notes ("Rival paused").
 * Sits under the top bar, centred, so both players see the same thing at the same time.
 */
function SpeedVoteBar() {
  const s = useGame();
  const session = useSession();
  const v = session.speedVote;
  if (!v || !s.mp) return null;
  const rival = s.mp.rival?.companyName ?? session.rivalName ?? 'Your rival';
  const myColor = s.mp.myColor;
  const rivalColor = s.mp.rival?.color ?? session.rivalColor ?? 'var(--line-2)';

  if (v.kind === 'note') {
    return (
      <div class="mp-vote mp-vote-note" role="status">
        {v.text}
      </div>
    );
  }

  const left = v.secondsLeft / v.total;
  const drain = <div class="mp-vote-drain" style={{ '--f': left.toFixed(3) } as any} aria-hidden="true" />;

  if (v.kind === 'ask') {
    if (v.from === 'me') {
      return (
        <div class="mp-vote" role="status">
          <div class="mp-vote-row">
            <span class="mp-vote-speed num">{speedText(v.speed)}</span>
            <span class="mp-vote-text">Asked {rival} to speed up. Goes through in {v.secondsLeft} s unless they say no.</span>
          </div>
          {drain}
        </div>
      );
    }
    return (
      <div class="mp-vote is-ask" role="alertdialog" aria-label={`${rival} asks for ${speedText(v.speed)}`}>
        <div class="mp-vote-row">
          <span class="mp-vote-speed num">{speedText(v.speed)}</span>
          <span class="mp-vote-text">
            {rival} wants {speedText(v.speed)}. Yes in {v.secondsLeft} s.
          </span>
          <span class="mp-vote-acts">
            <Button size="sm" variant="primary" onClick={() => answerSpeedAsk(true)}>
              Accept
            </Button>
            <Button size="sm" onClick={() => answerSpeedAsk(false)}>
              Keep {speedText(s.speed || 1)}
            </Button>
          </span>
        </div>
        {drain}
      </div>
    );
  }

  // Countdown out of a pause.
  return (
    <div class="mp-vote is-count" role="alertdialog" aria-label={`Resuming at ${speedText(v.speed)} in ${v.secondsLeft} seconds`}>
      <div class="mp-vote-row">
        <span class="mp-vote-clock num">{v.secondsLeft}</span>
        <span class="mp-vote-text">
          {v.from === 'me' ? 'You' : rival} pressed play. Resuming at <b>{speedText(v.speed)}</b>.
        </span>
        <span class="mp-vote-acts">
          {!v.meReady && (
            <Button size="sm" variant="primary" onClick={readyToResume}>
              Ready
            </Button>
          )}
          <Button size="sm" onClick={holdResume}>
            Stay paused
          </Button>
        </span>
      </div>
      <div class="mp-vote-ready">
        <span class={`mp-ready-chip${v.meReady ? ' is-on' : ''}`} style={{ '--c': myColor } as any}>
          You {v.meReady ? 'ready' : 'not ready'}
        </span>
        <span class={`mp-ready-chip${v.rivalReady ? ' is-on' : ''}`} style={{ '--c': rivalColor } as any}>
          {rival} {v.rivalReady ? 'ready' : 'not ready'}
        </span>
        <span class="faint">Both ready starts it now.</span>
      </div>
      {drain}
    </div>
  );
}

/** Shown when the connection drops. Sticky: the only exits are waiting for a reconnect or leaving. */
function DisconnectModal() {
  const s = useGame();
  const session = useSession();
  const [busy, setBusy] = useState(false);
  // Once the match has a result, the result modal is the only thing to say.
  if (session.status !== 'disconnected' || s.mp?.result) return null;
  const rival = s.mp?.rival?.companyName ?? session.rivalName ?? 'Your rival';

  const wait = async () => {
    setBusy(true);
    try {
      await reconnect();
    } catch {
      // The session reports the failure itself; the modal stays up.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      tone="danger"
      title="Rival disconnected"
      width={440}
      footer={
        <>
          <Button variant="primary" disabled={busy} onClick={wait}>
            {busy ? 'Reconnecting…' : 'Wait'}
          </Button>
          <Button variant="danger" onClick={() => leaveGame()}>
            Leave
          </Button>
        </>
      }
    >
      <p>
        The connection to {rival} dropped, so both games are paused. Wait for it to come back, or leave the match. Leaving
        ends this match for you.
      </p>
    </Modal>
  );
}

/** Match over: winner, reason, final numbers. Sticky, so the only way out is "Back to menu". */
function ResultModal() {
  const s = useGame();
  const mp = s.mp;
  const r = mp?.result;
  if (!mp || !r) return null;

  const rival = mp.rival;
  const rivalName = labInfo(s, MP_RIVAL_ID)?.name ?? rival?.companyName ?? 'Rival';
  const crowns = crownTable(s);
  const mineCrowns = crowns.filter((c) => c.leader === 'me').length;
  const rivalCrowns = crowns.filter((c) => c.leader === 'rival').length;
  const money = (v: number) => formatMoney(v, 1);

  const headline = r.winner === 'me' ? 'You win.' : r.winner === 'rival' ? `${rivalName} wins.` : 'Draw.';
  const myElo = Math.round(s.stats.bestElo);
  const rivalElo = rival?.model ? Math.round(rival.model.elo) : null;

  return (
    <Modal
      open
      title="Match over"
      width={480}
      footer={
        <Button variant="primary" onClick={() => leaveGame()}>
          Back to menu
        </Button>
      }
    >
      <div class="mp-result-head">{headline}</div>
      <p class="mp-result-reason">{plain(r.reason)}</p>
      <div class="table-wrap">
        <table class="table mp-result-table">
          <thead>
            <tr>
              <th>Final</th>
              <th class="num">You</th>
              <th class="num">{rivalName}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Valuation</td>
              <td class="num">{money(s.finance.valuation)}</td>
              <td class="num">{rival ? money(rival.valuation) : '—'}</td>
            </tr>
            <tr>
              <td>Benchmark crowns</td>
              <td class="num">{mineCrowns}</td>
              <td class="num">{rivalCrowns}</td>
            </tr>
            <tr>
              <td>Best Elo</td>
              <td class="num">{myElo}</td>
              <td class="num">{rivalElo ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export function MpOverlays() {
  return (
    <>
      <WaitingBar />
      <SpeedVoteBar />
      <DisconnectModal />
      <ResultModal />
    </>
  );
}
