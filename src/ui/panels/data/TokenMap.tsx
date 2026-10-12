// "Your tokens": a treemap of the owned data. Area is tokens, grouped by domain. Shade is quality. A dashed inset
// marks a set nobody has verified yet. Hover shows the numbers in a readout; click (or Enter) opens the set.
import { useState } from 'preact/hooks';
import type { Id } from '../../../sim/types';
import { DOMAIN_LABEL, fmtTok, pct, riskLevel } from './labels';
import { qualityShade, SHADE_STEPS, type OwnedItem } from './model';
import { layoutGroups } from './treemap';
import { useMeasure } from './useMeasure';

const MIN_SHARE = 0.006;
const HEAD = 20;
const CHIP_H = 18;

/** Shorten a label to what fits in `px` at the given font size (IBM Plex Sans is roughly 0.56em per character). */
function fit(text: string, px: number, size = 12): string {
  const max = Math.floor((px - 10) / (size * 0.56));
  if (max <= 0) return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

export function TokenMap({ items, onOpen }: { items: OwnedItem[]; onOpen: (id: Id) => void }) {
  const [ref, width] = useMeasure<HTMLDivElement>(640);
  const [hover, setHover] = useState<Id | null>(null);
  const height = Math.round(Math.min(340, Math.max(220, width * 0.5)));
  const groups =
    items.length > 0
      ? layoutGroups(
          items.map((it) => ({ ...it, value: it.tokensB, group: it.domain })),
          { x: 0, y: 0, w: width, h: height },
          { minShare: MIN_SHARE, head: HEAD, gap: 2 },
        )
      : [];
  const hot = hover ? items.find((it) => it.id === hover) ?? null : null;

  return (
    <div class="tm">
      <div ref={ref} class="tm-canvas" style={{ height: `${height}px` }}>
        {items.length === 0 ? (
          <div class="tm-empty">
            <div class="tm-empty-title">Nothing owned yet</div>
            <div class="tm-empty-text">Buy a set from the catalogue below, or start a crawler. Your tokens show up here, by domain.</div>
          </div>
        ) : (
          <svg class="tm-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Your tokens, by domain">
            {groups.map((g) => (
              <g key={g.key} class="tm-group">
                {g.head > 0 && (
                  <g>
                    <rect class="tm-head" x={g.rect.x} y={g.rect.y} width={g.rect.w} height={g.head} />
                    <text class="tm-domain" x={g.rect.x + 6} y={g.rect.y + 13}>
                      {fit(`${DOMAIN_LABEL[g.key as keyof typeof DOMAIN_LABEL] ?? g.key} · ${fmtTok(g.value)}`, g.rect.w - 6, 11)}
                    </text>
                  </g>
                )}
                {g.tiles.map(({ item, rect }) => {
                  const r = rect;
                  if (r.w < 1 || r.h < 1) return null;
                  const dim = hover !== null && hover !== item.id;
                  const big = r.w >= 70 && r.h >= 30;
                  const twoLine = r.w >= 70 && r.h >= 54;
                  return (
                    <g
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      class={`tm-tile ${dim ? 'dim' : ''} ${hover === item.id ? 'hot' : ''}`}
                      aria-label={`${item.name}, ${fmtTok(item.tokensB)} tokens, quality ${pct(item.quality)}${item.verified ? '' : ' unverified'}, legal risk ${riskLevel(item.legalRisk).label}`}
                      onPointerEnter={() => setHover(item.id)}
                      onPointerLeave={() => setHover((cur) => (cur === item.id ? null : cur))}
                      onFocus={() => setHover(item.id)}
                      onBlur={() => setHover((cur) => (cur === item.id ? null : cur))}
                      onClick={() => onOpen(item.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpen(item.id);
                        }
                      }}
                    >
                      <rect
                        class="tm-fill"
                        x={r.x + 1}
                        y={r.y + 1}
                        width={Math.max(0, r.w - 2)}
                        height={Math.max(0, r.h - 2)}
                        style={{ fill: qualityShade(item.quality) }}
                      />
                      {!item.verified && r.w > 16 && r.h > 16 && (
                        <rect class="tm-dash" x={r.x + 4} y={r.y + 4} width={r.w - 8} height={r.h - 8} />
                      )}
                      {big && (
                        <g>
                          <rect class="tm-chip" x={r.x + 4} y={r.y + 4} width={Math.min(r.w - 8, fit(item.name, r.w - 8).length * 6.7 + 10)} height={CHIP_H} />
                          <text class="tm-name" x={r.x + 9} y={r.y + 17}>
                            {fit(item.name, r.w - 8)}
                          </text>
                        </g>
                      )}
                      {twoLine && (
                        <g>
                          <rect class="tm-chip" x={r.x + 4} y={r.y + 26} width={Math.min(r.w - 8, 92)} height={CHIP_H} />
                          <text class="tm-num" x={r.x + 9} y={r.y + 39}>
                            {`${fmtTok(item.tokensB)} · ${pct(item.quality)}`}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            ))}
          </svg>
        )}
      </div>

      <div class="tm-readout" aria-live="polite">
        {hot ? (
          <>
            <span class="tm-readout-name">{hot.name}</span>
            <span class="num">{fmtTok(hot.tokensB)} tokens</span>
            <span class="num">{hot.verified ? `Quality ${pct(hot.quality)}` : `Quality ${pct(hot.quality)}, unverified`}</span>
            <span>Legal risk {riskLevel(hot.legalRisk).label.toLowerCase()}</span>
          </>
        ) : (
          <span class="tm-hint">{items.length > 0 ? 'Hover a block for its numbers. Click to open it.' : ' '}</span>
        )}
      </div>

      {items.length > 0 && (
        <div class="tm-legend" aria-label="How to read the map">
          <span class="tm-key">Area: tokens</span>
          <span class="tm-key tm-key-shade">
            <span>Quality</span>
            {SHADE_STEPS.map((q) => (
              <span key={q} class="tm-swatch" style={{ background: qualityShade(q) }} aria-hidden="true" />
            ))}
          </span>
          <span class="tm-key">
            <span class="tm-swatch tm-swatch-dash" aria-hidden="true" />
            Dashed: unverified
          </span>
        </div>
      )}
    </div>
  );
}
