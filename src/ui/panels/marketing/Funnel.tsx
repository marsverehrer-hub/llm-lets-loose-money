// OWNER: v10 MARKETING agent. Per segment: market size, then adopters, then your users. The sim has no awareness
// stage, so the funnel stops at adoption (the share of the market paying for any LLM product).
import type { ComponentChildren } from 'preact';
import type { GameState, Segment } from '../../../sim/types';
import { formatNumber } from '../../../sim/util';
import { HelpTip, formatPct } from '../../components';
import { SEGMENT_NAME } from './campaignCopy';

const SEGMENTS: Segment[] = ['consumer', 'developer', 'enterprise'];

export function Funnel({ s }: { s: GameState }) {
  return (
    <div class="mk-funnel">
      {SEGMENTS.map((seg) => {
        const st = s.market.segments[seg];
        const tam = st.tam;
        const adopters = tam * st.adoption;
        const users = st.playerUsers;
        const frac = (v: number) => (tam > 0 ? Math.min(1, Math.max(0, v / tam)) : 0);
        const yourShare = adopters > 0 ? users / adopters : 0;
        return (
          <section class="mk-fcard" key={seg} aria-label={`${SEGMENT_NAME[seg]} funnel`}>
            <h4 class="mk-fcard-title">{SEGMENT_NAME[seg]}</h4>
            <Step label="Market size" value={formatNumber(tam, 1)} frac={tam > 0 ? 1 : 0} color="var(--fg-3)" />
            <Step
              label={
                <>
                  Adopting
                  <HelpTip>Customers using any LLM product in this segment. The sim has no awareness stage, so the funnel starts here.</HelpTip>
                </>
              }
              value={`${formatNumber(adopters, 1)} · ${formatPct(st.adoption, 1)}`}
              frac={frac(adopters)}
              color="var(--blue)"
            />
            <Step label="Your users" value={formatNumber(users, 1)} frac={frac(users)} color="var(--amber)" />
            <div class="mk-fnote">{adopters > 0 ? `You hold ${formatPct(yourShare, 1)} of adopters.` : 'No adopters yet.'}</div>
          </section>
        );
      })}
    </div>
  );
}

function Step({ label, value, frac, color }: { label: ComponentChildren; value: string; frac: number; color: string }) {
  return (
    <div class="mk-fstep">
      <div class="mk-fstep-head">
        <span>{label}</span>
        <span class="num">{value}</span>
      </div>
      <div class="mk-fstep-track">
        <div class="mk-fstep-fill" style={{ width: `${(frac * 100).toFixed(2)}%`, '--c': color } as any} />
      </div>
    </div>
  );
}
