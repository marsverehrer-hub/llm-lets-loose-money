// OWNER: PROGRESSION UI (v13). Lab level, XP to the next level, perk points and the hot streak.
import type { GameState } from '../../../sim/types';
import { levelProgress, progressOf, streakXpMult } from '../../../sim/systems/progression';
import { Button, Card, HelpTip, ProgressBar, formatInt } from '../../components';
import { navigate } from '../../nav';

export function LevelCard({ s, onOpen }: { s: GameState; onOpen?: () => void }) {
  const p = progressOf(s);
  const lp = levelProgress(p);
  const last = p.log[p.log.length - 1];
  return (
    <Card
      title="Lab level"
      code="LAB"
      class="lab-level-card"
      actions={
        p.perkPoints > 0 ? (
          <Button size="sm" variant="primary" onClick={onOpen ?? (() => navigate('lab'))}>
            {`Spend ${p.perkPoints} point${p.perkPoints === 1 ? '' : 's'}`}
          </Button>
        ) : (
          <Button size="sm" onClick={onOpen ?? (() => navigate('lab'))}>
            Perks
          </Button>
        )
      }
    >
      <div class="lab-level">
        <div class="lab-level-badge num" aria-label={`Level ${p.level}`}>
          <span class="lab-level-k">LVL</span>
          <span class="lab-level-n">{p.level}</span>
        </div>
        <div class="lab-level-main">
          <ProgressBar value={lp.frac} height={8} label="To next level" right={`${formatInt(lp.into)} / ${formatInt(lp.need)} XP`} />
          <div class="lab-level-meta small">
            <span class={p.streak >= 3 ? 'lab-streak hot' : 'lab-streak'}>
              Streak <span class="num">{p.streak}</span>
              {p.streak > 0 && <span class="num"> · x{streakXpMult(p.streak).toFixed(2)} XP</span>}
              <HelpTip>Pre-training runs in a row that land at or above their forecast. Each step raises run XP. A miss resets it.</HelpTip>
            </span>
            <span class="muted">
              Best <span class="num">{p.bestStreak}</span>
            </span>
            {last && (
              <span class="lab-last muted">
                Last <span class="num good">+{last.amount}</span> {last.reason}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
