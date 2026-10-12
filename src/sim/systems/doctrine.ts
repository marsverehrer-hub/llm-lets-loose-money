// OWNER: DOCTRINE. v8 lab doctrine (GAME_DESIGN §19.1): setDoctrine handler. Perks are applied in src/sim/bonuses.ts.
import type { ActionHandlers, GameState } from '../types';
import { DOCTRINE_CHANGE_COST, DOCTRINE_COOLDOWN, doctrineById } from '../data/doctrines';
import { clamp, notify, pushNews } from '../util';
import { doctrineLockedNotice } from './scenario'; // v9 scenario

/** Days left before the lab may change focus again (0 = free to change, or never picked). */
export function doctrineCooldownLeft(s: GameState): number {
  if (s.company.doctrine === undefined) return 0;
  const since = s.company.doctrineSince ?? 0;
  return Math.max(0, DOCTRINE_COOLDOWN - (s.day - since));
}

export const handlers: ActionHandlers = {
  setDoctrine: (s, a) => {
    const locked = doctrineLockedNotice(s); // v9 scenario: some scenarios lock the lab focus
    if (locked) {
      notify(s, locked, 'bad');
      return;
    }
    const next = doctrineById(a.doctrine);
    if (!next) {
      notify(s, 'Pick one of the five lab focuses.', 'bad');
      return;
    }
    const current = doctrineById(s.company.doctrine);
    if (current?.id === next.id) {
      notify(s, `Already focused on ${next.name}.`, 'info');
      return;
    }
    // First pick is free.
    if (!current) {
      s.company.doctrine = next.id;
      s.company.doctrineSince = s.day;
      notify(s, `Lab focus: ${next.name}. ${next.tagline}`, 'good');
      pushNews(s, `${s.company.name} settles on a focus: ${next.name}.`, 'info');
      return;
    }
    const left = doctrineCooldownLeft(s);
    if (left > 0) {
      notify(s, `Lab focus can change in ${left} days.`, 'bad');
      return;
    }
    s.company.hype = clamp(s.company.hype - DOCTRINE_CHANGE_COST.hype, 0, 100);
    s.staff.morale = clamp(s.staff.morale - DOCTRINE_CHANGE_COST.morale, 0, 100);
    s.company.doctrine = next.id;
    s.company.doctrineSince = s.day;
    notify(
      s,
      `Lab focus changed from ${current.name} to ${next.name}. Hype -${DOCTRINE_CHANGE_COST.hype}, morale -${DOCTRINE_CHANGE_COST.morale}.`,
      'bad',
    );
    pushNews(s, `${s.company.name} changes focus, from ${current.name} to ${next.name}. The staff have read the new slide deck.`, 'info');
  },
};
