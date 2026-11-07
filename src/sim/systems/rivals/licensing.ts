// v22: licensing a released model to a rival lab. The lab pays a royalty for a year, and while the deal runs its next
// releases get a small quality bump: the trade-off of helping a rival.
import type { ActionHandlers, GameState, Id, ModelLicense } from '../../types';
import { addRevenue, formatMoney, notify, pushNews } from '../../util';
import { modelAllows } from '../hub';
import { labName } from '../labs';
import { RIVAL_TUNING } from './tuning';

const T = RIVAL_TUNING;

/** The deal this lab holds, if any and still running. */
function dealOf(s: GameState, labId: Id): ModelLicense | undefined {
  return s.modelLicenses?.find((d) => d.labId === labId && s.day < d.endDay);
}

/** Quality points a lab's releases gain while it licenses one of the player's models. */
export function licenseBoost(s: GameState, labId: Id): number {
  return dealOf(s, labId) ? T.LICENSE_QUALITY_BOOST : 0;
}

/** What the lab pays a year: a share of its valuation, never under the minimum. */
export function royaltyPerYear(s: GameState, labId: Id): number {
  const valuation = s.competitors.find((c) => c.id === labId)?.valuation ?? 0;
  return Math.max(T.LICENSE_MIN_PER_YEAR, valuation * T.LICENSE_VALUATION_SHARE);
}

/** Why no model can be licensed to this lab right now (guests, an inactive lab, a deal already running), or null. */
export function labLicenseBlock(s: GameState, labId: Id): string | null {
  if (s.mp?.role === 'guest') return 'Only the host can license models in a match.';
  const lab = s.rivals?.find((l) => l.id === labId);
  if (!lab || lab.status !== 'active') return 'Only active labs can license a model.';
  if (dealOf(s, labId)) return `${labName(s, labId)} already licenses a model from you.`;
  return null;
}

/** Why the player cannot license this model to this lab right now, or null when they can. The Field and the action both read it. */
export function licenseBlock(s: GameState, modelId: Id, labId: Id): string | null {
  const blocked = labLicenseBlock(s, labId);
  if (blocked) return blocked;
  const m = s.models.find((x) => x.id === modelId);
  if (!m || m.releasedDay === null || m.deprecated) return 'Only a released model that is still on sale can be licensed.';
  if (!modelAllows(m, 'contract')) return `${m.origin?.license} weights can't be licensed out.`;
  const lab = s.rivals!.find((l) => l.id === labId)!;
  const best = lab.models.reduce((a, x) => Math.max(a, x.overall), 0);
  if (m.overall <= best) return `${labName(s, labId)} already has a model as good as ${m.name}.`;
  return null;
}

/** Daily: books the running royalties and drops deals that ended or whose lab left the field. */
export function licensingDay(s: GameState): void {
  if (!s.modelLicenses?.length) return;
  s.modelLicenses = s.modelLicenses.filter((d) => s.day < d.endDay && s.rivals?.find((l) => l.id === d.labId)?.status === 'active');
  for (const d of s.modelLicenses) addRevenue(s, 'other', d.royaltyPerDay);
}

export const handlers: ActionHandlers = {
  licenseModel: (s, a) => {
    const block = licenseBlock(s, a.modelId, a.labId);
    if (block) {
      notify(s, block, 'bad');
      return;
    }
    const m = s.models.find((x) => x.id === a.modelId)!;
    const year = royaltyPerYear(s, a.labId);
    const deal: ModelLicense = { modelId: m.id, labId: a.labId, startDay: s.day, endDay: s.day + T.LICENSE_DAYS, royaltyPerDay: year / 365 };
    s.modelLicenses = [...(s.modelLicenses ?? []), deal];
    notify(s, `${labName(s, a.labId)} licenses ${m.name} for ${formatMoney(year)} a year.`, 'milestone');
    pushNews(s, `${s.company.name} licenses ${m.name} to ${labName(s, a.labId)}.`, 'milestone');
  },
};
