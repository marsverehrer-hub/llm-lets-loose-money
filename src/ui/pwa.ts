// Offline cache for the built game. Production builds only, and only where the browser allows service workers in a
// secure context (https, or localhost for testing). Everything else in the app works without it.

/** Registers public/sw.js. Safe to call anywhere: failures are logged, never thrown. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const { protocol, hostname } = window.location;
  const secure = protocol === 'https:' || hostname === 'localhost';
  if (!secure) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
      console.warn('Service worker not registered', err);
    });
  });
}
