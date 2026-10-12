// Dev harness for the office scene: http://localhost:5320/src/office/demo.html
import { h, render } from 'preact';
import { createInitialState } from '../sim/state';
import { GPUS } from '../sim/data/gpus';
import { OFFICE_TIERS } from '../sim/data/roles';
import { ROLE_IDS, type GameState, type Model, type RoleId, type TrainingRun } from '../sim/types';
import { OfficeView } from './OfficeView';

const TIER_IDS: string[] = OFFICE_TIERS.length ? OFFICE_TIERS.map((t) => t.id) : ['garage', 'hotdesk', 'loft', 'floors', 'campus', 'arcology'];

const s: GameState = createInitialState(42, 'Demo Labs');
s.day = 900; // ~2019.5
s.speed = 1;
s.staff.roles.researcher = { count: 14, skill: 1.1, salaryLevel: 1 };
s.staff.roles.engineer = { count: 18, skill: 1, salaryLevel: 1 };
s.staff.roles.safety = { count: 6, skill: 1, salaryLevel: 1 };
s.staff.roles.sales = { count: 10, skill: 1, salaryLevel: 1 };
s.staff.roles.marketing = { count: 6, skill: 1, salaryLevel: 1 };
s.company.officeTierId = TIER_IDS[Math.min(2, TIER_IDS.length - 1)];
s.compute.rented = { [GPUS[1]?.id ?? 'v1000']: 2400, [GPUS[3]?.id ?? 'h100']: 300 };
s.compute.datacenters = [
  { id: 'dc1', name: 'Server Closet #1', tierId: 'closet', gpus: { [GPUS[2]?.id ?? 'a100']: 2000 }, buildDaysLeft: 0 },
  { id: 'dc2', name: 'Colo Cage B', tierId: 'colo', gpus: {}, buildDaysLeft: 12 },
];
s.finance.cash = 5_000_000;
s.finance.dailyRevenue = 120_000;
s.finance.dailyExpenses = 90_000;
s.training = makeTraining(s);
s.models = [];
s.company.hype = 40;

let nextModel = 1;
let tierIdx = Math.min(2, TIER_IDS.length - 1);
let savedCash = 0;

function makeTraining(st: GameState): TrainingRun {
  return {
    id: 'demo-run',
    name: 'Frontier-ish 1T',
    paramsB: 1000,
    tokensB: 20000,
    datasetIds: [],
    techniques: [],
    dataQuality: 0.8,
    totalFlops: 1e24,
    doneFlops: 0.37e24,
    startedDay: st.day,
    lossHistory: [],
    predictedLoss: 1.9,
  };
}

function makeModel(n: number, released: boolean): Model {
  return {
    id: `demo-model-${n}`,
    name: `Secret-${n}`,
    paramsB: 70,
    tokensB: 1500,
    datasetIds: [],
    techniques: [],
    finalLoss: 2.1,
    scores: { reasoning: 60, coding: 58, chat: 62, safety: 50 },
    overall: 60,
    elo: 1280,
    trainedDay: s.day,
    releasedDay: released ? s.day : null,
    deprecated: false,
  };
}

// Simple fake sim tick so the scene animates: day advances, training progresses.
setInterval(() => {
  s.day += 0.5;
  if (s.training) {
    s.training.doneFlops = Math.min(s.training.totalFlops, s.training.doneFlops + 0.01e24);
    if (s.training.doneFlops >= s.training.totalFlops) s.training = null;
  }
  for (const dc of s.compute.datacenters) if (dc.buildDaysLeft > 0) dc.buildDaysLeft = Math.max(0, dc.buildDaysLeft - 0.5);
}, 500);

const container = document.getElementById('office')!;
render(h(OfficeView, { state: s, height: 420 }), container);

const status = document.getElementById('status')!;
function updateStatus(): void {
  const headcount = ROLE_IDS.reduce((a, r) => a + (s.staff.roles[r]?.count ?? 0), 0);
  const gpus = Object.values(s.compute.rented).reduce((a, b) => a + b, 0);
  status.textContent =
    `tier=${s.company.officeTierId} headcount=${headcount} rentedGPUs=${gpus} ` +
    `models=${s.models.length} training=${s.training ? 'yes' : 'no'} cash=${Math.round(s.finance.cash)}`;
}
setInterval(updateStatus, 300);
updateStatus();

function bindClick(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener('click', fn);
}

bindClick('btn-tier', () => {
  tierIdx = (tierIdx + 1) % TIER_IDS.length;
  s.company.officeTierId = TIER_IDS[tierIdx];
});

bindClick('btn-hire', () => {
  for (let i = 0; i < 5; i++) {
    const r: RoleId = ROLE_IDS[Math.floor(Math.random() * ROLE_IDS.length)];
    const role = s.staff.roles[r];
    role.count += 1;
  }
});

bindClick('btn-fire', () => {
  for (let i = 0; i < 5; i++) {
    const r: RoleId = ROLE_IDS[Math.floor(Math.random() * ROLE_IDS.length)];
    const role = s.staff.roles[r];
    if (role.count > 0) role.count -= 1;
  }
});

bindClick('btn-train', () => {
  s.training = s.training ? null : makeTraining(s);
});

bindClick('btn-gpus', () => {
  const id = GPUS[1]?.id ?? 'v1000';
  s.compute.rented[id] = (s.compute.rented[id] ?? 0) + 500;
});

bindClick('btn-model', () => {
  s.models.push(makeModel(nextModel++, false));
});

bindClick('btn-cash', () => {
  if (s.finance.cash >= 0) {
    savedCash = s.finance.cash;
    s.finance.cash = -250_000;
  } else {
    s.finance.cash = savedCash || 5_000_000;
  }
});
