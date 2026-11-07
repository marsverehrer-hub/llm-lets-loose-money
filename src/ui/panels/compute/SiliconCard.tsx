// v19 D5: the Silicon card. Your own chip programme: design, tape-out, a fab slot, then yield. The finished chip shows
// up in Install GPUs like any other card (availableGpus handles that).
import { dispatch, useGame } from '../../store';
import { formatMoney } from '../../../sim/util';
import { gpuById } from '../../../sim/systems/compute';
import type { ChipProgram } from '../../../sim/types';
import { ConfirmButton } from '../panelKit';
import { CHIP_DESIGN_SHARE, TAPEOUT_ODDS, chipDesignDaysLeft, chipGateReason, chipProgrammeCost, chipRunning, fmtDay, nextChipGeneration } from './gpuUi';

const PHASE_LABEL: Record<ChipProgram['phase'], string> = {
  design: 'Design',
  tapeout: 'Tape-out',
  fab: 'Fab',
  ready: 'Ready',
  failed: 'Failed',
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div class="cc-fact">
      <span class="cc-fact-k">{label}</span>
      <b class="cc-fact-v">{value}</b>
    </div>
  );
}

export function SiliconCard() {
  const s = useGame();
  const c = s.chip ?? null;
  const gen = nextChipGeneration(s);
  const cost = chipProgrammeCost(gen);
  const gate = chipGateReason(s);
  const running = chipRunning(s);
  const designDays = chipDesignDaysLeft(s);
  const chipDef = c?.gpuId ? gpuById(c.gpuId) : undefined;
  const chipName = chipDef?.name ?? c?.gpuId ?? null;
  // Unit cost of your own chip: list price over yield (D4).
  const readyPrice = chipDef && c?.yieldRate ? chipDef.buyPrice / c.yieldRate : 0;
  const startTitle = running
    ? 'A programme is already running'
    : gate ?? (s.finance.cash < cost ? 'Not enough cash' : `Start generation ${gen} for ${formatMoney(cost)}`);

  return (
    <div class="cc-section">
      <h4 class="cc-h">Silicon · your own chips: design, tape-out, a fab slot, then yield</h4>
      <div class="cc-sheet">
        {c ? (
          <>
            <div class="cc-facts">
              <Fact label="Programme" value={`Generation ${c.generation}`} />
              <Fact label="Phase" value={PHASE_LABEL[c.phase]} />
              <Fact label="Tape-out odds" value={`${Math.round(TAPEOUT_ODDS * 100)}%`} />
              <Fact label="Yield" value={c.yieldRate !== undefined ? `${Math.round(c.yieldRate * 100)}% good dies` : '—'} />
            </div>

            {c.phase === 'design' && (
              <div class="cc-section">
                <div class="cc-mw-bar" role="meter" aria-label="Design progress" aria-valuemin={0} aria-valuemax={c.rpNeeded} aria-valuenow={Math.round(c.rpDone)}>
                  <i style={{ width: `${Math.min(100, (c.rpDone / Math.max(1, c.rpNeeded)) * 100)}%` }} />
                </div>
                <p class="cc-note">
                  {Math.round(c.rpDone).toLocaleString('en-US')} of {Math.round(c.rpNeeded).toLocaleString('en-US')} research points. The design takes{' '}
                  {Math.round(CHIP_DESIGN_SHARE * 100)}% of the lab's research each day
                  {designDays !== null ? `, about ${designDays} day${designDays === 1 ? '' : 's'} left` : ', no research yet, so no estimate'}.
                </p>
              </div>
            )}

            {c.phase === 'tapeout' && <p class="cc-note">Tape-out in progress.</p>}

            {c.phase === 'fab' && c.fabReadyDay !== undefined && (
              <p class="cc-note">
                Fab slot delivers {fmtDay(c.fabReadyDay)}, {Math.max(0, c.fabReadyDay - s.day)} day{c.fabReadyDay - s.day === 1 ? '' : 's'} to go.
              </p>
            )}

            {c.phase === 'ready' && (
              <p class="cc-note">
                {chipName} is ready. It is on offer under Install GPUs with no vendor allocation, at {formatMoney(readyPrice)} a unit after yield.
              </p>
            )}

            {c.phase === 'failed' && <p class="cc-note">The tape-out failed. The cash is gone and the lesson is in the news. You can start again.</p>}

            <p class="cc-note">
              Spent so far on this programme: {formatMoney(c.cashSpent)}.
            </p>
          </>
        ) : (
          <p class="cc-note">No programme yet. A programme takes cash and research time, and its first chips arrive much later than a vendor's.</p>
        )}

        {!running && (
          <div class="cc-section">
            {/* A programme is a big share of the cash, so it takes a second click (DESIGN: one confirm rule). */}
            <ConfirmButton
              class="btn-sm cc-build"
              tone="primary"
              label={`Start programme (gen ${gen})`}
              confirmLabel={`Spend ${formatMoney(cost)} on generation ${gen}?`}
              disabled={!!gate || s.finance.cash < cost}
              title={startTitle}
              onConfirm={() => dispatch({ type: 'startChipProgram' })}
            />
            {gate && <p class="cc-note">{gate}.</p>}
          </div>
        )}
      </div>
    </div>
  );
}
