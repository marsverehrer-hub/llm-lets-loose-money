import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { applyHostLabs } from '../src/sim/systems/multiplayer';
import { rivalLabs } from '../src/sim/systems/rivals';

describe('v19 rival labs in multiplayer', () => {
  it('the guest mirrors the host lab companies', () => {
    const host = createInitialState(3, 'Host');
    const labs = rivalLabs(host);
    labs[0].status = 'active';
    labs[0].cash = 123e6;
    const guest = createInitialState(4, 'Guest');
    guest.mp = { role: 'guest', hostLabs: host.competitors, hostRivals: labs } as unknown as typeof guest.mp;
    applyHostLabs(guest);
    expect(guest.rivals?.[0].cash).toBe(123e6);
    expect(guest.rivals?.[0].status).toBe('active');
    // A copy, not a shared reference.
    labs[0].cash = 1;
    expect(guest.rivals?.[0].cash).toBe(123e6);
  });
});
