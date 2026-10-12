import { useEffect, useRef } from 'preact/hooks';
import { useGame } from '../store';
import { announce, flashCash } from './banner';
import { plain } from '../shell/fmt';
import { playSfx } from './sound';

interface Snapshot {
  notices: Set<number>;
  released: number;
  isPublic: boolean;
  event: string | null;
}

/**
 * Watches the game state and fires the juice: sounds, the milestone strip and the
 * cash flash for toasts, model releases, the IPO and new event decisions.
 *
 * The first render only records a snapshot, so loading an old save never
 * replays a celebration for things that already happened.
 */
export function FxDirector() {
  const s = useGame();
  const prev = useRef<Snapshot | null>(null);
  useEffect(() => {
    const pending = s.events.pending;
    const eventKey = pending && pending.result === undefined ? `${pending.defId}@${pending.day}` : null;
    const next: Snapshot = {
      notices: new Set(s.notifications.map((n) => n.id)),
      released: s.stats.modelsReleased,
      isPublic: s.company.isPublic,
      event: eventKey,
    };

    const p = prev.current;
    prev.current = next;
    if (!p) return;

    const show = (head: string, text: string) => {
      announce(head, plain(text));
      flashCash();
    };

    const fresh = s.notifications.filter((n) => !p.notices.has(n.id));
    const released = next.released > p.released;
    const ipo = next.isPublic && !p.isPublic;

    if (ipo || released) {
      // One big moment beats a stack of small sounds, so the toast chimes are skipped.
      if (ipo) show('IPO', 'Listed on the exchange. Try not to check the ticker.');
      else {
        const latest = s.models
          .filter((m) => m.releasedDay !== null)
          .sort((a, b) => (b.releasedDay ?? 0) - (a.releasedDay ?? 0))[0];
        show('Model released', latest ? latest.name : 'New model is out.');
      }
      playSfx('fanfare');
    } else {
      const ms = fresh.find((n) => n.kind === 'milestone');
      if (ms) {
        show('Milestone', ms.text);
        playSfx('cash');
      } else if (fresh.some((n) => n.kind === 'good')) {
        playSfx('cash');
      } else if (fresh.some((n) => n.kind === 'bad')) {
        playSfx('bonk');
      }
      if (eventKey && eventKey !== p.event) playSfx('sting');
    }
  });

  return null;
}
