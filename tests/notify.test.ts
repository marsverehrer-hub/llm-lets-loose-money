// v18 WP5 (notification diet): background notices go to the inbox; toasts are for things the player did or must see.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import { inTick, notify } from '../src/sim/util';

describe('notification diet', () => {
  it('a background info notice goes to the inbox only', () => {
    const s = createInitialState(7);
    s.notifications = [];
    inTick(() => notify(s, 'Background line', 'info'));
    expect(s.notifications.some((n) => n.text === 'Background line')).toBe(false);
    expect(s.noticeLog!.some((n) => n.text === 'Background line')).toBe(true);
  });

  it('background bad and milestone notices still toast', () => {
    const s = createInitialState(7);
    s.notifications = [];
    inTick(() => {
      notify(s, 'Background trouble', 'bad');
      notify(s, 'Background milestone', 'milestone');
    });
    expect(s.notifications.map((n) => n.text)).toEqual(['Background trouble', 'Background milestone']);
  });

  it('an info notice from a dispatched action toasts', () => {
    const s = createInitialState(7);
    s.notifications = [];
    dispatch(s, { type: 'setResearch', nodeId: 'transformers' });
    expect(s.notifications.some((n) => /^Now researching/.test(n.text) && n.kind === 'info')).toBe(true);
  });

  it('an explicit toast option wins over the background default', () => {
    const s = createInitialState(7);
    s.notifications = [];
    inTick(() => notify(s, 'Forced line', 'info', { toast: true }));
    expect(s.notifications.some((n) => n.text === 'Forced line')).toBe(true);
  });

  it('the inbox keeps every line, including repeats the toast stack collapses', () => {
    const s = createInitialState(7);
    s.notifications = [];
    s.noticeLog = [];
    inTick(() => {
      notify(s, 'Same line', 'info');
      notify(s, 'Same line', 'info');
    });
    expect(s.noticeLog!.filter((n) => n.text === 'Same line')).toHaveLength(2);
    expect(s.notifications).toHaveLength(0);
  });
});
