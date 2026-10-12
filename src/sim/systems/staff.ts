// OWNER: Agent A. Hiring, payroll, morale, offices, stars, poaching.
import type { ActionHandlers, GameState, OfficeTier, Rng, RoleId, Star } from '../types';
import { ROLE_IDS } from '../types';
import { BALANCE } from '../balance';
import { ROLES, OFFICE_TIERS, STAR_TEMPLATES } from '../data/roles';
import { addExpense, clamp, formatMoney, newId, notify, pushNews, trySpend, yearOf } from '../util';
import { hireCostMult } from './scenario'; // v9 scenario

export const STAFF_TUNING = {
  SALARY_LEVEL_MIN: 0.8,
  SALARY_LEVEL_MAX: 1.6,
  /** Fraction of the morale gap closed per day. */
  MORALE_DRIFT: 0.03,
  /** Morale penalty while headcount exceeds the office capacity. */
  OVERCROWD_PENALTY: 15,
  /** Market salaries and star salaries inflate by this factor per year. */
  SALARY_INFLATION_PER_YEAR: 1.05,
  STAR_INFLATION_PER_YEAR: 1.04,
  STAR_GAP_MIN_DAYS: 60,
  STAR_GAP_MAX_DAYS: 120,
  STAR_TTL_DAYS: 30,
  MAX_CANDIDATES: 3,
  /** Hiring a star costs this many times the normal recruiting fee. */
  STAR_FEE_MULT: 5,
  /** Per-day chance that a low-morale or underpaid lab loses one ordinary employee. */
  POACH_CHANCE_LOW_MORALE: 0.02,
  POACH_CHANCE_UNDERPAID: 0.01,
  /** Hired stars below this loyalty can be poached. */
  STAR_POACH_LOYALTY: 25,
  STAR_POACH_CHANCE: 0.03,
};

function roleDef(role: RoleId) {
  return ROLES.find((r) => r.id === role);
}

function roleName(role: RoleId, plural = false): string {
  const r = roleDef(role);
  return plural ? r?.plural ?? role : r?.name ?? role;
}

export function headcount(s: GameState): number {
  let n = 0;
  for (const r of ROLE_IDS) n += s.staff.roles[r].count;
  n += s.staff.stars.filter((st) => st.hiredDay !== null).length;
  return n;
}

export function officeTier(s: GameState): OfficeTier {
  return OFFICE_TIERS.find((t) => t.id === s.company.officeTierId) ?? OFFICE_TIERS[0];
}

export function officeCapacity(s: GameState): number {
  return officeTier(s)?.capacity ?? 0;
}

/** Current market salary for a role ($/year), grows with AI hype and year. */
export function marketSalary(s: GameState, role: RoleId): number {
  const base = roleDef(role)?.baseSalary ?? 0;
  const inflation = Math.pow(STAFF_TUNING.SALARY_INFLATION_PER_YEAR, yearOf(s.day) - BALANCE.START_YEAR);
  return base * inflation * (1 + s.market.aiHype / 150);
}

/** Total payroll $/day including hired stars. */
export function dailyPayroll(s: GameState): number {
  let total = 0;
  for (const r of ROLE_IDS) {
    const st = s.staff.roles[r];
    total += (marketSalary(s, r) * st.salaryLevel * st.count) / 365;
  }
  for (const star of s.staff.stars) if (star.hiredDay !== null) total += star.salary / 365;
  return total;
}

export function moraleFactor(s: GameState): number {
  return 0.6 + (0.8 * s.staff.morale) / 100;
}

/** Effective "skill units" for a role: count * skill * moraleFactor. Used by other systems. */
export function roleStrength(s: GameState, role: RoleId): number {
  const st = s.staff.roles[role];
  return st.count * st.skill * moraleFactor(s);
}

/** Average salary level across roles that have people (1 when empty). */
function averageSalaryLevel(s: GameState): number {
  let sum = 0;
  let n = 0;
  for (const r of ROLE_IDS) {
    const st = s.staff.roles[r];
    if (st.count > 0) {
      sum += st.salaryLevel * st.count;
      n += st.count;
    }
  }
  return n > 0 ? sum / n : 1;
}

function spawnStar(s: GameState, rng: Rng): void {
  const taken = new Set(s.staff.stars.map((x) => x.name));
  const pool = STAR_TEMPLATES.filter((t) => !taken.has(t.name));
  if (pool.length === 0) return;
  const t = rng.pick(pool);
  const id = newId(s, 'star');
  const inflation = Math.pow(STAFF_TUNING.STAR_INFLATION_PER_YEAR, yearOf(s.day) - BALANCE.START_YEAR);
  const star: Star = {
    id,
    name: t.name,
    role: t.role,
    title: t.title,
    salary: Math.round(t.salary * inflation),
    bonuses: { ...t.bonuses },
    loyalty: rng.int(45, 80),
    hiredDay: null,
  };
  s.staff.stars.push(star);
  s.flags[`starExpires.${id}`] = s.day + STAFF_TUNING.STAR_TTL_DAYS;
  pushNews(s, `Job market: ${t.name}, ${t.title}, is open to offers (${roleName(t.role)}).`, 'info');
}

export function staffTick(s: GameState, rng: Rng): void {
  // 1. Payroll and office rent
  addExpense(s, 'payroll', dailyPayroll(s));
  addExpense(s, 'office', officeTier(s).rentPerDay);

  // 2. Morale drifts toward a target set by pay and crowding
  const hc = headcount(s);
  const cap = officeCapacity(s);
  const avgLevel = averageSalaryLevel(s);
  const hiredStars = s.staff.stars.filter((st) => st.hiredDay !== null).length;
  let target = 50 + 60 * (avgLevel - 1) + Math.min(10, hiredStars);
  if (hc > cap) target -= STAFF_TUNING.OVERCROWD_PENALTY;
  target = clamp(target, 0, 100);
  s.staff.morale = clamp(s.staff.morale + (target - s.staff.morale) * STAFF_TUNING.MORALE_DRIFT, 0, 100);

  // 3. Poaching of ordinary staff
  let poachChance = 0;
  if (s.staff.morale < 40) poachChance += STAFF_TUNING.POACH_CHANCE_LOW_MORALE;
  if (avgLevel < 0.95) poachChance += STAFF_TUNING.POACH_CHANCE_UNDERPAID;
  if (poachChance > 0 && rng.chance(poachChance)) {
    const withPeople = ROLE_IDS.filter((r) => s.staff.roles[r].count > 0);
    if (withPeople.length > 0) {
      const role = rng.pick(withPeople);
      s.staff.roles[role].count -= 1;
      notify(s, `A rival lab poached a ${roleName(role)}. Pay better or care more.`, 'bad');
      pushNews(s, `${s.company.name} loses a ${roleName(role)} to a rival lab.`, 'bad');
    }
  }

  // 4. Hired stars: loyalty follows morale, low-loyalty stars can be poached
  for (const star of s.staff.stars) {
    if (star.hiredDay === null) continue;
    star.loyalty = clamp(star.loyalty + (s.staff.morale - star.loyalty) * 0.02, 0, 100);
  }
  const poached = s.staff.stars.filter(
    (st) => st.hiredDay !== null && st.loyalty < STAFF_TUNING.STAR_POACH_LOYALTY && rng.chance(STAFF_TUNING.STAR_POACH_CHANCE),
  );
  for (const star of poached) {
    s.staff.stars = s.staff.stars.filter((x) => x.id !== star.id);
    notify(s, `${star.name} left for a rival lab. Their bonuses went with them.`, 'bad');
    pushNews(s, `${star.name} (${star.title}) has left ${s.company.name} for a rival.`, 'bad');
  }

  // 5. Candidates expire after a while
  s.staff.stars = s.staff.stars.filter((star) => {
    if (star.hiredDay !== null) return true;
    const key = `starExpires.${star.id}`;
    const expires = s.flags[key];
    if (expires !== undefined && expires <= s.day) {
      delete s.flags[key];
      pushNews(s, `${star.name} accepted another offer. The candidate pool shrinks.`, 'info');
      return false;
    }
    return true;
  });

  // 6. New star candidates appear every 60-120 days
  if (s.day >= s.staff.nextStarDay) {
    s.staff.nextStarDay = s.day + rng.int(STAFF_TUNING.STAR_GAP_MIN_DAYS, STAFF_TUNING.STAR_GAP_MAX_DAYS);
    const open = s.staff.stars.filter((st) => st.hiredDay === null).length;
    if (open < STAFF_TUNING.MAX_CANDIDATES) spawnStar(s, rng);
  }
}

export const handlers: ActionHandlers = {
  hire: (s, a, rng) => {
    const role = roleDef(a.role);
    if (!role) {
      notify(s, 'Unknown role.', 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count < 1) {
      notify(s, 'Hire at least one person.', 'bad');
      return;
    }
    const free = officeCapacity(s) - headcount(s);
    if (a.count > free) {
      const tier = officeTier(s);
      notify(
        s,
        free <= 0
          ? `${tier.name} is full (${tier.capacity} seats). Upgrade the office to hire more.`
          : `Only ${free} seat${free === 1 ? '' : 's'} free in ${tier.name}. Upgrade the office to hire more.`,
        'bad',
      );
      return;
    }
    const fee = role.hireCost * a.count * hireCostMult(s); // v9 scenario: hiring takes longer (Big Tech spinout pays 2x)
    if (!trySpend(s, 'payroll', fee, `${a.count} recruiting fee${a.count === 1 ? '' : 's'}`)) return;

    const st = s.staff.roles[a.role];
    let sum = 0;
    for (let i = 0; i < a.count; i++) sum += rng.range(0.8, 1.2);
    st.skill = (st.count * st.skill + sum) / (st.count + a.count);
    st.count += a.count;
    notify(
      s,
      `Hired ${a.count} ${a.count === 1 ? role.name : role.plural}. Recruiting fees ${formatMoney(fee)}.`,
      'good',
    );
  },

  fire: (s, a) => {
    const role = roleDef(a.role);
    if (!role) {
      notify(s, 'Unknown role.', 'bad');
      return;
    }
    if (!Number.isInteger(a.count) || a.count < 1) {
      notify(s, 'Fire at least one person.', 'bad');
      return;
    }
    const st = s.staff.roles[a.role];
    const n = Math.min(a.count, st.count);
    if (n === 0) {
      notify(s, `No ${role.plural} left to let go.`, 'bad');
      return;
    }
    st.count -= n;
    s.staff.morale = clamp(s.staff.morale - Math.min(10, n), 0, 100);
    notify(s, `Let go ${n} ${n === 1 ? role.name : role.plural}. Morale took a hit.`, 'info');
  },

  setSalaryLevel: (s, a) => {
    const role = roleDef(a.role);
    if (!role) {
      notify(s, 'Unknown role.', 'bad');
      return;
    }
    if (!Number.isFinite(a.level)) return;
    const level = clamp(Math.round(a.level * 100) / 100, STAFF_TUNING.SALARY_LEVEL_MIN, STAFF_TUNING.SALARY_LEVEL_MAX);
    s.staff.roles[a.role].salaryLevel = level;
    notify(s, `${role.plural} now paid ${Math.round(level * 100)}% of market.`, 'info');
  },

  upgradeOffice: (s, a) => {
    const idx = OFFICE_TIERS.findIndex((t) => t.id === a.tierId);
    if (idx < 0) {
      notify(s, 'Unknown office.', 'bad');
      return;
    }
    const cur = OFFICE_TIERS.findIndex((t) => t.id === s.company.officeTierId);
    if (idx <= cur) {
      notify(s, "You're already in that office or a bigger one.", 'info');
      return;
    }
    if (idx !== cur + 1) {
      notify(s, `Upgrade to ${OFFICE_TIERS[cur + 1].name} first.`, 'bad');
      return;
    }
    const tier = OFFICE_TIERS[idx];
    if (!trySpend(s, 'office', tier.cost, `the move to ${tier.name}`)) return;
    s.company.officeTierId = tier.id;
    notify(s, `Moved into ${tier.name} (capacity ${tier.capacity}).`, 'good');
    pushNews(s, `${s.company.name} moves into ${tier.name}.`, 'info');
  },

  hireStar: (s, a) => {
    const star = s.staff.stars.find((x) => x.id === a.starId);
    if (!star || star.hiredDay !== null) {
      notify(s, 'That candidate is no longer on the market.', 'bad');
      return;
    }
    if (officeCapacity(s) - headcount(s) < 1) {
      notify(s, `${officeTier(s).name} is full. Upgrade the office first.`, 'bad');
      return;
    }
    const fee = (roleDef(star.role)?.hireCost ?? 0) * STAFF_TUNING.STAR_FEE_MULT;
    if (!trySpend(s, 'payroll', fee, `${star.name}'s recruiting package`)) return;
    star.hiredDay = s.day;
    delete s.flags[`starExpires.${star.id}`];
    notify(s, `${star.name} joined as ${star.title}.`, 'milestone');
    pushNews(s, `${s.company.name} hires ${star.name}, ${star.title}.`, 'milestone');
  },
};
