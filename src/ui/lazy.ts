// Named-export lazy loading for Preact. The chunk is fetched when the component first renders, so it stays off the
// first-paint path. Wrap each use in <Suspense> (preact/compat) so a loading chunk shows nothing rather than blanking the app.
import { lazy } from 'preact/compat';
import type { ComponentType } from 'preact';

export function lazyNamed<K extends string>(load: () => Promise<Record<K, ComponentType<any>>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })));
}
