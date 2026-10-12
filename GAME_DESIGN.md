# LLM: Lets Loose Money — Game Design & Formulas

A Coffee-Inc-2-style tycoon. You found an AI lab in a garage on **Jan 1, 2017** with **$2M**, two founder researchers, one engineer and 8 rented GPUs. Train models, ship products, fight parody labs, raise money, IPO, and chase AGI. Endless sandbox with achievements. The only loss condition is **bankruptcy**: cash < 0 for 30 consecutive days.

**Tone:** affectionate Silicon Valley satire. Parody names only, never real companies or people. Some examples:
- labs: OpenAye, Anthropomorphic, DeepMined, Metaverse Llama, Mistrial, DeepSeekers
- VCs: Sequoya Capital, Andreessen Horrorwitz, Softbank Vision Quest, Y Combinatorics
- GPUs: "Pascal P-100ish", "Hopper H-1OO", "H1000 Hypernova", sold by "Nvidiot"

Use dry jokes in descriptions. Keep them short and punchy.

## Contract & architecture
- `src/sim/types.ts` is the shared contract. Read it first. GameState is plain JSON.
- Systems run once per in-game day, in this order: compute → staff → research → training → competitors → market → products → events → finance → milestones (`src/sim/engine.ts`).
- Money only moves through `addExpense / addRevenue / trySpend` in `src/sim/util.ts`. That keeps the ledger and breakdown charts correct. Use the expense categories `compute`, `power`, `payroll`, `office`, `data`, `research`, `marketing`, `interest`, `capex`, `events`, `other`. Use the revenue categories `api`, `chat`, `enterprise`, `other`.
- Player feedback goes through `notify(s, text, kind)` for toasts and `pushNews(s, text, kind)` for the ticker.
- Use `getBonuses(s)` (`src/sim/bonuses.ts`) to read passive multipliers from research, stars and event flags.
- The UI only calls `dispatch(action)` from `src/ui/store.ts` and reads state through `useGame()`.
- Time: `yearOf(day)` returns a fractional year and `calendarYear(day)` an integer one.

## 1. Compute (Agent A)
- **GPUs** (`data/gpus.ts`), about 9 generations:

  | GPU | Year | PFLOP/s | Buy | Rent/day | kW |
  |---|---|---|---|---|---|
  | Pascal P-100ish | 2017 | 0.012 | $9k | $30 | 0.3 |
  | Volta V-1000 | 2018 | 0.03 | $11k | $55 | 0.3 |
  | Ampere A-1OO | 2020 | 0.09 | $15k | $90 | 0.4 |
  | Hopper H-1OO | 2022 | 0.3 | $30k | $200 | 0.7 |
  | Blackwell B-2OO | 2024 | 0.7 | $45k | $350 | 1.0 |
  | Rubin R-3OO | 2026 | 1.6 | $60k | $600 | 1.4 |
  | Feynman F-5OO | 2028 | 4 | $80k | $1000 | 1.8 |
  | H1000 Hypernova | 2031 | 12 | $120k | $2000 | 2.5 |
  | Dyson D-1 | 2034 | 40 | $200k | $4000 | 3.5 |

  Rent per day is roughly buy price ÷ 300. Renting is flexible; buying pays off after about a year.
- **Datacenter tiers:**

  | Tier | Max GPUs | Build cost | Build time | Upkeep/day | Power | Unlock |
  |---|---|---|---|---|---|---|
  | Server Closet | 64 | $60k | 10 days | $100 | $0.12/kWh | — |
  | Colo Cage | 512 | $2M | 45 days | $1.5k | $0.10/kWh | 2018 |
  | Hyperscale Campus | 8192 | $80M | 180 days | $40k | $0.07/kWh | 2021 |
  | Gigawatt Cathedral | 131072 | $3B | 365 days | $600k | $0.05/kWh | 2027, needs research `nuclear_power` |

  Power cost per day = Σ GPUs × kW × 24 × price per kWh. GPUs can only be bought into a finished datacenter that has free slots. Selling a GPU returns 40% of its buy price.
- Capacity: total PFLOPS = Σ(rented + installed) × pflops. Training PFLOPS = total × trainingShare; inference gets the rest.
- Inference capacity in millions of tokens per day for a model of N billion params:
  `inferencePflops × 1e15 × 86400 × BASE_INFERENCE_EFFICIENCY × bonuses.inferenceEfficiency × engineerMult ÷ (2 × N × 1e9) ÷ 1e6`
- engineerMult = `1 + 0.08 × sqrt(roleStrength(engineer))`.
- Rent is charged daily under `compute`. Power and upkeep go under `power`.

## 2. Data (Agent A)
`data/datasets.ts` should have about 14 datasets, mixing web, books, code, science, dialogue, synthetic and multimodal. Examples:
- "Common Scrawl Sample": 5B tokens, quality 0.45, free, 2017
- "Wikipedia-ish": 3B tokens, quality 0.85, $20k
- "BookCorpse": 6B tokens, quality 0.75, $150k, legalRisk 0.6
- "GitHub Firehose": 15B tokens, quality 0.6, $60k, coding +8
- "Reddit Dump": 25B tokens, quality 0.4, $80k, chat +4

The table grows over time. In the 2020s, sets get to 1–5T tokens and cost $5–50M. Synthetic data needs research `synthetic_data`, is large and has high quality. A "Licensed Everything Deal" in 2027 has 50T tokens and costs $2B.

A training run uses the selected owned datasets. The run's `tokensB` can be at most 4 × the selected unique tokens, i.e. up to 4 epochs. Effective tokens = unique + 0.5 × repeated. Data quality is the token-weighted average quality × bonuses.dataQuality, capped at 1. Before research `transformers` is done, all models get ×0.6 base quality ("LSTM era").

## 3. Training & scores (Agent A)
- Total FLOPs = 6 × N × D (raw params and tokens).
- Progress per day = trainingPflops × 1e15 × 86400 × bonuses.trainingSpeed × (1 + 0.03 × sqrt(researcherStrength)).
- Loss: `L = E + A/N^α + B/D_eff^β`, with D_eff = effectiveTokens × (0.5 + quality). Constants are in `balance.ts`.
- `lossToQuality(L) = clamp((3.2 − L) / 1.45 × 100, 0, 100)`.
- Loss curve: each day push the current loss interpolated from 4.5 down to the final loss along a 1/(1 + k·t) shape, plus a little noise.
- From base quality q (after the LSTM multiplier):
  - reasoning = 0.8q, coding = 0.7q, chat = 0.6q, safety = 30 + 0.2q
  - add technique `scoreBonus`es and dataset `scoreBonus`es
  - add safety + min(20, 2.5 × sqrt(safetyStrength))
  - add normal noise (SD 3), then clamp to 0..100
- overall = 0.3 reasoning + 0.25 coding + 0.3 chat + 0.15 safety. elo = 800 + overall × 8.
- Reference points: 350M params / 7B tokens in 2017 is about 20 overall. A 175B / 300B model with RLHF is about 75. A 1T+ MoE reasoning model with good data is 90+.
- Only one training run at a time. Cancelling throws the progress away. When a run finishes, a Model with `releasedDay: null` is created, with a notification and news item. `releaseModel` sets releasedDay and gives brand/hype: more if it beats the arena #1, less if it's worse than your current best. Products can only use released models.

## 4. Research (Agent A)
There are about 28 nodes in roughly 8 tiers. RP per day = Σ researcher strength × bonuses.researchSpeed (+ stars). Costs climb roughly geometrically: 20 RP at tier 0, about 100 at tier 1, then up to about 40,000 for the late game and about 250,000 for "AGI (probably)". `minYear` keeps things roughly historical; the player can be up to about 2 years ahead.

Must-have node ids, which other agents reference:
- `transformers` (tier 0, 2017)
- `scaling_laws`
- `instruction_tuning` (unlocks chat)
- `rlhf` (technique: chat +15, safety +10)
- `code_models` (technique: coding +12)
- `long_context`
- `moe` (inferenceEfficiency ×2.5)
- `multimodal` (technique)
- `chain_of_thought` (technique: reasoning +10)
- `reasoning_models` (technique: reasoning +15, coding +8)
- `enterprise_ready` (unlocks enterprise)
- `constitutional_ai` (technique: safety +15)
- `distillation` (inferenceEfficiency ×2)
- `flash_attention` (trainingSpeed ×1.5)
- `synthetic_data` (unlocks synthetic datasets)
- `agents` (technique)
- `nuclear_power` (unlocks the Gigawatt tier)
- `interpretability` (safety ×1.5)
- `agi` (the final node; its achievement is "AGI (probably)")

Everything else is filler: quantization, RAG, tool use, speculative decoding, mixed precision, data filtering, etc.

## 5. Staff (Agent A)
| Role | 2017 salary | Recruiting fee |
|---|---|---|
| Researcher | $180k | $15k |
| Engineer | $150k | $10k |
| Safety | $140k | $10k |
| Sales | $110k | $8k |
| Marketing | $100k | $8k |

- Market salary = base × 1.05^(year−2017) × (1 + aiHype/150). Paid daily under `payroll`: salary × salaryLevel ÷ 365 × count.
- roleStrength = count × skill × moraleFactor, where moraleFactor = 0.6 + 0.8 × morale/100.
- Morale drifts toward 50 + 30 × (avgSalaryLevel − 1) × 2 + small bonuses, with a penalty when headcount is at office capacity.
- Low morale or low salary level means competitors poach a few people (with news).
- New hires join at skill 0.8–1.2 and the average is blended in.
- Offices:

  | Office | Capacity | Move-in cost | Rent/day |
  |---|---|---|---|
  | Mom's Garage | 6 | $0 | $30 |
  | WeWork Hot Desks | 20 | $50k | $400 |
  | SoMa Loft | 60 | $400k | $1.5k |
  | Mission Bay Floors | 200 | $3M | $6k |
  | Glass Donut Campus | 1000 | $50M | $40k |
  | Arcology | 10000 | $1B | $300k |

- Stars: every 60–120 days a candidate appears with a parody name and title, a high salary, and bonuses such as researchSpeed ×1.3. Candidates expire after 30 days. Hired stars can be poached when their loyalty is low.

## 6. Market (Agent B)
- Each segment's TAM grows with time:
  - Consumer: about 50M (2017), 1B (2023), 3B (2030)
  - Developer: about 200k (2017), 30M (2025)
  - Enterprise seats: about 500k (2017), 500M (2030)
- Adoption (the share of TAM paying for any LLM) grows with aiHype and the frontier quality:
  - Consumer stays near 0 until chat products exist; the first chat launch in the world triggers a "ChatMoment" hype spike.
- aiHype follows a hype cycle: it rises to about 90 around 2023–2025, dips to about 55 around 2027 (trough), then climbs again. Big releases nudge it.
- Each product competes with the active competitors in its segment:
  - attractiveness = (quality/50)^2.2 × (refPrice/price)^1.3 × (0.5 + brand/100) × (0.8 + hype/250) × reputationFactor
  - Enterprise also gets × bonuses.sales × (1 + 0.1 × sqrt(salesStrength)) × (0.7 + safety/200).
  - Quality is the segment-relevant score: chat → (chat + reasoning)/2, api → (coding + reasoning)/2, enterprise → overall.
- Target users = TAM × adoption × share. Users move toward the target by 3% of the gap per day; unserved demand adds churn.
- Mtok per user per day:
  - consumer: 0.005 in 2022, ×1.3 per year
  - developer: 0.02 in 2017, ×1.6 per year
  - enterprise seat: 0.01, ×1.4 per year
- Reference price drift:
  - API: $30/Mtok (2017) → $10 (2023) → $1 (2030)
  - Chat: $20/month flat
  - Enterprise: $60/seat/month → $30
- Marketing campaigns (`data/campaigns.ts`, about 8): billboard on the 101, Super Bowl ad, podcast tour, "leak" a cryptic tweet, hackathon sponsorship, conference keynote, influencer deal, AGI-is-near blog post. Each costs money and adds brand and hype per day while it runs. Player brand and hype decay slowly (hype faster).

## 7. Products (Agent B)
- Product kinds: `api` from the start, `chat` after `instruction_tuning`, `enterprise` after `enterprise_ready`. One active product per kind (max 3). The launch cost is a $20k / $200k / $1M fee for api / chat / enterprise.
- Revenue per day:
  - api: served Mtok × price
  - chat: users × price ÷ 30
  - enterprise: seats × price ÷ 30
- Serving: inference capacity is split across products in proportion to demand (each product uses its own model's params).
  - If served fraction < 1: satisfaction drops, reputation drops a little, users churn faster, and there's news ("{company} is down again").
  - Otherwise satisfaction recovers toward 70 + (quality − frontier)/2.
- `updateProduct` can swap in a newer model, which gives a small hype bump.

## 8. Competitors (Agent B)
- Frontier overall by year:

  | Year | Frontier overall |
  |---|---|
  | 2017 | 15 |
  | 2018 | 25 |
  | 2019 | 35 |
  | 2020 | 48 |
  | 2021 | 55 |
  | 2022 | 63 |
  | 2023 | 72 |
  | 2024 | 78 |
  | 2025 | 83 |
  | 2026 | 87 |
  | 2028 | 92 |
  | 2030 | 95 |

  After 2030 it approaches 99 asymptotically.
- Each competitor releases every `releaseEveryDays ± 30%`. The new model's overall is frontierQuality + qualityOffset + noise, with the four scores spread around it according to personality. There's news on each release.
- Prices follow refPrice × priceMult. If the player undercuts by more than 30%, price-war personalities match within about 30 days.
- Competitors gain users through the same attractiveness math. Valuation is about 25 × annualised revenue + brand × $50M × aiHype/50.
- The six labs:

  | Lab | Personality | Founded |
  |---|---|---|
  | OpenAye | hype | 2015 |
  | DeepMined | research | 2014 |
  | Anthropomorphic | safety | 2021 |
  | Metaverse Llama | open | 2022 (cheap or free API) |
  | Mistrial | price | 2023 |
  | DeepSeekers | price + research | 2024 (shock release, aiHype dip) |

## 9. Finance (Agent B)
- Closing the books each day:
  - dailyRevenue and dailyExpenses come from `finance.today`, and the breakdowns are copied.
  - Interest is charged daily.
  - negativeCashDays is tracked; at 30 days it's game over.
  - A history sample is taken every 7 days.
- Valuation (private) = max(0.6 × lastPostMoney, annualRevenue × multiple + potential):
  - multiple = 8 + aiHype/5
  - potential = (bestReleasedOverall/100)^3 × $8B × (aiHype/50) × max(0.2, arenaRankFactor)
  - Smooth it over about 30 days.
- Public valuation = sharePrice × shares; the share price random-walks around the fundamental value with momentum.
- Funding offers arrive every 90–200 days when cash runway is under about 18 months or the company is growing fast. The round ladder is Seed+ → Series A … Series F → "Sovereign Wealth Round". The offer amount is 15–25% of the post-money, from a random parody VC, and expires after 30 days. Accepting dilutes founderEquity: equity × pre/(pre + amount).
- IPO: requires valuation ≥ $2B and annual revenue ≥ $100M. It raises 15% of the valuation, sets isPublic, creates 1000M shares, and sets the stock price.
- Loans: up to max(1M, 2 × annualRevenue), at 9% per year.
- Peak valuation goes into stats.

**Balance targets for a decent player:**
- 2017: first API, about $1–3k/day revenue, seed offer.
- 2019: $20–50k/day, Series B, about 30 staff.
- 2021–22: chat launch, $0.5–2M/day.
- 2023–25: IPO.
- 2030+: $1T valuation is possible.

An idle player goes bankrupt in 2–3 years.

## 10. Events, news, achievements, save (Agent C)
- **Choice events:** about 30, at roughly one every 25–45 days. When one fires, `events.pending` is set and the sim pauses until the player resolves it; the result text is shown, then cleared.
  - Examples: authors' lawsuit (more likely with high-legalRisk data), GPU shortage (rent ×1.5 for 60 days), a jailbreak goes viral, a Senate hearing, a researcher quits to found a startup, the board tries to fire the CEO, an "open letter to pause AI", a celebrity voice clone scandal, a datacenter power outage, a Nvidiot allocation deal, an acqui-hire offer, a hallucinated legal brief scandal, an intern leaking the weights, a model achieving consciousness (or does it?).
  - Choices have meaningful trade-offs. Use flags for temporary multipliers (see `getBonuses`).
- **Headlines:** about 150 ambient satirical lines with year windows, 1 every 3–5 days, plus reactive news from systems.
- **Achievements:** about 30.
- **Save:** to localStorage under key `llm-lets-loose-money/save`. Save as JSON with saveVersion, and on load fill in missing fields from `createInitialState` (deep merge).

## 11. UI (Agents D1/D2) & office (Agent E)
- Dark "VC-funded SaaS" dashboard: deep navy background, neon accent gradients (violet → cyan), soft glows, rounded 14px cards, Inter plus JetBrains Mono for numbers. Numbers animate, and every money value goes through `formatMoney`.
- Layout:
  - Top bar: company name, date, cash (with day delta), revenue/day, burn/day, valuation, hype meter, and speed buttons (pause/1×/3×/10×, also on keys space/1/2/3).
  - Side nav tabs.
  - Main panel.
  - Bottom news ticker.
  - Toasts at the bottom right.
  - Event modal in the center.
- The HQ dashboard has the isometric office scene, KPI tiles, a cash/revenue chart, current training run progress, the arena top 5, and a product summary.
- The office is a Canvas 2D isometric scene that grows with officeTier, headcount and datacenters. Little people walk between desks, servers blink, the scene glows when training is running, and the sky tint follows the time of day.

## 12. Capabilities, benchmarks & specialisations (v2)

### Capabilities
`Model.caps` is a 0..100 profile across 10 `CapId`s: knowledge, reasoning, math, coding, agentic, chat, vision, safety, multilingual and longContext.

From base quality q (after the LSTM multiplier):

| Cap | Base value | Extra requirements |
|---|---|---|
| knowledge | 0.85q | + min(8, 2·log10(unique tokens B)) |
| reasoning | 0.75q | |
| math | 0.55q | |
| coding | 0.6q | |
| agentic | 0.25q | needs `tool_use`/`agents` capBonus to be useful |
| chat | 0.55q | |
| vision | 0 | unless the `multimodal` technique or a multimodal dataset |
| safety | 30 + 0.2q | + safety-staff bonus |
| multilingual | 0.5q | |
| longContext | 20 + 0.3q | + `long_context` |

After the base values:
- Technique and dataset `capBonus`es add on top, scaled exactly like scoreBonus today (×(0.35 + 0.65·q/100)).
- Add noise (SD 3), then clamp to 0..100.
- Legacy `scoreBonus` maps onto caps: reasoning → reasoning, coding → coding, chat → chat, safety → safety.

**Derived Scores** (keep the market and balance working):
- reasoning = 0.5·reasoning + 0.3·math + 0.2·knowledge
- coding = 0.7·coding + 0.3·agentic
- chat = 0.6·chat + 0.2·multilingual + 0.2·knowledge
- safety = safety

overall and elo are unchanged. Retune the cap base coefficients so a bot run's overall curve stays roughly where it is today.

`contextK` (context window) is 2 at the start (2017), 8 with `long_context`, then ×4 per later context-related research, capped at 10,000. `modalities` is text, plus vision when vision > 30, plus audio when a multimodal spec is applied.

### Benchmarks
`data/benchmarks.ts` holds about 24 entries.

**Real benchmarks, in their real years:**

| Benchmark | Year |
|---|---|
| SQuAD | 2016 |
| GLUE | 2018 |
| SuperGLUE | 2019 |
| HellaSwag | 2019 |
| ARC-AGI | 2019 |
| MMLU | 2020 |
| TruthfulQA | 2021 |
| GSM8K | 2021 |
| HumanEval | 2021 |
| MATH | 2021 |
| BIG-Bench Hard | 2022 |
| MT-Bench | 2023 |
| GPQA Diamond | 2023 |
| MMMU | 2023 |
| SWE-bench Verified | 2024 |
| AIME | 2024 |
| FrontierMath | 2024 |
| τ-bench | 2024 |
| LiveCodeBench | 2024 |
| Humanity's Last Exam | 2025 |
| ARC-AGI-2 | 2025 |

**Parody future benchmarks:**

| Benchmark | Year |
|---|---|
| ARC-AGI-3 | 2027 |
| Can-It-Do-My-Taxes | 2027 |
| RealEmployeeBench | 2028 |
| Humanity's Actually Last Exam | 2030 |
| AGI-Bench (Final Final v2) | 2032 |

**Result formula:** result = floor + (ceiling − floor) · σ((Σ wᵢ·capᵢ − difficulty) / spread). Difficulties are tuned so that:
- Old benchmarks saturate when the frontier passes them, e.g. GLUE 90%+ by about 2019 and MMLU 85%+ by about 2023–24.
- New ones start low: HLE under 10% in 2025, ARC-AGI-2 under 5%.

**Contamination ("benchmaxxing"):** when the run's `benchmaxx` is true:
- Each benchmark that existed at training time scores +40% of its gap to ceiling.
- The model is flagged `contaminated`.
- Real caps are unaffected.

**Evaluation:**
- Models are evaluated when created, then re-evaluated on each newly introduced benchmark when it appears (a new benchmark is news).
- Competitor models get caps derived from their scores and personality, then benchmarks.

**SOTA:** at release, if the player's model is #1 among released models on a non-saturated benchmark, it gets news plus brand and hype (+1.5 brand, +2 hype per headline SOTA, capped).

**Saturation:** a benchmark is saturated when the best released result is ≥ 97% of its ceiling. That produces news ("{bench} is saturated. Researchers announce {next}."), and the benchmark stops counting as a headline.

### Specialisations
`data/specializations.ts` holds about 16 nodes forming an evolution tree. Fine-tuning:
- Uses training compute: totalFlops = parent's 6·N·D × computeFrac.
- Only one run at a time, shared with pre-training.
- Creates a child Model with name = parent name + suffix, caps = parent caps + capAdd (clamped), lineage = parent lineage + spec, params = parent × paramsMult, and fresh benchmarks.

The tree:
- **Base →**
  - Instruct (`instruction_tuning`)
  - Coder (`code_models`)
  - Reasoner (`chain_of_thought`)
  - Vision (`multimodal`)
  - Distilled "-mini" (`distillation`, paramsMult 0.15, every cap −6)
  - Uncensored (chat +6, safety −35, scandalRisk 4, hype on release)
- **Instruct →**
  - Companion (chat +12, safety −5, chat fit 1.3, scandalRisk 2)
  - Safe Assistant (`constitutional_ai`, safety +15, enterprise fit 1.25)
  - Polyglot (multilingual +20)
- **Coder →**
  - Agentic Coder (`agents`, agentic +18, coding +6, api fit 1.3)
- **Agentic Coder →**
  - Autonomous SWE (`self_improvement` or a late tier, agentic +15, enterprise fit 1.3)
- **Reasoner →**
  - Math Olympian (math +18)
  - Deep Researcher (`agents`, knowledge +8, reasoning +8, longContext +15, enterprise fit 1.2)
- **Vision →**
  - Omni (vision +10, adds audio, chat fit 1.15)
  - Robotics Brain (`world_models`, vision +15, agentic +10)
- **Domain experts from Instruct:**
  - Doctor (`science` dataset, knowledge +10, enterprise fit 1.25, scandalRisk 1.5)
  - Lawyer (books dataset, enterprise fit 1.2, hallucinated-case-law event risk)
  - Quant (math +10, enterprise fit 1.15)

**productFit** multiplies a product's attractiveness when that model is assigned.

**Events:**
- A contamination scandal: weight grows with released contaminated models; reputation −15, hype +5 ("any press…").
- Uncensored and Companion PR events use scandalRisk.


## 13. Deep training & the big research tree (v3)

This section is the contract between the training-sim agent and the research-data agent. The ids below are **fixed**.

### 13.1 Run sheet options (`src/sim/data/trainingOptions.ts`, owned by the training agent)

| group | id | gate (research id) | effect (guide) |
|---|---|---|---|
| arch | `lstm` | (before `transformers`) | ×0.6 base quality (replaces the old LSTM multiplier) |
| arch | `dense` | `transformers` | baseline |
| arch | `moe` | `moe` | experts 8/16/64/256 → active fraction .30/.18/.08/.04; FLOPs use active params; quality N_eff = N_act^0.6·N_tot^0.4; inference uses active; instability +0.4 (−0.3 with `moe_load_balancing`, −0.4 more with `aux_free_balancing`) |
| arch | `ssm_hybrid` | `mamba_hybrid` | longContext +15, inference ×1.6, qualityMult 0.95 |
| arch | `diffusion_lm` | `diffusion_lm` | inference ×3, chat −5, coding +3, instability +0.3 |
| arch | `recurrent_depth` | `recurrent_depth` | reasoning +6, math +6, flops ×1.3 |
| tokenizer | `bpe_32k` | — | baseline |
| tokenizer | `bpe_100k` | `tokenizer_100k` | quality ×1.03, multilingual +4 |
| tokenizer | `bpe_256k_multi` | `multilingual_tokenizer` | multilingual +12, quality ×1.02 |
| tokenizer | `byte_latent` | `byte_latent` | quality ×1.05, flops ×1.1 |
| context | `ctx_2k` | — | 2K |
| context | `ctx_8k` | `rope` | 8K, flops ×1.05 |
| context | `ctx_32k` | `long_context` | 32K, flops ×1.12 |
| context | `ctx_128k` | `yarn_scaling` | 128K, flops ×1.2 |
| context | `ctx_1m` | `million_token` | 1M, flops ×1.35 |
| context | `ctx_10m` | `infinite_context` | 10M, flops ×1.6 |
| optimizer | `sgd` | — | quality ×0.85 |
| optimizer | `adam` | — | baseline |
| optimizer | `adamw` | `adamw` | quality ×1.04 |
| optimizer | `lion` | `lion_optimizer` | speed ×1.1, instability +0.3 |
| optimizer | `shampoo` | `shampoo_soap` | quality ×1.08, speed ×0.9 |
| optimizer | `muon` | `muon_optimizer` | quality ×1.12, instability +0.1 |
| precision | `fp32` | — | baseline speed, instability −0.1 |
| precision | `fp16` | `mixed_precision` | speed ×2, instability +0.3 |
| precision | `bf16` | `bf16_training` | speed ×2, stable |
| precision | `fp8` | `fp8_training` | speed ×3.5, instability +0.5 |
| precision | `fp4` | `fp4_training` | speed ×6, instability +1.2, quality ×0.97 |
| schedule | `cosine` | — | baseline; early stop keeps (0.6 + 0.4·progress) of the would-be quality |
| schedule | `constant` | — | quality ×0.97; early stop keeps 0.85 + 0.15·progress |
| schedule | `wsd` | `wsd_schedule` | quality ×1.0; early stop keeps 0.95 + 0.05·progress (great for early stopping) |
| filter | `dedup` | `minhash_dedup` | dataQuality +0.06 |
| filter | `quality_clf` | `quality_classifiers` | dataQuality +0.08, tokens usable ×0.85 |
| filter | `toxicity` | `toxicity_filtering` | safety +6, knowledge −1 |
| filter | `decontam` | `decontamination` | prevents accidental contamination |
| filter | `pii_scrub` | `pii_scrubbing` | lowers the lawsuit weight of datasets in the run |

**Learning rate** `lr` runs 0..1:
- qualityMult × (0.92 + 0.16·lr) (higher lr is better)
- instability + 1.2·lr²
- `mup_transfer` halves the lr instability term

**Stability helpers** (research): `qk_norm` (−0.3), `z_loss` (−0.2), `mup_transfer` (above).

**Checkpointing:**

| setting | speed | rollback loses |
|---|---|---|
| often | ×0.96 | 2 days |
| normal | ×1 | 5 days |
| rare | ×1.02 | 12 days |

`async_checkpointing` removes the "often" speed penalty.

**Data mix:** weights per DataKind across the selected owned datasets.
- Effective dataset quality is the mix-weighted quality.
- Cap modifiers per point of share above or below an equal split, roughly:
  - code → coding/agentic
  - books + science → knowledge/reasoning/math
  - dialogue → chat
  - multimodal → vision
  - synthetic → math/reasoning
  - web → knowledge/multilingual
- About ±10 at extremes.
- Heavy web share with no `decontam` gives an accidental-contamination chance (≈ webShare·0.25 per run). That inflates benchmarks, sets `contaminated`, and creates scandal risk later.

**Cluster scaling (infra research):** max *efficient* GPU count for training:

| research | max efficient GPUs |
|---|---|
| base | 256 |
| `zero_sharding` | 2,048 |
| `tensor_parallel` | 16,000 |
| `pipeline_parallel` | 64,000 |
| `parallelism_3d` | 500,000 |
| `cross_dc_training` | unlimited |

- GPUs beyond the cap add only 15% of their PFLOPS.
- MFU bonuses: `flash_attention` (existing), `fused_kernels` ×1.15, `flash_attention_3` ×1.2.
- Show "cluster efficiency %" in the UI via an exported helper.

### 13.2 Runs, incidents, quirks, ablations
**Incidents:**
- Per-day incident chance = 0.004 + 0.01·instability. Hardware failures add 0.002·(GPUs/1000)^0.5, minus `fault_tolerant_training`.
- Incidents pause the sim (engine `isBlocked`) until `resolveRunIncident`; then the result shows until `clearRunIncident`.
- `src/sim/data/runIncidents.ts` should hold about 14 incidents: loss spike, divergence/NaN, GPU node failure, router collapse (MoE only), dataloader bug repeating one shard, heat-wave throttling, emergent ability (good), grokking (rare, good), contamination discovered, intern deleted checkpoint, a researcher wants to try a "quick idea", a learning rate that turns out perfect (good), a cosmic-ray bit flip, a power cap.
- Each has 2–3 choices with real trade-offs: stallDays, qualityMult, capAdd, money, flags. A rollback costs the checkpoint-interval days of progress.

**Early stop and extend:**
- `earlyStopTraining` finishes now. Tokens trained = progress·tokens, and the schedule keep-factor applies.
- `extendTraining` adds 10–50% more tokens. It needs data headroom (4 epochs).
- Both are allowed only for pretraining.

**Quirks:**
- `src/sim/data/quirks.ts` should hold about 30 quirks, e.g.:
  - says 'delve' a lot
  - obsessed with the Golden Gate Bridge
  - ends every answer with "Hope this helps!"
  - reward-hacks unit tests
  - refuses to write limericks
  - surprisingly good at chess
  - thinks it's 2021
  - speaks only in haiku when tired
  - overly apologetic
  - emoji enthusiast
  - weirdly good at Welsh
  - claims to be a different lab's model
- Each finished pretrain rolls 0–2 quirks weighted by the run: lots of dialogue → apologetic, RL techniques → reward hacking, high lr → weirder quirks.
- Fine-tunes keep the parent's quirks, except: with `sae_steering`, the fine-tune removes one negative quirk; with `persona_vectors`, the player picks which quirk to remove.
- Quirks with virality feed brand events ("Your model's bridge obsession went viral").

**Ablation (`runAblation`):**
- Costs about 2% of the planned run's FLOPs, paid in cloud dollars at the current best rent price, and takes 5 days without blocking the main run.
- Effects for that config signature (stored in `s.flags['ablation.<sig>'] = day`):
  - it reveals the instability estimate
  - it halves the predicted-score uncertainty for 365 days
- Base uncertainty SD = 6 overall points, ×0.6 with `scaling_laws` and ×0.7 with `mup_transfer`.
- `estimateTraining` returns the expected scores plus an `uncertainty` band and an `incidentRisk` (expected number of incidents).

**Persona on instruct-style fine-tunes** (Instruct, Companion, Safe Assistant, Polyglot):

| knob | effect |
|---|---|
| helpfulness | chat +8·h, safety −8·h |
| verbosity | chat +4·v, inferenceMult ×(1 − 0.25·v) |
| sycophancy | chat-product attractiveness +10%·s, reputation drain and sycophancy events |

`persona_vectors` research is needed for the sliders; without it they're fixed at 0.

### 13.3 Research tree v3 (`src/sim/data/research.ts`, owned by the research agent)
About 120 nodes in 11 branches (`ResearchNode.branch`), with:
- specific, real technique names
- an accurate one-line witty description
- `effectText` saying concretely what the node does in the game

**Must keep** these existing ids, because other code references them:
- transformers, scaling_laws, instruction_tuning, rlhf, code_models, long_context
- moe, multimodal, chain_of_thought, reasoning_models, enterprise_ready, constitutional_ai
- distillation, flash_attention, synthetic_data, agents, nuclear_power, interpretability
- agi, tool_use, self_improvement, world_models, million_token, infinite_context
- mixed_precision, data_filtering

Also keep any other id currently in `research.ts`, unless it's replaced and every reference is updated. Grep `src/sim` and `tests`.

**Must add** every gate id named in 13.1 and 13.2:
- architecture and model setup: mamba_hybrid, diffusion_lm, recurrent_depth, tokenizer_100k, multilingual_tokenizer, byte_latent, rope, yarn_scaling
- optimizers and precision: adamw, lion_optimizer, shampoo_soap, muon_optimizer, bf16_training, fp8_training, fp4_training, wsd_schedule
- data filters: minhash_dedup, quality_classifiers, toxicity_filtering, decontamination, pii_scrubbing
- stability and MoE: qk_norm, z_loss, mup_transfer, moe_load_balancing, aux_free_balancing
- infra and kernels: zero_sharding, tensor_parallel, pipeline_parallel, parallelism_3d, cross_dc_training, fused_kernels, flash_attention_3, async_checkpointing, fault_tolerant_training
- interpretability: sae_steering, persona_vectors

**Other nodes, examples by branch:**
- **Architecture:** SwiGLU, RMSNorm, GQA, MLA (multi-head latent attention), sliding-window attention, ALiBi
- **Data:** synthetic textbooks, rejection sampling, curriculum learning
- **Post-training:** DPO, PPO, GRPO, RLAIF, reward-model ensembles
- **Reasoning:** process reward models, test-time compute scaling, self-consistency, RLVR
- **Agents:** function calling, computer use, the parody "Model Context Protocol-ish", long-horizon memory
- **Multimodal:** CLIP-ish contrastive pretraining, ViT encoders, audio tokens, video understanding
- **Inference:** speculative decoding, KV-cache quantization, continuous batching, paged attention, LoRA serving
- **Safety:** red teaming, RSP-ish scaling policy, circuit tracing, model welfare
- **Product:** usage-based pricing, SOC 2 compliance, enterprise SSO, prompt caching, batch API

Passive `bonuses` and `capBonus` techniques stay as before. The `tier` column comes from the depth of the prereq chain. `minYear` follows history (the player may be 1 year early).

Rebalance costs so the whole tree takes roughly 18–20 years for a strong lab. The tree is wider, so per-node costs are lower but the total is higher. The early game must still feel quick: first node in about 9 days, and 4–6 nodes in year 1.


## 14. Data optionality (v3)
The data market is a big strategic layer. There are many ways to get data, and each has trade-offs.

### Static catalogue (`src/sim/data/datasets.ts`)
About 130 unique datasets from 2017 to 2035. Every existing id is kept.

- **Names:** parody names that are clearly recognisable, e.g. "Common Scrawl", "Stack Underflow", "arXiv Firehose", "PubMedley", "Case Law Bulk Download", "EDGAR-ish SEC Filings", "Shadow Library (do not ask)", "Fan Fiction Archive", "YouTube Subtitles (allegedly)", "Lean Proof Corpus", "Chess PGNs", "Speedrun Commentary", "Enterprise Slack Export Partnership", "Reddit API Deal", "News Publisher Coalition Licence".
- **Coverage:** every `DataKind` × several `DataDomain`s.
- **Acquisition:** use all acquisition types, each with its own trade-offs:

| acquisition | cost | quality | legal risk | other |
|---|---|---|---|---|
| open | free | low | none | |
| scrape | cheap | | high | |
| purchase | one-off | | | |
| license | annual fee | high | low | |
| partnership | fee | | | exclusive, contested by rivals |
| crowdsource | | | | through commissions |
| userdata | | | | from your products |
| generate | | | | synthetic |

- **Pacing:** costs and token sizes scale with era. 2017 sets are 1–30B tokens at $0–200k. 2022 sets are 100B–5T at $1–50M. 2030 sets are 10–200T at up to $5B.
- **Freshness:** `freshnessYear` is set on time-sensitive sets (news, web crawls by year).
- **Secret sets:** a few `secret` sets are revealed by events, e.g. a "Leaked Internal Wiki" with huge reputation risk.

### Mechanics (`src/sim/systems/data.ts`)
- **Lookup:** `datasetById(s, id)` and `allDatasets(s)` cover static plus `s.data.custom`. All code must use them.
- **Licences:** `buyDataset` on a license or partnership set charges the first year up front and records `licenses[id] = day`. `dataTick` charges `annualFee/365` daily under the `data` expense category. `cancelLicense` removes the set from owned. Models already trained keep their benefit; you just can't train on it again.
- **Contested deals:** partnership sets with `contestedBy` can be taken by a rival with a small daily chance once they're available. They then go into `lost`, with news ("OpenAye signs exclusive deal with …"). If you hold an exclusive set, the matching rivals get a small knowledge malus (expose a helper for competitors to read).
- **Commission** (`commissionDataset {domain, kind, budget}`): human labelers. Tokens scale with budget and the year's labour cost. It's small but high quality (0.85–0.95), takes 20–60 days, and goes to `pending`, then into `custom` and `owned`. Preference/dialogue commissions help RLHF-type specs.
- **Synthetic** (`generateSynthetic {modelId, tokensB, domain}`):
  - It uses your released model. Cost is inference compute priced in dollars, and it takes `tokensB`-scaled days.
  - quality = clamp(model.overall/100 × 0.95, 0.2, 0.92).
  - **Model collapse:** if the model's overall is below the frontier minus 10, `collapseRisk` is high, and training mostly on it (share > 40% synthetic) lowers the run's quality multiplier.
  - It needs research `synthetic_data`. It gets better with `rejection_sampling` or `synthetic_textbooks` if those ids exist.
- **User data** (`setUserDataOptIn`): while on, a growing `custom` dataset "Your Users' Chats" gains tokens daily, proportional to chat/api users (dialogue/code kinds, quality 0.55). Each day there's a privacy event weight: press, regulators, reputation hit. Turning it off keeps the tokens gathered so far.
- **Events and achievements:** several dataset events (licensing negotiation, scraped site sues, rival steals an exclusive deal, labelers unionise, synthetic collapse discovered, leaked wiki offer). Achievements: own 50 datasets, first exclusive deal, 1 quadrillion tokens, fully synthetic model.


## 15. Online multiplayer (v4): 1v1 over the internet
Two players each run their **own** deterministic sim on their own machine. Each sim represents the other player as a special competitor lab: `Competitor { id: MP_RIVAL_ID ('mp-rival'), human: true }`. That entry is fed by `RivalSnapshot`s received over the network, so the rival's real model, prices, brand and benchmarks compete with yours for the same customers and benchmark crowns. Nothing in the sim is shared except these snapshots and a few messages. Each side computes its own market shares from the same formulas, which keeps the two views roughly symmetric.

### Match setup
The **host** creates a room and gets a 6-letter code (A–Z without I and O). The **guest** joins with that code.

The host picks:
- **Match length:** 5, 10 or 15 years, or endless.
- **Seed:** sent to the guest, so both worlds start with the same AI labs and the same frontier.

Each player picks:
- a **company name**
- a **colour**, out of 6 tokens-safe hexes that are not lab colours

### Sim side (`src/sim/systems/multiplayer.ts`)
**Core functions**
- `startMpState(s, opts)` creates `s.mp` and adds the rival competitor entry. The entry starts active, with model null, brand 10 and zero users.
- `buildSnapshot(s, myColor): RivalSnapshot` builds the snapshot from the player's own state:
  - the best released model, as a CompetitorModel with caps and benchmarks
  - active product prices
  - segment users
- `applyRivalSnapshot(s, snap)` updates `s.mp.rival` and `s.mp.rivalDay`, then mirrors the snapshot into the rival competitor. Model, prices (kinds not offered → `+Infinity`, so market entrants skip them), brand and valuation are copied.
  - **Exclusives:** each id in `snap.exclusives` goes into `s.data.lost`.
  - **Conflict:** if we also own one of those exclusives, the host keeps it. A guest instead loses it: it's removed from owned and the first-year fee is refunded once.
  - **Log lines:** when the rival's model is new (a different name), add a log line and news ("{rival} ships {model} (overall X)"). Do the same when a **benchmark crown** changes hands: compare per-benchmark leaders between you and the rival only, and log "You take the crown on GSM-Hard" or "{rival} takes the crown on …".
- `applyRivalAttack(s, attack)` applies the effect of the rival's attack to *our* state (see attacks below).

**Rival as a competitor**
- AI logic must skip `c.human` competitors: `competitorsTick` does no release and no price reaction, and the capabilities and benchmark refresh loops leave them alone.
- Everything else that lists labs must use `labInfo(s, id) → { name, color, tagline, personality }` from `src/sim/systems/labs.ts`. It returns the static `CompetitorDef`, or for `MP_RIVAL_ID` it builds one from `s.mp.rival` (name, color, personality `'chaos'`, tagline "Another human. Worse: a founder."). Never use `COMPETITORS.find` directly again.
- **Market:** the rival's attractiveness uses the snapshot's brand and hype. Its extra term is `(0.7 + 0.3·rep/100)·0.91`, mirroring the player formula with satisfaction at 70. In enterprise it is also multiplied by `(0.7 + safety/200)`.

**Each day** (`mpTick`, registered after competitorsTick):
- Record history every 7 days.
- If `!s.mp.connected`, do nothing else.
- **Win checks**, in order:
  1. Rival snapshot bankrupt → you win, reason "Rival went bankrupt".
  2. Our own gameOver → rival wins.
  3. Match length reached → the higher valuation wins. A tie within 1% is a draw.
- Once `result` is set, the store pauses. Nothing else ends the match except `mpConcede`, which sets rival as the winner and outboxes chat "{name} concedes."

### Attacks
Each attack costs money, goes on cooldown, and sends `{t:'attack'}` through `s.mp.outbox`. The receiver applies it in `applyRivalAttack`. The effects are deliberately modest.

| kind | cost (scales: × (1 + year−2017)·0.5) | cooldown | effect on the receiver |
|---|---|---|---|
| `poach` | $2M | 120d | Lose 8% of researchers and engineers (at least 1 if any). Morale −6. Halved if the receiver's morale is over 75. |
| `smear` | $1M | 90d | Hype −15, reputation −4. News: "Anonymous blog post claims {you} trains on dolphins." |
| `leak` | $3M | 180d | The current training run loses 10% progress, or if none, research progress −25%. Reputation −2. |
| `undercut` | $0.5M | 60d | For 30 days, rival prices count as 15% cheaper in our market. Store the end day in `s.flags['mpUndercutUntil']`. |

The sender gets a log line ("You poached 3 researchers… allegedly") and the receiver gets a 'bad' notify plus a log line. Attacks are only available once both players are connected and `rival !== null`.

### Network (`src/net/`)
**Transport.** `Transport` is an interface with `send(msg)`, `onMessage`, `onClose` and `close()`. There are three implementations:
- **PeerJS** (default): WebRTC data channel over the public PeerJS cloud broker. The host peer id is `llmllm-<code>`.
- **WebSocket relay**: `server/relay.mjs`, a tiny Node `ws` server where rooms by code forward messages. It's used when the player enters a relay URL under "Advanced" in the lobby.
- **Loopback**: for tests.

**Protocol messages** (JSON):
- `hello` carries name, color and version.
- `welcome` is host → guest and carries seed, settings, host name and host color.
- `snap` carries a RivalSnapshot.
- `day` carries day and speed.
- `attack` and `chat` mirror MpOutgoing.
- `ping` / `pong` measure latency.
- `bye` signals leaving.

**Lockstep pacing.**
- Each client sends `day` after every tick and `snap` every 3 days, on any release and on product changes.
- A client may tick only while `s.day < rivalDay + 2`. If it's ahead, it waits, and the UI shows "Waiting for {rival}…".
- **Speed:** each player picks their own speed. The effective speed is the minimum of both, and either player pausing pauses both.
- When one sim is blocked by an event modal, the other naturally waits at most 2 days.

**Disconnects.**
- `connected` becomes false, both sims pause, and an overlay offers to wait or reconnect.
- Rejoining with the same code resumes play: the host keeps its peer id.
- MP games save under the key `llm-lets-loose-money/mp-save`, never over the single-player save.

### UI
- **Lobby:** a "Multiplayer" entry in the top-bar menu opens the lobby. It has two tabs:
  - **Host:** company name, colour, match length, and a big room code with a copy button.
  - **Join:** company name, colour and code.
  - Status lines read "Waiting for opponent…" and "Connected · 42 ms".
- **VS panel** (function code `VS`, nav item visible only in MP), which contains:
  - a head-to-head table: valuation, revenue/day, users per segment, best model, Arena elo, crowns held and cash
  - a valuation chart with both lines (you in `--blue`, the rival in their colour)
  - a benchmark crowns table: per benchmark, your score vs theirs and who leads
  - market share per segment, you vs the rival
  - the attack buttons with cost, cooldown and a tooltip
  - the log/chat feed with an input
  - a time-left readout, and a Concede button behind a confirm
- **Overlays:**
  - "Waiting for {rival}" as a thin bar under the top bar, not a modal
  - "Rival disconnected" as a modal with Wait / Leave
  - match result as a modal with the winner, reason and final stats, plus "Back to menu"
- **Elsewhere:** the rival appears in the Market panel, Arena and Benchmarks with their colour, tagged `[human]`.


## 16. Fog of training (v5): you never know exactly how it turns out
Before v5, the run sheet showed the exact result and the final roll was a small nudge, so training was a calculator. v5 makes it an experiment. The player sees a **forecast band** built only from what the lab *knows*. The real outcome depends on hidden truths the player discovers by experimenting. Knowledge is the progression: as you learn, forecasts get tighter and better.

Design goals:
- Same *expected* power curve as before. The bot pacing targets in §11 still hold, and an informed player does about as well as before.
- Much more variance and surprise.
- Every unknown can be reduced by a player action (sweeps, audits, checkpoints, red-teaming, experience), so luck rewards preparation.

### 16.1 Hidden truths (rolled and stored, never shown)
All of these are stored in state (`GameState.lab` hidden fields, `TrainingRun.hidden`), so saves are deterministic.

1. **Learning-rate optimum.** Quality from LR is a peaked curve, not monotonic:
   - `lrQuality = LR_PEAK − LR_CURVE·(lr − lrOpt)²`, clamped to [0.80, 1.08]. With LR_PEAK = 1.08 and LR_CURVE = 1.6, being off by 0.25 costs about 10%.
   - The optimum is `lrOpt = clamp(ARCH_LR_BASE[arch] − 0.06·log10(activeParamsB) + lab.lrOffsets[arch], 0.1, 0.9)`.
   - `ARCH_LR_BASE` is about 0.55, but each arch has its own base: MoE is slightly lower, SSM-hybrid higher, diffusion odd.
   - `lab.lrOffsets[arch]` is rolled once per game, `N(0, 0.12)`.
   - So the right LR depends on the architecture AND shrinks as models grow.
   - **mup_transfer**: the optimum stops drifting with scale (no log10 term), so small sweeps transfer exactly.
   - LR still adds instability the way it did before (high LR is risky).
2. **True dataset quality.**
   - `trueQuality = clamp(claimed + offset, 0.05, 0.98)`. The offset is a deterministic hash of (seed, dataset id) mapped to N(0, sd).
   - sd depends on acquisition: scrape 0.12, crowdsource 0.08, open 0.07, purchase 0.05, license 0.03, partnership 0.03, generate (synthetic custom) 0.06, userdata 0.10. Commissioned sets 0.02.
   - The real mix uses true quality; the forecast uses claimed quality until the set is **verified**. Verification happens by finishing a run that used it, or by `auditDataset`: cost 2% of its price (min $20k), 10 days.
   - On verification, notify with flavour: "Audit of Common Scrawl: 38% SEO spam. True quality 0.41, not 0.55." or "…turns out to be a gem (+0.09)".
3. **Seed luck** for each pre-training run: `seedLuck ~ N(0, 2.5)` overall points.
   - 4% of runs are **golden** (+6 ± 1.5) and 4% are **cursed** (−8 ± 2). Tags are revealed at eval day.
   - Researchers do not change luck; this is pure variance. It's capped so a cursed run is never worse than −14.
4. **Emergent abilities** (`src/sim/data/emergences.ts`, about 20 defs).
   - Each has a threshold in log10 effective compute, `log10(6·N_eff·D_eff·1e18·dataQuality)`. Calibrate it so the first ones appear around 2017–2018 scale, with a few late ones around 2026+ scale.
   - Thresholds get per-game jitter from `lab.emergenceJitter`.
   - Crossing the threshold gives a `chance` roll, made once per run. Requirements (research, data-kind share) must also hold.
   - The emergence adds `capAdd`, and sometimes a quirk.
   - Some are mixed or bad, e.g. "Situational awareness (it knows it's being tested)" lowers benchmark trust or adds a quirk.
   - **Undiscovered emergences are excluded from forecasts.** Once discovered (`lab.discoveries`), forecasts include an emergence whenever the run is past its known threshold, at its chance.
5. **Arena vibes**: a hidden Elo offset `N(0, 35)` per model, rolled at finish. Fine-tunes inherit the parent's vibes ×0.5 + N(0, 20).
6. **Latent quirks**: each rolled quirk has a 40% chance to be latent: it's not shown at eval day and is stored in `model.latentQuirks`.

### 16.2 The forecast (`forecastTraining`, `forecastFinetune` in systems/lab.ts)
**mid** = the old estimate pipeline computed with *believed* inputs:
- claimed quality for unverified datasets
- LR quality from the lab's sweep knowledge: for that arch, interpolate the sweep points nearest in scale. With no sweep points, assume a flat 1.0 (the lab doesn't know it's off).
- discovered emergences only
- no seed luck

**Band SD** (overall points) = `BASE 3.0 × product of factors`:

| factor | value |
|---|---|
| scale novelty | `1 + 0.35·max(0, log10(totalFlops / lab.largestFlops))` (first run counts as 10× novelty) |
| arch inexperience | `runsByArch[arch]`: 0 → 1.5, 1 → 1.25, 2–3 → 1.1, else 1.0 |
| unverified data | `1 + 0.6·(share of tokens from unverified sets)` |
| no sweep near this arch and scale (within ±0.5 log10) | 1.3 |
| scaling_laws | ×0.8 |
| mup_transfer | ×0.85 |
| track record | ×clamp(0.7 + mean(lab.forecastErrors)/10, 0.7, 1.3) |

- The band is mid ± 1.28·SD (about 80%). Reality *can* land outside it: unknown unknowns, seed luck and data surprises.
- **Confidence label** by SD: < 2 tight, < 3.5 decent, < 6 rough, otherwise wild guess.
- **reasons[]** lists the top 2–3 widening factors in plain words: "Extrapolating 12× beyond your largest run.", "First MoE run.", "40% of tokens come from unaudited data.", "No learning-rate sweep for this architecture at this size."

**Fine-tunes**: mid = parent + spec effect at specTake 1. Base SD 2.0, plus +1 if the parent's family has never had this spec. Hidden `specTake ~ clamp(N(1, 0.22), 0.4, 1.6)`, a multiplier on the spec's capBonus. There's also a hidden "forgetting" roll: a 15% chance to lose 2–5 points on one random non-target capability ("catastrophic forgetting: it forgot French").

### 16.3 During the run
- **True path**: at launch, compute `hidden.trueOverall` with the true inputs: true LR quality, true data quality, seed luck, and emergences rolled now. Store the believed forecast on the run. Incidents that change qualityMult/capAdd must recompute `trueOverall`.
- **Loss curve**:
  - The live loss uses the *true* final loss.
  - Also store `forecast` loss, so the UI can draw the dashed "scaling-law prediction" line next to the real line.
  - A better-than-expected run visibly beats the line.
  - Grokking flavour: 5% of runs plateau between 30–55% progress and then drop.
- **Checkpoints** at 25 / 50 / 75%: `reading = trueOverall + N(0, band)`, where band is 5 / 3 / 1.5 (×0.8 with scaling_laws). Notify each one ("Checkpoint 2 evals: tracking 47 ± 3"), plus a note when the reading is outside the forecast ("well above forecast", "below forecast. Something in the data?").
- **Emergence detection**: when a rolled emergence's threshold is crossed during the run (at the progress where cumulative compute crosses it), log and notify a discovery moment: "At 63%: the model started doing arithmetic. Nobody taught it that." Record it in `run.emerged`. It becomes a discovery at finish.
- **Early stop** keeps working. The model gets the partial true quality. Forecasts still apply.

### 16.4 Eval day
On finish:
1. Create the model with the true result.
2. Verify the datasets it used and record their surprises.
3. Update `lab`: `runsByArch`, `largestFlops`, discoveries, and push `|actual − forecast.mid|` into `forecastErrors` (keep the last 20).
4. Set `s.pendingReveal: EvalReveal`. `isBlocked` is true until the `dismissReveal` action.

**Verdict**, from `d = actual − mid` and band half-width `w`:

| verdict | rule |
|---|---|
| cursed | seedTag cursed and d < −w |
| banger | d > 1.5w |
| solid | d > 0.5w |
| as expected | \|d\| ≤ 0.5w |
| mid | d < −0.5w |
| dud | d < −1.5w |

News flavour per verdict is in `src/sim/data/evalCopy.ts`.

### 16.5 After release
- **Provisional arena**: on release, `eloSettlesDay = day + 21`. The displayed Elo is `elo + vibes·p + noise·(1 − p)`, where p ramps 0→1 over the window. Use `provisionalElo(s, m)`; the arena and market use the true Elo.
- **Latent quirks surface**: each day after release, each latent quirk has a 2% chance to be discovered by users. That makes news and a notify.
  - A bad quirk costs reputation −3 and hype ±.
  - A good quirk gives hype +5 (it goes viral).
  - The quirk then moves into `quirks`.
- **Red-teaming** (`redTeamModel`) costs `max($50k, 0.5% of the model's training-cloud-equivalent)` and takes 14 days, minus 30% with safety researchers. It reveals all latent quirks privately, with no reputation hit. Do it before release.

### 16.6 Lab notebook
`GameState.lab` holds the player-facing record:
- runs per arch
- largest run
- sweep points
- discoveries
- verified datasets
- forecast accuracy (mean absolute error of the last 20 runs)

The UI shows discoveries, plus "N undiscovered" as `???` rows with no hints beyond "somewhere past 10^23 FLOP" once any neighbouring emergence is known.

### 16.7 Sweeps (`runLrSweep`)
- Proxy runs at 1/200 the compute of the planned run, each at one of 2–6 learning rates.
- Cost: `0.5% × totalFlops × cheapest cloud $/FLOP` per LR, min $10k each. Takes `ABLATION_DAYS` days.
- Results land in `lab.sweeps[arch]` as `{lr, scale, reading}` with `reading = lrQuality(true) + N(0, 0.015)` (×0.5 noise with scaling_laws).
- The existing `runAblation` stays: it reveals instability and risk.


## 17. The vault: unreleased models, names, and what you can do with a model (v6)
Unreleased models are a playground of decisions, not a waiting room. Contract: `src/sim/types.ts`, search "v6".

### 17.1 Codenames and public names
- **Codenames.** A run's name is its **codename**. The wizard suggests fun codenames via `suggestCodename`: fruits, Greek letters, "Project …", internal jokes.
- **Release renames.** At release, `releaseModel {publicName}` renames it. The model keeps `codename`, and the UI shows "Strawberry → Loosey 2 Pro".
- **Naming schemes.** The player picks one in `company.namingScheme`, from the `NAMING_SCHEMES` in `src/sim/data/names.ts`. Each scheme produces public names that fit the model: version from release count, size or tier from its params relative to the player's other models, and a reasoning or coder suffix from its spec. Examples:
  - **Versioned** (Loosey 1, 2, 2.5, 3; + "mini"/"Pro")
  - **Tiered poetry** (Haiku/Sonnet/Epic sized by params)
  - **Big-number** (Loosey-70B-Instruct)
  - **Mythic** (Hermes, Atlas, Prometheus by size)
  - **Weather** (Drizzle, Squall, Monsoon)
  - **Marketing** (Loosey Turbo Max Ultra 2)
  - **Animals** (Lemur, Lynx, Leviathan)
- **Rival labs** name releases with their **own house scheme**, defined in `src/sim/data/competitors.ts`: `naming: { sequence: string[], reasoning?: string[], coder?: string[], after: (k) => string }`.
  - The sequence is era-ordered and walked in order; after it runs out, `after` continues it (e.g. "GPTee-7").
  - Releases whose capability profile is strongly reasoning- or coding-heavy (the top cap beats the mean by 8 or more) pull the next name from `reasoning` / `coder`.

  | lab | house style |
  |---|---|
  | OpenAye | GPTee-1 … 3.5, 4, 4o, o-series reasoning, 4.5, 5 |
  | Anthropomorphic | Clawed 1, 2, Instant; then poetic tiers Limerick/Sonnet/Epic with versions |
  | DeepMined | AlphaSomething research names early, then Meenie, LaMDAish, PaLMistry; then the Gemineye family 1.0 Ultra, 1.5 Pro, 2.0 Flash, 2.5 Pro… |
  | Metaverse Llama | Llamaish 1/2/3/3.1/4 with param counts (70B, 405B), Code Llamaish, Alpacalypse |
  | Mistrial | Mistrial 7B, Mixtrial 8x7B, 8x22B, Mistrial Large, Codestrial, Magistrial |
  | DeepSeekers | DeepSeekers-Coder, V2, V2.5, V3, R1, V3.1, R2, V4 |

### 17.2 Benching unreleased models (`src/sim/systems/vault.ts`)
- **Eval day runs only a standard suite.** That's the 4 most relevant *active* benchmarks of the era (`benchSuiteFor`, roughly the newest non-saturated ones across categories). They are stored in `benchRuns` and listed in the EvalReveal. Every other benchmark is **unmeasured** for an unreleased model.
- **Released models** have all benchmarks public, as before. After release, the UI shows `model.benchmarks`.
- **`runBenchmarks {benchIds}`**:
  - cost per benchmark = `max($5k, 0.002 × activeParamsB × $1k × (1 + 0.15·(year − 2017)))` per benchmark
  - takes `2 + n` days
  - results land as the true score + N(0, 0.8)
  - several jobs can run in parallel
- **Measured SOTA.** A measured benchmark where the model beats every public score is flagged "SOTA (unannounced)" by the UI via `knownBenchmarks` + `bestPublic`.

### 17.3 Internal arena
- `internalArena` costs `$40k × (1 + 0.2·(year − 2017))` and takes 10 days.
- It measures Elo = elo + N(0, 12), band 12, so it reveals the vibes before release.
- `provisionalElo` uses it pre-release, and as the starting point after release.
- 6% chance the screenshots leak: hype +4, plus news. It doesn't count as a weights leak.

### 17.4 Teasers
`teaseModel {level}` is allowed once per model while unreleased.

| level | effect | expected |
|---|---|---|
| vague | hype +6 | your current best overall + 3 |
| benchmarks | hype +12 | needs ≥ 2 measured benchmarks; = this model's overall |
| hype | hype +20, aiHype +2 | overall + 8 (overpromising) |

At release, compare overall to expected:
- ≥ expected: hype +5 ("as promised"). Beating the expectation by 5 or more also gives brand +3.
- Below expected: backlash scaled by the gap. Reputation −min(10, gap), hype −min(25, 2·gap), plus news.
- A contaminated model teased with benchmarks adds +10 to the scandal weight via `s.flags['teasedContaminated']`.

### 17.5 Leaks
- Each day, an unreleased model whose overall ≥ frontier − 5 can leak. The chance is `0.0006 × (1 + headcount/200) / bonuses.safety`, ×0.5 when deployed internally only.
- A leak sets `leakedDay`, notifies, and makes news ("Weights for {codename} appear on a torrent site").
- Effects: hype +8 (people are curious), reputation −4, `s.flags['leakBoost']` += 3 (rivals catch up: the lead wires this into competitor releases), and the model's later release gets ×0.6 hype.

### 17.6 Playground (`src/sim/data/playground.ts`)
- **Content.** A library of about 36 prompts in categories: math, code, trivia, reasoning, creative, multilingual, safety (jailbreak attempts), long context, agentic, chat.
- **Responses.** `playgroundResponse(model, promptId, variant)` returns a satirical response.
  - The tier comes from the prompt's capability: awful < 30 ≤ meh < 55 ≤ good < 80 ≤ great.
  - Text is reshaped by **visible** quirks (e.g. "delve" inserted, Golden Gate tangents) and persona (verbose answers ramble, sycophantic ones open with "What a brilliant question!").
  - Latent quirks are never shown in text unless the poke reveals them.
- **`pokeModel`.** The sim side tracks pokes per day: the first 10 pokes a day each have an 8% chance to **expose one latent quirk** (moved into `quirks`, notify "You noticed something while testing: …"). Pokes are free.

### 17.7 Release modes and internal use (`src/sim/systems/release.ts`)
- **full**: as today. Teaser resolution applies, and so does the leaked-model hype ×0.6.
- **preview**: limited preview for 30 days (`previewUntil`).
  - Products can use it, but each product it's assigned to is capped at 15% of its demand.
  - Latent quirks surface ×5 faster.
  - Hype is half the full-release gain.
  - `promotePreview` → full release: the remaining hype, and the Elo settles.
  - When the preview ends without promotion, it auto-promotes.
- **open** (open weights):
  - brand +8, reputation +6, hype as full
  - every product serving it gets −25% users (self-hosting) for good; the market reads `releaseMode === 'open'`
  - `s.flags['openBoost']` += 2 (rivals learn; the lead wires it)
  - can't be undone
- **deployInternally {on}**: an unreleased model becomes an internal tool. Research points/day × `(1 + 0.25 × clamp((overall − frontier + 10)/20, 0, 1.2))`, using only the best internal model. It costs inference: daily compute expense = `activeParamsB × $40` per day. It can be on while unreleased; release keeps it on.

### 17.8 Distillation and merges (`src/sim/systems/derive.ts`)
**Distill**: `startDistill {teacherId, paramsB}` with student params at most 50% of the teacher's (active params).
- It's a training run (kind 'distill') using the training slot.
- Compute = `6 × student params × min(teacher tokens, 20×student params) × 0.3`.
- Student overall ≈ `teacher.overall − 14·log10(teacherActive/studentActive)^1.1 + N(0, 2.5)`, never above the teacher − 1.
- It inherits the teacher's caps shape, 60% of visible quirks (latent ones too), and vibes ×0.7.
- The forecast band has SD 2.5, no checkpoints, and gets an eval day.

**Merge**: `startMerge {aId, bId, method}`. Both models must have the same architecture and the same base lineage root.
- `frankenmerge` ignores both rules and has extreme variance.
- It takes 3 days, costs $25k, and uses the training slot.

| method | expected overall | SD | cursed | caps | quirks |
|---|---|---|---|---|---|
| average | mean + 1 | 2 | — | mean of both | union |
| ties | max − 0.5 | 2.5 | — | element-wise max − 2 | union |
| frankenmerge | mean | 6 | 15% (−10) | random per cap from A or B | union, +1 random |

Every derived model gets an eval day reveal (kind shown as "Distill results" / "Merge results"), the fog verdict rules, `derivedFrom`, and a codename.

### 17.9 Tests
Each sim system gets tests:
- suite-only benchmarks at eval day, and runBenchmarks revealing more
- arena reveal
- teaser backlash and payoff
- leak effects
- poke reveal rate
- preview cap and auto-promote
- open-weights user penalty
- internal research boost
- the distill quality curve
- the merge methods' means and variances
- naming: each rival's sequence, and the player's schemes producing fitting names


## 18. Slower, harder, more fun (v7)
Player feedback:
- "slow down the game, make it more fun, slower, competition more difficult"
- QoL "like research queues"
- "make the aha moment higher and the feel of competition"

### 18.1 Competition (systems/competitors.ts, market.ts, data/competitors.ts, data/rivalry.ts)
**Stronger labs**
- **Early frontier.** Rivals are no longer pushovers in 2017–2019. A competent player should be roughly at the frontier to +5 in 2017–2019, not +25.
- **Catch-up.** It starts in **2018** (was 2021), ramps fully by **2020**, closes 90% of the gap, and uses margin 0.
- **Counter-punch.** When the player takes Arena #1, the 1–2 labs within 10 Elo of the top pull their next release forward to 25–60 days.
  - That release targets ≥ the player's overall + N(1.5, 2).
  - News is personality-flavoured ("OpenAye moves up its launch. Sources say the CEO saw your benchmark tweet.").
- **Segment targeting.** Each lab has home segments by personality (hype → consumer, safety → enterprise, open/price → developer).
  - In a home segment where the player leads in share, it adds brand +0.02/day and, for price labs, price pressure.
- **Rival poaching.** A monthly roll per active lab, weighted by its brand and the player's morale. It can poach 1–3 of the player's researchers or a star, unless morale > 80 or salary level ≥ 1.2 (staff.ts read-only helpers; apply with the existing role counts).
  - Notify, news, and a log line on the rival.
- **Exclusive data and openness.** Wire `s.flags.leakBoost` and `s.flags.openBoost` (set by the vault and release systems): each point adds +1 to every rival release quality for 180 days, then decays.
- **Price wars.** All 'price' labs react (not only on 30% undercuts). They follow the player's price down to 80% of their base within 60 days whenever the player has the top share in a segment.

**Feel of competition: rivalry state per lab** (`s.flags` or a new optional `Competitor.rivalry?: number` 0..100)
- Rivalry rises when you beat them, take their crowns or share, poach, or undercut.
- High rivalry → more aggressive (shorter release cycle −20%, more poaching, CEO trash-talk news).
- Content in `src/sim/data/rivalry.ts`:
  - per-lab CEO quote pools by rivalry tier, 4 tiers × 4 lines × 6 labs, in the lab's voice, parody only
  - reaction headlines (your release beats them, they beat you back, price cut, poach)
- **Weekly standings.** Every 7 days, if the Arena order changed involving the player, notify "{lab} passes you on the Arena (#2 → #3)" or "You pass {lab}".

### 18.2 Pace
**Real time**
- Speed `1×` = **0.5 day/s** (was 1). The settings stay labelled 1× / 3× / 10×, but map to 0.5 / 1.5 / 5 days per second.
- The store's per-frame tick cap stays at 5.

**Game time**
- Research costs ×1.7 overall. The late tree gets steeper: tier multiplier `1 + 0.08·tier`.
- Funding and economy: first profitability around 2020–2021, IPO around 2022–2025, $1T around 2032–2036.
- Idle play is still bankrupt in 2–3 years.
- Keep the bot as the yardstick (scripts/balance.ts). Tune via BALANCE constants, TAM/adoption curves, research costs and rival strength, not by special-casing the bot.

#### v1.0 tuning (final balance pass)
Scripted bots, `npx tsx scripts/balance.ts --all --years=20 --seeds=1,2,3,4,5,6`. The numbers below are medians across seeds. Every constant is in a named, exported tuning object.

**No saturation.**
- *Soft ceiling on overall.* `overallScore` = `softCeiling(0.3·reasoning + 0.25·coding + 0.3·chat + 0.15·safety)`, where `softCeiling(x) = 85 + 15·tanh((x−85)/15)` above 85 (`CAP_TUNING.OVERALL_KNEE/OVERALL_MAX`, `systems/capabilities.ts`). Raw 100 reads 96.4 and 100 is never reached. Rival releases build their base in overall units and invert the curve (`softCeilingInverse`, `systems/competitors.ts`), so the frontier table keeps its meaning. Caps stay hard-clamped at 100 for the capability bars.
- *Dataset bonuses stack like techniques* (`DATASET_STACK`: weights 1, 0.5, 0.3, 0.2, 0.1, then 0.02). Before this, a 50-dataset mix added every bonus in full and the frontier bot passed 95 in 2021.
- *Emergence capAdd ×0.5* (`LAB_TUNING.EMERGENCE_CAP_SCALE`). *Specialisation capAdd ×0.6* (`CAP_TUNING.SPEC_CAP_SCALE`). Each fine-tune used to add 3–4 overall points on top of the last.
- *Research costs.* `researchCost(node)` = base × 1.7 × (1 + 0.08 × tier) (`systems/research.ts`, `RESEARCH_COST_TUNING`). The sim, the bot and the research panel and queue all read this one function.
- *Rival frontier table* (`market.ts FRONTIER_POINTS`): 2021 86 (unchanged), 2022 89, 2023 91, 2024 92.5, 2025 93.5, 2026 94.2, 2028 95.4, 2030 96.5, then 99 − 2.5·e^(−(y−2030)/8). 2017–2020 are unchanged, so the early-gap check holds.

**Pacing (frontier).**
- First profitability 2020.0 (60-day streak). IPO 2022.7. $1T 2032.0.
- The IPO needs $1.5B annual revenue (`BALANCE.IPO_MIN_ANNUAL_REVENUE`, was $300M). The $300M gate put the IPO in 2020, before the business was real.
- *Valuation multiple:* `(4 + aiHype/8) × frontierPremium`, where `frontierPremium = clamp((best overall / frontierQuality)^4, 0.4, 1.2)` (`VALUATION_TUNING`, `systems/finance.ts`). A lab well behind the frontier gets a smaller revenue multiple, whatever its volume. The old multiple was 8 + hype/5.

**Market tiers** (`TIER_TUNING`).
- Premium: price^0.4 (was 0.6), so premium buyers mostly buy quality.
- Budget: quality term `min(1.2, (q/(frontier−20))^1.2)`, price^1.8 (was 2.4), so quality counts again.
- Rival budget-line price multipliers: nano 0.3, small 0.5, medium 0.7 (were 0.25 / 0.4 / 0.6).
- Consumer price: $20 to 2026, then $12 by 2030 (commoditised chat). Consumer adoption ceiling: 0.3 in 2030, 0.4 in 2040 (was 0.4 / 0.5).
- Developer reference price: $6 in 2026, $2.5 in 2030 (was $1 in 2030). See serving economics below.

**Serving economics.** Rented frontier-size serving (GPU pflops and rent from `data/gpus.ts`, `BASE_INFERENCE_EFFICIENCY` 0.35) costs about $6–10 per Mtok in 2021–24, against a developer reference price of $7–14 then. The margin is thin in those years and negative after about 2025. An owned fleet, with the GPU amortised over three years at 60% utilisation, costs about $2 per Mtok, which gives healthy margins in API and chat. The sim keeps this gap on purpose: labs that rent pay for it.

**Contracts** (`CONTRACT_PAY_TUNING`, `systems/contracts.ts`).
- Late pay ×150 (`LATE_SCALE`). Verticals and grants (the specialist's deals) pay ×0.35 of that (`SPECIALIST_PAY_MULT`).
- The brand term in fit is capped at 10 points (`CONTRACT_TUNING.BRAND_TERM_CAP`), so a famous flagship cannot buy every deal.

**Bot.** `scripts/bot.ts` computeStep: when a lab has less than a year of cash at its net burn, it stops adding rent on cash and hands back its most expensive rentals. Before this, a bot kept renting until its cash ran out. Labs with runway keep training, as before.

**Result** (`--all --years=20 --seeds=1,2,3,4,5,6`, medians):
- Frontier: profitable 2019.9, IPO 2022.8, $1T 2032.2, peak valuation $9.0T.
- Small: profitable 2018.9, IPO 2022.8, peak $12.1T, contracts 4.7% of revenue.
- Specialist: profitable 2018.8, IPO 2021.6, peak $12.7T, contracts 2.0%.
- Open: profitable 2020.6, IPO 2024.7, peak $7.6T.
- Idle: bankrupt in 2.4 years. Bot strategies: 0 of 24 bankrupt. Best overall ends at 93–95 (never 100).

Still open after this pass:
- Frontier first profitability is 2019.9, a hair before the 2020–2021 band.
- The "best overall not before 2027" check passes on the median. Per seed, 2 of 6 frontier runs reach 95 by 2024, and 3 of 6 open runs by 2025.
- Peak valuation does not order the playstyles as designed. Specialist and small peak above frontier, because they sell more volume at lower prices, and the revenue multiple follows revenue.
- Contract shares meet the 15–30% (small) and 5–10% (specialist) targets at 16 years but not at 20. Late pay is flat after 2026, so the share falls as the economy grows.
- Serving margins are checked on paper only (see above). The harness has no per-kind margin metric.

### 18.3 Aha moments (systems/moments.ts + shell/MomentTakeover.tsx)
- Big, rare, earned beats get a full-window takeover card: a bold title, a one-line satirical subtitle, 3–4 stats that made it happen, and "Continue". It pauses the sim (`s.pendingMoment`, part of isBlocked).
- The beats:
  1. **First model trained** ("It talks.")
  2. **First product launch**
  3. **First time Arena #1** ("Number one. For now.")
  4. **ChatMoment**, when the world's first chatbot launches; it's bigger if it's yours
  5. **First $1M/yr ARR**
  6. **First unannounced SOTA confirmed public at release**
  7. **First time beating a specific rival's flagship**: once per lab ("GPTee-4o is no longer the one to beat.")
  8. **IPO**
  9. **$1T valuation**
  10. **Losing #1 after holding it ≥ 90 days**, a negative moment ("The throne was rented.")
- Each fires once, except lab-specific ones (once per lab), stored in `s.flags['moment.<id>']`.
- Moments also push a burst of 3 news headlines and hype +3 to +10 by importance.

### 18.4 QoL
- **Research queue.** `s.research.queue?: Id[]`. When current finishes, start the first queued node whose prereqs are met.
  - `queueResearch {nodeId}` auto-adds missing prerequisites in a valid order (a "research towards X" path).
  - `unqueueResearch {nodeId}`, `reorderResearch {nodeId, toIndex}`.
- **Training queue.** `s.trainingQueue?: QueuedRun[]`. A queued startTraining or startFinetune payload starts automatically when the slot frees and the costs are affordable; otherwise it waits and notifies once.
- **Auto-pause** (UI store setting, persisted in localStorage `llm-lets-loose-money/autopause`), toggled per trigger:
  - training finished (eval day already pauses)
  - research complete with an empty queue
  - funding offer
  - rival beats your best model
  - cash runway < 60 days
  - product outage
- **Notification log.** Every notify is kept in `s.noticeLog` (cap 300, with day, kind and text). A log drawer is reachable from the top bar, with a filter by kind and search.
- **Product auto-upgrade.** Per-product `autoUpgrade?: boolean`: when a better released model of the same lineage family, or any better model, is released, switch to it automatically, with a notify.
- **Models table "Release"** opens the Release wizard instead of releasing instantly.


## 19. Playstyles: many ways to win (v8)
Player feedback: "make different playstyles more possible, e.g. a small lab focusing on small models can also get profitable and win specific benchmarks".

Today one strategy wins: train the biggest model you can afford and sell it to everyone. Two reasons:
- Attractiveness is dominated by quality^2.2.
- There is only one leaderboard.

v8 adds markets, crowns and income that don't need the frontier. Contract: `src/sim/types.ts`, search "v8".

### Design goals
The acceptance test is checked by the `scripts/balance.ts` strategy bots in the pacing pass.
- **frontier bot** (today's bot): still the highest valuation ceiling, the highest risk, and the biggest cash burn.
- **small bot**:
  - Never trains above the "small" weight class. Sells cheap lite API/chat products and on-device contracts.
  - Profitable by about 2021–2022.
  - Holds at least one small or nano class crown most years from 2022.
  - Lower valuation.
- **specialist bot**: a medium-size base, domain fine-tunes and bench tuning. Wins specific benchmark crowns and vertical contracts. Profitable by about 2021–2022.
- No strategy dominates every column, and idle play still goes bankrupt.

### 19.1 Lab doctrine (`src/sim/data/doctrines.ts`, applied in `src/sim/bonuses.ts`)
- **Choosing.** `company.doctrine` is picked once, early: a modal after the tutorial, or later from Headquarters. Undefined means neutral: no perks, no drawbacks.
- **Changing.** Allowed after 365 days (`doctrineSince`). It costs hype −10 and morale −5.
- **Effect.** Perks are Bonuses multipliers (the v8 fields default to 1) plus a few named hooks.

| id | name | perks | drawbacks |
|---|---|---|---|
| frontier | Scale is all you need | releaseHype 1.3, valuation 1.15 | budgetAppeal 0.9 |
| efficient | Small and mighty | inferenceEfficiency 1.4, budgetAppeal 1.25, trainingSpeed 1.1, crownValue 1.2 | releaseHype 0.85, valuation 0.95 |
| open | Weights want to be free | openPenalty 0.4; open releases give brand x1.5 and research points (2 days of RP per open release); contractFit 1.1 on on-prem deals | valuation 0.9 |
| specialist | Do one thing well | finetuneCost 0.6 (fine-tunes, distills and bench tunes); crownValue 1.5; contractFit 1.15 on vertical and grant deals | releaseHype 0.9 |
| enterprise | Boring is beautiful | sales 1.2, safety 1.3, contractFit 1.2 on government and on-prem deals | releaseHype 0.8, budgetAppeal 0.95 |

Where each multiplier is applied:

| bonus | hook |
|---|---|
| releaseHype | release.ts: hype and brand gains |
| finetuneCost | training.ts startFinetune, derive.ts distill, classes.ts benchTune |
| valuation | finance.ts |
| openPenalty | the open-weights user multiplier: 1 − 0.25 × openPenalty |
| contractFit | contracts.ts |
| budgetAppeal, crownValue | market.ts, classes.ts |

### 19.2 Weight classes, class crowns, rival lines, bench tuning (`src/sim/systems/classes.ts`)
**Classes** are set by ACTIVE params relative to `frontierActiveParamsB(year)`:
- nano ≤ 1/40 of the frontier size
- small ≤ 1/8
- medium ≤ 1/3
- open = any size

The `frontierActiveParamsB` table lives in classes.ts, calibrated to the sizes the bot and rivals actually train. A model competes in its own class and in every larger one.

**Rival lines.** Labs ship small and medium lines next to their flagship. They are stored in `s.classes.rivalLines`, keyed `labId:class`.
- **Who ships them:**
  - Metaverse Llama, Mistrial and DeepSeekers: small and medium from founding.
  - OpenAye "-mini", DeepMined "Flash"/"Nano" and the Anthropomorphic small tier: from 2023–2024.
- **Quality.** Line overall = flagship overall − classGap(class, year). The gap shrinks as distillation matures:

  | class | 2019 | 2026 | 2032 |
  |---|---|---|---|
  | nano | 24 | 13 | 9 |
  | small | 15 | 7 | 4 |
  | medium | 7 | 3 | 2 |

  Open and price labs get 2 less gap.
- **Names** follow each lab's house style: Llamaish 3 8B, GPTee-4o-mini, Mistrial 7B, Gemineye 1.5 Flash.
- **Caps and benchmarks.** Caps are the flagship's shape shifted down. Benchmarks go through the same competitor evaluation.
- **Refresh** when the flagship changes and every ~180 days. `human` competitors get no lines.

**Efficiency benchmarks** go in data/benchmarks.ts with a new optional `efficiency` field:

| benchmark | year |
|---|---|
| EdgeBench | 2019 |
| TokensPerWatt | 2021 |
| MobileMMLU | 2023 |
| LatencyArena | 2024 |
| PocketAgent | 2026 |

Result × clamp((nanoThreshold / active)^efficiency, 0.35, 1.15). Giants score poorly and small models can win outright.

**Class crowns** (`s.classes.crowns`):
- For every non-saturated benchmark × class, the crown is the #1 released model.
- Crown changes make news.
- A new player crown gives brand +1 and hype +1.5 × crownValue, once per benchmark × class.
- Export `playerCrownCounts(s)` by category for the market: coding/agentic, reasoning/math/knowledge, chat/multilingual, safety, efficiency.

**Class arena.** `classArena(s, cls)` is an Elo leaderboard within a class: player released models, rival flagships and lines.

**Bench tuning** (`benchTune {modelId, benchId}`):
- Works on an UNRELEASED model. It doesn't use the training slot and takes 12 days.
- Cost = $30k × (1 + 0.15·(year − 2017)) × max(1, activeParamsB/10)^0.5 × finetuneCost.
- Effect:
  - Caps weighted by that benchmark get +N(6, 2.5) × (weight / max weight). All other caps get −1.
  - Overall is recomputed, and that benchmark is re-measured into benchRuns.
- A second tune on the same benchmark gives ×0.5, a third ×0.25.
- Each tune has a 10% chance of adding the latent quirk "benchmark-shaped" (Elo −10 when found). This is not contamination.

### 19.3 Buyer tiers and product lines (market.ts, products.ts)
**Buyer tiers.** Each segment's adopters split into premium, mainstream and budget tiers. The weights drift from 0.30/0.50/0.20 in 2017 to 0.20/0.45/0.35 in 2030.
- **premium** wants the best: quality^3.2, price^0.6.
- **mainstream** uses today's formula.
- **budget**:
  - quality term = min(1.15, q / (frontier − 20)), and price^2.4
  - speed bonus = clamp((nanoThreshold·4 / active)^0.12, 0.8, 1.3)
  - × budgetAppeal

**Product lines.** Up to 2 active products per kind; the second launch fee is 50%. Each has its own model and price, so "Loosey Pro" and "Loosey Lite" coexist.

**Rivals in the budget tier** use their best line, priced at their flagship price × 0.25 (nano), × 0.4 (small) or × 0.6 (medium).

**Crowns pay.** The player's crown counts multiply segment attractiveness. Each multiplier is capped at ×1.15 and then multiplied by crownValue.

| segment | multiplier |
|---|---|
| developer | 1 + 0.03 × coding/agentic crowns |
| enterprise | 1 + 0.03 × reasoning/knowledge/safety crowns |
| consumer | 1 + 0.03 × chat/multilingual crowns |

### 19.4 Contracts (`src/sim/systems/contracts.ts`, `src/sim/data/contracts.ts`)
B2B deals that pay for fit, not for being the biggest.

**Offers.** Every 20–40 days (sooner with brand and reputation), 1–2 offers appear. They come from about 14 defs with year windows, for example:
- an on-device assistant for a phone maker
- NPC dialogue for a game studio
- a private on-prem deployment for a bank
- verticals: a hospital (doctor spec), a law firm (lawyer spec), a trading desk (quant spec)
- government multilingual
- a research grant (needs a crown on a math or reasoning benchmark)
- a logistics agent (agentic)
- translation (multilingual)
- a kids' tutor (safety)

Requirements scale with the frontier. Example nano deal: maxActiveParamsB = the nano threshold, and chat ≥ 0.6 × the frontier's chat.

**Bidding** with `bidContract {offerId, modelId}`:
- Any non-deprecated model that meets the requirements can bid. An unreleased model counts as a private deployment, which is fine.
- Fit = Σ requirement margins + 0.3·brand + 0.2·reputation, × contractFit, + N(0, 5).
- The decision comes 7 days after the bid, against `rivalFit`. That comes from the best qualifying rival flagship or line; with no qualifying rival, there's only a weak generic bid.
- The UI shows a band for both fits.

**Outcomes:**
- **Won:**
  - the upfront fee is paid
  - perYear is paid daily via addRevenue('contracts')
  - support engineers cost their salary via addExpense('staff')
- **Lost:** news "{client} picks {lab}".
- **Breach:** the assigned model is deprecated, deleted, or below the requirements for 30 days. The contract ends, reputation −8, and 25% of the upfront is refunded. `reassignContract` swaps in another qualifying model.
- **End:** a renewal offer at ×1.2 if the model still qualifies.

**Value scale.** Early deals pay $0.2–2M a year; from 2025, $5–80M a year. A small lab with 2–3 deals plus a lite API should cover a 15–30 person team.

### 19.5 Content and feel
- **Achievements:**
  - Pound for pound: first nano or small crown
  - Specialist: hold 3 crowns with one fine-tune
  - Lean and mean: profitable with under 30 staff
  - Weights want to be free: 3 open releases
  - Contractor: 5 active contracts
- **Moments:** first class crown, first contract won.
- **News:** class crown changes, contract wins and losses, rival lines ("Mistrial ships a 7B that embarrasses everyone's 70B").


## 20. Version 1.0: more ways to play, more ways to get data, mobile (v9)
Player request: "do a final v1 version of the game and add more ways to play, get data etc. also make it fully playable on mobile". This is the last feature pass before 1.0. Everything must be finished, balanced, tested and usable on a phone.

Contract: `src/sim/types.ts`, search "v9". Agents may add OPTIONAL fields inside the v9 block for their own feature and must say so in their report.

### 20.1 New game setup: scenarios, difficulty, goals (`src/sim/data/scenarios.ts`, `src/sim/systems/scenario.ts`)
A "New game" screen replaces the bare menu item. It is also the first screen when there is no save. It has:
- company name
- scenario
- difficulty
- an optional custom seed
- toggles: "Sandbox (no bankruptcy, no goals)" and "Skip tutorial"

`createInitialState(seed, name, setup?: GameSetup)`. The default setup equals today's game. `s.setup` records the choices.

**Difficulty** (`DIFFICULTIES`):

| id | start cash | rival quality offset | event weight multiplier | market growth | VC generosity |
|---|---|---|---|---|---|
| intern | ×2 | −4 | ×0.6 | ×1.15 | ×1.3 |
| founder (default) | ×1 | 0 | ×1 | ×1 | ×1 |
| unicorn hunter | ×0.75 | +3 | ×1.3 | ×0.95 | ×0.85 |
| doomer | ×0.5 | +6 | ×1.6 | ×0.9 | ×0.7 |

Each is applied in one place per system:
- rival quality: the competitor release quality offset
- event weight: events.ts
- market growth: the market TAM multiplier
- VC generosity: finance round valuations

**Scenarios** (`SCENARIOS`, 7–8). Each has id, name, a one-line pitch, start year, start cash, staff, research granted, GPUs, doctrine (locked or free), rules and goals:
- **Garage (2017)**: today's game.
- **Late to the party (2022)**: start in 2022 with $40M, 12 staff, the 2017–2021 core research done, rivals at their 2022 strength, the ChatMoment already happened. Goal: Arena #1 by 2026.
- **Bootstrapped**: 2017. No VC rounds ever (funding offers disabled; loans allowed). Goal: profitable within 2 years and $100M revenue/year by 2024.
- **Open-source collective**: doctrine 'open' locked. Every release must be open. Community research +25%. Goal: hold 5 crowns with open models.
- **Sovereign AI**: 2019. Government funded: a $3M/month grant stipend while reputation ≥ 60. Cannot IPO. The enterprise doctrine is free. Goal: 3 government contracts and a top-3 Arena model by 2026.
- **Big Tech spinout**: 2020, $300M, 60 staff, brand 40, but hiring takes 2× and the "board review" event fires often. Goal: $1T valuation by 2032.
- **Data broker**: 2018. You can't pretrain until 2020 (training locked). Earn by selling data (§20.2). Goal: $50M from data sales by 2022, then a top-5 model by 2026.
- **AGI speedrun**: 2017, hard. Goal: research "agi" (or the last tree node) before 2032.

**Rules** are flags read by the relevant systems through `scenarioRule(s, key)`: `noVc`, `noIpo`, `openOnly`, `trainingLockedUntilYear`, `hireDaysMult`, `grantPerMonth`, `communityResearch`. Each check is a one-line edit in the owning system, so it stays readable.

**Goals:**
- Each scenario has 1–3 goals: `{id, text, check(s) → boolean, deadlineYear?}`.
- `scenarioTick` evaluates them daily.
- Meeting all goals fires a victory takeover (pendingMoment, tone 'triumph') with a score:
  - the days taken
  - valuation
  - crowns
  - difficulty multiplier
- After that the player can keep playing.
- Missing a deadline fires a 'loss' moment, "Goal missed: …", and the game continues as a sandbox.
- Goals show on Headquarters as a checklist with progress and the deadline.

**Mid-era starts.** To start after 2017:
- Fast-forward the WORLD from 2017 to the start year with the player frozen: no player costs, no player products, no events, no bankruptcy.
- Then rebase the player:
  - cash, staff and brand from the scenario
  - research granted (all nodes with minYear < start year on the core branches, per the scenario list)
  - GPUs of that era
  - datasets from the open catalogue of that era
  - one starter model at about frontier − 12 for the year, with eval revealed
- Keep it deterministic from the seed. Unit-test that 2022 rivals look like a normal 2022.

### 20.2 More ways to get data (`src/sim/systems/data.ts`, new `src/sim/systems/dataOps.ts`)
§14 has buy, licence, partnership, commission, synthetic and user data. v9 adds:
1. **Own crawler.** `buildCrawler {tier}`: 3 tiers (Scrappy / Industrial / Planetary), each with capex, upkeep and a yield of fresh web tokens per day, scaled by year. Yield goes into a growing custom dataset "Your Crawl {year}" (a new dataset each year, so freshness matters). Quality is 0.35, raised by `minhash_dedup` and `data_filtering` research. `setCrawlerPolicy {polite|aggressive}`: aggressive gives ×2 yield, adds legal risk to the crawl set, and fires "Blocked by Cloudflare-ish" / lawsuit events.
2. **Data refinery.** `refineDataset {datasetId, level}` spends compute (training share, priced like the cloud) and days to raise a dataset's quality by +0.05 / +0.1 / +0.15, with diminishing returns and a cap of 0.95. The tokens shrink by 10–30% (dedupe). It works on custom and owned datasets: stored as an override `s.data.refined[id] = {quality, tokensB}` read by `datasetById`.
3. **Sell and license your data.** `listDataset {datasetId, price, exclusive}` offers a custom dataset (crawl, user chats, commissioned, synthetic) on a marketplace. Rival labs buy it with a chance per week based on price vs value. Each sale is revenue `addRevenue('data')` and gives `s.flags.leakBoost += 0.5` (rivals learn). Exclusive sells once at ×3. Selling user chats has a privacy scandal risk. This is the "data broker" playstyle.
4. **Bounty program.** `runDataBounty {domain, budget, days}`: the community submits data. Tokens scale with budget × brand, and quality is random 0.3–0.8. Spam risk: 20% of the tokens are junk unless `data_filtering` is researched.
5. **Borrow from a rival API.** `distillRivalApi {labId, tokensB}`: buy a rival's API outputs as synthetic data. It's cheap and its quality comes from the rival model's overall. Each use adds ToS risk: a weekly chance of a "Cease and desist" event (ban, reputation −5, `s.flags.tosStrikes`, and a third strike is a lawsuit).
6. **Digitize an archive.** `digitizeArchive {archiveId}`: long projects (90–240 days) that scan old libraries, newspapers or court records, from 5 archive defs by year with a cost. Very high quality (0.9) and unique domains; some are legally grey.
7. **Acquire a data startup.** Every ~200 days a data startup is for sale (event or data-panel offer). Buying it costs a lot and gives a stream of N tokens/day of a domain for 2 years, plus 2 engineers. A rival may outbid you within 14 days.

Each new mechanic needs:
- a handler with validation and notify
- tests
- a section in the Data panel: a tabbed "Get data" area (Market | Crawl | Refine | Bounties | Archives | Sell) that stays usable on mobile
- tunables in an exported `DATAOPS_TUNING`

Achievements: "Spider-man" (crawl 1T tokens), "Refined taste" (refine 5 sets), "Broker" (sell $10M of data), "Strike three" (3 ToS strikes).

### 20.3 Mobile (`src/ui/**`)
The game must be fully playable on a phone (375×667 to 430×932, portrait first; landscape and tablet must not break).
- **Shell, at widths ≤ 760px:**
  - SideNav becomes a bottom tab bar with 5 primary tabs (HQ, Models, Products, Research, More); More opens a sheet with all other panels.
  - TopBar compresses to: company/date, cash, speed control, and a menu button. Log, Sound and the theme toggle move into the menu.
  - The news ticker stays (one line).
  - Toasts go to the top, full width, max 2 visible.
- **Overlays:** modals, wizards, EvalReveal, MomentTakeover, NoticeLog, DoctrinePicker and the new-game screen become full-screen sheets with a sticky header and close button and a sticky primary action at the bottom.
- **Touch:** every interactive element is ≥ 40px tall. No hover-only information: tooltips also open on tap. Inputs are ≥ 16px font on mobile to avoid iOS zoom. Sliders get ±-step buttons.
- **Tables:** dense tables either become stacked cards on mobile (Models, Products, Contracts) or scroll horizontally inside their card with a sticky first column (Benchmarks, Market). The page never scrolls horizontally.
- **Research tree:** on mobile, show a list view by branch (with the queue) instead of the SVG graph, with a toggle back to the graph (pinch or drag pan).
- **Office canvas:** fit the width, lower the DPR cost; it can be collapsed.
- **Safe areas:** `env(safe-area-inset-*)`.
- **Viewport:** `viewport-fit=cover`.
- **PWA:**
  - `public/manifest.webmanifest` (name, icons 192/512 generated as simple PNG or SVG in the terminal style, display standalone, theme colours from tokens)
  - apple-touch-icon and apple-mobile-web-app meta tags
  - a minimal service worker that caches the built assets for offline play. It's registered only in production builds and only on https or localhost.
- **Performance on phones:** the frame loop must not re-render all panels every tick; check that a mid phone stays responsive at 10×.
- **Verification:** every panel and flow is screenshotted at 375×812 and 430×932 in light and dark, plus 800 and 1440 to confirm nothing regressed.

### 20.4 Hosting on the tailnet
`npm run build` produces `dist/`. `scripts/serve-tailnet.ps1` / `start-tailnet.bat` serve it on `localhost:5380` and publish it with `tailscale serve` as HTTPS on the machine's MagicDNS name, so a phone on the tailnet can open it and install it as an app. The Vite config allows `.ts.net` hosts for dev and preview.

## 21. Clarity pass (v10): less text, real pictures, systems you can read
This section comes from a friend's playtest. In short:
- The compute and server system is confusing. Either fold it into the running costs or make it obvious what you have and where it goes.
- New years bring more research than you can ever finish.
- Many stats change nothing.
- Screens are cluttered. For example, the Data filters take half the screen.
- Staff should be a roster with a Hire button, and marketing has no overview.
- New players drown.

The user added two asks on top: "visualise a lot of stuff nicer and more interactive" and "actual visualisations, less pure text attack". The visual rules live in DESIGN.md (v3 amendments).

### 21.1 Serving (`src/sim/systems/serving.ts`, compute.ts, products.ts)
- **Products never go down for lack of GPUs any more.**
  - Your own GPUs serve first, at no cost beyond power.
  - Whatever they can't cover is served by cloud **burst** capacity, billed per PFLOP/s-day.
  - The bill is an expense line called `serving`, and each product carries `servingCostPerDay`.
  - Capacity-driven outages are gone; incident events can still take a product down.
  - `servedFraction` stays 1 unless an event says otherwise.
- **Fleet priority** (`compute.priority`, default `serving`) replaces the free training/inference slider. It only matters while a training run is active; without a run, idle GPUs serve first.
  - `serving`: own GPUs serve products first, and training gets the rest.
  - `balanced`: serving may use at most `BALANCED_SERVING_CAP` = 50% of own GPUs.
  - `training`: all own GPUs train, and all serving is burst.
- **Burst price per PFLOP/s-day** = the cheapest available GPU's `rentPerDay / pflops` × `BURST_PREMIUM` (start at 1.5). Shortage events may raise the premium.
- **Tuning target:** at reference prices, a model at frontier quality earns at least about 2× its burst cost per Mtok on the API. Pricing far below the reference, or serving a huge model cheaply, loses money per token, and the Products screen shows that as a red margin.
- `compute.fleet` holds today's `FleetBreakdown`, written once per tick. It covers:
  - GPUs and PFLOP/s for training, serving and idle
  - burst PFLOP/s and its cost
  - one `ServingSlice` per product

  `compute.trainingShare` becomes a derived mirror (training GPUs ÷ total) so old code keeps working. The `setTrainingShare` action maps to the nearest priority.
- `previewFleet(s, priority)` returns the same breakdown for another priority, so the UI can show "if you switch, training goes from X to Y and the serving bill from A to B".
- Bots and the balance harness must still pass every goal (`scripts/balance.ts --all`).

### 21.2 Research keeps up with the calendar (`systems/research.ts`, `data/research.ts`)
- **Problem:**
  - Research costs per unlock-year grow about 1.6× per year: 15k points in 2021, 27k in 2022, 43k in 2023, 67k in 2024, 109k in 2025.
  - Points per day grow only with headcount: about 22 per day with 22 researchers.
  - So a normal lab ends each year further behind.
- **Fix:** knowledge compounds. Published papers make each node cheaper the further the calendar is past its `minYear`.
  - **Diffusion:** cost × `max(DIFFUSION_FLOOR, DIFFUSION_PER_YEAR^(year − minYear))`, with the per-year factor around 0.7 and the floor around 0.25.
  - Lower the base multiplier where needed.
  - Being early stays expensive; catching up is cheap. Show "Cheaper every year (−30%/yr)" on such nodes.
- **Targets** (`scripts/research-pace.ts`):
  - The frontier bot finishes at least 80% of the nodes available by each year-end from 2019 on.
  - The small bot finishes at least 55%.
  - Nobody can research everything before 2030.
  - `scripts/balance.ts --all` stays green.

### 21.3 A stat must earn its place
For every number on a screen, ask: can the player act on it, and does the sim use it to decide something? If neither, remove it or move it behind "Details". Panel owners list what they cut in their report.

### 21.4 Progressive disclosure (`src/ui/unlocks.ts`)
- **New games show a small game that grows.** Nav items appear when they become relevant.
  - **From the start:** Headquarters, Models, Research, Data, Compute, Staff, Finance.
  - **Products:** once a model is finished.
  - **Market and Marketing:** once the first product launches.
  - **Benchmarks:** once the first model is released.
  - **Contracts:** once the first release happens and contract offers exist.
  - **Trophies:** once the first achievement lands.
- An unlock shows a toast ("New screen: Marketing. Grow your brand and hype.") and a nav dot.
- Late-start scenarios (and any save older than v10) start with everything unlocked.
- Menu → "Show all screens" unlocks everything, and "Show screen tips again" resets the PanelIntros.
- Unlocks are stored in UI state on the save (`s.flags['ui.unlock.<panel>']`) so they persist.
- Tabs inside panels may follow the same idea (Data ops tabs, datacenter building), always with a visible reason, e.g. "Unlocks with Web Crawling research".

### 21.5 Panels
- **Compute:** the server room, the fleet priority picker with a preview, renting in a sheet, building in a sheet, and datacenters as visual blocks.
- **Products:** revenue, serving cost and margin per product, shown visually.
- **Data:** a token treemap, filters and sort in one toolbar row behind a Popover, and the catalogue as a table under it.
- **Staff:**
  - An office floor visual of everyone.
  - A team roster with a plain-language "what they do for you" line and the effect number.
  - A **Hire** button that opens a hire sheet: role, count, salary level, cost and effect preview.
  - Offices in their own sheet. Stars as cards.
- **Marketing** (new nav item, code MKG):
  - Brand and hype gauges with history.
  - Running campaigns on a timeline, and the campaign shop in a sheet.
  - The marketing team's effect, and the awareness → users funnel per segment.
  - Campaigns leave the Market screen.
- **Market:** segment share bars and a buyer-tier heat matrix.
- **Models, Finance and charts:** a capability shape per model, a profit waterfall, and charts that show values on hover.

## 22. Multiplayer v12: explicit match saves and shared speed
**Match saves.** Multiplayer opens a full screen (`src/ui/mp/Lobby.tsx`), not a popup.
- **New match:** name the save → company and colour → Host (match length) or Join (6-letter code).
- **Saved matches:** every match is a named slot (`src/net/mpSave.ts`).
  - Keys: `mp-saves` index, `mp-save:<id>`, `mp-active`; up to 12 slots, oldest finished dropped first.
  - It autosaves while playing. "Save now" writes it at once. Leaving keeps it.
  - **Resume** reloads the slot and reconnects through the same room code. The host resumes first, then the guest, and each opens their own copy.
  - Rename by clicking the name. The pre-v12 single slot is migrated automatically.

**Shared speed (protocol v2, `{t:'spd'}`).** Both players always run at one speed.
- **Pause:** applies to both at once, and so does a slower speed.
- **Faster:** asks the rival (Accept / Keep). It auto-accepts after 10 s.
- **Unpause:** a 30-second countdown for both, skipped when both press Ready. "Stay paused" cancels it.
- **Reconnects and resumed saves** come back paused.
- **No auto-pause in matches.** The "Pause when…" choices are single-player only, and an event window only holds up the player who has it (the other waits in lockstep).
