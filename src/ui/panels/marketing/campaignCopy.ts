// OWNER: v10 MARKETING agent (GAME_DESIGN §21.5). Plain-language copy and launch status for campaigns.
// Pure functions: no Preact here, so the Marketing screen and the Market screen read the same rules.
import { CAMPAIGNS } from '../../../sim/data/campaigns';
import { MAX_ACTIVE_CAMPAIGNS } from '../../../sim/systems/market';
import type { CampaignDef, GameState, Segment } from '../../../sim/types';
import { calendarYear, dayToDate, formatMoney } from '../../../sim/util';

/** Campaigns the sim lets run at once. */
export const MAX_RUNNING_CAMPAIGNS = MAX_ACTIVE_CAMPAIGNS;

export const SEGMENT_NAME: Record<Segment, string> = { consumer: 'Consumers', developer: 'Developers', enterprise: 'Enterprise' };

const SEGMENT_BUYERS: Record<Segment, string> = { consumer: 'consumers', developer: 'developers', enterprise: 'enterprise buyers' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "14 Mar 2019" from a day number. */
export function dayLabel(day: number): string {
  const d = dayToDate(Math.round(day));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Who a campaign is aimed at, in words. */
export function targetLabel(def: CampaignDef): string {
  return def.segment ? `${SEGMENT_NAME[def.segment]} only` : 'All markets';
}

/**
 * What a campaign does, in words. Brand is company-wide, so a segment target only says it brings more buyers into that
 * segment for every lab (the sim's targeted-campaign boost). No raw numbers.
 */
export function campaignEffects(def: CampaignDef): string[] {
  const out: string[] = [];
  out.push(def.brandPerDay >= 1 ? 'Strongly raises brand awareness' : def.brandPerDay >= 0.3 ? 'Raises brand awareness' : 'Slightly raises brand awareness');
  out.push(def.hypePerDay >= 2 ? 'Creates a burst of hype' : def.hypePerDay >= 0.8 ? 'Builds hype' : 'Adds a little hype');
  if (def.segment) out.push(`Brings more ${SEGMENT_BUYERS[def.segment]} into the market, for every lab`);
  return out;
}

/** Why a campaign cannot be launched right now, or null when it can. */
export function launchBlock(s: GameState, def: CampaignDef): string | null {
  if (s.market.campaigns.some((c) => c.defId === def.id)) return 'Running now';
  if (calendarYear(s.day) < def.minYear) return `Opens in ${def.minYear}`;
  if (s.market.campaigns.length >= MAX_RUNNING_CAMPAIGNS) return `All ${MAX_RUNNING_CAMPAIGNS} slots in use`;
  if (s.finance.cash < def.cost) return `Needs ${formatMoney(def.cost, 1)} cash`;
  return null;
}

/** A warning that does not block the launch: consumer campaigns do nothing until consumer chat opens. */
export function campaignNote(s: GameState, def: CampaignDef): string | null {
  if (def.segment === 'consumer' && !('chatMoment' in s.flags)) return 'Consumer chat has not opened yet, so this adds no buyers yet';
  return null;
}

export interface RunningWindow {
  defId: string;
  name: string;
  cost: number;
  days: number;
  daysLeft: number;
  /** Day it went live, derived from the days it has used up (the sim stores daysLeft only). */
  start: number;
  /** Last day it runs, today + daysLeft. */
  end: number;
  segment?: Segment;
}

/** Running campaigns with their dates. The sim stores only daysLeft, so start = today - days used. */
export function runningWindows(s: GameState): RunningWindow[] {
  return s.market.campaigns.map((c) => {
    const def = CAMPAIGNS.find((d) => d.id === c.defId);
    const days = def?.days ?? c.daysLeft;
    const used = Math.max(0, days - c.daysLeft);
    return {
      defId: c.defId,
      name: def?.name ?? c.defId,
      cost: def?.cost ?? 0,
      days,
      daysLeft: c.daysLeft,
      start: s.day - used,
      end: s.day + c.daysLeft,
      segment: def?.segment,
    };
  });
}
