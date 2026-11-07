// v19 (Phase D3): interconnect caps the training cluster, sites set power price, build time and megawatt cap, and grid
// outages take a hall offline for a day or two.
import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { dispatch } from '../src/sim/engine';
import type { GameState } from '../src/sim/types';
import {
  clusterEfficiency,
  clusterFailureMult,
  computeTick,
  dailyComputeCost,
  fabricClusterCap,
  hallMegawatts,
  hallOffline,
  ownPflops,
  siteMwLeft,
} from '../src/sim/systems/compute';
import { SITES } from '../src/sim/data/sites';
import { makeRng } from '../src/sim/rng';

function hall(s: GameState, id: string, tierId: string, gpus: Record<string, number>, site?: 'grid' | 'hydro' | 'solar' | 'nuclear') {
  s.compute.rented = {};
  s.compute.datacenters.push({ id, name: id, tierId, gpus, buildDaysLeft: 0, site });
  return s.compute.datacenters[s.compute.datacenters.length - 1];
}

describe('interconnect', () => {
  it('pcie caps a training cluster at 64 GPUs and InfiniBand lifts the cap', () => {
    const s = createInitialState(4, 'Fabric');
    hall(s, 'dc1', 'hyperscale', { p100: 100 });
    expect(clusterEfficiency(s).maxEfficientGpus).toBe(64);
    s.compute.datacenters[0].infiniband = true;
    expect(fabricClusterCap(s)).toBe(Infinity);
    // The research cap (256 at base) still applies: min(research, fabric).
    expect(clusterEfficiency(s).maxEfficientGpus).toBe(256);
  });

  it('with no hall (cloud only) the fabric cap is InfiniBand', () => {
    const s = createInitialState(4, 'Cloud');
    expect(fabricClusterCap(s)).toBe(Infinity);
  });

  it('setInterconnect charges the difference between tiers, and refuses NVLink before 2018', () => {
    const s = createInitialState(4, 'Upgrade');
    s.finance.cash = 1e12;
    const dc = hall(s, 'dc1', 'colo', {});
    const before = s.finance.cash;
    dispatch(s, { type: 'setInterconnect', datacenterId: 'dc1', tier: 'nvlink' });
    expect(dc.interconnect).toBeUndefined(); // 2017: not yet available
    expect(s.finance.cash).toBe(before);

    s.day = 400; // 2018
    dispatch(s, { type: 'setInterconnect', datacenterId: 'dc1', tier: 'nvlink' });
    expect(dc.interconnect).toBe('nvlink');
    expect(before - s.finance.cash).toBeCloseTo(2_000_000 * 0.1);

    s.day = 800; // 2019: InfiniBand
    dispatch(s, { type: 'setInterconnect', datacenterId: 'dc1', tier: 'infiniband' });
    expect(dc.infiniband).toBe(true);
    expect(before - s.finance.cash).toBeCloseTo(2_000_000 * 0.25); // nvlink share already paid
  });
});

describe('sites', () => {
  it('hydro power costs 55% of the grid price for the same hall', () => {
    const grid = createInitialState(4, 'Grid');
    hall(grid, 'dc1', 'colo', { p100: 100 }, 'grid');
    const hydro = createInitialState(4, 'Hydro');
    hall(hydro, 'dc1', 'colo', { p100: 100 }, 'hydro');
    expect(dailyComputeCost(hydro).power / dailyComputeCost(grid).power).toBeCloseTo(SITES.hydro.powerPriceMult);
  });

  it('build days scale by the site, and the hall stores its site', () => {
    const s = createInitialState(4, 'Build');
    s.finance.cash = 1e12;
    dispatch(s, { type: 'buildDatacenter', tierId: 'closet', name: 'G' });
    dispatch(s, { type: 'buildDatacenter', tierId: 'closet', name: 'H', site: 'hydro' });
    const [g, h] = s.compute.datacenters;
    expect(g.site).toBe('grid');
    expect(g.buildDaysLeft).toBe(10);
    expect(h.site).toBe('hydro');
    expect(h.buildDaysLeft).toBe(Math.round(10 * SITES.hydro.buildDaysMult));
  });

  it('nuclear waits for its research', () => {
    const s = createInitialState(4, 'Nuke');
    s.finance.cash = 1e12;
    dispatch(s, { type: 'buildDatacenter', tierId: 'colo', name: 'N', site: 'nuclear' });
    expect(s.compute.datacenters.length).toBe(0);
  });

  it('the megawatt cap refuses a purchase that would push the hall past it', () => {
    const s = createInitialState(4, 'Cap');
    s.finance.cash = 1e12;
    s.day = 365 * 5 + 10; // 2022: H-100 is on sale
    // cathedral: PUE 1.12. 60 000 H-100 at 0.7 kW = 47.0 MW, leaving about 3 MW of the 50 MW grid cap.
    const dc = hall(s, 'dc1', 'cathedral', { h100: 60_000 });
    expect(hallMegawatts(dc)).toBeCloseTo((60_000 * 0.7 * 1.12) / 1000);
    expect(siteMwLeft(s, dc)).toBeCloseTo(SITES.grid.mwCap - hallMegawatts(dc));
    dispatch(s, { type: 'buyGpus', datacenterId: 'dc1', gpuId: 'h100', count: 10_000 });
    expect(dc.gpus['h100']).toBe(60_000);
    expect(s.noticeLog?.at(-1)?.text).toMatch(/MW/);
  });
});

describe('grid outages', () => {
  it('an outage takes the hall PFLOPS off for the day, then the hall comes back', () => {
    const s = createInitialState(4, 'Outage');
    hall(s, 'dc1', 'colo', { p100: 100 });
    const up = ownPflops(s);
    expect(up).toBeGreaterThan(0);
    s.flags['outage.dc1'] = s.day + 1;
    expect(hallOffline(s, s.compute.datacenters[0])).toBe(true);
    expect(ownPflops(s)).toBe(0);
    s.day += 1;
    expect(hallOffline(s, s.compute.datacenters[0])).toBe(false);
    expect(ownPflops(s)).toBeCloseTo(up);
  });

  it('a solar hall goes dark now and then over a few years of daily ticks', () => {
    const s = createInitialState(4, 'Solar');
    s.finance.cash = 1e12;
    hall(s, 'dc1', 'colo', { p100: 200 }, 'solar');
    for (let d = 0; d < 1500; d++) {
      s.day = d;
      s.finance.today = { revenue: {}, expenses: {} };
      computeTick(s, makeRng(s));
    }
    expect(s.flags['stat.outages'] ?? 0).toBeGreaterThan(0);
  });
});

describe('cluster failures', () => {
  it('start at the base rate with no training GPUs', () => {
    const s = createInitialState(4, 'Fail');
    expect(clusterFailureMult(s)).toBe(1);
  });
});
