// Milestone feedback: a notice in the toast stack (shell/Toasts.tsx) and a brief colour
// inversion of the top-bar cash readout. Static colour swaps only; no motion.

/** Window event carrying a BannerDetail. Toasts listens for it. */
export const BANNER_EVENT = 'llm:banner';

export interface BannerDetail {
  head: string;
  text: string;
}

let flashTimer = 0;

/** Invert the cash readout in the top bar for a moment (no-op if the bar is not mounted). */
export function flashCash(): void {
  if (typeof document === 'undefined') return;
  const el = document.querySelector<HTMLElement>('.topbar-stat.cash');
  if (!el) return;
  el.classList.add('fx-flash');
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove('fx-flash'), 420);
}

/** Post a milestone-style notice. It never covers the panel header; Toasts renders it. */
export function announce(head: string, text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<BannerDetail>(BANNER_EVENT, { detail: { head, text } }));
}
