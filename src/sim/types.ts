// ============================================================================
// LLM: Lets Loose Money — SHARED CONTRACT
// Every module (sim systems, data tables, UI, office scene) builds on these types.
// Do NOT change existing fields without coordinating; adding optional fields is OK.
// GameState must stay JSON-serialisable (no functions, Maps, Sets, class instances).
// ============================================================================

export type Id = string;

export type Segment = 'consumer' | 'developer' | 'enterprise';
export type ProductKind = 'chat' | 'api' | 'enterprise';
/** Which product kind serves which market segment (1:1). */
export const SEGMENT_OF: Record<ProductKind, Segment> = { chat: 'consumer', api: 'developer', enterprise: 'enterprise' };
export const KIND_OF: Record<Segment, ProductKind> = { consumer: 'chat', developer: 'api', enterprise: 'enterprise' };

export type RoleId = 'researcher' | 'engineer' | 'safety' | 'sales' | 'marketing';
export const ROLE_IDS: RoleId[] = ['researcher', 'engineer', 'safety', 'sales', 'marketing'];

/** Game speed in days per real second. 0 = paused. */
export type Speed = 0 | 1 | 3 | 10;

export type NoticeKind = 'good' | 'bad' | 'info' | 'milestone';

/** Benchmark scores, each 0..100. */
export interface Scores {
  reasoning: number;
  coding: number;
  chat: number;
  safety: number;
}

// ---------------------------------------------------------------------------
// v2: capabilities, benchmarks, specialisations (see GAME_DESIGN.md §12)
// ---------------------------------------------------------------------------

/** Latent capability axes, each 0..100. Scores (the 4 market-facing numbers) are DERIVED from these. */
export type CapId =
  | 'knowledge'
  | 'reasoning'
  | 'math'
  | 'coding'
  | 'agentic'
  | 'chat'
  | 'vision'
  | 'safety'
  | 'multilingual'
  | 'longContext';
export const CAP_IDS: CapId[] = ['knowledge', 'reasoning', 'math', 'coding', 'agentic', 'chat', 'vision', 'safety', 'multilingual', 'longContext'];
export type Capabilities = Record<CapId, number>;

export type BenchmarkCategory = 'language' | 'knowledge' | 'reasoning' | 'math' | 'coding' | 'agentic' | 'chat' | 'vision' | 'safety' | 'frontier';

/** A real (or, after ~2026, parody) benchmark. Results are % unless unit says otherwise. */
export interface BenchmarkDef {
  id: Id;
  name: string;              // "MMLU", "SWE-bench Verified"
  fullName: string;          // "Massive Multitask Language Understanding"
  year: number;              // year introduced (appears on leaderboards from then)
  category: BenchmarkCategory;
  /** Capability mix feeding this benchmark (weights sum to ~1). */
  weights: Partial<Capabilities>;
  /** Capability level (0..100 weighted) at which a model scores halfway between floor and ceiling. */
  difficulty: number;
  /** Logistic spread: smaller = sharper jump from floor to ceiling. */
  spread: number;
  floor: number;             // random-guess score, e.g. 25 for 4-way multiple choice
  ceiling: number;           // best achievable (label noise), e.g. 92
  /** Considered "headline" (shown in compact model rows / press) while not saturated. */
  headline?: boolean;
  /** v8: efficiency benchmark exponent. Result x clamp((nanoThreshold/activeParamsB)^efficiency, 0.35, 1.15). */
  efficiency?: number;
  flavor: string;            // one dry line
}

/** A post-training specialisation a model can evolve into (fine-tune / distill / RL). */
export interface SpecializationDef {
  id: Id;
  name: string;              // "Coder"
  suffix: string;            // appended to the model name, e.g. "-Coder"
  description: string;       // short, witty
  /** Parent spec ids this can evolve from; 'base' = any model without a specialisation. */
  from: Id[];
  requiresResearch?: Id;
  requiresDatasetKind?: DatasetDef['kind'];
  /** Fine-tune cost as a fraction of the parent's pre-training FLOPs. */
  computeFrac: number;
  /** Additive capability changes (can be negative). */
  capAdd: Partial<Capabilities>;
  /** Multiplier on parent params (distillation < 1). Default 1. */
  paramsMult?: number;
  /** Attractiveness multiplier per product kind when this model is assigned to it. Default 1. */
  productFit?: Partial<Record<ProductKind, number>>;
  /** Per-day chance multiplier for PR-scandal events while a product runs this model. Default 1. */
  scandalRisk?: number;
  /** Hype points gained when a model with this specialisation is released. Default 0. */
  releaseHype?: number;
  tier: number;              // depth in the evolution tree (1 = first fine-tune)
}

// ---------------------------------------------------------------------------
// Static data definitions (live in src/sim/data/*, may contain functions)
// ---------------------------------------------------------------------------

export interface GpuDef {
  id: Id;
  name: string;            // parody names, e.g. "Pascal P-100ish"
  unlockYear: number;      // first calendar year it can be bought/rented
  pflops: number;          // EFFECTIVE PFLOP/s per GPU (MFU already folded in)
  buyPrice: number;        // $ per GPU (capex, goes into a datacenter)
  rentPerDay: number;      // $ per GPU per day in the cloud
  powerKw: number;         // kW per GPU (drives datacenter power bill)
  flavor: string;
}

export interface DatacenterTier {
  id: Id;
  name: string;            // "Server Closet", "Colo Cage", "Hyperscale Campus", "Gigawatt Cathedral"
  maxGpus: number;
  buildCost: number;
  buildDays: number;
  upkeepPerDay: number;    // fixed $/day
  powerPricePerKwh: number;
  unlockYear: number;
  requiresResearch?: Id;
  flavor: string;
}

export interface DatasetDef {
  id: Id;
  name: string;
  kind: 'web' | 'books' | 'code' | 'science' | 'synthetic' | 'dialogue' | 'multimodal';
  tokensB: number;         // billions of tokens
  quality: number;         // 0..1
  cost: number;            // one-off $
  legalRisk: number;       // 0..1, chance-ish weight for lawsuit events
  unlockYear: number;
  requiresResearch?: Id;
  /** Flat score bonus applied to models trained with this dataset. */
  scoreBonus?: Partial<Scores>;
  /** v2: flat capability bonus (preferred over scoreBonus). */
  capBonus?: Partial<Capabilities>;
  flavor: string;
  // v3 data optionality (all optional; see GAME_DESIGN.md §14)
  /** How it's obtained. Default 'purchase'. */
  acquisition?: DataAcquisition;
  /** Subject area, used by domain specialisations and flavour. */
  domain?: DataDomain;
  /** Latest year covered — newer data improves knowledge on fresh topics. */
  freshnessYear?: number;
  /** Recurring licence fee in $/year while held (acquisition 'license' | 'partnership'). */
  annualFee?: number;
  /** Exclusive deal: rivals' knowledge suffers slightly while you hold it. */
  exclusive?: boolean;
  /** Reputation hit chance-ish weight (separate from legal risk). */
  reputationRisk?: number;
  /** Requires the player to have an active product of this kind (user-data sets). */
  requiresProduct?: ProductKind;
  /** Requires a released model with at least this overall score (e.g. distillation-style synthetic sets). */
  requiresModelOverall?: number;
  /** Rival labs that compete for the same deal; if a rival takes it first it disappears from the shop. */
  contestedBy?: Id[];
  /** Hidden until an event or research reveals it. */
  secret?: boolean;
}

export type DataAcquisition = 'purchase' | 'license' | 'scrape' | 'partnership' | 'crowdsource' | 'generate' | 'userdata' | 'open';
export type DataDomain =
  | 'general'
  | 'code'
  | 'math'
  | 'science'
  | 'medical'
  | 'legal'
  | 'finance'
  | 'multilingual'
  | 'creative'
  | 'dialogue'
  | 'vision'
  | 'audio'
  | 'video'
  | 'gaming'
  | 'robotics'
  | 'safety'
  | 'news';

/** A dataset created at runtime (commissioned / generated / harvested). Same shape as DatasetDef, stored in state. */
export type CustomDataset = DatasetDef & { createdDay: number; source: 'commission' | 'synthetic' | 'userdata' | 'crawl' | 'bounty' | 'archive' | 'distill' | 'startup'; collapseRisk?: number };

/** Passive multipliers aggregated from research + stars + events. 1 = neutral. */
export interface Bonuses {
  trainingSpeed: number;       // multiplies training FLOP throughput
  inferenceEfficiency: number; // multiplies tokens served per PFLOP
  dataQuality: number;         // multiplies dataset quality (cap 1.0 after mult)
  researchSpeed: number;       // multiplies research points
  safety: number;              // reduces incident chance (higher = safer)
  brand: number;               // multiplies brand gain
  sales: number;               // multiplies enterprise attractiveness
  // v8 playstyles (lab doctrine). All default 1 in NEUTRAL_BONUSES.
  releaseHype?: number;        // multiplies hype/brand gained from releases
  finetuneCost?: number;       // multiplies fine-tune compute (lower = cheaper)
  budgetAppeal?: number;       // multiplies attractiveness in the budget buyer tier
  crownValue?: number;         // multiplies the payoff of benchmark / class crowns
  openPenalty?: number;        // multiplies the user loss from open-weights releases (0.25 base)
  valuation?: number;          // multiplies private and public valuation
  contractFit?: number;        // multiplies the player's fit score when bidding on contracts
}

export interface ResearchNode {
  id: Id;
  name: string;
  description: string;         // short, witty
  cost: number;                // research points
  prereqs: Id[];
  minYear: number;             // cannot start before this year
  /** If true, can be toggled in the training wizard and adds scoreBonus to that run. */
  technique?: boolean;
  scoreBonus?: Partial<Scores>;
  /** v2: capability bonus for techniques (preferred over scoreBonus). */
  capBonus?: Partial<Capabilities>;
  /** v2: research that unlocks a specialisation or raises the context window etc. */
  unlocksSpec?: Id;
  /** Passive bonuses applied once researched (multiplicative with others). */
  bonuses?: Partial<Bonuses>;
  unlocksProduct?: ProductKind;
  tier: number;                // column in the tree UI (0..n)
  /** v3: research branch (lane in the tree UI). */
  branch?: ResearchBranch;
  /** v3: one dry line saying concretely what it does in game, e.g. "Unlocks FP8 precision (x3.5 speed, unstable)". */
  effectText?: string;
  icon: string;                // single emoji
}

export interface RoleDef {
  id: RoleId;
  name: string;
  plural: string;
  baseSalary: number;          // $ per year, 2017; grows with AI hype
  hireCost: number;            // one-off recruiting fee
  description: string;
  icon: string;
}

export interface OfficeTier {
  id: Id;
  name: string;                // "Mom's Garage", "WeWork Hot Desk", "SoMa Loft", ...
  capacity: number;            // max headcount
  cost: number;                // one-off move-in cost
  rentPerDay: number;
  flavor: string;
}

export interface CampaignDef {
  id: Id;
  name: string;
  cost: number;
  days: number;
  brandPerDay: number;         // brand points per day while running
  hypePerDay: number;          // player hype points per day while running
  segment?: Segment;           // targeted boost, undefined = all
  minYear: number;
  flavor: string;
}

export type Personality = 'hype' | 'safety' | 'open' | 'price' | 'research' | 'chaos';

export interface CompetitorDef {
  id: Id;
  name: string;                // OpenAye, Anthropomorphic, DeepMined, Metaverse Llama, Mistrial, DeepSeekers
  color: string;               // hex
  personality: Personality;
  foundedYear: number;         // appears in market from this year
  qualityOffset: number;       // added to frontier curve (-15..+5)
  releaseEveryDays: number;
  priceMult: number;           // multiplies reference prices
  brand: number;               // starting brand 0..100
  modelNames: string[];        // legacy cycling names, used only when `naming` is absent
  /**
   * House naming scheme (GAME_DESIGN.md §17.1). `sequence` is era-ordered and walked one name per normal release;
   * `after(k)` continues it past the end (k = 1, 2, ...). `reasoning` / `coder` pools supply names for releases whose
   * caps are strongly skewed that way. Every name a lab can produce is unique by construction.
   */
  naming?: { sequence: string[]; reasoning?: string[]; coder?: string[]; after: (k: number) => string };
  tagline: string;
}

/** A tangible change shown after a decision (cash, GPUs, staff, datasets, models, training days). Never a hidden stat. */
export interface TangibleDelta {
  label: string;               // "Cash", "GPUs", "Researchers"
  value: string;               // "−$2.0M", "+64 V-1000", "−2"
}

export interface EventChoice {
  label: string;
  /** Mutates state, returns a short result line shown to the player. Narrative only: no stat numbers. */
  effect: (s: GameState, rng: Rng) => string;
  /** Optional hint under the label. Tangible only: money, GPUs, staff, datasets, models, time, availability. */
  hint?: string | ((s: GameState) => string);
  /** Hide/disable choice when false (e.g. can't afford). */
  available?: (s: GameState) => boolean;
}

export interface EventDef {
  id: Id;
  title: string;
  body: (s: GameState) => string;
  icon: string;
  /** Relative weight when eligible; 0 = ineligible. Checked roughly daily. */
  weight: (s: GameState) => number;
  cooldownDays: number;
  once?: boolean;
  choices: EventChoice[];
}

export interface AchievementDef {
  id: Id;
  name: string;
  description: string;
  icon: string;
  check: (s: GameState) => boolean;
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// v3: deep training (see GAME_DESIGN.md §13)
// ---------------------------------------------------------------------------

export type ResearchBranch =
  | 'architecture'
  | 'scaling'
  | 'infra'
  | 'data'
  | 'posttraining'
  | 'reasoning'
  | 'agents'
  | 'multimodal'
  | 'inference'
  | 'safety'
  | 'product';
export const RESEARCH_BRANCHES: ResearchBranch[] = ['architecture', 'scaling', 'infra', 'data', 'posttraining', 'reasoning', 'agents', 'multimodal', 'inference', 'safety', 'product'];

export type DataKind = DatasetDef['kind'];
export const DATA_KINDS: DataKind[] = ['web', 'books', 'code', 'science', 'dialogue', 'synthetic', 'multimodal'];

export type TrainingOptionGroup = 'arch' | 'tokenizer' | 'context' | 'optimizer' | 'precision' | 'schedule' | 'filter';

/** A selectable run-sheet option. Gated by research and/or year. */
export interface TrainingOptionDef {
  id: Id;
  group: TrainingOptionGroup;
  name: string;                // "FP8"
  description: string;         // one dry line
  requiresResearch?: Id;
  minYear?: number;
  /** Multiplies training throughput (FLOP/day). */
  speedMult?: number;
  /** Multiplies effective compute for loss (quality). */
  qualityMult?: number;
  /** Multiplies total run FLOPs (e.g. longer context costs more). */
  flopsMult?: number;
  /** Added to the per-day incident rate (instability). Can be negative. */
  instability?: number;
  /** Multiplies inference efficiency of the resulting model. */
  inferenceMult?: number;
  /** Flat capability changes on the resulting model. */
  capAdd?: Partial<Capabilities>;
  /** context group only: context window in K tokens. */
  contextK?: number;
}

/** Everything the player chooses on the pre-training run sheet. */
export interface TrainingConfig {
  arch: Id;                    // option id, group 'arch'
  moeExperts?: number;         // only for MoE archs: 8 | 16 | 64 | 256
  tokenizer: Id;
  context: Id;
  optimizer: Id;
  precision: Id;
  schedule: Id;
  /** Learning-rate aggressiveness 0 (cautious) .. 1 (yolo). */
  lr: number;
  /** Relative weight per data kind (normalised by the sim). Kinds with no owned data are ignored. */
  dataMix: Partial<Record<DataKind, number>>;
  filters: Id[];               // option ids, group 'filter'
  checkpointing: 'often' | 'normal' | 'rare';
}

/** Model persona knobs set during instruct/chat-style fine-tunes. Each -1..1, 0 = neutral. */
export interface Persona {
  helpfulness: number;         // + chat, - safety
  verbosity: number;           // + chat vibes, + inference cost
  sycophancy: number;          // + short-term chat users, - reputation (events)
}

export interface RunIncidentChoice {
  label: string;
  hint?: string | ((s: GameState, run: TrainingRun) => string);
  available?: (s: GameState, run: TrainingRun) => boolean;
  /** Mutates state/run, returns a short result line. */
  effect: (s: GameState, run: TrainingRun, rng: Rng) => string;
}

/** Something that goes wrong (or right) mid-run and pauses the sim for a decision. */
export interface RunIncidentDef {
  id: Id;
  title: string;
  body: (s: GameState, run: TrainingRun) => string;
  /** Relative weight when an incident fires; 0 = ineligible. */
  weight: (s: GameState, run: TrainingRun) => number;
  good?: boolean;
  choices: RunIncidentChoice[];
}

/** A personality trait a model can come out of training with. */
export interface QuirkDef {
  id: Id;
  name: string;                // "Says 'delve' a lot"
  description: string;
  /** Roll weight given the finished run (data mix, arch, techniques...). 0 = impossible. */
  weight: (run: TrainingRun) => number;
  capAdd?: Partial<Capabilities>;
  /** Positive = more brand/hype from virality, negative = PR risk. Used by events. */
  virality?: number;
  good?: boolean;
}

// ---------------------------------------------------------------------------
// Runtime state (serialisable)
// ---------------------------------------------------------------------------

export interface Model {
  id: Id;
  name: string;
  paramsB: number;
  tokensB: number;
  datasetIds: Id[];
  techniques: Id[];            // research node ids applied
  finalLoss: number;
  scores: Scores;
  overall: number;             // weighted 0..100 (see GAME_DESIGN.md)
  elo: number;                 // arena rating, 800 + overall * 8
  trainedDay: number;
  releasedDay: number | null;  // null = trained but unreleased (secret!)
  deprecated: boolean;
  // v2 (optional for old saves; filled in on load / creation)
  caps?: Capabilities;
  /** Benchmark results (%), keyed by BenchmarkDef id, for benchmarks that existed when evaluated. */
  benchmarks?: Record<Id, number>;
  specId?: Id | null;          // null/undefined = base model
  parentId?: Id | null;
  /** Spec ids from the base model down to this one, e.g. ['instruct','companion']. */
  lineage?: Id[];
  contextK?: number;           // context window in thousands of tokens
  modalities?: ('text' | 'vision' | 'audio')[];
  /** Trained on benchmark test sets: inflated numbers, scandal risk. */
  contaminated?: boolean;
  // v3
  config?: TrainingConfig;
  /** Active params per token (MoE); equals paramsB for dense. Inference cost uses this. */
  activeParamsB?: number;
  quirks?: Id[];
  persona?: Persona;
  /** Multiplier on inference efficiency from arch/precision/verbosity (1 = baseline). */
  inferenceMult?: number;
  // v5 fog of training
  /** Quirks nobody has noticed yet. Found by red-teaming, or by the public after release. UI shows only a count/"unknown". */
  latentQuirks?: Id[];
  /** Red-team audit in progress (finishes on this day) or done (true). */
  redTeam?: { doneDay: number } | true;
  /** Hidden arena vibes offset (Elo). Elo shown = base elo + vibes once revealed; provisional until then. */
  vibes?: number;
  /** Day the provisional arena rating settles (releasedDay + window). Before that the UI shows "provisional". */
  eloSettlesDay?: number;
  /** Emergent abilities this model has. */
  emergences?: Id[];
  /** The forecast it was trained against, and how it landed. */
  forecast?: Forecast;
  // v6 the vault (GAME_DESIGN §17)
  /** Internal codename while unreleased; kept after a public rename. */
  codename?: string;
  /** Benchmarks the LAB has measured: id -> measured score (true score + small noise). Unreleased models show only these. */
  benchRuns?: Record<Id, { day: number; score: number }>;
  /** Eval jobs in flight. */
  benchJobs?: { benchIds: Id[]; doneDay: number }[];
  /** Internal blind arena: running (doneDay) or done (measured Elo ± band, reveals vibes before release). */
  arena?: { doneDay: number; elo?: number; band?: number };
  /** Public teaser: what was promised. Release below `expected` overall causes backlash. */
  teased?: { day: number; level: TeaseLevel; expected: number };
  /** Day the weights leaked, if they did. */
  leakedDay?: number;
  releaseMode?: ReleaseMode;
  /** v8: share of users a product keeps when serving this open-weights model, fixed on the day it was released (doctrine-dependent). */
  openUserShare?: number;
  /** Limited preview: ends on this day unless promoted earlier. */
  previewUntil?: number;
  /** Used internally (speeds up research) instead of / before release. */
  internal?: boolean;
  /** How it was made, for distilled and merged models. */
  derivedFrom?: { kind: 'distill' | 'merge'; ids: Id[]; method?: MergeMethod };
  /** Playground prompts tried (ids), for flavour and the latent-quirk poke cooldown. */
  pokes?: { day: number; count: number };
}

// v7
export interface Moment {
  id: Id;                       // e.g. 'first_arena_1' or 'beat_lab.openaye'
  title: string;                // "Number one. For now."
  subtitle: string;             // one satirical line
  /** `num` marks a numeric stat (rendered in mono); text stats such as model names render in sans. */
  stats: { label: string; value: string; num?: boolean }[];
  tone: 'triumph' | 'milestone' | 'loss';
  day: number;
}
export type QueuedRun =
  | { id: Id; kind: 'pretrain'; action: Extract<GameAction, { type: 'startTraining' }> }
  | { id: Id; kind: 'finetune'; action: Extract<GameAction, { type: 'startFinetune' }> };

// v6 the vault
export type ReleaseMode = 'full' | 'preview' | 'open';
export type TeaseLevel = 'vague' | 'benchmarks' | 'hype';
export type MergeMethod = 'average' | 'ties' | 'frankenmerge';

export interface TrainingRun {
  id: Id;
  name: string;
  paramsB: number;
  tokensB: number;
  datasetIds: Id[];
  techniques: Id[];
  dataQuality: number;         // 0..1 effective
  totalFlops: number;          // 6 * N * D (raw FLOPs)
  doneFlops: number;
  startedDay: number;
  lossHistory: number[];       // one sample per day, for the loss curve
  predictedLoss: number;
  // v2
  kind?: 'pretrain' | 'finetune' | 'distill' | 'merge';
  /** v6: distillation run (kind 'distill'). */
  distill?: { teacherId: Id };
  /** v6: merge run (kind 'merge'). */
  merge?: { aId: Id; bId: Id; method: MergeMethod };
  parentId?: Id;
  specId?: Id;
  benchmaxx?: boolean;
  // v3
  config?: TrainingConfig;
  persona?: Persona;
  /** Accumulated multiplier on effective compute from incidents/choices (1 = clean run). */
  qualityMult?: number;
  /** Flat cap changes picked up during the run (emergent abilities etc.). */
  capAdd?: Partial<Capabilities>;
  /** Incident awaiting a decision; the sim pauses until resolved. */
  pendingIncident?: { defId: Id; day: number; result?: string; deltas?: TangibleDelta[] } | null;
  /** Log lines for the run (incidents, rollbacks). */
  log?: { day: number; text: string; kind: NoticeKind }[];
  /** Days the run is stalled (rollbacks, hardware). Progress is not made while > 0. */
  stallDays?: number;
  /** Fixed setup and eval days still to spend before FLOPs count (pretrain only). */
  overheadLeft?: number;
  /** Std-dev multiplier on the score roll (ablations reduce it). */
  uncertainty?: number;
  accidentallyContaminated?: boolean;
  /** Incident ids that fired during the run (for achievements and quirk rolls). */
  incidents?: Id[];
  /** Fine-tune only: quirk the player picked to remove (persona_vectors). */
  removeQuirk?: Id;
  // v5 fog of training (GAME_DESIGN §16). `hidden` must never be shown by the UI.
  hidden?: RunHidden;
  /** What the lab believed at launch: the forecast band the player saw. */
  forecast?: Forecast;
  /** The believed final loss (the dashed "scaling-law prediction" line). predictedLoss is the true one. */
  forecastLoss?: number;
  /** Checkpoint eval readings revealed so far (at 25/50/75%). */
  checkpoints?: CheckpointReading[];
  /** Emergence ids already detected during this run. */
  emerged?: Id[];
  /** v13: how hard the team pushes the run. Undefined = 'standard'. Changeable while the run is live. */
  tempo?: RunTempo;
}

// ---------------------------------------------------------------------------
// v5 Fog of training: forecasts, hidden truths, discoveries (GAME_DESIGN §16)
// ---------------------------------------------------------------------------

/** The player's forecast for a run: a band, not a number. Built only from what the lab KNOWS. */
export interface Forecast {
  low: number;                  // ~10th percentile overall
  mid: number;                  // best guess overall
  high: number;                 // ~90th percentile overall
  /** 'wild guess' | 'rough' | 'decent' | 'tight' — sentence-case label for the band width. */
  confidence: 'wild guess' | 'rough' | 'decent' | 'tight';
  /** Why the band is wide, one short sentence each, e.g. "Extrapolating 12x beyond your largest run." */
  reasons: string[];
  /** Belief-based capability preview (same as mid). */
  caps: Capabilities;
  /** Overall points the forecast loses to undertraining (0 at or above 20 tokens per parameter). */
  undertrainPenalty?: number;
}

/** Rolled at run start. The UI must never read these. */
export interface RunHidden {
  /** Seed luck in overall points (golden ≈ +6, cursed ≈ -8, usually N(0, 2.5)). */
  seedLuck: number;
  /** 'golden' | 'cursed' | null: shown only at eval day. */
  seedTag: 'golden' | 'cursed' | null;
  /** True overall the run is heading for (before checkpoint luck / incidents). Recomputed if the run changes. */
  trueOverall: number;
  /** Hidden arena vibes offset in Elo (N(0, 35)), revealed over the provisional window after release. */
  vibes: number;
  /** Fine-tune only: how well the specialisation "took" (multiplier on its bonus, 0.4..1.6). */
  specTake?: number;
  /** Emergences this run will show if it gets far enough (rolled at launch). Detected in order as compute crosses them. */
  emergencePlan?: Id[];
  /** Grokking plateau: the loss display stays flat between these progress fractions, then drops. */
  grokking?: [number, number];
}

export interface CheckpointReading {
  at: number;                   // 0.25 | 0.5 | 0.75
  day: number;
  /** Measured overall at that point, extrapolated to the end of the run (noisy). */
  reading: number;
  /** ± band of the reading (shrinks each checkpoint). */
  band: number;
  note?: string;                // e.g. "Loss is tracking under the scaling-law line."
}

/** A capability that switches on past a hidden scale threshold. Content in src/sim/data/emergences.ts. */
export interface EmergenceDef {
  id: Id;
  name: string;                 // sentence case, e.g. "Arithmetic, mostly"
  description: string;          // satirical one-liner shown on discovery
  /** log10 of effective training compute (6·N_eff·D_eff·dataQuality) where it CAN appear, before per-game jitter. */
  threshold: number;
  /** Per-game jitter range (± log10) applied to the threshold. */
  jitter: number;
  /** Chance it appears once the threshold is crossed (0..1). */
  chance: number;
  /** Optional requirement: a researched node, or a minimum data-kind share in the mix. */
  requiresResearch?: Id;
  requiresKind?: { kind: DataKind; minShare: number };
  minYear?: number;
  capAdd: Partial<Capabilities>;
  /** Some emergences are mixed blessings: also add this quirk id. */
  quirk?: Id;
  good: boolean;
}

/** One LR-sweep / ablation measurement for an architecture at a scale. */
export interface SweepPoint {
  lr: number;
  /** log10 of active params of the proxy run. */
  scale: number;
  /** Measured quality factor (≈ 0.8..1.1, noisy). Higher is better. */
  reading: number;
  day: number;
}

/** What the lab has learned. Persisted in GameState.lab. */
export interface LabKnowledge {
  /** Completed pre-training runs per architecture id. */
  runsByArch: Record<Id, number>;
  /** Largest training compute completed so far (raw FLOPs). */
  largestFlops: number;
  /** LR sweep points per architecture id. */
  sweeps: Record<Id, SweepPoint[]>;
  /** Discovered emergences: id -> where and when. Undiscovered ones stay "???". */
  discoveries: Record<Id, { day: number; modelId: Id; threshold: number }>;
  /** Dataset ids whose TRUE quality has been measured (trained on, or audited). */
  verifiedData: Id[];
  // hidden per-game world truths (UI must not read)
  /** Per-architecture offset of the optimal LR. */
  lrOffsets: Record<Id, number>;
  /** Per-emergence threshold jitter actually used this game. */
  emergenceJitter: Record<Id, number>;
  /** Forecast accuracy track record: |actual - mid| of past runs (last 20). Makes forecasts tighter as you learn. */
  forecastErrors: number[];
  /** LR sweeps in progress. Their points land in `sweeps` when `doneDay` arrives. */
  sweepJobs?: SweepJob[];
}

/** An LR sweep in progress (see runLrSweep). Readings are measured at launch and revealed on doneDay. */
export interface SweepJob {
  arch: Id;
  doneDay: number;
  points: SweepPoint[];
}

/** Shown once after a run finishes ("eval day"). The sim pauses until dismissed. */
export interface EvalReveal {
  modelId: Id;
  kind: 'pretrain' | 'finetune' | 'distill' | 'merge';
  forecast: Forecast;
  actual: number;
  /** 'banger' | 'solid' | 'as expected' | 'mid' | 'dud' | 'cursed' relative to the forecast. */
  verdict: 'banger' | 'solid' | 'as expected' | 'mid' | 'dud' | 'cursed';
  seedTag: 'golden' | 'cursed' | null;
  emerged: Id[];
  /** Quirks visible at eval (latent ones are NOT listed). */
  quirks: Id[];
  /** Datasets whose true quality was revealed by this run: id -> (true - claimed). */
  dataSurprises: Record<Id, number>;
  /** Benchmark id -> score, in display order for the reveal. */
  benchmarks: Record<Id, number>;
}

export interface Datacenter {
  id: Id;
  name: string;
  tierId: Id;
  gpus: Record<Id, number>;    // gpuId -> count installed
  buildDaysLeft: number;       // > 0 = under construction
  /** v14: count-weighted average purchase day per GPU model (age drives failures and resale). Missing = bought today. */
  bought?: Record<Id, number>;
  /** v14: fractional GPU failures carried to the next day, per GPU model. */
  wear?: Record<Id, number>;
}

/** v8: buyer tiers inside every segment (GAME_DESIGN §19.3). Weights drift with the year. */
export type BuyerTier = 'premium' | 'mainstream' | 'budget';
export const BUYER_TIERS: BuyerTier[] = ['premium', 'mainstream', 'budget'];

export interface Product {
  id: Id;
  kind: ProductKind;
  name: string;
  modelId: Id | null;
  /** chat: $/user/month; api: $ per million tokens; enterprise: $/seat/month */
  price: number;
  users: number;               // chat users | dev accounts | enterprise seats
  /** v8: the same users split by buyer tier (sums to users). Refreshed by marketTick. Missing in older saves. */
  tierUsers?: Partial<Record<BuyerTier, number>>;
  launchedDay: number;
  satisfaction: number;        // 0..100
  servedFraction: number;      // 0..1 of demand served last tick (<1 = outage)
  mtokPerDay: number;          // demand in millions of tokens/day
  /** v10: serving cost per day (own GPU power share + cloud burst). Shown as the product's serving bill. */
  servingCostPerDay?: number;
  revenuePerDay: number;
  active: boolean;
  /** v7: switch to a better released model automatically. */
  autoUpgrade?: boolean;
}

export interface RoleState {
  count: number;
  skill: number;               // average skill 0.5..2
  salaryLevel: number;         // multiplier vs market salary (0.8..1.6)
}

export interface Star {
  id: Id;
  name: string;
  role: RoleId;
  title: string;               // "Ex-Gugle Distinguished Prompt Whisperer"
  salary: number;              // $/year
  bonuses: Partial<Bonuses>;
  loyalty: number;             // 0..100, low = poachable
  hiredDay: number | null;     // null = candidate on the market
}

export interface Campaign {
  defId: Id;
  daysLeft: number;
}

export interface SegmentState {
  tam: number;                 // total addressable customers
  adoption: number;            // 0..1 share of TAM using any LLM product
  refPrice: number;            // market reference price (same unit as Product.price)
  playerUsers: number;         // convenience mirror (sum of active player products)
}

export interface CompetitorModel {
  name: string;
  scores: Scores;
  overall: number;
  elo: number;
  releasedDay: number;
  // v2
  caps?: Capabilities;
  benchmarks?: Record<Id, number>;
}

export interface Competitor {
  id: Id;                      // matches CompetitorDef.id
  active: boolean;             // false until foundedYear
  model: CompetitorModel | null;
  prices: Record<ProductKind, number>;
  users: Record<Segment, number>;
  brand: number;
  valuation: number;
  nextReleaseDay: number;
  modelsReleased: number;
  /** Multiplayer: this entry is the other human player (id MP_RIVAL_ID). AI logic must skip it; data comes from RivalSnapshot. */
  human?: boolean;
  /** v7: how much this lab has it in for you (0..100). Drives aggression and CEO trash talk. */
  rivalry?: number;
}

// ---------------------------------------------------------------------------
// v4 Online multiplayer (1v1). Each player runs their OWN sim; the other player
// appears as a Competitor { id: MP_RIVAL_ID, human: true } fed by snapshots.
// See GAME_DESIGN.md §15.
// ---------------------------------------------------------------------------
export const MP_RIVAL_ID = 'mp-rival';
export type MpRole = 'host' | 'guest';
export type RivalAttackKind = 'poach' | 'smear' | 'leak' | 'undercut';

/** What one player publishes about their company. Sent every few days + on releases. Plain JSON. */
export interface RivalSnapshot {
  day: number;
  companyName: string;
  color: string;                         // hex chosen in lobby
  model: CompetitorModel | null;         // best RELEASED, non-deprecated model (caps + benchmarks included)
  /** Price per product kind they actively sell; absent = not offering that kind. */
  prices: Partial<Record<ProductKind, number>>;
  users: Record<Segment, number>;        // their own sim's player users per segment
  brand: number;
  hype: number;
  reputation: number;
  valuation: number;
  cash: number;
  revenuePerDay: number;
  isPublic: boolean;
  modelsReleased: number;
  researchDone: number;
  /** Exclusive dataset ids they hold (partnership deals). These become `lost` for you. */
  exclusives: Id[];
  bankrupt: boolean;
  /**
   * v12: the host's AI labs (never the human entry). The host's world is the reference for AI labs: the guest copies
   * these instead of simulating its own, so both players see the same arena, prices and releases.
   */
  labs?: Competitor[];
}

export interface RivalAttack {
  kind: RivalAttackKind;
  day: number;                           // sender's day
  from: string;                          // sender company name
}

export type MpOutgoing =
  | { t: 'attack'; attack: RivalAttack }
  | { t: 'chat'; text: string };

export interface MpSettings {
  /** Match ends at 1 Jan of (2017 + lengthYears); null = until bankruptcy / concede. */
  lengthYears: number | null;
}

export interface MpState {
  role: MpRole;
  room: string;
  settings: MpSettings;
  myColor: string;
  rival: RivalSnapshot | null;           // latest received
  rivalDay: number;                      // latest day the rival reported (lockstep)
  connected: boolean;
  /** Messages produced by sim handlers; the net layer drains & sends them. */
  outbox: MpOutgoing[];
  /** Day each attack becomes available again. */
  cooldowns: Partial<Record<RivalAttackKind, number>>;
  /** Head-to-head feed shown in the VS panel (attacks, chat, crowns won/lost), newest last, cap 100. */
  log: { day: number; text: string; kind: 'me' | 'rival' | 'chat' | 'info' }[];
  /** Weekly samples for the VS chart. */
  history: { day: number; me: number; rival: number }[];
  result: null | { winner: 'me' | 'rival' | 'draw'; reason: string; day: number };
  /** v12, guest only: the latest AI labs received from the host (see RivalSnapshot.labs). */
  hostLabs?: Competitor[];
}

export interface FundingOffer {
  roundName: string;           // "Seed+", "Series A", ...
  amount: number;              // $ invested
  preMoney: number;            // pre-money valuation
  investor: string;            // parody VC name
  expiresDay: number;
}

export interface FinanceSample {
  day: number;
  cash: number;
  revenue: number;             // daily revenue at sample time
  expenses: number;            // daily expenses at sample time
  valuation: number;
  users: number;               // total player users across products
  stockPrice: number;          // 0 before IPO
}

export interface Ledger {
  revenue: Record<string, number>;   // category -> $ today
  expenses: Record<string, number>;  // category -> $ today
}

export interface NewsItem {
  id: number;
  day: number;
  text: string;
  kind: NoticeKind;
}

export interface Notification {
  id: number;
  day: number;
  text: string;
  kind: NoticeKind;
}

export interface PendingEvent {
  defId: Id;
  day: number;
  result?: string;             // set after a choice is made, UI shows it then clears
  /** Tangible changes from the choice (cash, GPUs, staff...). Shown under the result. */
  deltas?: TangibleDelta[];
}

export interface GameState {
  saveVersion: number;
  seed: number;
  rngState: number;
  day: number;                 // days since 2017-01-01 (day 0)
  speed: Speed;
  idCounter: number;

  company: {
    name: string;
    brand: number;             // 0..100 player brand awareness
    hype: number;              // 0..100 player buzz, decays
    reputation: number;        // 0..100 trust (outages, safety incidents lower it)
    founderEquity: number;     // 0..1
    isPublic: boolean;
    sharesOutstanding: number; // millions, set at IPO
    stockPrice: number;
    officeTierId: Id;
    safetyIncidents: number;
    /** v6: the player's model naming scheme id (src/sim/data/names.ts NAMING_SCHEMES). */
    namingScheme?: Id;
    /** v8: the lab's strategic focus (src/sim/data/doctrines.ts). Undefined = not chosen yet (neutral). */
    doctrine?: DoctrineId;
    /** v8: day the doctrine was last set (changing again needs DOCTRINE_COOLDOWN days). */
    doctrineSince?: number;
  };

  finance: {
    cash: number;
    debt: number;
    loanRatePerYear: number;
    today: Ledger;             // accumulated during the current tick
    dailyRevenue: number;      // finalised totals from the previous tick
    dailyExpenses: number;
    revenueBreakdown: Record<string, number>;
    expenseBreakdown: Record<string, number>;
    valuation: number;
    lastPostMoney: number;
    roundsRaised: string[];
    /** v10: dated record of each round (rounds before v10 are missing here). */
    roundLog?: { name: string; day: number; amount: number; postMoney: number }[];
    totalRaised: number;
    pendingOffer: FundingOffer | null;
    nextOfferDay: number;
    negativeCashDays: number;
    history: FinanceSample[];  // sampled every 7 days, max ~600
  };

  compute: {
    rented: Record<Id, number>;      // gpuId -> count rented in cloud
    datacenters: Datacenter[];
    trainingShare: number;           // 0..1 of capacity allocated to training
    totalPflops: number;             // derived each tick
    trainingPflops: number;          // derived
    inferencePflops: number;         // derived
    inferenceUtilization: number;    // 0..1+, demand / capacity
    /** v10: fleet priority (default 'serving'). trainingShare becomes a derived mirror of the split. */
    priority?: FleetPriority;
    /** v10: today's derived fleet picture (serving system). */
    fleet?: FleetBreakdown;
  };

  data: {
    owned: Id[];                     // dataset ids
    // v3 (optional for old saves)
    /** Runtime-created datasets (commissioned, synthetic, user data). Ids are unique. */
    custom?: CustomDataset[];
    /** Licence start day per licensed dataset id (fees charged daily while present). */
    licenses?: Record<Id, number>;
    /** In-flight commissions / generations. */
    pending?: { id: Id; readyDay: number; dataset: CustomDataset }[];
    /** Harvest chats from the player's own products as training data. */
    userDataOptIn?: boolean;
    /** Dataset ids taken off the market by rivals (contested deals). */
    lost?: Id[];
    /** v9: refinery overrides, read by datasetById. quality and tokensB replace the catalogue values; passes counts refinements. */
    refined?: Record<Id, { quality: number; tokensB: number; passes: number }>;
  };

  research: {
    completed: Id[];
    current: Id | null;
    progress: number;                // points into current
    pointsPerDay: number;            // derived
    /** v7: research queue; the first node whose prereqs are met starts when `current` finishes. */
    queue?: Id[];
    /** v7: the player stopped research while a queue existed; the queue waits for Resume. */
    queuePaused?: boolean;
  };

  staff: {
    roles: Record<RoleId, RoleState>;
    stars: Star[];                   // hired + market candidates
    morale: number;                  // 0..100
    nextStarDay: number;
  };

  models: Model[];
  training: TrainingRun | null;
  products: Product[];

  market: {
    aiHype: number;                  // 0..100 global AI hype cycle
    segments: Record<Segment, SegmentState>;
    campaigns: Campaign[];
    /** v10: weekly brand and hype samples for the Marketing chart (max ~600). */
    history?: { day: number; brand: number; hype: number }[];
  };

  competitors: Competitor[];

  events: {
    pending: PendingEvent | null;
    lastFired: Record<Id, number>;   // defId -> day
    fired: Id[];                     // for once-only events
  };

  news: NewsItem[];                  // newest last, cap ~200
  notifications: Notification[];     // unread toasts, UI dismisses
  achievements: Record<Id, number>;  // id -> day unlocked
  flags: Record<string, number>;     // misc counters/flags for events & tutorial

  stats: {
    totalRevenue: number;
    peakValuation: number;
    modelsTrained: number;
    modelsReleased: number;
    outageDays: number;
    lawsuits: number;
    bestElo: number;
  };

  tutorialStep: number;              // -1 = done/skipped
  gameOver: null | { reason: string; day: number };

  /** v4: present only in an online 1v1 match. */
  mp?: MpState;

  /** v5: what the lab has learned (fog of training). Created on demand / by migration. */
  lab?: LabKnowledge;
  /** v5: eval-day reveal waiting to be shown; blocks the sim until dismissed. */
  pendingReveal?: EvalReveal | null;

  // v7 (GAME_DESIGN §18)
  /** Big "aha" beat waiting to be shown full-window; blocks the sim until dismissed. */
  pendingMoment?: Moment | null;
  /** Queued training jobs that start when the slot frees. */
  trainingQueue?: QueuedRun[];
  /** Every notification ever raised (newest last, cap 300), for the log drawer. */
  noticeLog?: { day: number; text: string; kind: NoticeKind }[];
  /** v8: weight classes, class crowns, rival small model lines, benchmark-targeted tuning (systems/classes.ts). */
  classes?: ClassesState;
  /** v8: B2B contract board (systems/contracts.ts). */
  contracts?: ContractsState;
  /** v9: how this game was set up (scenario, difficulty, sandbox). Undefined = classic garage / founder. */
  setup?: GameSetup;
  /** v9: scenario goal progress (systems/scenario.ts). */
  goals?: GoalState[];
  /** v9: data operations (crawler, refinery, marketplace, bounties, archives, rival API, startups). systems/dataOps.ts */
  dataOps?: DataOpsState;
  /** v13 progression: lab XP, levels, perks and the hot streak (systems/progression.ts). Created on demand. */
  progress?: ProgressState;
  /** v13 board objectives: quarterly goals with rewards (systems/board.ts). Created on demand. */
  board?: BoardState;
}

// ---------------------------------------------------------------------------
// Player actions — the ONLY way the UI changes the game
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'setSpeed'; speed: Speed }
  // v13 progression, board objectives and run tempo
  | { type: 'setRunTempo'; tempo: RunTempo }
  | { type: 'buyPerk'; perkId: Id }
  | { type: 'respecPerks' }
  | { type: 'rerollObjective'; objectiveId: Id }
  | { type: 'renameCompany'; name: string }
  // training & data
  | { type: 'buyDataset'; datasetId: Id }
  | { type: 'cancelLicense'; datasetId: Id }
  | { type: 'commissionDataset'; domain: DataDomain; kind: DataKind; budget: number; name?: string }
  | { type: 'generateSynthetic'; modelId: Id; tokensB: number; domain: DataDomain; name?: string }
  | { type: 'setUserDataOptIn'; on: boolean }
  | { type: 'startTraining'; name: string; paramsB: number; tokensB: number; datasetIds: Id[]; techniques: Id[]; benchmaxx?: boolean; config?: TrainingConfig }
  | { type: 'resolveRunIncident'; choice: number }
  | { type: 'clearRunIncident' }
  | { type: 'earlyStopTraining' }
  | { type: 'extendTraining'; fraction: number }
  | { type: 'runAblation'; paramsB: number; tokensB: number; datasetIds: Id[]; config: TrainingConfig }
  // v5 fog of training
  /** Small proxy runs at several learning rates for this arch/scale; adds SweepPoints to lab.sweeps after a few days. */
  | { type: 'runLrSweep'; paramsB: number; tokensB: number; datasetIds: Id[]; config: TrainingConfig; lrs: number[] }
  /** Audit a dataset to learn its true quality before training on it. */
  | { type: 'auditDataset'; datasetId: Id }
  /** Red-team a model: reveals latent quirks after some days. */
  | { type: 'redTeamModel'; modelId: Id }
  | { type: 'dismissReveal' }
  | { type: 'startFinetune'; parentId: Id; specId: Id; name?: string; benchmaxx?: boolean; persona?: Persona; removeQuirk?: Id }
  | { type: 'cancelTraining' }
  /** v6: mode defaults to 'full'; publicName renames the model at launch (the old name becomes its codename). */
  | { type: 'releaseModel'; modelId: Id; mode?: ReleaseMode; publicName?: string }
  // v6 the vault: unreleased models
  | { type: 'runBenchmarks'; modelId: Id; benchIds: Id[] }
  | { type: 'internalArena'; modelId: Id }
  | { type: 'teaseModel'; modelId: Id; level: TeaseLevel }
  /** Playground: try a prompt on a model. Free; occasionally exposes a latent quirk. */
  | { type: 'pokeModel'; modelId: Id; promptId: Id }
  | { type: 'promotePreview'; modelId: Id }
  | { type: 'deployInternally'; modelId: Id; on: boolean }
  | { type: 'startDistill'; teacherId: Id; paramsB: number; name: string }
  | { type: 'startMerge'; aId: Id; bId: Id; method: MergeMethod; name: string }
  | { type: 'setNamingScheme'; schemeId: Id }
  // v7 QoL and moments
  | { type: 'queueResearch'; nodeId: Id }
  | { type: 'unqueueResearch'; nodeId: Id }
  | { type: 'reorderResearch'; nodeId: Id; toIndex: number }
  | { type: 'setResearchQueuePaused'; paused: boolean }
  | { type: 'queueTraining'; action: Extract<GameAction, { type: 'startTraining' }> | Extract<GameAction, { type: 'startFinetune' }> }
  | { type: 'unqueueTraining'; id: Id }
  | { type: 'setProductAutoUpgrade'; productId: Id; on: boolean }
  | { type: 'dismissMoment' }
  // v8 playstyles
  | { type: 'setDoctrine'; doctrine: DoctrineId }
  | { type: 'benchTune'; modelId: Id; benchId: Id }
  | { type: 'bidContract'; offerId: Id; modelId: Id }
  | { type: 'declineContract'; offerId: Id }
  | { type: 'reassignContract'; contractId: Id; modelId: Id }
  | { type: 'cancelContract'; contractId: Id }
  | { type: 'deprecateModel'; modelId: Id }
  // research
  | { type: 'setResearch'; nodeId: Id | null }
  // compute
  | { type: 'rentGpus'; gpuId: Id; count: number }          // negative = return
  | { type: 'buildDatacenter'; tierId: Id; name: string }
  | { type: 'buyGpus'; datacenterId: Id; gpuId: Id; count: number }
  | { type: 'sellGpus'; datacenterId: Id; gpuId: Id; count: number }
  | { type: 'setTrainingShare'; share: number }
  | { type: 'setFleetPriority'; priority: FleetPriority }
  // staff
  | { type: 'hire'; role: RoleId; count: number }
  | { type: 'fire'; role: RoleId; count: number }
  | { type: 'setSalaryLevel'; role: RoleId; level: number }
  | { type: 'upgradeOffice'; tierId: Id }
  | { type: 'hireStar'; starId: Id }
  // products & market
  | { type: 'launchProduct'; kind: ProductKind; name: string; modelId: Id; price: number }
  | { type: 'updateProduct'; productId: Id; modelId?: Id; price?: number }
  | { type: 'shutdownProduct'; productId: Id }
  | { type: 'launchCampaign'; campaignId: Id }
  // multiplayer (no-ops when s.mp is absent)
  | { type: 'mpAttack'; kind: RivalAttackKind }
  | { type: 'mpChat'; text: string }
  | { type: 'mpConcede' }
  // v9 data operations (systems/dataOps.ts, GAME_DESIGN §20.2)
  | { type: 'buildCrawler'; tier: CrawlerTierId }
  | { type: 'setCrawlerPolicy'; policy: CrawlPolicy }
  | { type: 'refineDataset'; datasetId: Id; level: RefineLevel }
  | { type: 'listDataset'; datasetId: Id; price: number; exclusive: boolean }
  | { type: 'unlistDataset'; datasetId: Id }
  | { type: 'runDataBounty'; domain: DataDomain; budget: number; days: number }
  | { type: 'distillRivalApi'; labId: Id; tokensB: number }
  | { type: 'digitizeArchive'; archiveId: Id }
  | { type: 'buyDataStartup'; startupId: Id }
  // finance
  | { type: 'acceptOffer' }
  | { type: 'declineOffer' }
  | { type: 'takeLoan'; amount: number }
  | { type: 'repayLoan'; amount: number }
  | { type: 'ipo' }
  | { type: 'secondaryOffering' }
  // events / ui
  | { type: 'resolveEvent'; choice: number }
  | { type: 'clearEventResult' }
  | { type: 'dismissNotification'; id: number }
  | { type: 'setTutorialStep'; step: number };

export type ActionType = GameAction['type'];
export type ActionOf<T extends ActionType> = Extract<GameAction, { type: T }>;

/** Each system module exports `handlers: ActionHandlers` for the actions it owns. */
export type ActionHandlers = {
  [K in ActionType]?: (s: GameState, a: ActionOf<K>, rng: Rng) => void;
};

/** A system runs once per day tick and mutates state in place. */
export type System = (s: GameState, rng: Rng) => void;

export interface Rng {
  next(): number;                         // [0,1)
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
  pick<T>(arr: readonly T[]): T;
  normal(mean?: number, sd?: number): number;
}

// ---------------------------------------------------------------------------
// v8 Playstyles: many ways to win (GAME_DESIGN.md §19)
// ---------------------------------------------------------------------------
export type DoctrineId = 'frontier' | 'efficient' | 'open' | 'specialist' | 'enterprise';

/** Weight classes by ACTIVE params relative to the year's frontier size (see classes.ts classOf). 'open' = any size. */
export type WeightClass = 'nano' | 'small' | 'medium' | 'open';

/** A small/medium model line a rival lab ships next to its flagship (Llamaish 8B, GPTee-mini, Mistrial 7B...). */
export interface RivalLineModel extends CompetitorModel {
  labId: Id;
  weightClass: WeightClass;
  activeParamsB: number;
  /** releasedDay of the flagship this line was built from. A change means the line is rebuilt. */
  basedOnDay?: number;
}

/** Who is #1 on a benchmark within a weight class (released models only). */
export interface ClassCrown {
  benchId: Id;
  weightClass: WeightClass;
  holder: Id;                  // 'player' or a competitor id
  modelName: string;
  score: number;
  sinceDay: number;
}

/** A benchmark-targeted tuning job on an UNRELEASED model (vault-side, does not use the training slot). */
export interface BenchTuneJob {
  id: Id;
  modelId: Id;
  benchId: Id;
  startDay: number;
  doneDay: number;
  cost: number;
  /** Diminishing-returns multiplier on the cap gain: 1 for the first tune on this model and benchmark, then 0.5, 0.25. */
  gainMult?: number;
}

export interface ClassesState {
  crowns: ClassCrown[];
  /** Rival small/medium lines keyed `${labId}:${weightClass}`. */
  rivalLines: Record<string, RivalLineModel>;
  benchTunes: BenchTuneJob[];
}

export type ContractKind = 'ondevice' | 'onprem' | 'vertical' | 'government' | 'npc' | 'grant' | 'agentic';

export interface ContractReqs {
  /** Max ACTIVE params in B (on-device / NPC deals). */
  maxActiveParamsB?: number;
  /** Minimum capability values. */
  minCaps?: Partial<Capabilities>;
  /** Model lineage must include one of these spec ids (domain experts etc.). */
  specIds?: Id[];
  /** Model must be released with releaseMode 'open' (self-hosted). */
  openWeights?: boolean;
  /** Player must hold a crown on one of these benchmarks (any weight class). */
  crownOn?: Id[];
  /** Max allowed contamination: true = contaminated models are rejected. */
  clean?: boolean;
}

export interface ContractOffer {
  id: Id;
  defId: Id;
  kind: ContractKind;
  client: string;              // parody client name
  title: string;
  blurb: string;               // one dry line
  reqs: ContractReqs;
  upfront: number;             // $ paid on signing
  perYear: number;             // $ per year while active (paid daily)
  years: number;
  /** Engineers tied up supporting it while active (reduces effective engineer count). */
  supportEngineers: number;
  expiresDay: number;          // offer disappears after this
  /** The strongest rival bid's fit score (hidden exact value; UI shows a band). */
  rivalFit: number;
  rivalLab: Id | null;
}

export interface ActiveContract {
  id: Id;
  offer: ContractOffer;
  modelId: Id;
  startDay: number;
  endDay: number;
  /** Days the assigned model has failed the requirements (deprecated, deleted...). 30 = breach. */
  breachDays: number;
}

/** v8: a bid waiting for its decision day. The offer stays in `offers` until the bid is decided. */
export interface ContractBid {
  id: Id;
  offerId: Id;
  modelId: Id;
  bidDay: number;
  decideDay: number;
  /** Our fit, rolled when the bid went in (expected fit + N(0, 5)). Never shown exactly. */
  fit: number;
}

export interface ContractsState {
  offers: ContractOffer[];
  active: ActiveContract[];
  /** Finished / lost / declined, newest first, capped 40. */
  history: { day: number; client: string; title: string; outcome: 'won' | 'lost' | 'declined' | 'expired' | 'completed' | 'breached' | 'cancelled'; value: number; winner?: string }[];
  nextOfferDay: number;
  /** v8 (optional): bids awaiting their decision day. Missing in older saves = none. */
  pending?: ContractBid[];
}

// ---------------------------------------------------------------------------
// v9 Version 1.0: scenarios, difficulty, data operations (GAME_DESIGN.md §20)
// Agents may add OPTIONAL fields in this block for their own feature.
// ---------------------------------------------------------------------------
export type DifficultyId = 'intern' | 'founder' | 'unicorn' | 'doomer';

export interface GameSetup {
  scenarioId: Id;              // 'garage' = classic
  difficulty: DifficultyId;
  sandbox: boolean;            // no bankruptcy, no goals
  skipTutorial: boolean;
  startYear: number;
}

export interface GoalState {
  id: Id;
  text: string;
  deadlineYear?: number;
  doneDay: number | null;
  failedDay: number | null;
  /** v9 scenario (optional): true on the one goal whose deadline passed (the loss takeover names it). */
  missed?: boolean;
}

// --- v9 data operations (systems/dataOps.ts, GAME_DESIGN §20.2). Every field is optional for old saves. ---
export type CrawlerTierId = 'scrappy' | 'industrial' | 'planetary';
export type CrawlPolicy = 'polite' | 'aggressive';
export type RefineLevel = 1 | 2 | 3;

export interface CrawlerState {
  tier: CrawlerTierId;
  policy: CrawlPolicy;
  builtDay: number;
  /** Yield and upkeep start on this day (a build or upgrade takes buildDays). */
  onlineDay: number;
}

/** Work in flight. Each job lands on doneDay and delivers its result into the dataset shelf. */
export type DataJob =
  | { id: Id; kind: 'bounty'; startDay: number; doneDay: number; cost: number; domain: DataDomain; budget: number; tokensB: number; quality: number; spamShare: number }
  | { id: Id; kind: 'archive'; startDay: number; doneDay: number; cost: number; archiveId: Id }
  | { id: Id; kind: 'distill'; startDay: number; doneDay: number; cost: number; labId: Id; modelName: string; tokensB: number; quality: number; collapseRisk: number }
  | { id: Id; kind: 'refine'; startDay: number; doneDay: number; cost: number; datasetId: Id; level: RefineLevel; quality: number; tokensB: number };

/** A custom dataset offered on the marketplace. Rivals buy it by chance each week. */
export interface DataListing {
  datasetId: Id;
  price: number;
  exclusive: boolean;
  listedDay: number;
  buyers: Id[];
  sales: number;
  revenue: number;
  /** Closed after an exclusive sale. */
  closed?: boolean;
}

/** A data startup for sale. Buying it starts a token stream and hires two engineers. */
export interface StartupOffer {
  id: Id;
  name: string;
  domain: DataDomain;
  tokensPerDayB: number;
  quality: number;
  price: number;
  offeredDay: number;
  expiresDay: number;
  /** Day a rival starts a bidding war (null = uncontested). */
  contestDay: number | null;
  /** The rival lab in the war, if any. */
  rivalId: Id | null;
  /** True once the bidding war has started. Buying now costs the war premium. */
  war: boolean;
  /** Day the rival wins if the player has not answered. Set when the war starts. */
  warDeadline: number | null;
}

/** A bought startup's running token stream into its own dataset. */
export interface StartupStream {
  id: Id;
  name: string;
  domain: DataDomain;
  datasetId: Id;
  tokensPerDayB: number;
  startDay: number;
  endDay: number;
}

export interface DataOpsState {
  crawler?: CrawlerState | null;
  /** Lifetime crawled tokens, billions. */
  crawledB?: number;
  /** Day until which a Cloudflare-ish block halves the crawl yield. */
  blockedUntil?: number;
  /** A block has landed and the player has not answered the event yet. */
  blockPending?: boolean;
  jobs?: DataJob[];
  listings?: DataListing[];
  streams?: StartupStream[];
  startup?: StartupOffer | null;
  nextStartupDay?: number;
  /** Lifetime marketplace revenue. */
  soldTotal?: number;
  /** Distillation orders since the last cease and desist. */
  tosExposure?: number;
  /** A cease and desist letter is waiting for an answer. */
  tosPending?: boolean;
  /** Distillation is banned until this day after a comply choice. */
  distillBannedUntil?: number;
  /** Archive ids that already had their copyright claim. */
  claimedArchives?: Id[];
  /** Recent deliveries and events for the Get data panel (newest last, capped). */
  log?: { day: number; text: string }[];
}

// ============================================================================
// v10 Clarity pass (GAME_DESIGN.md §21)
// ============================================================================

/**
 * Who gets the player's own GPUs first while a training run is active. Serving demand your own GPUs can't
 * cover is always served by rented cloud capacity ("burst") at a per-token cost, so products never go down
 * for lack of capacity. Without an active run, idle GPUs always serve first (they cost nothing extra).
 * - serving:  your GPUs serve products first, training gets what is left (cheapest serving, slower training)
 * - balanced: serving may use at most half of your GPUs, the rest bursts to the cloud
 * - training: all your GPUs train, all serving is bought from the cloud (fastest training, highest serving bill)
 */
export type FleetPriority = 'serving' | 'balanced' | 'training';

/** One product's slice of today's serving (derived each tick by the serving system). */
export interface ServingSlice {
  productId: Id;
  /** PFLOP/s served on the player's own GPUs. */
  ownPflops: number;
  /** PFLOP/s bought from the cloud. */
  burstPflops: number;
  /** Tokens served per day, millions. */
  mtokPerDay: number;
  /** Cloud burst cost per day for this product. */
  burstCostPerDay: number;
  /** Power cost per day of the own GPUs it used. */
  ownCostPerDay: number;
}

/** Derived picture of where the fleet goes today. Recomputed every tick; never persisted logic. */
export interface FleetBreakdown {
  totalGpus: number;
  totalPflops: number;
  /** PFLOP/s the active run gets after cluster efficiency (0 without a run). */
  trainingPflops: number;
  /** Own GPUs given to training (before cluster efficiency). */
  trainingGpus: number;
  servingPflops: number;
  servingGpus: number;
  idlePflops: number;
  idleGpus: number;
  burstPflops: number;
  burstCostPerDay: number;
  /** Cloud burst price, $ per PFLOP/s-day, this year. */
  burstPricePerPflopDay: number;
  slices: ServingSlice[];
}

// ---------------------------------------------------------------------------
// v13 Progression, board objectives and run tempo (GAME_DESIGN.md §23)
// ---------------------------------------------------------------------------
/** How hard a live run is pushed. careful: slower, far fewer incidents. crunch: faster, risky, burns morale. */
export type RunTempo = 'careful' | 'standard' | 'crunch';

export type PerkBranch = 'scale' | 'craft' | 'hype' | 'data' | 'trust';

export interface PerkDef {
  id: Id;
  name: string;
  branch: PerkBranch;
  /** 1..4. Tier 4 is the branch capstone; a lab may own only one capstone. */
  tier: 1 | 2 | 3 | 4;
  /** Perk points it costs. */
  cost: number;
  /** Lab level needed before it can be bought. */
  minLevel: number;
  /** Dry one-liner. */
  description: string;
  /** What it does in game, concretely. */
  effectText: string;
  /** Passive multipliers, folded into getBonuses. */
  bonuses?: Partial<Bonuses>;
}

export interface ProgressState {
  /** Lifetime lab XP. */
  xp: number;
  /** Current lab level (1-based). */
  level: number;
  /** Unspent perk points. */
  perkPoints: number;
  perks: Id[];
  /** Consecutive pre-training runs that landed at or above their forecast. */
  streak: number;
  bestStreak: number;
  /** Counters the observer already paid XP for. */
  seen: { research: number; released: number; crowns: number; contractsWon: number; achievements: number; revealKey: string };
  /** Recent XP gains, newest last (cap 30). */
  log: { day: number; amount: number; reason: string }[];
  /** Day of the last respec (respecs have a cooldown). */
  respecDay?: number;
}

export type ObjectiveKind =
  | 'revenue' | 'users' | 'ship' | 'research' | 'beat' | 'crown' | 'contract' | 'rank' | 'hype' | 'runway' | 'launch' | 'train' | 'scale';

export interface ObjectiveReward {
  xp: number;
  cash?: number;
  hype?: number;
  /** Research points added to the current topic (or banked when idle). */
  rp?: number;
}

export interface Objective {
  id: Id;
  kind: ObjectiveKind;
  text: string;
  /** Target value for the measured quantity. */
  target: number;
  /** Measured value when the quarter began (for count goals and progress bars). */
  base: number;
  /** Last measured value (refreshed daily). */
  value: number;
  reward: ObjectiveReward;
  /** The stretch goal of the quarter: harder, pays double. */
  stretch?: boolean;
  doneDay: number | null;
}

export interface BoardState {
  quarterStart: number;
  quarterEnd: number;
  /** 1-based quarter number since the lab opened. */
  quarter: number;
  objectives: Objective[];
  /** 0..100. Hits raise it, misses lower it. Moves valuation a little (finance reads it through Bonuses.valuation). */
  confidence: number;
  /** Rerolls left this quarter. */
  rerolls: number;
  /** Past quarters, newest last (cap 24). */
  history: { quarter: number; hit: number; total: number; day: number }[];
}
