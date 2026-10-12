// Compute screen (GAME_DESIGN §21.1, §21.5). Leads with the server room; renting and building sit right below it.
import { useState } from 'preact/hooks';
import { useGame } from '../store';
import { Card, PanelHeader, PanelIntro, Tabs } from '../components';
import { buildRoom } from './compute/roomModel';
import { summaryParts } from './compute/roomModel';
import { SceneView } from '../../scenes/SceneView';
import { createScene as createDatacenter, CAM as DC_CAM } from '../../scenes/compute';
import { FleetPicker } from './compute/FleetPicker';
import { DailyCost } from './compute/DailyCost';
import { BlockSheet, BuildBody, RentBody } from './compute/ComputeSheets';
import './panels.css';
import './compute/compute.css';

type OpenSheet = { kind: 'block'; key: string } | null;

export function ComputePanel() {
  const s = useGame();
  const room = buildRoom(s);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const close = () => setSheet(null);
  const [get, setGet] = useState<'rent' | 'build'>('rent');

  return (
    <div class="panel pn pn-compute cc">
      <PanelIntro id="compute">
        Compute is the hardware your models train and serve on. Products run on your own GPUs first. Anything more is bought from the cloud.
      </PanelIntro>
      <PanelHeader code="CMP" title="Compute" subtitle="Your GPUs, where they work, and what they cost" />

      <SceneView
        state={s}
        make={createDatacenter}
        cam={DC_CAM}
        camId="CAM-03"
        height={360}
        label="Your datacenters: racks blink amber for training, blue for serving and dark when idle; the cloud floats to the side"
        onSelect={(hit) => {
          const key = hit.id.startsWith('dc:') ? hit.id.slice(3) : hit.id === 'cloud:rented' ? 'rental' : hit.id === 'cloud:burst' ? 'burst' : null;
          if (key) setSheet({ kind: 'block', key });
        }}
      />
      <p class="cc-summary cc-summary-under">
        {summaryParts(s, room).map((p, i) => (
          <span key={i}>
            {i > 0 && <span class="cc-sep"> · </span>}
            {p}
          </span>
        ))}
        <span class="cc-sep"> · </span>
        <span class="cc-legend-inline">
          <i class="cc-swatch cc-training" /> training <i class="cc-swatch cc-serving" /> serving <i class="cc-swatch cc-idle" /> idle · click a hall to manage it
        </span>
      </p>

      <Card
        title="Get more GPUs"
        actions={
          <Tabs
            variant="segmented"
            value={get}
            onChange={setGet}
            tabs={[
              { id: 'rent', label: 'Rent (no upfront cost)' },
              { id: 'build', label: 'Build a datacenter' },
            ]}
          />
        }
      >
        {get === 'rent' ? <RentBody /> : <BuildBody />}
      </Card>

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
