// Player actions on compute: rent, buy, sell and upgrade GPUs and halls, set the fleet priority and the fabric.
import { DEFAULT_PROVIDER_ID } from '../../data/clouds'; // v16 cloud market
import { RESEARCH } from '../../data/research';
import { SITES, DEFAULT_SITE } from '../../data/sites'; // v19 sites
import { addRevenue, calendarYear, clamp, formatMoney, newId, notify, trySpend } from '../../util';
import { isResearched } from '../research';
import { freeSlots, gpuPriceMult } from '../supply'; // v19 pre-orders hold slots; v19 GPU supply (1 until D1 lands)
import { customChipPrice } from '../chipRnd'; // v19 own silicon
import { consumeGpuAllocation, gpuAllocationLeft } from '../scaleLimits'; // v16 supply
import { rentFromProvider } from '../cloudMarket'; // v16 cloud market
import { COMPUTE_TUNING, datacenterPue, INTERCONNECT_COST_SHARE, INTERCONNECT_RANK } from './tuning';
import { datacenterTierById, gpuById } from './catalogue';
import { interconnectOf, isFinished, siteMwLeft, siteOf, siteOpen } from './sites';
import { applyPriority, priorityFromShare } from './fleet';
import { gpuAgeYears, resaleFraction } from './wear';
import type { ActionHandlers, Datacenter } from '../../types';

export const handlers: ActionHandlers = {
  // v16: the legacy rental rents on-demand from the default provider, within its quota (systems/cloudMarket.ts).
  rentGpus: (s, a) => rentFromProvider(s, DEFAULT_PROVIDER_ID, a.gpuId, a.count),

  // v16 (GAME_DESIGN §26.3): one-off datacenter upgrades.
  upgradeDatacenter: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    const tier = dc ? datacenterTierById(dc.tierId) : undefined;
    if (!dc || !tier) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    const liquid = a.upgrade === 'liquid';
    if (!liquid && a.upgrade !== 'infiniband') return;
    if (liquid ? dc.liquid : dc.infiniband) {
      notify(s, `${dc.name} already has ${liquid ? 'liquid cooling' : 'InfiniBand'}.`, 'info');
      return;
    }
    const cost = tier.buildCost * (liquid ? COMPUTE_TUNING.LIQUID_COST_SHARE : COMPUTE_TUNING.INFINIBAND_COST_SHARE);
    if (!trySpend(s, 'capex', cost, liquid ? 'liquid cooling' : 'InfiniBand')) return;
    if (liquid) dc.liquid = true;
    else dc.infiniband = true;
    notify(s, `${dc.name} now has ${liquid ? 'liquid cooling: lower power bill, fewer failures' : 'InfiniBand: neocloud customers pay more for it'}.`, 'good');
  },

  buildDatacenter: (s, a) => {
    const tier = datacenterTierById(a.tierId);
    if (!tier) {
      notify(s, 'Unknown datacenter tier.', 'bad');
      return;
    }
    if (calendarYear(s.day) < tier.unlockYear) {
      notify(s, `${tier.name} is not available until ${tier.unlockYear}.`, 'bad');
      return;
    }
    if (tier.requiresResearch && !isResearched(s, tier.requiresResearch)) {
      const node = RESEARCH.find((r) => r.id === tier.requiresResearch);
      notify(s, `${tier.name} needs research: ${node?.name ?? tier.requiresResearch}.`, 'bad');
      return;
    }
    const site = a.site ?? DEFAULT_SITE;
    if (!SITES[site]) {
      notify(s, 'Unknown site.', 'bad');
      return;
    }
    if (!siteOpen(s, site)) {
      const node = SITES[site].requiresResearch ? RESEARCH.find((r) => r.id === SITES[site].requiresResearch) : undefined;
      notify(s, `${SITES[site].name} is not open yet${node ? `: it needs research: ${node.name}` : ''}.`, 'bad');
      return;
    }
    const buildDays = Math.max(1, Math.round(tier.buildDays * SITES[site].buildDaysMult));
    const name = a.name.trim().slice(0, 32) || `${tier.name} #${s.compute.datacenters.length + 1}`;
    if (!trySpend(s, 'capex', tier.buildCost, tier.name)) return;
    const dc: Datacenter = { id: newId(s, 'dc'), name, tierId: tier.id, gpus: {}, buildDaysLeft: buildDays, site };
    s.compute.datacenters.push(dc);
    notify(s, `Breaking ground on ${name} at ${SITES[site].name}: ready in ${buildDays} days.`, 'good');
  },

  buyGpus: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    if (!isFinished(dc)) {
      notify(s, `${dc.name} is still under construction.`, 'bad');
      return;
    }
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    if (gpu.class !== 'custom' && calendarYear(s.day) < gpu.unlockYear) { // own silicon is gated by the programme instead
      notify(s, `${gpu.name} is not available until ${gpu.unlockYear}.`, 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count < 1) {
      notify(s, 'Buy at least one GPU.', 'bad');
      return;
    }
    const tier = datacenterTierById(dc.tierId);
    const free = freeSlots(s, dc); // slots held by pre-orders are taken
    if (a.count > free) {
      notify(s, `Only ${Math.max(0, free).toLocaleString('en-US')} free slot${free === 1 ? '' : 's'} in ${dc.name}.`, 'bad');
      return;
    }
    const alloc = gpuAllocationLeft(s, gpu.id); // v16: new generations are rationed
    if (a.count > alloc) {
      notify(s, `The vendor allocates you ${alloc.toLocaleString('en-US')} more ${gpu.name} this quarter. Older generations ship in bulk; brand gets you more.`, 'bad');
      return;
    }
    // v19: the site's megawatt cap, then demand's price (supply.ts; 1 until D1 lands).
    const mw = (a.count * gpu.powerKw * datacenterPue(dc)) / 1000;
    const mwLeft = siteMwLeft(s, dc);
    if (mw > mwLeft) {
      notify(s, `${SITES[siteOf(dc)].name} can feed ${dc.name} ${mwLeft.toFixed(1)} more MW. ${a.count} × ${gpu.name} needs ${mw.toFixed(1)} MW.`, 'bad');
      return;
    }
    // Your own silicon costs its unit price over the yield; everything else pays the market's demand multiplier.
    const price = gpu.class === 'custom' ? customChipPrice(s, gpu.id) : gpu.buyPrice * gpuPriceMult(s, gpu.id);
    if (!trySpend(s, 'capex', a.count * price, `${a.count} × ${gpu.name}`)) return;
    consumeGpuAllocation(s, gpu.id, a.count);
    // v14: track the batch's age as a count-weighted average purchase day.
    const had = dc.gpus[gpu.id] ?? 0;
    dc.bought ??= {};
    const prevDay = dc.bought[gpu.id] ?? s.day;
    dc.bought[gpu.id] = (prevDay * had + s.day * a.count) / (had + a.count);
    dc.gpus[gpu.id] = had + a.count;
    notify(s, `Installed ${a.count} × ${gpu.name} in ${dc.name}.`, 'good');
  },

  sellGpus: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    if (!dc) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    const gpu = gpuById(a.gpuId);
    if (!gpu) {
      notify(s, 'Unknown GPU.', 'bad');
      return;
    }
    const have = dc.gpus[gpu.id] ?? 0;
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > have) {
      notify(s, `${dc.name} only has ${have} × ${gpu.name} to sell.`, 'bad');
      return;
    }
    const refund = a.count * gpu.buyPrice * resaleFraction(gpuAgeYears(s, dc, gpu.id));
    addRevenue(s, 'other', refund);
    const left = have - a.count;
    if (left > 0) dc.gpus[gpu.id] = left;
    else {
      delete dc.gpus[gpu.id];
      if (dc.bought) delete dc.bought[gpu.id];
      if (dc.wear) delete dc.wear[gpu.id];
    }
    notify(s, `Sold ${a.count} × ${gpu.name} for ${formatMoney(refund)}.`, 'info');
  },

  // v19: fabric upgrade for a hall. Pays the difference between the tiers; InfiniBand also sets the v16 flag that
  // neocloud customers look for.
  setInterconnect: (s, a) => {
    const dc = s.compute.datacenters.find((d) => d.id === a.datacenterId);
    const tier = dc ? datacenterTierById(dc.tierId) : undefined;
    if (!dc || !tier) {
      notify(s, 'Unknown datacenter.', 'bad');
      return;
    }
    if (!isFinished(dc)) {
      notify(s, `${dc.name} is still under construction.`, 'bad');
      return;
    }
    if (a.tier !== 'nvlink' && a.tier !== 'infiniband') return; // PCIe is what a hall starts with
    const year = calendarYear(s.day);
    const gate = a.tier === 'nvlink' ? COMPUTE_TUNING.NVLINK_YEAR : COMPUTE_TUNING.INFINIBAND_YEAR;
    if (year < gate) {
      notify(s, `${a.tier === 'nvlink' ? 'NVLink-ish' : 'InfiniBand-ish'} fabric is not available until ${gate}.`, 'bad');
      return;
    }
    const current = interconnectOf(dc);
    if (INTERCONNECT_RANK[current] >= INTERCONNECT_RANK[a.tier]) {
      notify(s, `${dc.name} already has ${current === 'infiniband' ? 'InfiniBand' : 'NVLink'} or better.`, 'info');
      return;
    }
    const share = INTERCONNECT_COST_SHARE[a.tier] - INTERCONNECT_COST_SHARE[current];
    const label = a.tier === 'nvlink' ? 'NVLink-ish fabric' : 'InfiniBand-ish fabric';
    if (!trySpend(s, 'capex', tier.buildCost * share, label)) return;
    dc.interconnect = a.tier;
    if (a.tier === 'infiniband') dc.infiniband = true;
    notify(s, `${dc.name} now runs on ${label}: training clusters up to ${a.tier === 'nvlink' ? '2,048' : 'any size'} GPUs stay efficient.`, 'good');
  },

  // Legacy action: maps the share to the nearest fleet priority (v10).
  setTrainingShare: (s, a) => {
    if (!Number.isFinite(a.share)) return;
    applyPriority(s, priorityFromShare(clamp(a.share, 0, 1)));
  },
};
