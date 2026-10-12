// v10 Staff screen: read-only helpers. Every number comes from the sim's own formulas (never copied results),
// so the effect lines and previews can't drift from what a role really does.
import type { GameState, RoleDef, RoleId, Star } from '../../../sim/types';
import { ROLE_IDS } from '../../../sim/types';
import { ROLES } from '../../../sim/data/roles';
import { CAP_TUNING } from '../../../sim/balance';
import { COMPUTE_TUNING } from '../../../sim/systems/compute';
import { researchPointsPerDay } from '../../../sim/systems/research';
import { STAFF_TUNING, dailyPayroll, headcount, marketSalary, officeCapacity, roleStrength } from '../../../sim/systems/staff';
import { hireCostMult } from '../../../sim/systems/scenario';
import { marketingTeamEffect } from '../../../sim/systems/market';
import { RUN_TUNING } from '../../../sim/data/trainingOptions';

/**
 * Enterprise demand per sqrt(sales strength). Inline in sim/systems/market.ts (playerExtra), not exported,
 * so it is mirrored here. If the sim changes it, change this too.
 */
const SALES_SQRT_COEF = 0.1;

/** Morale thresholds the sim uses inline (staff.ts tick). Mirrored here for the warnings. */
export const POACH_MORALE_BELOW = 40;
export const UNDERPAID_BELOW = 0.95;

export const pct = (x: number): string => `${Math.round(x * 100)}%`;

export interface TeamStat {
  id: RoleId;
  role: RoleDef;
  /** Ordinary people on the team (not stars). */
  count: number;
  /** Hired stars whose role is this team. */
  stars: Star[];
  /** count + stars: what the floor and headcount show. */
  heads: number;
  skill: number;
  /** Pay as a fraction of market (0.8 to 1.6). */
  level: number;
  /** Market salary per person per year. */
  market: number;
  /** Payroll per day for the whole team, stars included. */
  payDay: number;
}

export function teamStats(s: GameState): TeamStat[] {
  return ROLES.map((role) => {
    const rs = s.staff.roles[role.id];
    const stars = s.staff.stars.filter((st) => st.hiredDay !== null && st.role === role.id);
    const market = marketSalary(s, role.id);
    const starPay = stars.reduce((a, st) => a + st.salary, 0);
    const payDay = (market * rs.salaryLevel * rs.count + starPay) / 365;
    return {
      id: role.id,
      role,
      count: rs.count,
      stars,
      heads: rs.count + stars.length,
      skill: rs.skill,
      level: rs.salaryLevel,
      market,
      payDay,
    };
  });
}

export interface TeamEffect {
  /** Numeric headline, used for before/after previews. */
  value: number;
  /** Plain line, without the team name, e.g. "22.0 research points/day". */
  line: string;
  /** Optional second plain line. */
  extra?: string;
}

/** What a team does for the lab right now, using the sim's own formulas. Morale and skill are already in. */
export function teamEffect(s: GameState, id: RoleId): TeamEffect {
  const rt = Math.sqrt(roleStrength(s, id));
  switch (id) {
    case 'researcher': {
      const v = researchPointsPerDay(s);
      return {
        value: v,
        line: `${v.toFixed(1)} research points/day`,
        extra: `+${pct(CAP_TUNING.RESEARCHER_TRAIN_BOOST * rt)} training speed`,
      };
    }
    case 'engineer': {
      const m = COMPUTE_TUNING.ENGINEER_BOOST * rt;
      const fewer = 1 - 1 / (1 + RUN_TUNING.ENGINEER_INCIDENT_COEF * rt);
      return {
        value: m,
        line: `Serve ${pct(m)} more tokens per GPU`,
        extra: `${pct(fewer)} fewer training incidents`,
      };
    }
    case 'safety': {
      const v = Math.min(CAP_TUNING.SAFETY_STAFF_CAP, CAP_TUNING.SAFETY_STAFF_PER_SQRT * rt);
      return {
        value: v,
        line: `+${v.toFixed(1)} safety score on your models (max +${CAP_TUNING.SAFETY_STAFF_CAP})`,
      };
    }
    case 'sales': {
      const v = SALES_SQRT_COEF * rt;
      return { value: v, line: `+${pct(v)} enterprise demand` };
    }
    case 'marketing': {
      const e = marketingTeamEffect(s);
      return {
        value: e.campaignMult - 1,
        line: `Campaigns ${pct(e.campaignMult - 1)} stronger`,
        extra: `+${e.brandPerDay.toFixed(3)} brand/day from word of mouth`,
      };
    }
  }
}

/** The effect text with the team name in front, e.g. "Researchers: 22.0 research points/day". */
export function effectSentence(team: TeamStat, eff: TeamEffect): string {
  return `${team.role.plural}: ${eff.line}`;
}

/** A copy of the state with `n` more people in `id` at pay level `level` (0.8..1.6). Read-only use only. */
export function withHire(s: GameState, id: RoleId, n: number, level: number): GameState {
  const rs = s.staff.roles[id];
  const count = rs.count + n;
  // Hires come in at an average skill of 1.0 (the sim draws 0.8 to 1.2 per person).
  const skill = count > 0 ? (rs.count * rs.skill + n) / count : rs.skill;
  return {
    ...s,
    staff: {
      ...s.staff,
      roles: { ...s.staff.roles, [id]: { ...rs, count, skill, salaryLevel: level } },
    },
  };
}

export interface HirePreview {
  /** Change in payroll per day, including a pay change for the people already there. */
  payDayDelta: number;
  payYearDelta: number;
  /** One-off recruiting fee for the new people. */
  fee: number;
  before: TeamEffect;
  after: TeamEffect;
  seatsFree: number;
  seatsLeft: number;
  /** Why Confirm is blocked, or null when the hire can go ahead. */
  blocked: string | null;
}

export function hirePreview(s: GameState, id: RoleId, n: number, level: number): HirePreview {
  const role = ROLES.find((r) => r.id === id);
  const cap = officeCapacity(s);
  const free = Math.max(0, cap - headcount(s));
  const fee = (role?.hireCost ?? 0) * n * hireCostMult(s);
  const after = withHire(s, id, n, level);
  const payDayDelta = dailyPayroll(after) - dailyPayroll(s);
  let blocked: string | null = null;
  if (n < 1) blocked = 'Pick at least one person.';
  else if (free === 0) blocked = 'The office is full. Move to a bigger office first.';
  else if (n > free) blocked = `Only ${free} seat${free === 1 ? '' : 's'} free. Lower the count or move office.`;
  else if (s.finance.cash < fee) blocked = 'Not enough cash for the recruiting fees.';
  return {
    payDayDelta,
    payYearDelta: payDayDelta * 365,
    fee,
    before: teamEffect(s, id),
    after: teamEffect(after, id),
    seatsFree: free,
    seatsLeft: Math.max(0, free - n),
    blocked,
  };
}

export interface Retention {
  /** Average pay across people you have, as a fraction of market. */
  avgLevel: number;
  lowMorale: boolean;
  underpaid: boolean;
  /** Chance per day that a rival poaches one ordinary employee (sim: staff.ts step 3). */
  chance: number;
  /** Rounded "about every N days" for the plain line. 0 when nothing is poaching. */
  everyDays: number;
}

export function retention(s: GameState): Retention {
  let sum = 0;
  let n = 0;
  for (const r of ROLE_IDS) {
    const rs = s.staff.roles[r];
    if (rs.count > 0) {
      sum += rs.salaryLevel * rs.count;
      n += rs.count;
    }
  }
  const avgLevel = n > 0 ? sum / n : 1;
  const lowMorale = s.staff.morale < POACH_MORALE_BELOW;
  const underpaid = avgLevel < UNDERPAID_BELOW;
  const chance = (lowMorale ? STAFF_TUNING.POACH_CHANCE_LOW_MORALE : 0) + (underpaid ? STAFF_TUNING.POACH_CHANCE_UNDERPAID : 0);
  return { avgLevel, lowMorale, underpaid, chance, everyDays: chance > 0 ? Math.round(1 / chance) : 0 };
}

export function moraleTone(morale: number): 'good' | 'warn' | 'bad' {
  return morale >= 60 ? 'good' : morale >= 40 ? 'warn' : 'bad';
}

// ---------------------------------------------------------------------------
// The office floor: one glyph per N people, so big offices stay readable.
// ---------------------------------------------------------------------------

const UNITS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const MAX_SLOTS = 150;
const COLS = 20;
export const CELL_W = 26;
export const CELL_H = 34;

/** People per glyph: 1 for offices up to 150 seats, then a round number that keeps the floor under 150 cells. */
export function peoplePerGlyph(cap: number): number {
  for (const u of UNITS) if (Math.ceil(cap / u) <= MAX_SLOTS) return u;
  return UNITS[UNITS.length - 1];
}

export interface FloorSlot {
  i: number;
  x: number;
  y: number;
  /** Team of the people in this slot, or null for an empty seat. */
  role: RoleId | null;
  /** Share of the slot filled (1 for a full glyph). */
  fill: number;
}

export interface FloorLayout {
  unit: number;
  cols: number;
  slots: FloorSlot[];
  width: number;
  height: number;
}

/** Lays the seats out in rows. People fill seats in team order, so each team is a contiguous group. */
export function floorLayout(cap: number, teams: { id: RoleId; heads: number }[]): FloorLayout {
  const unit = peoplePerGlyph(cap);
  const nSlots = Math.max(1, Math.ceil(cap / unit));
  const cols = Math.min(nSlots, COLS);
  const rows = Math.ceil(nSlots / cols);
  const seq: RoleId[] = [];
  for (const t of teams) for (let k = 0; k < t.heads; k++) seq.push(t.id);
  const slots: FloorSlot[] = [];
  for (let i = 0; i < nSlots; i++) {
    const start = i * unit;
    const end = Math.min(start + unit, seq.length);
    const n = Math.max(0, end - start);
    slots.push({
      i,
      x: (i % cols) * CELL_W,
      y: Math.floor(i / cols) * CELL_H,
      role: n > 0 ? seq[start] : null,
      fill: n / unit,
    });
  }
  return { unit, cols, slots, width: cols * CELL_W, height: rows * CELL_H };
}
