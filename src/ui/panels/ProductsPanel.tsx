// Products screen (GAME_DESIGN §21.5): what you sell, what it earns, what it costs to serve, and the margin.
import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { formatMoney } from '../../sim/util';
import { PanelHeader, PanelIntro, Card, Stat } from '../components';
import type { ProductKind } from '../../sim/types';
import { Empty } from './panelKit';
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


  return (
    <div class="panel pn pn-products pr">
      <PanelIntro id="products">
        A product is a model you sell: by the token to developers, by the month to chatbot users, or by the seat to companies. Revenue minus serving cost is
        your margin.
      </PanelIntro>
      <PanelHeader
        code="PRD"
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

      {live.length === 0 ? (
        <Card code="PRD" title="No live products" subtitle="Launch one to start earning">
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

      <Card code="NEW" title="Launch" subtitle="Up to two live lines per kind">
        <LaunchTiles s={s} onLaunch={(k) => setLaunchKind(k)} />
      </Card>

      <LaunchSheet kind={launchKind} onClose={() => setLaunchKind(null)} />
    </div>
  );
}
