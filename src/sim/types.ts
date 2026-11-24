// The whole game state is plain JSON. `endWeek` and `apply` are the only two functions that change it.
export type Id = string;
export type Week = number; // 48 weeks per game year
export type Modality = 'lang' | 'image' | 'video';
export type Layer = 'lab' | 'cloud' | 'chips' | 'fab' | 'power' | 'app';
export type Vec = number[]; // 4 capability axes, named by the modality table
export type Style = 'hype' | 'research' | 'safety' | 'follower' | 'pricewar';

/** Product attributes. cost = compute units per unit of demand served, speed = relative, trust = 0..1.2. */
export interface Attrs { cost: number; speed: number; trust: number }

export interface Actor {
  id: Id; name: string; cash: number; isPlayer: boolean;
  /** Rival tycoons only: how they trade and when they raid. All 0..1. */
  persona?: { greed: number; risk: number; ego: number; blurb: string };
}

export interface Ceo { name: string; style: Style; skill: number; ego: number }

export interface LabState {
  /** Techniques this lab has before they are public. */
  techniques: Id[];
  /** Data licence level per data kind (0..3). */
  data: Record<string, number>;
  talent: number; // 0.8..1.2
  brand: number; // 0..1, slow
  hype: number; // 0..1.5, decays weekly
  lastLaunch: Week;
  /** Things this lab has built before: 'arch:x', 'tech:x', 'em:x'. Drives novelty. */
  history: string[];
  maxCompute: number;
  raceWins: number;
  /** Research budget: share of weekly revenue, points saved up, and the technique it is aimed at. */
  research: { rate: number; points: number; aim: Id | null };
  /** Discounts from owning your own silicon: multipliers on training and serving compute prices. */
  hw: { train: number; infer: number };
  /** What this lab paid per compute-week last week, after contracts and owned clouds. */
  cuPrice: number;
  /** Compute used last week: training plus serving. */
  cuUsed: number;
}

/** A supplier's plant: capacity in compute-weeks per week it can support, and the three levers its controller sets. */
export interface Plant {
  capacity: number;
  queue: { week: Week; add: number }[]; // capacity under construction
  posture: -1 | 0 | 1; // price: undercut, market, premium
  capex: 0 | 1 | 2; // build rate: coast, steady, flat out
  blocked: Id[]; // labs it refuses to serve
  decreeUntil: Week; // regulators forbid blocking until then
  /** Chip designers: how good their current chip is, relative to the first-year part (1). */
  gen?: number;
}

/** A chip design. Node: last year's process or the newest; die size; memory; what it is best at. */
export interface ChipBlueprint { node: 0 | 1; die: 0 | 1 | 2; memory: 0 | 1; focus: 'train' | 'infer'; budget: number; weeks: 8 | 10 | 12 }
export interface ChipRun {
  id: Id; company: Id; name: string; bp: ChipBlueprint;
  start: Week; weeksPlanned: number; weeksDone: number; spent: number;
  /** Hidden: true performance (relative to the incumbent part) and yield. The UI goes through chips.ts views. */
  truth: { perf: number; yld: number };
  belief: { perf: number; yld: number };
  mods: { perf: number; yld: number; reveal: number };
  sd0: number; revealed: number;
  call: Call | null; outcome: Outcome | null; seen: Id[]; flags: Id[];
  status: 'running' | 'dead' | 'shipped';
}
/** A take-or-pay compute contract between a lab and the cloud layer. */
export interface Contract { lab: Id; units: number; price: number; until: Week }

export interface Company {
  id: Id; name: string; tagline: string; layer: Layer; color: string;
  ceo: Ceo;
  shares: number; price: number; hist: number[];
  cash: number; debt: number;
  rev: number; cost: number; // last week
  rev8: number; ni8: number; revGrowth: number; // moving averages
  negWeeks: number; raisedAt: Week;
  /** Share of weekly profit paid out to all shareholders. */
  payout: number;
  pill: boolean; integrationUntil: Week;
  lab?: LabState;
  plant?: Plant;
  app?: AppState;
}

/** An app company: it owns users in a few segments, and sends them to whichever lab's model it uses by default. */
export interface AppState {
  reach: Record<Id, number>; // segment id -> share of that segment it owns
  base: number; // weekly revenue from its own subscribers
  partner: Id | null; exclusive: boolean; cut: number; until: Week;
}

/** A deal the player signed through an offer. */
export interface Agreement {
  id: Id; kind: 'supply' | 'data' | 'royalty'; lab: Id; other: Id | null; until: Week; pay: number;
  seg?: Id; target?: number; due?: Week; met?: boolean; account?: string; data?: string;
}
/** An offer on the Desk. Options are plain effect lists like a run's calls. */
export interface Offer { id: Id; kind: Id; from: Id | null; expires: Week; big: boolean; call: Call }
/** A short job on a shipped model: a fine-tune for one segment, or a distilled cheap copy. */
export interface Project { id: Id; lab: Id; model: Id; kind: 'tune' | 'distill'; seg: Id | null; done: Week }

export interface Holding { owner: Id; company: Id; shares: number }
/** A trade in a company you control. It fills next week, at next week's price. */
export interface Order { owner: Id; company: Id; shares: number }
export interface Deal {
  id: Id; bidder: Id; merge: boolean; // merge: a company absorbs the target; otherwise a person buys control
  target: Id; offer: number; premium: number; opened: Week; closes: Week;
  /** What the player does with their own shares in the target: null until answered. */
  playerTenders: boolean | null;
}

export interface Blueprint {
  modality: Modality;
  arch: Id;
  /** Total compute, in compute-weeks. */
  compute: number;
  weeks: 4 | 6 | 8;
  split: { scale: number; exp: number; post: number }; // sums to 1
  sizeBias: number; // -1 (small model, many tokens) .. +1 (big model, few tokens)
  mix: Record<string, number>; // data kinds, sums to 1
  techniques: Id[];
  post: number | 'distill'; // axis index to polish, or cheaper serving
  promise?: { seg: Id; target: number };
}

/** Effects are plain data so calls can be stored, shown and tested without running code. */
export type Fx =
  | { k: 'weeks'; n: number }
  | { k: 'cap'; mult?: number; add?: Vec }
  | { k: 'attr'; trust?: number; cost?: number; speed?: number }
  | { k: 'cash'; n: number }
  | { k: 'reveal'; frac: number }
  | { k: 'lab'; talent?: number; hype?: number; brand?: number }
  | { k: 'flag'; id: Id }
  | { k: 'reroll' }
  | { k: 'learn'; tech: Id }
  | { k: 'kill' }
  | { k: 'ship' }
  | { k: 'risk'; p: number; bad: Fx[]; good: Fx[] }
  // Offer effects: they act on the lab and the world, not on a run.
  | { k: 'agree'; a: Omit<Agreement, 'id'> }
  | { k: 'partner'; app: Id; exclusive: boolean; cut: number; weeks: number }
  | { k: 'dataLevel'; kind: string }
  | { k: 'contract'; units: number; price: number; weeks: number }
  | { k: 'license'; model: Id; to: Id }
  | { k: 'rival'; co: Id; talent: number }
  // Chip designs.
  | { k: 'yield'; n: number };

export interface CallOption { label: string; note: string; fx: Fx[] }
export interface Call { def: Id; title: string; body: string; options: CallOption[] }
export interface Outcome { title: string; picked: string; lines: string[]; roll?: { p: number; bad: boolean } }

export interface Report { week: Week; loss: number; mid: number; sd: number; note: string }

export interface Run {
  id: Id; lab: Id; name: string; bp: Blueprint; handsOn: boolean;
  start: Week; weeksPlanned: number; weeksDone: number; cuPerWeek: number; spent: number;
  /** Price per compute-week, reserved when the run started. A crunch mid-run does not change the bill. */
  price: number;
  /** Hidden. The UI must go through view.ts and never read this. */
  truth: { g: number; e: number[]; rest: Vec; attrs: Attrs };
  belief: { g: number; rest: Vec };
  mods: { mult: number; add: Vec; trust: number; cost: number; speed: number; reveal: number };
  sd0: number; r: number; revealed: number; extends: number; instab: number; flops: number;
  forecast: number; // mean believed capability at launch time, for the verdict
  reports: Report[];
  call: Call | null; outcome: Outcome | null;
  seen: Id[]; flags: Id[];
  emergence: { id: Id; week: number } | null;
  status: 'running' | 'dead' | 'shipped';
}

export interface Model {
  id: Id; lab: Id; name: string; modality: Modality;
  cap: Vec; attrs: Attrs;
  /** Price as a multiple of each segment's reference price. */
  price: number;
  shipped: Week; quirks: Id[]; retired: boolean;
  arch: Id; techniques: Id[]; params: number; verdict: Verdict;
  /** Training compute, for pricing fine-tunes and distills. */
  compute: number;
  variantOf?: Id;
}

export interface Segment {
  id: Id; size: number; fit0: number;
  share: Record<Id, number>; // lab id -> share of the segment; the rest is unserved
  accounts: (Id | null)[]; // which lab each named account buys from
  /** Which benchmark generation is current (0 = the original). */
  gen: number;
}

export type Verdict = 'banger' | 'solid' | 'as expected' | 'mid' | 'dud';

export interface LaunchRow { seg: Id; score: number; lo: number; hi: number; leader: Id | null; leaderScore: number; crown: boolean }
export type Moment =
  | { kind: 'launch'; model: Id; lab: Id; rows: LaunchRow[]; verdict: Verdict; forecast: number; actual: number;
      quirks: Id[]; flips: { account: string; seg: Id; from: Id | null }[]; rev: number; profit: number;
      move: number; rivalMoves: { co: Id; pct: number }[]; promise: 'hit' | 'miss' | null; scandal: boolean }
  | { kind: 'race'; race: Id; year: number; standings: { co: Id; score: number }[]; prize: number }
  | { kind: 'end'; ending: 'rich' | 'agi' | 'agiLost' | 'stack'; standings: { id: Id; name: string; worth: number }[] }
  | { kind: 'deal'; bidder: Id; bidderName: string; target: Id; targetName: string; merge: boolean; got: number; outcome: 'won' | 'short' | 'blocked'; paid: number; mine: boolean }
  | { kind: 'ousted'; by: string; lab: string }
  | { kind: 'chip'; chip: Id; company: Id; perf: number; yld: number; eff: number; lo: number; hi: number; incumbent: number; capacity: number; discount: number | null; focus: 'train' | 'infer' }
  | { kind: 'variant'; model: Id; from: Id; rows: { seg: Id; before: number; after: number }[]; costBefore: number; rev: number }
  | { kind: 'over'; reason: string };

export interface News { week: Week; text: string; tone: 'good' | 'bad' | 'info'; co?: Id }

export interface GameState {
  v: number; seed: number; week: Week;
  playerId: Id; labId: Id; // the lab the player runs hands-on
  /** False after a hostile takeover of your lab: you are a shareholder, not the boss, until you control a lab again. */
  helm: boolean;
  actors: Record<Id, Actor>;
  companies: Record<Id, Company>;
  holdings: Holding[];
  orders: Order[];
  deals: Deal[];
  /** Shares traded this week per owner and company, for the weekly limit. */
  traded: Record<string, number>;
  models: Record<Id, Model>;
  runs: Record<Id, Run>;
  segments: Record<Id, Segment>;
  market: { sentiment: number; computePrice: number; scarcity: number; base: number; binding: Layer; capacity: Record<string, number>; demand: number };
  contracts: Contract[];
  offers: Offer[];
  agreements: Agreement[];
  projects: Project[];
  /** Week a technique goes public early because a lab shipped with it. */
  leaks: Record<Id, Week>;
  chips: Record<Id, ChipRun>;
  endings: string[];
  /** Hidden truths the player has discovered: 'syn:a:b', 'dq:web'. Value 1 = known. */
  known: Record<string, number>;
  standing: Record<Id, number>; // call def id -> option index to auto-pick
  callCount: Record<Id, number>;
  moments: Moment[];
  log: News[];
  tutorial: number; // step of the guided first run, 99 = done
  over: boolean;
  nextId: number;
}

export type Action =
  | { t: 'startRun'; bp: Blueprint; name: string }
  | { t: 'answerCall'; run: Id; option: number; always?: boolean }
  | { t: 'clearStanding'; def: Id }
  | { t: 'dismissOutcome'; run: Id }
  | { t: 'dismissMoment' }
  | { t: 'setPrice'; model: Id; price: number }
  | { t: 'retire'; model: Id }
  | { t: 'buyData'; kind: string }
  | { t: 'raise' }
  | { t: 'trade'; company: Id; shares: number } // signed: positive buys
  | { t: 'buyback' }
  | { t: 'borrow'; amount: number } // negative repays
  | { t: 'payout'; rate: number }
  | { t: 'tender'; target: Id; premium: number; as: 'me' | 'lab' }
  | { t: 'defend'; deal: Id; choice: 'tender' | 'refuse' | 'pill' }
  | { t: 'helm'; company: Id }
  | { t: 'contract'; units: number }
  | { t: 'lever'; company: Id; posture?: -1 | 0 | 1; capex?: 0 | 1 | 2; block?: Id }
  | { t: 'answerOffer'; offer: Id; option: number }
  | { t: 'project'; model: Id; kind: 'tune' | 'distill'; seg: Id | null }
  | { t: 'research'; rate?: number; aim?: Id | null }
  | { t: 'startChip'; company: Id; bp: ChipBlueprint; name: string }
  | { t: 'answerChip'; chip: Id; option: number }
  | { t: 'datacenter'; units: number }
  | { t: 'tutorial'; step: number };
