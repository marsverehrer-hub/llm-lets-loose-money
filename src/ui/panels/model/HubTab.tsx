// Open hub (Models · Open hub): rival labs' open weights, with their licenses, and a Download for each.
// Downloading adds the model to your lab; the license decides what you may do with it (see LaunchSheet, release).
import { useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { formatParams } from '../../../sim/util';
import type { GameState, HubLicense } from '../../../sim/types';
import { Pill, Select, Tabs } from '../../components';
import type { SelectOption, TabDef } from '../../components';
import { fmtTok } from '../data/labels';
import { tdate } from '../../shell/fmt';
import { hubModels, downloadedModel, LICENSE_RULE, LICENSE_TONE } from './hubList';
import type { HubModelRow } from './hubList';
import '../models.css';

type HubFilter = 'all' | 'permissive';
type HubSort = 'newest' | 'overall';
const FILTERS: TabDef<HubFilter>[] = [
  { id: 'all', label: 'All' },
  { id: 'permissive', label: 'Permissive only' },
];
const SORTS: SelectOption[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'overall', label: 'Overall' },
];

/** The license pill. A model with no license on the hub is shown as such, never as a green one. */
export function LicensePill({ license }: { license: HubLicense | null }) {
  if (!license) return <Pill tone="muted">unlicensed</Pill>;
  return (
    <Pill tone={LICENSE_TONE[license]} title={LICENSE_RULE[license]}>
      {license}
    </Pill>
  );
}

export function HubTab({ s }: { s: GameState }) {
  const [filter, setFilter] = useState<HubFilter>('all');
  const [sort, setSort] = useState<HubSort>('newest');
  const all = hubModels(s);
  const shown = filter === 'permissive' ? all.filter((r) => r.model.license === 'permissive') : all;
  const rows = sort === 'overall' ? [...shown].sort((a, b) => b.model.overall - a.model.overall) : shown;

  return (
    <div class="hub">
      <p class="hub-abstract">
        <span class="smallcaps">Abstract.</span> Rival labs publish some of their models as open weights. Permissive weights can go into products and
        contracts. Noncommercial weights can be fine-tuned and released as open weights, but not sold. Research weights are for study only.
      </p>
      <div class="hub-tools">
        <Tabs<HubFilter> variant="segmented" value={filter} onChange={setFilter} tabs={FILTERS} />
        <Select ariaLabel="Sort hub models" value={sort} onChange={(v) => setSort(v as HubSort)} options={SORTS} />
      </div>
      {all.length === 0 ? (
        <div class="md-pad">
          <div class="md-empty-line">No open weights on the hub yet. Rival labs release some as they grow.</div>
        </div>
      ) : rows.length === 0 ? (
        <div class="md-pad">
          <div class="md-empty-line">No permissive models on the hub right now.</div>
        </div>
      ) : (
        <div class="table-wrap table-scroll">
          <table class="table hub-table table-stack">
            <thead>
              <tr>
                <th>Lab</th>
                <th>Model</th>
                <th class="num">Params</th>
                <th class="num">Tokens</th>
                <th class="num">Overall</th>
                <th class="num">Elo</th>
                <th>License</th>
                <th>Released</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <HubRow key={`${r.labId}:${r.model.id}`} s={s} row={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HubRow({ s, row }: { s: GameState; row: HubModelRow }) {
  const m = row.model;
  const owned = downloadedModel(s, row.labId, m.id);
  const elo = Math.round(m.elo);
  const released = m.releasedDay ?? m.trainedDay;
  return (
    <tr>
      <td data-label="Lab">{row.lab}</td>
      <td data-label="Model">
        <span class="hub-model-name">{m.name}</span>
      </td>
      <td class="num" data-label="Params">
        {formatParams(m.paramsB)}
      </td>
      <td class="num" data-label="Tokens">
        {fmtTok(m.tokensB)}
      </td>
      <td class="num" data-label="Overall">
        {Math.round(m.overall)}
      </td>
      <td class="num" data-label="Elo">
        {elo}
      </td>
      <td data-label="License">
        <LicensePill license={m.license} />
      </td>
      <td data-label="Released">{tdate(released)}</td>
      <td data-label="">
        {owned ? (
          <Pill tone="info">In your lab</Pill>
        ) : (
          <button type="button" class="btn btn-sm" onClick={() => dispatch({ type: 'downloadHubModel', labId: row.labId, modelId: m.id })}>
            Download
          </button>
        )}
      </td>
    </tr>
  );
}
