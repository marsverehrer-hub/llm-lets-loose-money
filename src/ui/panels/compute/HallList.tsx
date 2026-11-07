// v17.2: your datacenter halls as a plain list, so buying GPUs for them does not need the camera. Manage opens the
// same sheet as clicking the hall in the scene.
import { ProgressBar } from '../../components';
import type { ServerRoom } from './roomModel';

const num = (v: number) => Math.round(v).toLocaleString('en-US');

export function HallList({ room, onManage }: { room: ServerRoom; onManage: (key: string) => void }) {
  const halls = room.blocks.filter((b) => b.kind === 'dc');
  if (halls.length === 0) return null;
  return (
    <div class="cc-section">
      <h4 class="cc-h">Your datacenters</h4>
      <ul class="cc-rows">
        {halls.map((b) => (
          <li key={b.key} class="cc-row">
            <div class="cc-row-main">
              <b>{b.name}</b>
              <span class="cc-row-meta">
                {b.sub} · {b.building ? `building, ${b.buildDaysLeft} day${b.buildDaysLeft === 1 ? '' : 's'} left` : `${num(b.installed)} of ${num(b.capacity)} GPUs installed`}
              </span>
              <ProgressBar
                value={b.building ? b.buildProgress : b.capacity > 0 ? b.installed / b.capacity : 0}
                max={1}
                tone={b.building ? 'warn' : 'accent'}
                height={4}
              />
            </div>
            <div class="cc-row-actions">
              <button type="button" class="btn btn-sm" onClick={() => onManage(b.key)}>
                Manage
              </button>
            </div>
          </li>
        ))}
      </ul>
      <h4 class="cc-h">Build another</h4>
    </div>
  );
}
