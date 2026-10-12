import { describe, it, expect } from 'vitest';
import { createInitialState } from '../src/sim/state';
import { makeRng } from '../src/sim/rng';
import { DATASETS } from '../src/sim/data/datasets';
import { RESEARCH } from '../src/sim/data/research';
import { COMPETITORS } from '../src/sim/data/competitors';
import { DATA_EVENTS } from '../src/sim/data/dataEvents';
import { DATA_ACHIEVEMENTS } from '../src/sim/data/dataAchievements';
import {
  DATA_TUNING,
  availableDatasetsV2,
  buyDatasetV2,
  collapsePenalty,
  commissionCostPerB,
  commissionQuote,
  dataStats,
  dataTick,
  datasetById,
  handlers,
  rivalExclusiveMalus,
  syntheticQuote,
  syntheticShare,
} from '../src/sim/systems/data';
import { DATA_KINDS } from '../src/sim/types';
import type { DataAcquisition, GameState, Model, Product, Rng } from '../src/sim/types';

// §13.3 ids the research agent must provide (plus the ones already in research.ts).
const SPEC_RESEARCH_IDS = new Set([
  'transformers', 'scaling_laws', 'instruction_tuning', 'rlhf', 'code_models', 'long_context', 'moe', 'multimodal',
  'chain_of_thought', 'reasoning_models', 'enterprise_ready', 'constitutional_ai', 'distillation', 'flash_attention',
  'synthetic_data', 'agents', 'nuclear_power', 'interpretability', 'agi', 'tool_use', 'self_improvement', 'world_models',
  'million_token', 'infinite_context', 'mixed_precision', 'data_filtering',
  'mamba_hybrid', 'diffusion_lm', 'recurrent_depth', 'tokenizer_100k', 'multilingual_tokenizer', 'byte_latent', 'rope',
  'yarn_scaling', 'adamw', 'lion_optimizer', 'shampoo_soap', 'muon_optimizer', 'bf16_training', 'fp8_training',
  'fp4_training', 'wsd_schedule', 'minhash_dedup', 'quality_classifiers', 'toxicity_filtering', 'decontamination',
  'pii_scrubbing', 'qk_norm', 'z_loss', 'mup_transfer', 'moe_load_balancing', 'aux_free_balancing', 'zero_sharding',
  'tensor_parallel', 'pipeline_parallel', 'parallelism_3d', 'cross_dc_training', 'fused_kernels', 'flash_attention_3',
  'async_checkpointing', 'fault_tolerant_training', 'sae_steering', 'persona_vectors',
]);

const ACQUISITIONS: DataAcquisition[] = ['purchase', 'license', 'scrape', 'partnership', 'crowdsource', 'generate', 'userdata', 'open'];

const ORIGINAL_IDS = [
  'scrawl_sample', 'wikipediaish', 'bookcorpse', 'gutenbergish', 'github_firehose', 'reddit_dump', 'arxivomit',
  'stackoverflowed', 'common_scrawl_full', 'medical_journals', 'wsb_dumpsters', 'the_stack_mega', 'human_preferences',
  'pixel_pile', 'fineweb_ish', 'textbooks_synth', 'self_play_chats', 'every_podcast', 'licensed_everything',
];

/** Day number of January 1st of `year` (day 0 = 2017-01-01). */
function dayOf(year: number): number {
  let d = 0;
  for (let y = 2017; y < year; y++) d += y % 4 === 0 ? 366 : 365;
  return d;
}

function fresh(day = 0): GameState {
  const s = createInitialState(12345, 'Test Co');
  s.day = day;
  s.finance.cash = 1e12;
  return s;
}

function rngFor(s: GameState): Rng {
  return makeRng(s);
}

function model(id: string, overall: number, extra: Partial<Model> = {}): Model {
  return {
    id,
    name: `M-${id}`,
    paramsB: 7,
    tokensB: 1000,
    datasetIds: ['scrawl_sample'],
    techniques: [],
    finalLoss: 2,
    scores: { reasoning: overall, coding: overall, chat: overall, safety: overall },
    overall,
    elo: 800 + overall * 8,
    trainedDay: 0,
    releasedDay: 0,
    deprecated: false,
    ...extra,
  };
}

function product(kind: Product['kind'], users: number): Product {
  return {
    id: `p-${kind}`,
    kind,
    name: kind,
    modelId: null,
    price: 20,
    users,
    launchedDay: 0,
    satisfaction: 80,
    servedFraction: 1,
    mtokPerDay: 0,
    revenuePerDay: 0,
    active: true,
  };
}

function expenseToday(s: GameState, category: string): number {
  return s.finance.today.expenses[category] ?? 0;
}

function resetToday(s: GameState): void {
  s.finance.today = { revenue: {}, expenses: {} };
}

describe('dataset catalogue', () => {
  it('has unique, well-formed ids and fields', () => {
    const ids = DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of DATASETS) {
      expect(d.name.length, d.id).toBeGreaterThan(0);
      expect(d.flavor.length, d.id).toBeGreaterThan(0);
      expect(DATA_KINDS, d.id).toContain(d.kind);
      expect(d.tokensB, d.id).toBeGreaterThan(0);
      expect(d.quality, d.id).toBeGreaterThanOrEqual(0);
      expect(d.quality, d.id).toBeLessThanOrEqual(1);
      expect(d.cost, d.id).toBeGreaterThanOrEqual(0);
      expect(d.legalRisk, d.id).toBeGreaterThanOrEqual(0);
      expect(d.legalRisk, d.id).toBeLessThanOrEqual(1);
      expect(d.unlockYear, d.id).toBeGreaterThanOrEqual(2017);
      expect(d.unlockYear, d.id).toBeLessThanOrEqual(2035);
      expect(d.acquisition, d.id).toBeDefined();
      expect(d.domain, d.id).toBeDefined();
    }
  });

  it('keeps every id the old catalogue had', () => {
    const ids = new Set(DATASETS.map((d) => d.id));
    for (const id of ORIGINAL_IDS) expect(ids.has(id), id).toBe(true);
  });

  it('only references research ids that exist or are on the §13.3 lists', () => {
    const real = new Set(RESEARCH.map((r) => r.id));
    for (const d of DATASETS) {
      if (!d.requiresResearch) continue;
      expect(real.has(d.requiresResearch) || SPEC_RESEARCH_IDS.has(d.requiresResearch), `${d.id} -> ${d.requiresResearch}`).toBe(true);
    }
  });

  it('only contests with real rival labs', () => {
    const rivals = new Set(COMPETITORS.map((c) => c.id));
    for (const d of DATASETS) for (const r of d.contestedBy ?? []) expect(rivals.has(r), `${d.id} -> ${r}`).toBe(true);
  });

  it('represents every DataKind and every acquisition type', () => {
    for (const k of DATA_KINDS) expect(DATASETS.some((d) => d.kind === k), k).toBe(true);
    for (const a of ACQUISITIONS) expect(DATASETS.some((d) => d.acquisition === a), a).toBe(true);
  });

  it('has exactly one free 2017 set with no research gate, and it is the starter', () => {
    const free = DATASETS.filter((d) => d.cost === 0 && d.unlockYear <= 2017 && !d.requiresResearch);
    expect(free.map((d) => d.id)).toEqual(['scrawl_sample']);
  });

  it('gives licence and partnership sets an annual fee, and partnerships exclusivity and rivals', () => {
    for (const d of DATASETS.filter((x) => x.acquisition === 'license' || x.acquisition === 'partnership')) {
      expect(d.annualFee ?? 0, d.id).toBeGreaterThan(0);
    }
    for (const d of DATASETS.filter((x) => x.acquisition === 'partnership')) {
      expect(d.exclusive, d.id).toBe(true);
      expect(d.contestedBy?.length ?? 0, d.id).toBeGreaterThan(0);
    }
  });

  it('has a few secret sets and keeps the catalogue around 130 sets', () => {
    expect(DATASETS.filter((d) => d.secret).length).toBeGreaterThanOrEqual(2);
    expect(DATASETS.length).toBeGreaterThanOrEqual(120);
  });

  it('gates user-data sets on a live product of the matching kind', () => {
    const s = fresh(dayOf(2025));
    const rows = availableDatasetsV2(s);
    const row = rows.find((r) => r.def.id === 'your_api_prompts');
    expect(row?.status).toBe('locked');
    expect(row?.reason).toMatch(/api/);
    s.products.push(product('api', 10));
    const row2 = availableDatasetsV2(s).find((r) => r.def.id === 'your_api_prompts');
    expect(row2?.status).toBe('available');
  });
});

describe('shop status', () => {
  it('shows the starter as owned and research gates as locked with a reason', () => {
    const s = fresh(dayOf(2024));
    s.data.owned = ['scrawl_sample'];
    const rows = availableDatasetsV2(s);
    expect(rows.find((r) => r.def.id === 'scrawl_sample')?.status).toBe('owned');
    const synth = rows.find((r) => r.def.id === 'textbooks_synth');
    expect(synth?.status).toBe('locked');
    expect(synth?.reason).toMatch(/research/);
  });

  it('hides secret sets until revealed, and hides sets far in the future', () => {
    const s = fresh(dayOf(2017));
    const ids = availableDatasetsV2(s).map((r) => r.def.id);
    expect(ids).not.toContain('leaked_internal_wiki');
    expect(ids).not.toContain('licensed_everything');
    s.flags['revealed.leaked_internal_wiki'] = 1;
    s.day = dayOf(2025);
    expect(availableDatasetsV2(s).map((r) => r.def.id)).toContain('leaked_internal_wiki');
  });

  it('marks rival-signed sets as lost and pending commissions as pending', () => {
    const s = fresh(dayOf(2023));
    s.data.lost = ['reddit_api_deal'];
    const rows = availableDatasetsV2(s);
    expect(rows.find((r) => r.def.id === 'reddit_api_deal')?.status).toBe('lost');
    handlers.commissionDataset!(s, { type: 'commissionDataset', domain: 'general', kind: 'web', budget: 100_000 }, rngFor(s));
    expect(availableDatasetsV2(s).some((r) => r.status === 'pending')).toBe(true);
  });
});

describe('buying and licences', () => {
  it('charges a licence year up front, then the fee daily from year two, and cancel stops it', () => {
    const s = fresh(dayOf(2021));
    const d = datasetById(s, 'pubmedley')!;
    const before = s.finance.cash;
    expect(buyDatasetV2(s, 'pubmedley')).toBe(true);
    expect(before - s.finance.cash).toBeCloseTo(d.cost + (d.annualFee ?? 0), 2);
    expect(s.data.licenses?.pubmedley).toBe(s.day);

    resetToday(s);
    dataTick(s, rngFor(s));
    expect(expenseToday(s, 'data')).toBe(0);

    s.day += DATA_TUNING.LICENCE_TERM_DAYS;
    resetToday(s);
    dataTick(s, rngFor(s));
    expect(expenseToday(s, 'data')).toBeCloseTo((d.annualFee ?? 0) / 365, 6);

    handlers.cancelLicense!(s, { type: 'cancelLicense', datasetId: 'pubmedley' }, rngFor(s));
    expect(s.data.owned).not.toContain('pubmedley');
    s.day += 1;
    resetToday(s);
    dataTick(s, rngFor(s));
    expect(expenseToday(s, 'data')).toBe(0);
  });

  it('refuses sets that are locked, lost or already owned', () => {
    const s = fresh(dayOf(2017));
    expect(buyDatasetV2(s, 'textbooks_synth')).toBe(false);
    expect(s.data.owned).not.toContain('textbooks_synth');
    s.data.lost = ['wikipediaish'];
    expect(buyDatasetV2(s, 'wikipediaish')).toBe(false);
    s.data.lost = [];
    expect(buyDatasetV2(s, 'scrawl_sample')).toBe(false);
  });

  it('charges the cost for a one-off purchase', () => {
    const s = fresh(dayOf(2017));
    const before = s.finance.cash;
    expect(buyDatasetV2(s, 'wikipediaish')).toBe(true);
    expect(before - s.finance.cash).toBeCloseTo(20_000, 2);
    expect(s.data.owned).toContain('wikipediaish');
  });

  it('cancelling a licence you do not hold is refused', () => {
    const s = fresh(dayOf(2017));
    handlers.cancelLicense!(s, { type: 'cancelLicense', datasetId: 'wikipediaish' }, rngFor(s));
    expect(s.notifications.at(-1)?.kind).toBe('bad');
  });

  it('summarises owned tokens and licence fees', () => {
    const s = fresh(dayOf(2021));
    buyDatasetV2(s, 'pubmedley');
    buyDatasetV2(s, 'wikipediaish');
    const st = dataStats(s);
    expect(st.owned).toBe(3);
    expect(st.licences).toBe(1);
    expect(st.licenceCostPerYear).toBe(1_000_000);
    expect(st.totalTokensB).toBeCloseTo(5 + 30 + 3, 6);
  });
});

describe('commissions', () => {
  it('completes into custom and owned, after the labelling time', () => {
    const s = fresh(dayOf(2017));
    const before = s.finance.cash;
    handlers.commissionDataset!(s, { type: 'commissionDataset', domain: 'medical', kind: 'science', budget: 500_000 }, rngFor(s));
    expect(s.data.pending).toHaveLength(1);
    expect(before - s.finance.cash).toBeCloseTo(500_000, 2);
    const job = s.data.pending![0];
    const days = job.readyDay - s.day;
    expect(days).toBeGreaterThanOrEqual(20);
    expect(days).toBeLessThanOrEqual(60);
    expect(job.dataset.quality).toBeGreaterThanOrEqual(0.85);
    expect(job.dataset.quality).toBeLessThanOrEqual(0.95);
    expect(job.dataset.tokensB).toBeGreaterThan(0);

    s.day = job.readyDay;
    dataTick(s, rngFor(s));
    expect(s.data.pending).toHaveLength(0);
    expect(s.data.custom!.map((c) => c.id)).toContain(job.id);
    expect(s.data.owned).toContain(job.id);
    expect(datasetById(s, job.id)?.kind).toBe('science');
  });

  it('rejects tiny budgets and a full queue', () => {
    const s = fresh(dayOf(2017));
    handlers.commissionDataset!(s, { type: 'commissionDataset', domain: 'general', kind: 'web', budget: 100 }, rngFor(s));
    expect(s.data.pending).toHaveLength(0);
    for (let i = 0; i < DATA_TUNING.PENDING_MAX; i++) {
      handlers.commissionDataset!(s, { type: 'commissionDataset', domain: 'general', kind: 'web', budget: 50_000 }, rngFor(s));
    }
    expect(s.data.pending).toHaveLength(DATA_TUNING.PENDING_MAX);
    handlers.commissionDataset!(s, { type: 'commissionDataset', domain: 'general', kind: 'web', budget: 50_000 }, rngFor(s));
    expect(s.data.pending).toHaveLength(DATA_TUNING.PENDING_MAX);
  });

  it('buys fewer tokens for the same budget as labour gets dearer', () => {
    const early = fresh(dayOf(2017));
    const late = fresh(dayOf(2030));
    expect(commissionCostPerB(late)).toBeGreaterThan(commissionCostPerB(early));
    expect(commissionQuote(late, 1_000_000).tokensB).toBeLessThan(commissionQuote(early, 1_000_000).tokensB);
  });
});

describe('synthetic generation', () => {
  it('needs the synthetic data research, a released model and compute', () => {
    const s = fresh(dayOf(2024));
    s.models.push(model('m1', 60));
    s.compute.totalPflops = 50;
    expect(syntheticQuote(s, 'm1', 1).ok).toBe(false);
    s.research.completed.push('synthetic_data');
    s.compute.totalPflops = 0;
    expect(syntheticQuote(s, 'm1', 1).ok).toBe(false);
    s.compute.totalPflops = 50;
    s.models[0].releasedDay = null;
    expect(syntheticQuote(s, 'm1', 1).ok).toBe(false);
  });

  it('gives quality that tracks the model overall', () => {
    const s = fresh(dayOf(2017));
    s.research.completed.push('synthetic_data');
    s.compute.totalPflops = 50;
    s.models.push(model('weak', 60), model('strong', 80));
    const weak = syntheticQuote(s, 'weak', 1);
    const strong = syntheticQuote(s, 'strong', 1);
    expect(weak.ok && strong.ok).toBe(true);
    if (!weak.ok || !strong.ok) return;
    expect(weak.quality).toBeCloseTo(0.6 * 0.95, 6);
    expect(strong.quality).toBeCloseTo(0.8 * 0.95, 6);
    expect(strong.quality).toBeGreaterThan(weak.quality);
  });

  it('generates a synthetic set that lands in custom and owned, with the quoted quality', () => {
    const s = fresh(dayOf(2017));
    s.research.completed.push('synthetic_data');
    s.compute.totalPflops = 50;
    s.models.push(model('m1', 70));
    const q = syntheticQuote(s, 'm1', 2);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const before = s.finance.cash;
    handlers.generateSynthetic!(s, { type: 'generateSynthetic', modelId: 'm1', tokensB: 2, domain: 'math' }, rngFor(s));
    expect(before - s.finance.cash).toBeCloseTo(q.cost, 2);
    const job = s.data.pending![0];
    s.day = job.readyDay;
    dataTick(s, rngFor(s));
    const made = datasetById(s, job.id);
    expect(made?.kind).toBe('synthetic');
    expect(made?.acquisition).toBe('generate');
    expect(made?.quality).toBeCloseTo(q.quality, 6);
    expect(s.data.owned).toContain(job.id);
  });

  it('flags model collapse for a model far behind the frontier', () => {
    const s = fresh(dayOf(2026));
    s.research.completed.push('synthetic_data');
    s.compute.totalPflops = 50;
    s.models.push(model('behind', 60), model('ahead', 97));
    const behind = syntheticQuote(s, 'behind', 1);
    const ahead = syntheticQuote(s, 'ahead', 1);
    expect(behind.ok && ahead.ok).toBe(true);
    if (!behind.ok || !ahead.ok) return;
    expect(behind.collapseRisk).toBeGreaterThan(0.5);
    expect(ahead.collapseRisk).toBeLessThan(0.3);
  });

  it('penalises training that is mostly synthetic, more when the synthetic sets are collapse-prone', () => {
    const s = fresh(dayOf(2025));
    expect(syntheticShare(['scrawl_sample', 'textbooks_synth'], s)).toBeCloseTo(50 / 55, 6);
    expect(collapsePenalty(s, ['scrawl_sample'])).toBe(1);
    expect(collapsePenalty(s, ['textbooks_synth'])).toBeLessThan(1);
    s.data.custom = [{
      id: 'synth_x', name: 'Risky', kind: 'synthetic', acquisition: 'generate', domain: 'general', tokensB: 500,
      quality: 0.5, cost: 0, legalRisk: 0, unlockYear: 2025, flavor: 'x', createdDay: 0, source: 'synthetic', collapseRisk: 0.95,
    }];
    s.data.owned.push('synth_x');
    expect(collapsePenalty(s, ['synth_x'])).toBeLessThan(collapsePenalty(s, ['textbooks_synth']));
    expect(collapsePenalty(s, ['synth_x'])).toBeGreaterThanOrEqual(0.6);
  });
});

describe('user data', () => {
  it('grows the chats set with active chat users', () => {
    const s = fresh(dayOf(2025));
    s.products.push(product('chat', 1_000_000));
    handlers.setUserDataOptIn!(s, { type: 'setUserDataOptIn', on: true }, rngFor(s));
    const set = datasetById(s, DATA_TUNING.USER_CHATS_ID);
    expect(set).toBeDefined();
    expect(s.data.owned).toContain(DATA_TUNING.USER_CHATS_ID);
    const start = set!.tokensB;
    for (let i = 0; i < 10; i++) dataTick(s, rngFor(s));
    expect(datasetById(s, DATA_TUNING.USER_CHATS_ID)!.tokensB - start).toBeCloseTo(10 * 1_000_000 * DATA_TUNING.USER_CHAT_B_PER_USER_DAY, 6);
    expect(s.flags[DATA_TUNING.PRIVACY_HEAT_KEY]).toBeGreaterThan(0);
  });

  it('keeps gathered tokens and stops growing when switched off', () => {
    const s = fresh(dayOf(2025));
    s.products.push(product('chat', 500_000));
    handlers.setUserDataOptIn!(s, { type: 'setUserDataOptIn', on: true }, rngFor(s));
    for (let i = 0; i < 5; i++) dataTick(s, rngFor(s));
    handlers.setUserDataOptIn!(s, { type: 'setUserDataOptIn', on: false }, rngFor(s));
    const kept = datasetById(s, DATA_TUNING.USER_CHATS_ID)!.tokensB;
    for (let i = 0; i < 5; i++) dataTick(s, rngFor(s));
    expect(datasetById(s, DATA_TUNING.USER_CHATS_ID)!.tokensB).toBe(kept);
    expect(dataStats(s).userChatsTokensB).toBe(kept);
  });

  it('grows more with API accounts than chat users, per account', () => {
    const chat = fresh(dayOf(2025));
    chat.products.push(product('chat', 1000));
    const api = fresh(dayOf(2025));
    api.products.push(product('api', 1000));
    for (const s of [chat, api]) handlers.setUserDataOptIn!(s, { type: 'setUserDataOptIn', on: true }, rngFor(s));
    dataTick(chat, rngFor(chat));
    dataTick(api, rngFor(api));
    expect(datasetById(api, DATA_TUNING.USER_CHATS_ID)!.tokensB).toBeGreaterThan(datasetById(chat, DATA_TUNING.USER_CHATS_ID)!.tokensB);
  });
});

describe('rival deals and exclusives', () => {
  it('lets a rival sign a shelf partnership, which goes to lost with news', () => {
    const s = fresh(dayOf(2023));
    s.competitors.find((c) => c.id === 'openaye')!.active = true;
    s.competitors.find((c) => c.id === 'metaverse_llama')!.active = false;
    const always: Rng = { ...rngFor(s), chance: () => true };
    dataTick(s, always);
    expect(s.data.lost).toContain('reddit_api_deal');
    expect(s.news.some((n) => n.text.includes('OpenAye signs exclusive deal with Reddit API Deal'))).toBe(true);
    expect(buyDatasetV2(s, 'reddit_api_deal')).toBe(false);
  });

  it('never lets an inactive rival sign, and never takes a set you already own', () => {
    const s = fresh(dayOf(2023));
    const always: Rng = { ...rngFor(s), chance: () => true };
    dataTick(s, always);
    expect(s.data.lost).toEqual([]);
    buyDatasetV2(s, 'reddit_api_deal');
    s.competitors.find((c) => c.id === 'openaye')!.active = true;
    dataTick(s, always);
    expect(s.data.lost).not.toContain('reddit_api_deal');
  });

  it('gives rivals a knowledge malus per exclusive set you hold that they contest, capped', () => {
    const s = fresh(dayOf(2023));
    expect(rivalExclusiveMalus(s, 'openaye')).toBe(0);
    buyDatasetV2(s, 'reddit_api_deal');
    buyDatasetV2(s, 'news_publisher_coalition');
    expect(rivalExclusiveMalus(s, 'openaye')).toBeCloseTo(3, 6);
    expect(rivalExclusiveMalus(s, 'deepmined')).toBe(0);
    expect(rivalExclusiveMalus(s, 'openaye')).toBeLessThanOrEqual(DATA_TUNING.RIVAL_MALUS_CAP);
  });
});

describe('events and achievements', () => {
  it('has well-formed dataset events that run every choice without throwing', () => {
    const ids = DATA_EVENTS.map((e) => e.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(new Set(ids).size).toBe(ids.length);
    const base = fresh(dayOf(2025));
    base.data.owned = ['scrawl_sample', 'bookcorpse', 'wsb_dumpsters', 'pubmedley', 'reddit_dump'];
    base.data.licenses = { pubmedley: 0 };
    base.data.lost = ['reddit_api_deal'];
    base.data.userDataOptIn = true;
    base.flags[DATA_TUNING.PRIVACY_HEAT_KEY] = 60;
    base.products.push(product('chat', 1000));
    base.data.custom = [{
      id: 'synth_r', name: 'Risky', kind: 'synthetic', acquisition: 'generate', domain: 'general', tokensB: 10,
      quality: 0.5, cost: 0, legalRisk: 0, unlockYear: 2025, flavor: 'x', createdDay: 0, source: 'synthetic', collapseRisk: 0.9,
    }];
    base.data.owned.push('synth_r');
    for (const e of DATA_EVENTS) {
      expect(e.choices.length, e.id).toBeGreaterThanOrEqual(2);
      expect(typeof e.body(base), e.id).toBe('string');
      expect(typeof e.weight(base), e.id).toBe('number');
      for (const c of e.choices) {
        const s = structuredClone(base);
        const out = c.effect(s, rngFor(s));
        expect(typeof out, `${e.id}:${c.label}`).toBe('string');
      }
    }
  });

  it('has well-formed dataset achievements', () => {
    const ids = DATA_ACHIEVEMENTS.map((a) => a.id);
    expect(ids.length).toBeGreaterThanOrEqual(5);
    expect(new Set(ids).size).toBe(ids.length);
    const s = fresh(0);
    for (const a of DATA_ACHIEVEMENTS) expect(typeof a.check(s), a.id).toBe('boolean');
  });
});

describe('lookup', () => {
  it('finds static and custom datasets by id', () => {
    const s = fresh(dayOf(2025));
    expect(datasetById(s, 'wikipediaish')?.name).toBe('Wikipedia-ish');
    expect(datasetById(s, 'nope')).toBeUndefined();
    s.products.push(product('chat', 1000));
    handlers.setUserDataOptIn!(s, { type: 'setUserDataOptIn', on: true }, rngFor(s));
    expect(datasetById(s, DATA_TUNING.USER_CHATS_ID)?.name).toBe("Your Users' Chats");
  });
});
