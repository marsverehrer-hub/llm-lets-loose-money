import type { BenchmarkDef } from '../types';
// OWNER: v2 capabilities. Benchmarks in their real years, plus parody future ones.
// Result = floor + (ceiling - floor) * sigmoid((weighted capability - difficulty) / spread). See systems/capabilities.ts.
// difficulty/spread are fitted so the frontier lab (see scripts/benchmarks.ts) clears roughly the historical
// numbers: MMLU ~45 in 2020, ~86 in 2023; GPQA ~40 in 2023; HLE under 10 in 2025; SWE-bench ~30 in 2024, ~70 in 2025.
export const BENCHMARKS: BenchmarkDef[] = [
  {
    id: 'squad', name: 'SQuAD', fullName: 'Stanford Question Answering Dataset', year: 2016, category: 'language',
    weights: { reasoning: 0.5, knowledge: 0.5 }, difficulty: 15.3, spread: 10.25, floor: 0, ceiling: 96,
    flavor: 'Reading comprehension: questions that can be answered by pointing at the paragraph.',
  },
  {
    id: 'glue', name: 'GLUE', fullName: 'General Language Understanding Evaluation', year: 2018, category: 'language',
    weights: { reasoning: 0.5, chat: 0.3, knowledge: 0.2 }, difficulty: 39.1, spread: 3.77, floor: 40, ceiling: 92,
    flavor: 'Nine tasks, one average, and a leaderboard that rewards overfitting to the average.',
  },
  {
    id: 'superglue', name: 'SuperGLUE', fullName: 'SuperGLUE', year: 2019, category: 'language',
    weights: { reasoning: 0.7, knowledge: 0.3 }, difficulty: 52.6, spread: 5.39, floor: 50, ceiling: 92,
    flavor: 'GLUE, but the tasks got harder and the baselines got better faster than anyone planned.',
  },
  {
    id: 'hellaswag', name: 'HellaSwag', fullName: 'Harder Endings, Longer Contexts, and Low-shot Activities for Situations With Adversarial Generations', year: 2019, category: 'reasoning',
    weights: { reasoning: 0.5, knowledge: 0.3, chat: 0.2 }, difficulty: 49.2, spread: 9.59, floor: 25, ceiling: 96,
    flavor: 'Pick the sensible ending. Surprisingly hard for something that has read everything.',
  },
  {
    id: 'arc_agi', name: 'ARC-AGI', fullName: 'Abstraction and Reasoning Corpus for Artificial General Intelligence', year: 2019, category: 'reasoning',
    weights: { reasoning: 0.7, math: 0.3 }, difficulty: 85.4, spread: 10.47, floor: 0, ceiling: 95,
    flavor: 'Grid puzzles that humans solve in seconds and models solve by memorising the genre.',
  },
  {
    id: 'mmlu', name: 'MMLU', fullName: 'Massive Multitask Language Understanding', year: 2020, category: 'knowledge', headline: true,
    weights: { knowledge: 0.6, reasoning: 0.3, multilingual: 0.1 }, difficulty: 64.1, spread: 6.95, floor: 25, ceiling: 92,
    flavor: '57 subjects of multiple choice. The most-cited number in every pitch deck.',
  },
  {
    id: 'truthfulqa', name: 'TruthfulQA', fullName: 'Measuring How Models Mimic Human Falsehoods', year: 2021, category: 'safety',
    weights: { knowledge: 0.5, safety: 0.3, chat: 0.2 }, difficulty: 73, spread: 7.83, floor: 25, ceiling: 90,
    flavor: 'Questions where the popular answer is wrong. Models learned that very quickly.',
  },
  {
    id: 'gsm8k', name: 'GSM8K', fullName: 'Grade School Math 8K', year: 2021, category: 'math',
    weights: { math: 0.8, reasoning: 0.2 }, difficulty: 63.7, spread: 3.74, floor: 0, ceiling: 97,
    flavor: 'Grade-school word problems. Eight thousand of them, and each one is a paragraph of arithmetic.',
  },
  {
    id: 'humaneval', name: 'HumanEval', fullName: 'Hand-Written Evaluation Set for Code Generation', year: 2021, category: 'coding',
    weights: { coding: 0.8, reasoning: 0.2 }, difficulty: 74.5, spread: 5.71, floor: 0, ceiling: 96,
    flavor: '164 Python functions graded by unit tests. The tests are shorter than the prompts.',
  },
  {
    id: 'math', name: 'MATH', fullName: 'Mathematics Aptitude Test of Heuristics', year: 2021, category: 'math',
    weights: { math: 0.8, reasoning: 0.2 }, difficulty: 73.1, spread: 4.26, floor: 0, ceiling: 97,
    flavor: 'Competition-style maths with checkable answers, which is why nobody trusts the grader.',
  },
  {
    id: 'bbh', name: 'BIG-Bench Hard', fullName: 'Beyond the Imitation Game Benchmark, Hard subset', year: 2022, category: 'reasoning',
    weights: { reasoning: 0.6, knowledge: 0.2, math: 0.2 }, difficulty: 76.1, spread: 4.91, floor: 25, ceiling: 95,
    flavor: 'The 23 tasks the big benchmark authors could not stop thinking about.',
  },
  {
    id: 'mt_bench', name: 'MT-Bench', fullName: 'Multi-Turn Benchmark', year: 2023, category: 'chat',
    weights: { chat: 0.7, reasoning: 0.3 }, difficulty: 76.3, spread: 6.58, floor: 30, ceiling: 95,
    flavor: 'Multi-turn chat, graded by another model. Marking the homework with more homework.',
  },
  {
    id: 'gpqa', name: 'GPQA Diamond', fullName: 'Graduate-Level Google-Proof Q&A, Diamond subset', year: 2023, category: 'knowledge', headline: false,
    weights: { knowledge: 0.5, reasoning: 0.5 }, difficulty: 85, spread: 2.26, floor: 25, ceiling: 88,
    flavor: 'Graduate-level science questions written by PhDs. Google-proof, mostly.',
  },
  {
    id: 'mmmu', name: 'MMMU', fullName: 'Massive Multi-discipline Multimodal Understanding', year: 2023, category: 'vision', headline: true,
    weights: { vision: 0.6, knowledge: 0.2, reasoning: 0.2 }, difficulty: 54.6, spread: 17.67, floor: 25, ceiling: 85,
    flavor: 'College-level questions about charts and diagrams. Some of the diagrams are wrong.',
  },
  {
    id: 'swe_bench', name: 'SWE-bench Verified', fullName: 'Software Engineering benchmark, human-verified subset', year: 2024, category: 'agentic', headline: true,
    weights: { coding: 0.4, agentic: 0.6 }, difficulty: 80.7, spread: 6.87, floor: 0, ceiling: 92,
    flavor: 'Real GitHub issues. Fix the bug, pass the tests, and do not break the other four thousand.',
  },
  {
    id: 'aime', name: 'AIME', fullName: 'American Invitational Mathematics Examination', year: 2024, category: 'math', headline: true,
    weights: { math: 0.8, reasoning: 0.2 }, difficulty: 79, spread: 1.87, floor: 0, ceiling: 93,
    flavor: 'Competition maths for people who enjoy suffering. Thirty problems, one fair answer each.',
  },
  {
    id: 'frontiermath', name: 'FrontierMath', fullName: 'FrontierMath', year: 2024, category: 'frontier', headline: true,
    weights: { math: 0.9, reasoning: 0.1 }, difficulty: 85.6, spread: 1.93, floor: 0, ceiling: 90,
    flavor: 'Research-level maths. Mathematicians were paid to write them, then paid again to check them.',
  },
  {
    id: 'tau_bench', name: 'τ-bench', fullName: 'Tool-Agent-User Benchmark', year: 2024, category: 'agentic', headline: true,
    weights: { agentic: 0.7, chat: 0.3 }, difficulty: 66.2, spread: 11.35, floor: 0, ceiling: 92,
    flavor: 'Customer service with tools, and a policy document nobody has read.',
  },
  {
    id: 'livecodebench', name: 'LiveCodeBench', fullName: 'LiveCodeBench', year: 2024, category: 'coding',
    weights: { coding: 0.8, reasoning: 0.2 }, difficulty: 90.7, spread: 2.96, floor: 0, ceiling: 92,
    flavor: 'Competitive programming problems released after the training cutoff. Fresh, like the milk.',
  },
  {
    id: 'hle', name: "Humanity's Last Exam", fullName: "Humanity's Last Exam", year: 2025, category: 'frontier', headline: true,
    weights: { knowledge: 0.4, reasoning: 0.4, math: 0.2 }, difficulty: 96, spread: 2.48, floor: 0, ceiling: 92,
    flavor: 'Questions written to be unanswerable by machines. Machines are now answering them, slowly.',
  },
  {
    id: 'arc_agi_2', name: 'ARC-AGI-2', fullName: 'Abstraction and Reasoning Corpus, second edition', year: 2025, category: 'reasoning', headline: true,
    weights: { reasoning: 0.7, math: 0.3 }, difficulty: 96.7, spread: 1.99, floor: 0, ceiling: 90,
    flavor: 'The grid puzzles again, this time designed to be hard for real.',
  },
  {
    id: 'arc_agi_3', name: 'ARC-AGI-3', fullName: 'Abstraction and Reasoning Corpus, third edition, now interactive', year: 2027, category: 'reasoning', headline: true,
    weights: { reasoning: 0.5, agentic: 0.5 }, difficulty: 101.2, spread: 1.8, floor: 0, ceiling: 85,
    flavor: 'Interactive puzzles scored by a committee. Entirely new, still the same vibe.',
  },
  {
    id: 'taxes', name: 'Can-It-Do-My-Taxes', fullName: 'Can It Do My Taxes? (Filing Edition)', year: 2027, category: 'agentic',
    weights: { agentic: 0.5, math: 0.3, knowledge: 0.2 }, difficulty: 95, spread: 1.8, floor: 0, ceiling: 98,
    flavor: 'Real tax returns, real refunds, real audit risk. The grader is an accountant.',
  },
  {
    id: 'real_employee', name: 'RealEmployeeBench', fullName: 'Real Employee Benchmark (Lite, Meetings Included)', year: 2028, category: 'agentic',
    weights: { agentic: 0.6, chat: 0.2, knowledge: 0.2 }, difficulty: 100.4, spread: 1.8, floor: 0, ceiling: 95,
    flavor: 'Tasks from a real job posting. The model must attend a meeting that could have been an email.',
  },
  {
    id: 'hale', name: "Humanity's Actually Last Exam", fullName: "Humanity's Actually Last Exam (Sponsored)", year: 2030, category: 'frontier', headline: true,
    weights: { knowledge: 0.4, reasoning: 0.4, math: 0.2 }, difficulty: 102.5, spread: 1.8, floor: 0, ceiling: 95,
    flavor: 'The sequel nobody asked for. Sponsored by a sovereign wealth fund.',
  },
  {
    id: 'agi_bench', name: 'AGI-Bench (Final Final v2)', fullName: 'AGI-Bench (Final Final v2)', year: 2032, category: 'frontier',
    weights: { reasoning: 0.3, agentic: 0.3, knowledge: 0.2, chat: 0.2 }, difficulty: 104.4, spread: 1.8, floor: 0, ceiling: 100,
    flavor: 'A single number that proves AGI. Version two of the proof is out.',
  },
  // v8 efficiency benchmarks (GAME_DESIGN §19.2): the above-floor result is scaled by clamp((nano / active)^efficiency,
  // 0.35, 1.15), so small models can win them outright and giants score poorly.
  {
    id: 'edgebench', name: 'EdgeBench', fullName: 'EdgeBench: accuracy per device', year: 2019, category: 'chat', efficiency: 0.35,
    weights: { reasoning: 0.5, chat: 0.3, knowledge: 0.2 }, difficulty: 45, spread: 9, floor: 25, ceiling: 90,
    flavor: 'Accuracy measured on a laptop that was already slow in 2019.',
  },
  {
    id: 'tokens_per_watt', name: 'TokensPerWatt', fullName: 'TokensPerWatt: quality per joule, two decimal places', year: 2021, category: 'coding', efficiency: 0.3,
    weights: { coding: 0.5, reasoning: 0.3, chat: 0.2 }, difficulty: 58, spread: 8, floor: 0, ceiling: 90,
    flavor: 'Reported to two decimal places so nobody can argue with the wattage.',
  },
  {
    id: 'mobile_mmlu', name: 'MobileMMLU', fullName: 'MobileMMLU: the massive exam, shortened for small screens', year: 2023, category: 'knowledge', efficiency: 0.4,
    weights: { knowledge: 0.6, reasoning: 0.2, multilingual: 0.2 }, difficulty: 60, spread: 6, floor: 25, ceiling: 88,
    flavor: 'MMLU with the questions cut to fit a phone screen. Several are now unanswerable.',
  },
  {
    id: 'latency_arena', name: 'LatencyArena', fullName: 'LatencyArena: answers scored by time to first token', year: 2024, category: 'agentic', efficiency: 0.5,
    weights: { agentic: 0.4, coding: 0.3, chat: 0.3 }, difficulty: 66, spread: 7, floor: 0, ceiling: 92,
    flavor: 'Scored by how fast the answer arrives. Accuracy is a tiebreaker nobody reads.',
  },
  {
    id: 'pocket_agent', name: 'PocketAgent', fullName: 'PocketAgent: agentic tasks on-device, no cloud, no patience', year: 2026, category: 'agentic', efficiency: 0.45,
    weights: { agentic: 0.5, reasoning: 0.3, chat: 0.2 }, difficulty: 72, spread: 5, floor: 0, ceiling: 92,
    flavor: 'Agentic tasks that run on a phone with no cloud and very little patience.',
  },
];
