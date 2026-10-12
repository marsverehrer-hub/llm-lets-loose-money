// Labels and formatters for the Data screen. Pure: no Preact, no state.
import type { CapId, DataAcquisition, DataDomain, DataKind, DatasetDef, GameState, Id, ProductKind, Scores } from '../../../sim/types';
import type { DatasetStatus } from '../../../sim/systems/data';
import { RESEARCH } from '../../../sim/data/research';
import { labName } from '../../../sim/systems/labs';
import { formatMoney, formatNumber } from '../../../sim/util';
import type { PillTone } from '../../components';

export const KIND_LABEL: Record<DataKind, string> = {
  web: 'Web',
  books: 'Books',
  code: 'Code',
  science: 'Science',
  dialogue: 'Dialogue',
  synthetic: 'Synthetic',
  multimodal: 'Multimodal',
};
export const KIND_KEYS = Object.keys(KIND_LABEL) as DataKind[];

export const DOMAIN_LABEL: Record<DataDomain, string> = {
  general: 'General',
  code: 'Code',
  math: 'Maths',
  science: 'Science',
  medical: 'Medical',
  legal: 'Legal',
  finance: 'Finance',
  multilingual: 'Multilingual',
  creative: 'Creative',
  dialogue: 'Dialogue',
  vision: 'Vision',
  audio: 'Audio',
  video: 'Video',
  gaming: 'Gaming',
  robotics: 'Robotics',
  safety: 'Safety',
  news: 'News',
};
export const DOMAIN_KEYS = Object.keys(DOMAIN_LABEL) as DataDomain[];

export const ACQ_KEYS: DataAcquisition[] = ['open', 'purchase', 'scrape', 'license', 'partnership', 'crowdsource', 'generate', 'userdata'];
export const ACQ: Record<DataAcquisition, { label: string; tone: PillTone; help: string }> = {
  open: { label: 'Open', tone: 'muted', help: 'Free and public. Low quality, and nobody can sue you over it.' },
  purchase: { label: 'Purchase', tone: 'default', help: 'One-off payment. The seller keeps the receipts.' },
  scrape: { label: 'Scrape', tone: 'bad', help: 'Cheap and ethically flexible. Expect legal letters.' },
  license: { label: 'Licence', tone: 'info', help: 'Signing fee, then an annual fee for as long as you keep it.' },
  partnership: { label: 'Partnership', tone: 'milestone', help: 'Exclusive deal with a fee. Rivals can sign it first.' },
  crowdsource: { label: 'Commission', tone: 'good', help: 'Paid humans, slow and careful. Ordered through the Commission window.' },
  generate: { label: 'Synthetic', tone: 'info', help: 'Written by one of your own models. Watch for collapse.' },
  userdata: { label: 'User data', tone: 'bad', help: 'Harvested from your products. Privacy heat rises while you do it.' },
};

export const STATUS_KEYS: DatasetStatus[] = ['owned', 'available', 'locked', 'lost', 'pending'];
export const STATUS: Record<DatasetStatus, { label: string; tone: PillTone }> = {
  owned: { label: 'Owned', tone: 'good' },
  available: { label: 'Available', tone: 'default' },
  locked: { label: 'Locked', tone: 'muted' },
  lost: { label: 'Lost', tone: 'bad' },
  pending: { label: 'In flight', tone: 'milestone' },
};

export const CAP_LABEL: Record<CapId, string> = {
  knowledge: 'Knowledge',
  reasoning: 'Reasoning',
  math: 'Maths',
  coding: 'Coding',
  agentic: 'Agentic',
  chat: 'Chat',
  vision: 'Vision',
  safety: 'Safety',
  multilingual: 'Multilingual',
  longContext: 'Long context',
};
export const SCORE_LABEL: Record<keyof Scores, string> = { reasoning: 'Reasoning', coding: 'Coding', chat: 'Chat', safety: 'Safety' };
export const PRODUCT_LABEL: Record<ProductKind, string> = { api: 'API', chat: 'Chat', enterprise: 'Enterprise' };

/** "1 day", "3 days". */
export const plural = (n: number, word: string): string => `${Math.max(0, Math.round(n))} ${word}${Math.round(n) === 1 ? '' : 's'}`;

/** Token counts in billions, shown as "5B", "320M", "2T". */
export const fmtTok = (tokensB: number): string => formatNumber(tokensB * 1e9, 1).replace(/\.0(?=[A-Za-z]|$)/, '');
/** Money, shown as "$20K", "$1.5M", "$2B". */
export const usd = (v: number): string => formatMoney(v, 1).replace(/\.0(?=[KMBT]|$)/, '');
export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const sig2 = (v: number): number => (v > 0 ? Number(v.toPrecision(2)) : 0);

/** Log-scale slider: position 0..1000 <-> value in [min, max]. */
export function toPos(v: number, min: number, max: number): number {
  return Math.round((1000 * (Math.log(v) - Math.log(min))) / (Math.log(max) - Math.log(min)));
}
export function fromPos(p: number, min: number, max: number): number {
  return sig2(Math.exp(Math.log(min) + (p / 1000) * (Math.log(max) - Math.log(min))));
}

export function acqOf(d: DatasetDef): DataAcquisition {
  return d.acquisition ?? 'purchase';
}
export function isLicensedKind(d: DatasetDef): boolean {
  const a = acqOf(d);
  return a === 'license' || a === 'partnership';
}
/** Cash needed to sign or buy a set now: the one-off cost plus the first year's fee for licences. */
export function upfrontOf(d: DatasetDef): number {
  return d.cost + (isLicensedKind(d) ? d.annualFee ?? 0 : 0);
}
export function verbOf(d: DatasetDef): string {
  switch (acqOf(d)) {
    case 'open':
      return 'Take';
    case 'scrape':
      return 'Scrape';
    case 'license':
      return 'Sign licence';
    case 'partnership':
      return 'Sign deal';
    default:
      return 'Buy';
  }
}

/** Three-step risk reading for one number in 0..1. */
export function riskLevel(v: number): { label: string; tone: PillTone } {
  if (v < 0.25) return { label: 'Low', tone: 'good' };
  if (v < 0.55) return { label: 'Medium', tone: 'milestone' };
  return { label: 'High', tone: 'bad' };
}

/** Quality per dollar: quality over the log of the total price, so free sets are not infinite. */
export function valueOf(d: DatasetDef, quality: number): number {
  return quality / Math.log10(10 + d.cost + (d.annualFee ?? 0));
}

/** Signed quality delta as a fraction, e.g. "+0.06" or "−0.14". */
export function signedFrac(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
}
export function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)}`;
}

/** The sim does not store the winner of a contested set, but it always writes a news line naming them. */
export function lostTo(s: GameState, d: DatasetDef): string | null {
  for (const id of d.contestedBy ?? []) {
    const name = labName(s, id);
    const line = `${name} signs exclusive deal with ${d.name}`;
    if (s.news.some((n) => n.text.includes(line))) return name;
  }
  return null;
}

export function requirements(d: DatasetDef): string[] {
  const out: string[] = [];
  if (d.requiresResearch) out.push(`Research: ${RESEARCH.find((r) => r.id === d.requiresResearch)?.name ?? d.requiresResearch}`);
  if (d.requiresProduct) out.push(`A live ${PRODUCT_LABEL[d.requiresProduct]} product`);
  if (d.requiresModelOverall !== undefined) out.push(`A released model at ${d.requiresModelOverall} overall`);
  return out;
}

export function freshnessOf(d: DatasetDef, year: number): string {
  if (!d.freshnessYear) return 'Undated';
  const age = year - d.freshnessYear;
  return age >= 3 ? `Covers to ${d.freshnessYear}, getting old` : `Covers to ${d.freshnessYear}`;
}

export function isLicence(s: GameState, id: Id): boolean {
  return s.data.licenses?.[id] !== undefined;
}
