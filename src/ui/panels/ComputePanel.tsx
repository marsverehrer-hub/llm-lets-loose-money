// Compute screen (GAME_DESIGN §21.1, §21.5). Leads with renting and building; the server room camera sits below.
import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { Card, PanelHeader, PanelIntro, Stat, Tabs } from '../components';
import { buildRoom } from './compute/roomModel';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createDatacenter, CAM as DC_CAM } from '../../scenes/compute';
import { FleetPicker } from './compute/FleetPicker';
import { DailyCost } from './compute/DailyCost';
import { BlockSheet, BuildBody, RentBody } from './compute/ComputeSheets';
import { CloudMarket } from './compute/CloudMarket'; // v16 cloud providers
import { NeocloudTab } from './compute/NeocloudTab'; // v16 neocloud
import { HallList } from './compute/HallList';
import { ViewFold } from './ViewFold';
import { useIntent } from '../nav';
import './panels.css';
import './compute/compute.css';

const gpus = (n: number) => Math.round(n).toLocaleString('en-US');

type OpenSheet = { kind: 'block'; key: string } | null;

export function ComputePanel() {
  const s = useGame();
  const room = buildRoom(s);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);
  const [get, setGet] = useState<'rent' | 'market' | 'build' | 'neocloud'>('rent');
  // v17.2: "Rent GPUs", "Build a datacenter" and the like land on that tab of Get more GPUs.
  useIntent('compute', (i) => {
    if (!('tab' in i)) return;
    setGet(i.tab === 'cloud' ? 'market' : i.tab);
    requestAnimationFrame(() => document.querySelector('.cc-get')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  });

  return (
    <div class="panel pn pn-compute cc">
      <PanelHeader
        title="Compute"
        subtitle="Your GPUs, where they work, and what they cost"
        actions={
          <>
            <Stat label="GPUs" value={gpus(room.ownGpus)} size="sm" />
            <Stat label="Training" value={gpus(room.training)} tone={room.training > 0 ? 'warn' : 'muted'} size="sm" />
            <Stat label="Serving" value={gpus(room.serving)} tone={room.serving > 0 ? 'info' : 'muted'} size="sm" />
            {room.idle > 0 && <Stat label="Idle" value={gpus(room.idle)} tone="muted" size="sm" />}
          </>
        }
      />
      <PanelIntro id="compute">
        Compute is the hardware your models train and serve on. Products run on your own GPUs first. Anything more is bought from the cloud.
      </PanelIntro>

      <Card
        class="cc-get"
        title="Get more GPUs"
        subtitle={get === 'rent' ? 'No upfront cost, billed daily' : undefined}
        actions={
          <Tabs
            variant="segmented"
            value={get}
            onChange={setGet}
            tabs={[
              { id: 'rent', label: 'Rent' },
              { id: 'market', label: 'Cloud providers' },
              { id: 'build', label: 'Build a datacenter' },
              { id: 'neocloud', label: 'Neocloud', count: s.neocloud?.offers.length || undefined },
            ]}
          />
        }
      >
        {get === 'rent' ? (
          <RentBody />
        ) : get === 'market' ? (
          <CloudMarket />
        ) : get === 'build' ? (
          <>
            <HallList room={room} onManage={(key) => setSheet({ kind: 'block', key })} />
            <BuildBody key={s.compute.datacenters.length} />
          </>
        ) : (
          <NeocloudTab />
        )}
      </Card>

      <ViewFold panel="compute">
        <SceneView
          state={s}
          make={createDatacenter}
          cam={DC_CAM}
          camId="CAM-03"
          height={360}
          label="Your datacenters: rack lights are yellow for training, green for serving and dim when idle; the cloud floats to the side"
          onSelect={(hit) => {
            const key = hit.id.startsWith('dc:') ? hit.id.slice(3) : hit.id === 'cloud:rented' ? 'rental' : hit.id === 'cloud:burst' ? 'burst' : null;
            if (key) setSheet({ kind: 'block', key });
          }}
        />
        <p class="cc-summary cc-summary-under">
          <span class="cc-legend-inline">
            <i class="cc-swatch cc-training" /> training <i class="cc-swatch cc-serving" /> serving <i class="cc-swatch cc-idle" /> idle · click a hall to manage it
          </span>
        </p>
      </ViewFold>

      <div class="cc-two">
        <FleetPicker s={s} />
        <DailyCost s={s} burstCost={room.burstCostPerDay} />
      </div>

      <BlockSheet
        s={s}
        room={room}
        blockKey={sheet?.kind === 'block' ? sheet.key : null}
        onClose={close}
        onRent={() => {
          close();
          setGet('rent');
        }}
      />
    </div>
  );
}
