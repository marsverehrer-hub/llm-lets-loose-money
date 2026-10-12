// OWNER: Agent VAULT-B. Release modes and internal deployment. GAME_DESIGN §17.7.
// Implemented by VAULT-B; the exported signatures are the UI contract.
import type { ActionHandlers, GameState, Id, Model, ReleaseMode, Rng } from '../types';
import { getBonuses } from '../bonuses';
import { LATENT_DISCOVERY_COPY, pickCopy } from '../data/evalCopy';
import { DOCTRINE_TUNING } from '../data/doctrines';
import { NAMING_SCHEMES } from '../data/names';
import { quirkById } from '../data/quirks';
import { addExpense, clamp, formatMoney, notify, pushNews, yearOf } from '../util';
import { releaseSota, specById } from './capabilities';
import { researchPointsPerDay } from './research';
import { frontierQuality } from './market';
import { onRelease } from './vault';
import { enforceOpenRelease } from './scenario'; // v9 scenario

/**
 * Latent-quirk and arena constants that mirror LAB_TUNING in lab.ts. They are copied rather than imported: lab.ts
 * reads RUN_TUNING at load time, and release.ts is imported by research.ts, so importing lab.ts here creates a cycle
 * through data/trainingOptions that leaves RUN_TUNING undefined. Keep the values in step with lab.ts.
 */
const LAB_MIRROR = {
  ELO_SETTLE_DAYS: 21,
  LATENT_SURFACE_PER_DAY: 0.02,
  GOOD_QUIRK_HYPE: 5,
  BAD_QUIRK_REP: -3,
  BAD_QUIRK_HYPE: -2,
};

/** Tunables for release modes and internal use (GAME_DESIGN §17.7). */
export const RELEASE_TUNING = {
  /** A preview lasts this many days, then auto-promotes unless it was promoted earlier. */
  PREVIEW_DAYS: 30,
  /** Share of the full-release hype and brand that a preview gives up front (the rest comes at promotion). */
  PREVIEW_HYPE_SHARE: 0.5,
  /** Products serving a preview model reach at most this share of their demand. */
  PREVIEW_DEMAND_CAP: 0.15,
  /** Latent quirks in a preview surface this many times faster than the lab's base daily rate. */
  PREVIEW_LATENT_MULT: 5,
  /** Open weights: flat brand and reputation on top of the full-release gains. */
  OPEN_BRAND: 8,
  OPEN_REPUTATION: 6,
  /** Products serving an open model keep this share of their users (self-hosting takes the rest, for good). */
  OPEN_USER_MULT: 0.75,
  /** Added to the rivals' openBoost flag (the lead wires it into competitor releases). */
  OPEN_RIVAL_BOOST: 2,
  /** Internal research: bonus per unit of gap, where gap = clamp((overall − frontier + OFFSET) / SPAN, 0, UNIT_MAX). */
  INTERNAL_RESEARCH_PER_UNIT: 0.25,
  INTERNAL_GAP_OFFSET: 10,
  INTERNAL_GAP_SPAN: 20,
  INTERNAL_UNIT_MAX: 1.2,
  /** Daily inference cost of an internal model: active params (billions) × this, in dollars. */
  INTERNAL_COST_PER_PARAM_DAY: 40,
};

const RELEASE_MODES: ReleaseMode[] = ['full', 'preview', 'open'];

export interface ReleasePreview { mode: ReleaseMode; hype: number; brand: number; reputation: number; notes: string[] }

interface ReleaseGains { brand: number; hype: number; aiHype: number; beatsArena: boolean; beatsOwn: boolean }

function arenaLeaderElo(s: GameState): number | null {
  let best: number | null = null;
  for (const c of s.competitors) {
    const elo = c.model?.elo;
    if (elo !== undefined && (best === null || elo > best)) best = elo;
  }
  return best;
}

/** v8 doctrine: share of users a product keeps when serving open weights, given the lab's openPenalty (0.75 at neutral). */
export function openUserShareFor(s: GameState): number {
  return 1 - (1 - RELEASE_TUNING.OPEN_USER_MULT) * (getBonuses(s).openPenalty ?? 1);
}

/** v8 doctrine: brand multiplier on open releases (1.5 under the open doctrine, else 1). */
function openBrandMult(s: GameState): number {
  return s.company.doctrine === 'open' ? DOCTRINE_TUNING.OPEN_BRAND_MULT : 1;
}

/** Full-release gains for a model right now (brand, hype, market AI hype), before any mode split. */
function releaseGains(s: GameState, m: Model): ReleaseGains {
  const arena = arenaLeaderElo(s);
  const beatsArena = arena === null || m.elo > arena;
  let prevBest = -1;
  for (const x of s.models) if (x.releasedDay !== null && x.id !== m.id) prevBest = Math.max(prevBest, x.overall);
  const beatsOwn = m.overall > prevBest;
  const arenaF = beatsArena ? 1 : 0.4;
  const ownF = beatsOwn ? 1 : 0.5;
  const bonuses = getBonuses(s);
  // v8: releaseHype scales both the hype and the brand a release brings in (doctrine).
  const rh = bonuses.releaseHype ?? 1;
  return {
    brand: (2 + 4 * arenaF) * ownF * bonuses.brand * rh,
    hype: ((5 + 15 * arenaF) * ownF + (specById(m.specId)?.releaseHype ?? 0)) * rh,
    aiHype: (beatsArena ? 1.5 : 0.3) * ownF,
    beatsArena,
    beatsOwn,
  };
}

/** What releasing `m` in `mode` would do right now (hype/brand/rep deltas and one-line consequences). */
export function releasePreview(s: GameState, m: Model, mode: ReleaseMode): ReleasePreview {
  if (m.releasedDay !== null) return { mode, hype: 0, brand: 0, reputation: 0, notes: [`${m.name} is already public.`] };
  const g = releaseGains(s, m);
  if (mode === 'preview') {
    const share = RELEASE_TUNING.PREVIEW_HYPE_SHARE;
    return {
      mode,
      hype: g.hype * share,
      brand: g.brand * share,
      reputation: 0,
      notes: [
        `Limited preview for ${RELEASE_TUNING.PREVIEW_DAYS} days. Products serve it up to ${Math.round(RELEASE_TUNING.PREVIEW_DEMAND_CAP * 100)}% of their demand.`,
        `Half the hype now. The rest comes when you promote it, or when the preview runs out.`,
        `Hidden quirks surface about ${RELEASE_TUNING.PREVIEW_LATENT_MULT} times faster.`,
      ],
    };
  }
  if (mode === 'open') {
    const lossPct = Math.round((1 - openUserShareFor(s)) * 100);
    return {
      mode,
      hype: g.hype,
      brand: (g.brand + RELEASE_TUNING.OPEN_BRAND) * openBrandMult(s),
      reputation: RELEASE_TUNING.OPEN_REPUTATION,
      notes: [
        'Anyone can download the weights. This cannot be undone.',
        `Every product serving it loses ${lossPct}% of its users to self-hosting, for good.`,
        'Rivals learn from it.',
      ],
    };
  }
  return {
    mode: 'full',
    hype: g.hype,
    brand: g.brand,
    reputation: 0,
    notes: ['Public on day one. Every product can serve it.', 'Teasers resolve now.'],
  };
}

/** Research speed multiplier from the best internally deployed model (1 = none). */
export function internalResearchMult(s: GameState): number {
  let best: Model | undefined;
  for (const m of s.models) if (m.internal && !m.deprecated && (!best || m.overall > best.overall)) best = m;
  if (!best) return 1;
  const { INTERNAL_GAP_OFFSET, INTERNAL_GAP_SPAN, INTERNAL_UNIT_MAX, INTERNAL_RESEARCH_PER_UNIT } = RELEASE_TUNING;
  const gap = clamp((best.overall - frontierQuality(yearOf(s.day)) + INTERNAL_GAP_OFFSET) / INTERNAL_GAP_SPAN, 0, INTERNAL_UNIT_MAX);
  return 1 + INTERNAL_RESEARCH_PER_UNIT * gap;
}

/** Daily compute cost of keeping `m` deployed internally. */
export function internalCostPerDay(m: Model): number {
  return (m.activeParamsB ?? m.paramsB) * RELEASE_TUNING.INTERNAL_COST_PER_PARAM_DAY;
}

/** Demand cap for products serving a preview model (1 = uncapped). */
export function previewDemandCap(m: Model | undefined): number {
  return m?.releaseMode === 'preview' ? RELEASE_TUNING.PREVIEW_DEMAND_CAP : 1;
}

/**
 * User share a product keeps when serving `m` for the open-weights penalty (1 = none). The share is snapshotted on
 * the model at open release, so the doctrine it was released under is the one that sticks.
 */
export function openUserMult(m: Model | undefined): number {
  return m?.releaseMode === 'open' ? (m.openUserShare ?? RELEASE_TUNING.OPEN_USER_MULT) : 1;
}

/** Tell the player about a latent quirk that a preview's users have found (same copy and effects as labTick). */
function surfaceQuirk(s: GameState, m: Model, q: Id, rng: Rng): void {
  m.latentQuirks = (m.latentQuirks ?? []).filter((x) => x !== q);
  if (!(m.quirks ?? []).includes(q)) m.quirks = [...(m.quirks ?? []), q];
  const def = quirkById(q);
  const good = def?.good === true;
  const text = pickCopy(rng, LATENT_DISCOVERY_COPY[good ? 'good' : 'bad'], { model: m.name, quirk: def?.name ?? q });
  if (good) {
    s.company.hype = clamp(s.company.hype + LAB_MIRROR.GOOD_QUIRK_HYPE, 0, 100);
  } else {
    s.company.reputation = clamp(s.company.reputation + LAB_MIRROR.BAD_QUIRK_REP, 0, 100);
    s.company.hype = clamp(s.company.hype + LAB_MIRROR.BAD_QUIRK_HYPE, 0, 100);
  }
  pushNews(s, text, good ? 'good' : 'bad');
  notify(s, text, good ? 'good' : 'bad');
}

/** Turn a preview into a full release: the remaining hype and brand, the Elo settles, the SOTA headlines land. */
function promoteModel(s: GameState, m: Model, auto: boolean): void {
  const g = releaseGains(s, m);
  const rest = 1 - RELEASE_TUNING.PREVIEW_HYPE_SHARE;
  const brand = g.brand * rest;
  const hype = g.hype * rest;
  s.company.brand = clamp(s.company.brand + brand, 0, 100);
  s.company.hype = clamp(s.company.hype + hype, 0, 100);
  s.market.aiHype = clamp(s.market.aiHype + g.aiHype * rest, 0, 100);
  m.releaseMode = 'full';
  delete m.previewUntil;
  m.eloSettlesDay = s.day;
  const sota = releaseSota(s, m);
  const label = m.specId ? `${m.name} (${specById(m.specId)?.name ?? 'fine-tune'})` : m.name;
  pushNews(
    s,
    auto
      ? `${s.company.name}'s preview of ${label} runs out, and it becomes a full release. Nobody scheduled that.`
      : `${s.company.name} promotes ${label} from preview to full release (Elo ${Math.round(m.elo)}).`,
    'milestone',
  );
  const prefix = auto ? `The preview of ${m.name} ran out and it is now a full release` : `Promoted ${m.name} to a full release`;
  notify(
    s,
    `${prefix}: brand +${brand.toFixed(1)}, hype +${hype.toFixed(1)}${sota ? `, ${sota} headline SOTA${sota > 1 ? 's' : ''}` : ''}.`,
    'good',
  );
}

export function releaseTick(s: GameState, rng: Rng): void {
  // Internal deployments cost inference every day, whether or not the model is public.
  for (const m of s.models) {
    if (m.internal && !m.deprecated) addExpense(s, 'compute', internalCostPerDay(m));
  }
  // Previews that reach their end date auto-promote.
  for (const m of s.models) {
    if (m.releaseMode !== 'preview' || m.releasedDay === null || m.deprecated || m.previewUntil === undefined) continue;
    if (s.day >= m.previewUntil) promoteModel(s, m, true);
  }
  // labTick already rolls each latent quirk at the base daily rate. Add the rest of the multiplier for previews.
  const extra = (RELEASE_TUNING.PREVIEW_LATENT_MULT - 1) * LAB_MIRROR.LATENT_SURFACE_PER_DAY;
  for (const m of s.models) {
    if (m.releaseMode !== 'preview' || m.releasedDay === null || !m.latentQuirks?.length) continue;
    for (const q of [...m.latentQuirks]) {
      if (rng.chance(extra)) surfaceQuirk(s, m, q, rng);
    }
  }
}

/** Registered AFTER training handlers in engine.ts, so its releaseModel replaces the old one. */
export const handlers: ActionHandlers = {
  releaseModel: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is already public.`, 'info');
      return;
    }
    if (m.deprecated) {
      notify(s, `${m.name} is deprecated and can't be released.`, 'bad');
      return;
    }
    const mode: ReleaseMode = enforceOpenRelease(s, a.mode ?? 'full'); // v9 scenario: open-only scenarios
    if (!RELEASE_MODES.includes(mode)) {
      notify(s, 'Pick a release mode: full, preview or open.', 'bad');
      return;
    }
    const rename = a.publicName?.trim().slice(0, 40);
    if (rename) {
      if (!m.codename) m.codename = m.name;
      m.name = rename;
    }

    const g = releaseGains(s, m);
    const preview = mode === 'preview';
    const share = preview ? RELEASE_TUNING.PREVIEW_HYPE_SHARE : 1;
    const isOpen = mode === 'open';
    const brandGain = (g.brand * share + (isOpen ? RELEASE_TUNING.OPEN_BRAND : 0)) * (isOpen ? openBrandMult(s) : 1);
    const hypeGain = g.hype * share;
    const repGain = isOpen ? RELEASE_TUNING.OPEN_REPUTATION : 0;
    s.company.brand = clamp(s.company.brand + brandGain, 0, 100);
    s.company.hype = clamp(s.company.hype + hypeGain, 0, 100);
    s.company.reputation = clamp(s.company.reputation + repGain, 0, 100);
    s.market.aiHype = clamp(s.market.aiHype + g.aiHype * share, 0, 100);
    if (isOpen) s.flags['openBoost'] = (s.flags['openBoost'] ?? 0) + RELEASE_TUNING.OPEN_RIVAL_BOOST;
    // v8 doctrine (open): open weights bank research points, worth OPEN_RESEARCH_DAYS of current output.
    let rpGain = 0;
    if (isOpen && s.company.doctrine === 'open' && s.research.current) {
      rpGain = DOCTRINE_TUNING.OPEN_RESEARCH_DAYS * researchPointsPerDay(s);
      s.research.progress += rpGain;
    }
    if (isOpen) m.openUserShare = openUserShareFor(s);

    m.releaseMode = mode;
    m.releasedDay = s.day;
    m.eloSettlesDay = s.day + (preview ? RELEASE_TUNING.PREVIEW_DAYS : LAB_MIRROR.ELO_SETTLE_DAYS);
    if (preview) m.previewUntil = s.day + RELEASE_TUNING.PREVIEW_DAYS;
    s.stats.modelsReleased += 1;
    s.stats.bestElo = Math.max(s.stats.bestElo, m.elo);

    const lines = onRelease(s, m);
    const elo = Math.round(m.elo);
    const label = m.specId ? `${m.name} (${specById(m.specId)?.name ?? 'fine-tune'})` : m.name;
    let sota = 0;
    if (preview) {
      pushNews(s, `${s.company.name} opens a limited preview of ${label}. Thirty days, a waitlist, and a very long blog post.`, 'info');
    } else {
      if (g.beatsArena) {
        pushNews(s, `${s.company.name} releases ${label} and takes the top spot on the arena (Elo ${elo}).`, 'milestone');
      } else if (g.beatsOwn) {
        pushNews(s, `${s.company.name} releases ${label}. Good model, not the arena leader (Elo ${elo}).`, 'good');
      } else {
        pushNews(s, `${s.company.name} releases ${label}. A step back from the last flagship (Elo ${elo}).`, 'info');
      }
      if (mode === 'open') pushNews(s, `${s.company.name} puts the weights of ${label} online. Competitors are reading the README.`, 'milestone');
      // Headline SOTAs wait for promotion when the model is only in preview.
      sota = releaseSota(s, m);
    }

    const parts = [`brand +${brandGain.toFixed(1)}`, `hype +${hypeGain.toFixed(1)}`];
    if (repGain) parts.push(`reputation +${repGain}`);
    if (rpGain) parts.push(`research +${rpGain.toFixed(0)} RP`);
    if (sota) parts.push(`${sota} headline SOTA${sota > 1 ? 's' : ''}`);
    const head = preview
      ? `Previewing ${m.name} for ${RELEASE_TUNING.PREVIEW_DAYS} days: ${parts.join(', ')}. Promote it for the rest.`
      : `Released ${m.name}${mode === 'open' ? ' as open weights' : ''}: ${parts.join(', ')}.`;
    notify(s, [head, ...lines].join(' '), 'good');
  },

  promotePreview: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.releaseMode !== 'preview') {
      notify(s, `${m.name} is not in preview.`, 'bad');
      return;
    }
    if (m.deprecated) {
      notify(s, `${m.name} is deprecated and can't be promoted.`, 'bad');
      return;
    }
    promoteModel(s, m, false);
  },

  deployInternally: (s, a) => {
    const m = s.models.find((x) => x.id === a.modelId);
    if (!m) {
      notify(s, 'That model no longer exists.', 'bad');
      return;
    }
    if (m.deprecated) {
      notify(s, `${m.name} is deprecated. Internal use is for models that still work.`, 'bad');
      return;
    }
    if (!a.on) {
      if (!m.internal) return;
      m.internal = false;
      notify(s, `${m.name} is back in the drawer. Research goes back to its normal pace.`, 'info');
      return;
    }
    if (m.releasedDay !== null) {
      notify(s, `${m.name} is public already. Internal use is for models nobody has seen.`, 'bad');
      return;
    }
    m.internal = true;
    const mult = internalResearchMult(s);
    notify(
      s,
      `${m.name} is now an internal tool. Research runs ${Math.round((mult - 1) * 100)}% faster, and it costs ${formatMoney(internalCostPerDay(m))} a day.`,
      'good',
    );
  },

  setNamingScheme: (s, a) => {
    const scheme = NAMING_SCHEMES.find((x) => x.id === a.schemeId);
    if (!scheme) {
      notify(s, 'Unknown naming scheme.', 'bad');
      return;
    }
    s.company.namingScheme = scheme.id;
    notify(s, `Naming scheme: ${scheme.name}. ${scheme.description}`, 'info');
  },
};
