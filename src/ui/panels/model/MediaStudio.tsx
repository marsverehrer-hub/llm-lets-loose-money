// v16 (GAME_DESIGN §28.2): image and video models on the Models panel. The live media run, the models with their lab
// notebook and benchmarks, the products that sell them, the media arena and the data shop. Never reads run.hidden.
import { useState } from 'preact/hooks';
import { dispatch } from '../../store';
import { Card, NetView, Pill, ProgressBar, clamp, formatDays, netSpecOfMedia } from '../../components';
import { formatMoney, formatParams } from '../../../sim/util';
import { mediaArchById } from '../../../sim/data/imageModels';
import {
  MEDIA_CHANNEL_NAME,
  mediaArena,
  mediaBenchScores,
  mediaDatasetsFor,
  mediaKindLock,
  mediaLaunchFee,
  mediaRate,
  mediaRefPrice,
} from '../../../sim/systems/imageGen';
import type { GameState, Id, MediaChannel, MediaKind, MediaModel } from '../../../sim/types';
import { setView } from '../train/draft';
import { ConfirmButton } from '../panelKit';

const KINDS: MediaKind[] = ['image', 'video'];
const CHANNELS: MediaChannel[] = ['app', 'api'];
const KIND_LABEL: Record<MediaKind, string> = { image: 'Image', video: 'Video' };
const price = (v: number) => (v >= 1 ? `$${v.toFixed(v >= 10 ? 0 : 2)}` : `$${v.toFixed(3)}`);

export function MediaStudio({ s }: { s: GameState }) {
  const ms = s.media;
  const models = [...(ms?.models ?? [])].sort((a, b) => b.trainedDay - a.trainedDay);
  const [selId, setSelId] = useState<Id | null>(null);
  const sel = models.find((m) => m.id === selId) ?? models[0] ?? null;
  const run = ms?.run ?? null;
  const products = (ms?.products ?? []).filter((p) => p.active);
  const [shopKind, setShopKind] = useState<MediaKind>('image');

  return (
    <Card title="Image and video models">
      <div class="md-stack">
        {run ? (
          <div class="md-action">
            <div>
              <div class="md-desc">{`${run.name} · ${mediaArchById(run.config.arch)?.name ?? run.config.arch} · ${formatParams(run.config.paramsB)} · forecast ${Math.round(run.forecast.low)} to ${Math.round(run.forecast.high)}`}</div>
              <ProgressBar value={clamp(run.doneFlops / Math.max(1, run.totalFlops), 0, 1)} right={`ETA ${formatDays(etaOf(s))}`} />
              <NetView spec={netSpecOfMedia(run.config)} progress={clamp(run.doneFlops / Math.max(1, run.totalFlops), 0, 1)} seed={run.name} height={160} />
              {s.training && <div class="tw-faint tw-small">Sharing the cluster with the language-model run.</div>}
            </div>
            <button type="button" class="btn btn-sm" onClick={() => dispatch({ type: 'cancelMediaRun' })}>
              Cancel
            </button>
          </div>
        ) : (
          <div class="md-action">
            <div class="md-desc">
              {models.length === 0
                ? 'Image models are cheap to train and quick to sell: a good first product for a small lab. The market is smaller and commoditises fast.'
                : 'Train another image or video model from New model.'}
            </div>
            <button type="button" class="btn" onClick={() => setView({ kind: 'train' })}>
              New model
            </button>
          </div>
        )}

        {models.length > 0 && (
          <div class="table-wrap table-scroll">
            <table class="table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Type</th>
                  <th class="num">Overall</th>
                  <th class="num">Elo</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} class={m.id === sel?.id ? 'sel' : ''} onClick={() => setSelId(m.id)}>
                    <td>{m.name}</td>
                    <td>{`${KIND_LABEL[m.kind]} · ${mediaArchById(m.config.arch)?.name ?? m.config.arch}`}</td>
                    <td class="num">{Math.round(m.overall)}</td>
                    <td class="num">{Math.round(m.elo)}</td>
                    <td>{m.releasedDay === null ? <Pill tone="warn">Secret</Pill> : <Pill tone="good">{m.openWeights ? 'Open' : 'Live'}</Pill>}</td>
                    <td>
                      <ModelActions s={s} m={m} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {sel && <Notebook s={s} m={sel} />}

        {products.length > 0 && (
          <div class="table-wrap table-scroll">
            <table class="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Model</th>
                  <th class="num">Price</th>
                  <th class="num">Users</th>
                  <th class="num">Revenue / day</th>
                  <th class="num">Serving / day</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.map((p) => {
                  const ref = mediaRefPrice(s, p.kind, p.channel);
                  const choices = models.filter((m) => m.kind === p.kind && m.releasedDay !== null);
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>
                        <select class="input" value={p.modelId} onChange={(e) => dispatch({ type: 'updateMediaProduct', productId: p.id, modelId: (e.currentTarget as HTMLSelectElement).value })}>
                          {choices.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td class="num">
                        <span class="tw-chips">
                          <button type="button" class="btn btn-sm" title="Cut the price 10%" onClick={() => dispatch({ type: 'updateMediaProduct', productId: p.id, price: Math.max(ref * 0.2, p.price * 0.9) })}>
                            −
                          </button>
                          {`${price(p.price)}${p.channel === 'app' ? '/mo' : ''}`}
                          <button type="button" class="btn btn-sm" title="Raise the price 10%" onClick={() => dispatch({ type: 'updateMediaProduct', productId: p.id, price: Math.min(ref * 5, p.price * 1.1) })}>
                            +
                          </button>
                        </span>
                      </td>
                      <td class="num">{p.channel === 'app' ? Math.round(p.users).toLocaleString() : `${Math.round(p.users).toLocaleString()}/day`}</td>
                      <td class="num">{formatMoney(p.revenuePerDay)}</td>
                      <td class="num">{formatMoney(p.costPerDay)}</td>
                      <td>
                        <ConfirmButton class="btn-sm" label="Shut down" confirmLabel="Shut it down?" onConfirm={() => dispatch({ type: 'shutdownMediaProduct', productId: p.id })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div class="md-arenas">
          {KINDS.filter((k) => !mediaKindLock(s, k) || mediaArena(s, k).length > 0).map((k) => (
            <div key={k}>
              <div class="md-section-title">{`${KIND_LABEL[k]} arena`}</div>
              <div class="table-wrap">
                <table class="table">
                  <tbody>
                    {mediaArena(s, k)
                      .slice(0, 6)
                      .map((r, i) => (
                        <tr key={`${r.lab}-${r.name}`} class={r.mine ? 'me' : ''}>
                          <td class="num faint md-rank">{i + 1}</td>
                          <td>{r.name}</td>
                          <td>{r.lab}</td>
                          <td class="num">{Math.round(r.elo)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {mediaArena(s, k).length === 0 && <div class="tw-faint tw-small">Nobody ships one yet.</div>}
            </div>
          ))}
        </div>

        <div>
          <div class="md-row-between">
            <span class="md-section-title">Data</span>
            <span class="tw-chips">
              {KINDS.map((k) => (
                <button key={k} type="button" class={`tw-chip ${shopKind === k ? 'is-on' : ''}`} aria-pressed={shopKind === k} onClick={() => setShopKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </span>
          </div>
          <div class="table-wrap table-scroll">
            <table class="table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th class="num">Samples</th>
                  <th class="num">Quality</th>
                  <th class="num">Legal risk</th>
                  <th class="num">Price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {mediaDatasetsFor(s, shopKind)
                  .filter((x) => x.available || x.owned)
                  .map(({ def, owned }) => (
                    <tr key={def.id} title={def.description}>
                      <td>{def.name}</td>
                      <td class="num">{`${def.samplesM >= 1 ? Math.round(def.samplesM) : def.samplesM}M`}</td>
                      <td class="num">{def.quality.toFixed(2)}</td>
                      <td class={`num ${def.legalRisk >= 0.5 ? 'tone-bad' : ''}`}>{`${Math.round(def.legalRisk * 100)}%`}</td>
                      <td class="num">{def.price > 0 ? formatMoney(def.price) : 'Free'}</td>
                      <td>
                        {owned ? (
                          <Pill tone="good">Owned</Pill>
                        ) : (
                          <button type="button" class="btn btn-sm" onClick={() => dispatch({ type: 'buyMediaDataset', datasetId: def.id })}>
                            Buy
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Days left on the media run (Infinity when it has no compute). The run dock shows it too. */
export function etaOf(s: GameState): number {
  const run = s.media?.run;
  const rate = mediaRate(s);
  return run && rate > 0 ? Math.max(0, run.totalFlops - run.doneFlops) / rate : Infinity;
}

function ModelActions({ s, m }: { s: GameState; m: MediaModel }) {
  if (m.releasedDay === null) {
    return (
      <span class="tw-chips">
        <button type="button" class="btn btn-sm btn-primary" onClick={() => dispatch({ type: 'releaseMediaModel', modelId: m.id })}>
          Release
        </button>
        <ConfirmButton
          class="btn-sm"
          label="Open weights"
          confirmLabel="Can't be undone. Open?"
          title="Brand and reputation now; anyone can host it, so your own product sells less"
          onConfirm={() => dispatch({ type: 'releaseMediaModel', modelId: m.id, openWeights: true })}
        />
      </span>
    );
  }
  const selling = new Set((s.media?.products ?? []).filter((p) => p.active && p.kind === m.kind).map((p) => p.channel));
  return (
    <span class="tw-chips">
      {CHANNELS.filter((c) => !selling.has(c)).map((c) => (
        <button
          key={c}
          type="button"
          class="btn btn-sm"
          title={`Launch fee ${formatMoney(mediaLaunchFee(s, c))}`}
          onClick={() => dispatch({ type: 'launchMediaProduct', kind: m.kind, channel: c, modelId: m.id })}
        >
          {`Launch ${MEDIA_CHANNEL_NAME[c]}`}
        </button>
      ))}
    </span>
  );
}

function Notebook({ s, m }: { s: GameState; m: MediaModel }) {
  const bench = mediaBenchScores(s, m.caps, m.kind);
  const caps = (Object.entries(m.caps) as [string, number][]).filter(([k]) => m.kind === 'video' || k !== 'motion');
  return (
    <div class="md-grid">
      <div>
        <div class="md-section-title">{`${m.name}: profile`}</div>
        {caps.map(([k, v]) => (
          <ProgressBar key={k} value={clamp(v / 100, 0, 1)} label={k[0].toUpperCase() + k.slice(1)} right={String(Math.round(v))} height={6} />
        ))}
        {bench.length > 0 && (
          <div class="tw-small tw-muted">{bench.map((b) => `${b.name} ${Math.round(b.score)}%`).join(' · ')}</div>
        )}
      </div>
      <div class="span-full">
        <div class="md-section-title">Anatomy</div>
        <NetView spec={netSpecOfMedia(m.config)} seed={m.id} height={160} />
      </div>
      <div>
        <div class="md-section-title">Lab notebook</div>
        <div class="tw-small">{`Forecast ${Math.round(m.forecastMid)}, landed ${Math.round(m.overall)}.`}</div>
        {m.notes.map((n) => (
          <div key={n} class="tw-small tw-muted">
            {n}
          </div>
        ))}
      </div>
    </div>
  );
}
