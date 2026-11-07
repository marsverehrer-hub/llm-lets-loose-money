// Products screen (GAME_DESIGN §21.5): what you sell, what it earns, what it costs to serve, and the margin.
import { useState } from 'preact/hooks';
import { getState, useGame } from '../store';
import { formatMoney } from '../../sim/util';
import { PanelHeader, PanelIntro, Card, Stat } from '../components';
import type { ProductKind } from '../../sim/types';
import { Empty, ViewDisclosure } from './panelKit';
import { liveLines, MAX_LINES_PER_KIND, unlockedProductKinds } from '../../sim/systems/products';
import { useIntent } from '../nav';
import { economics } from './products/productsKit';
import { LaunchSheet, LaunchTiles } from './products/LaunchSheet';
import { LiveProductCard } from './products/ProductCard';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createStreet, CAM as STREET_CAM } from '../../scenes/products';
import './panels.css';
import './products/products.css';

export function ProductsPanel() {
  const s = useGame();
  const live = s.products.filter((p) => p.active);
  const revenue = live.reduce((a, p) => a + economics(p).revenue, 0);
  const serving = live.reduce((a, p) => a + economics(p).cost, 0);
  const margin = revenue - serving;
  const [launchKind, setLaunchKind] = useState<ProductKind | null>(null);
  // v17.2: "Launch a product" elsewhere opens the launch sheet for that kind, or the first kind with a free slot.
  useIntent('products', (i) => {
    if (!('open' in i) || i.open !== 'launch') return;
    const now = getState(); // the hook keeps its first closure, so read the live state
    const open = unlockedProductKinds(now);
    const kind = i.kind ?? (['api', 'chat', 'enterprise'] as ProductKind[]).find((k) => open.includes(k) && liveLines(now, k).length < MAX_LINES_PER_KIND);
    if (kind) setLaunchKind(kind);
    else requestAnimationFrame(() => document.getElementById('pr-launch')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  });

  return (
    <div class="panel pn pn-products pr">
      <PanelHeader
        title="Products"
        subtitle="Models you sell"
        actions={
          <>
            <Stat label="Revenue / day" value={formatMoney(revenue)} tone={revenue > 0 ? 'good' : 'muted'} size="sm" />
            <Stat label="Serving / day" value={formatMoney(serving)} tone="muted" size="sm" />
            <Stat label="Margin / day" value={`${margin >= 0 ? '+' : ''}${formatMoney(margin)}`} tone={margin >= 0 ? 'good' : 'bad'} size="sm" />
          </>
        }
      />
      <PanelIntro id="products">
        A product is a model you sell: by the token to developers, by the month to chatbot users, or by the seat to companies. Revenue minus serving cost is
        your margin.
      </PanelIntro>

      {live.length === 0 ? (
        <Card title="No live products" subtitle="Launch one to start earning">
          <Empty title="Nothing on sale">Products need a released model. Launch one below once you have it.</Empty>
        </Card>
      ) : (
        <>
          <div class="pr-grid">
            {live.map((p) => (
              <div key={p.id} id={`pr-${p.id}`}>
                <LiveProductCard s={s} product={p} />
              </div>
            ))}
          </div>
        </>
      )}

      <div id="pr-launch">
        <Card title="Launch" subtitle="Up to two live lines per kind">
          <LaunchTiles s={s} onLaunch={(k) => setLaunchKind(k)} />
        </Card>
      </div>

      <ViewDisclosure panel="products">
        <SceneView
          state={s}
          make={createStreet}
          cam={STREET_CAM}
          camId="CAM-08"
          height={360}
          label="Your products as storefronts: queues of users, coins into the till, serving costs piped to the datacenter"
          onSelect={(hit) => {
            if (hit.id.startsWith('product:')) document.getElementById(`pr-${hit.id.slice(8)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            else if (hit.id.startsWith('lot:')) setLaunchKind(hit.id.slice(4) as ProductKind);
          }}
        />
      </ViewDisclosure>

      <LaunchSheet kind={launchKind} onClose={() => setLaunchKind(null)} />
    </div>
  );
}
