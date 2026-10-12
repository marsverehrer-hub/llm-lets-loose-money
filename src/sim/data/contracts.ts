// OWNER: CONTRACTS. v8 B2B contract definitions (GAME_DESIGN §19.4). Parody clients only.
// Requirements scale with the frontier (classThresholds / frontierQuality), so a small lab can win the small deals.
import type { ContractKind, ContractReqs, GameState, Id } from '../types';
import { classThresholds } from '../systems/classes';
import { frontierQuality } from '../systems/market';

export interface ContractDef {
  id: Id;
  kind: ContractKind;
  /** Parody client names. One is picked per offer. */
  clients: string[];
  /** Title template. `{client}` is replaced with the picked client. */
  title: string;
  /** One dry line. */
  blurb: string;
  /** Calendar years in which this deal can appear. */
  minYear: number;
  maxYear: number;
  /** Requirements for a given calendar year. Frontier-scaled. */
  reqs: (s: GameState, year: number) => ContractReqs;
  /** Pay for a given calendar year. */
  value: (year: number) => { upfront: number; perYear: number; years: number };
  /** Engineers tied up supporting it while active. */
  supportEngineers: number;
  /** Relative chance when an offer slot opens. */
  weight: number;
}

/**
 * v1.0 tuning (GAME_DESIGN §19.4, §18.2). Late pay is multiplied by LATE_SCALE so contracts are a real share of revenue
 * (about 15-30% for a small lab, 5-10% for a specialist) once the lab is a going concern. Early pay is unchanged.
 */
export const CONTRACT_PAY_TUNING = {
  LATE_SCALE: 150,
  /** Verticals and grants (the specialist's deals) pay this share of the rest, so a specialist's revenue share stays near 5-10%. */
  SPECIALIST_PAY_MULT: 0.35,
  /** After 2026 pay keeps growing with the market (per year, up to 2036), so contracts stay relevant late. */
  LATE_GROWTH: 1.18,
};

/**
 * Log-interpolates a per-year value from `early` (2018) to `late` (2026), then grows by LATE_GROWTH a year to 2036.
 * Early deals land at $0.1-2M a year; by 2026 the same deals are worth $5-80M before LATE_SCALE.
 */
function ramp(year: number, early: number, late: number): number {
  const t = Math.min(1, Math.max(0, (year - 2018) / 8));
  const growth = Math.pow(CONTRACT_PAY_TUNING.LATE_GROWTH, Math.min(10, Math.max(0, year - 2026)));
  return early * Math.pow(late / early, t) * growth;
}

/** Pay curve for a deal: perYear ramps from `early` to `late`; upfront is a multiple of one year's pay. */
function pay(early: number, late: number, o: { upfront: number; years: number }): ContractDef['value'] {
  return (year) => {
    const perYear = ramp(year, early, late * CONTRACT_PAY_TUNING.LATE_SCALE);
    return { upfront: perYear * o.upfront, perYear, years: o.years };
  };
}

/** Frontier overall in that year, for scaling capability floors. */
const F = (year: number): number => frontierQuality(year);

export const CONTRACT_DEFS: ContractDef[] = [
  // ---- on-device: small models that fit in a pocket ----------------------------------------
  {
    id: 'ondevice-phone',
    kind: 'ondevice',
    clients: ['Pear Inc.', 'Samsong', 'Nokka', 'Ximiao Mobile'],
    title: "On-device assistant for {client}'s next handset",
    blurb: 'They want it to fit in a pocket and never call home. Marketing has already said "private".',
    minYear: 2018,
    maxYear: 2100,
    reqs: (_s, year) => ({ maxActiveParamsB: classThresholds(year).small, minCaps: { chat: 0.6 * F(year) } }),
    value: pay(0.3e6, 9e6, { upfront: 0.5, years: 2 }),
    supportEngineers: 1,
    weight: 3,
  },
  {
    id: 'ondevice-earbud',
    kind: 'ondevice',
    clients: ['Earwax Audio', 'Boomhaus', 'Quietly Co.'],
    title: 'Offline translator for {client} earbuds',
    blurb: 'Latency under 200ms, battery under a day, zero internet. Nobody on the team has ever worn an earbud.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ maxActiveParamsB: classThresholds(year).nano, minCaps: { multilingual: 0.5 * F(year) } }),
    value: pay(0.2e6, 6e6, { upfront: 0.5, years: 2 }),
    supportEngineers: 1,
    weight: 2,
  },

  // ---- npc: dialogue for games and toys ------------------------------------------------------
  {
    id: 'npc-games',
    kind: 'npc',
    clients: ['Blocky Games', 'Mossback Interactive', 'Glimmer Forge'],
    title: "Shopkeeper and quest-giver dialogue for {client}'s open world",
    blurb: 'Every villager must now have an opinion about the weather. The ship date was last Tuesday.',
    minYear: 2018,
    maxYear: 2100,
    reqs: (_s, year) => ({ maxActiveParamsB: classThresholds(year).small, minCaps: { chat: 0.5 * F(year) } }),
    value: pay(0.2e6, 5e6, { upfront: 0.25, years: 2 }),
    supportEngineers: 1,
    weight: 3,
  },
  {
    id: 'npc-toys',
    kind: 'npc',
    clients: ['Plushwerks', 'Hasbeen Toy Co.'],
    title: 'Talking plush firmware for {client}',
    blurb: 'Cheerful, safe for ages three to six, and able to finish a sentence. Two of the three are negotiable.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ maxActiveParamsB: classThresholds(year).nano, minCaps: { chat: 0.4 * F(year), safety: 0.7 * F(year) } }),
    value: pay(0.15e6, 5e6, { upfront: 0.5, years: 1 }),
    supportEngineers: 0,
    weight: 2,
  },

  // ---- on-prem: their hardware, their basement ---------------------------------------------
  {
    id: 'onprem-bank',
    kind: 'onprem',
    clients: ['Bank of Amerigo', 'Ledgerly Trust', 'Mutual of Nowhere'],
    title: "Private deployment in {client}'s basement",
    blurb: 'The data never leaves the building. An auditor visits quarterly and asks about the basement.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ minCaps: { reasoning: 0.7 * F(year), safety: 0.6 * F(year) }, clean: true }),
    value: pay(0.8e6, 35e6, { upfront: 1, years: 3 }),
    supportEngineers: 2,
    weight: 2,
  },
  {
    id: 'onprem-defence',
    kind: 'onprem',
    clients: ['Gorgon Aerospace', 'Bulwark Defence Ltd.'],
    title: 'Air-gapped assistant for {client}',
    blurb: 'No network, no updates, one binder. The key to the cabinet belongs to a man named Gary.',
    minYear: 2021,
    maxYear: 2100,
    reqs: (_s, year) => ({ minCaps: { reasoning: 0.75 * F(year), knowledge: 0.7 * F(year) }, clean: true }),
    value: pay(0.5e6, 25e6, { upfront: 1, years: 3 }),
    supportEngineers: 2,
    weight: 1,
  },

  // ---- vertical: domain fine-tunes and a safety bar ----------------------------------------
  {
    id: 'vertical-hospital',
    kind: 'vertical',
    clients: ['Mercy General', 'St. Lumen Health'],
    title: 'Clinical notes assistant for {client}',
    blurb: 'Summarises visits in the voice of a tired doctor. Wants a doctor fine-tune. Is not a doctor.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ specIds: ['doctor'], minCaps: { knowledge: 0.6 * F(year) } }),
    value: pay(0.5e6, 15e6, { upfront: 0.5, years: 2 }),
    supportEngineers: 1,
    weight: 2,
  },
  {
    id: 'vertical-law',
    kind: 'vertical',
    clients: ['Dewey, Cheatham & Howe', 'Sue, Sue & Partners'],
    title: 'Contract review for {client}',
    blurb: 'Finds the trap clause on page forty. Must not cite cases that do not exist. Will cite a few anyway.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ specIds: ['lawyer'], minCaps: { reasoning: 0.6 * F(year) }, clean: true }),
    value: pay(0.4e6, 10e6, { upfront: 0.5, years: 2 }),
    supportEngineers: 1,
    weight: 2,
  },
  {
    id: 'vertical-trading',
    kind: 'vertical',
    clients: ['Hedgehog Capital', 'Amerigo Securities'],
    title: 'Morning desk notes for {client}',
    blurb: 'Writes the 6am note in a confident tone. Must never use the word "guaranteed".',
    minYear: 2020,
    maxYear: 2100,
    reqs: (_s, year) => ({ specIds: ['quant'], minCaps: { math: 0.6 * F(year) } }),
    value: pay(1e6, 22e6, { upfront: 0.5, years: 2 }),
    supportEngineers: 2,
    weight: 1,
  },
  {
    id: 'vertical-tutor',
    kind: 'vertical',
    clients: ['Snackbrain Learning', 'Little Scholar Co.'],
    title: 'Homework helper for {client}',
    blurb: 'For children, so the bar is no swearing and no dangerous chemistry. Both are tested weekly.',
    minYear: 2018,
    maxYear: 2100,
    reqs: (_s, year) => ({ minCaps: { safety: 0.8 * F(year), chat: 0.5 * F(year) } }),
    value: pay(0.3e6, 7e6, { upfront: 0.25, years: 2 }),
    supportEngineers: 1,
    weight: 2,
  },

  // ---- government: multilingual, and public weights ----------------------------------------
  {
    id: 'gov-multilingual',
    kind: 'government',
    clients: ['Ministry of Paperwork', 'Department of Forms'],
    title: 'Citizen services in every language for the {client}',
    blurb: 'Forty-one languages, one form, one deadline. The weights must be public so the press can audit them.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ minCaps: { multilingual: 0.7 * F(year) }, openWeights: true, clean: true }),
    value: pay(0.6e6, 14e6, { upfront: 0.5, years: 3 }),
    supportEngineers: 2,
    weight: 2,
  },

  // ---- grant: a crown buys you a grant -----------------------------------------------------
  {
    id: 'grant-math',
    kind: 'grant',
    clients: ['Institute for Vibes', 'Foundation for Mostly Good Science'],
    title: 'Mathematics grant from {client}',
    blurb: 'Holds a maths crown, gets a grant. The grant is paid in installments of optimism.',
    minYear: 2019,
    maxYear: 2100,
    reqs: (_s, year) => ({ crownOn: ['math', 'aime', 'frontiermath', 'gsm8k'], minCaps: { reasoning: 0.7 * F(year) } }),
    value: pay(0.3e6, 6e6, { upfront: 1, years: 2 }),
    supportEngineers: 0,
    weight: 1,
  },
  {
    id: 'grant-reasoning',
    kind: 'grant',
    clients: ['Institute for Vibes', 'Committee for Thinking Things'],
    title: 'Reasoning research grant from {client}',
    blurb: 'Wants a reasoning crown and a press release in return. The committee writes the press release.',
    minYear: 2021,
    maxYear: 2100,
    reqs: () => ({ crownOn: ['arc_agi', 'bbh', 'arc_agi_2', 'hle'] }),
    value: pay(0.5e6, 9e6, { upfront: 1, years: 2 }),
    supportEngineers: 0,
    weight: 1,
  },

  // ---- agentic: models that do things, not just say them -----------------------------------
  {
    id: 'agentic-logistics',
    kind: 'agentic',
    clients: ['Parcelly', 'Swiftrucks Logistics'],
    title: 'Dispatch agent for {client}',
    blurb: 'Books trucks, reroutes ferries and apologises to drivers on the company\'s behalf. Agency required.',
    minYear: 2024,
    maxYear: 2100,
    reqs: (_s, year) => ({ minCaps: { agentic: 0.4 * F(year) } }),
    value: pay(1e6, 30e6, { upfront: 0.25, years: 2 }),
    supportEngineers: 2,
    weight: 2,
  },
  {
    id: 'agentic-tax',
    kind: 'agentic',
    clients: ['Fileright', 'Taxly'],
    title: 'Tax-filing agent for {client}',
    blurb: 'Files your return. Reads the instructions, which were written by someone with a sense of humour.',
    minYear: 2025,
    maxYear: 2100,
    reqs: (_s, year) => ({ minCaps: { agentic: 0.45 * F(year), reasoning: 0.7 * F(year) }, clean: true }),
    value: pay(0.8e6, 15e6, { upfront: 0.25, years: 2 }),
    supportEngineers: 1,
    weight: 2,
  },
];

// Specialist-facing deals (verticals and grants) pay less than the on-device and NPC volume deals (CONTRACT_PAY_TUNING).
for (const d of CONTRACT_DEFS) {
  if (d.kind !== 'vertical' && d.kind !== 'grant') continue;
  const base = d.value;
  d.value = (year) => {
    const r = base(year);
    const k = CONTRACT_PAY_TUNING.SPECIALIST_PAY_MULT;
    return { upfront: r.upfront * k, perYear: r.perYear * k, years: r.years };
  };
}

export function contractDefById(id: Id): ContractDef | undefined {
  return CONTRACT_DEFS.find((d) => d.id === id);
}
