// Light/dark theme switch. Dark is the default. The choice lives on <html data-theme>
// (theme.css reads it) and persists to localStorage. index.html applies it before paint.

export type Theme = 'dark' | 'light';

export const THEME_KEY = 'llm-lets-loose-money/theme';

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

/** Set the theme on the document only (no storage write). */
export function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  if (t === 'light') document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
}

/** Apply and remember the theme. Storage can be blocked, so failures are ignored. */
export function setTheme(t: Theme): void {
  applyTheme(t);
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    /* private window or blocked storage: the theme still applies for this visit */
  }
}
