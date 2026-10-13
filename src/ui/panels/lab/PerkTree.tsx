// OWNER: PROGRESSION UI (v13, GAME_DESIGN §23.1). The perk tree: five branches side by side, tiers top to bottom.
// Phones get one branch at a time behind a segmented picker, so nothing scrolls sideways.
import { useState } from 'preact/hooks';
import type { GameState, PerkBranch, PerkDef } from '../../../sim/types';
import { PERKS, PERK_BRANCHES } from '../../../sim/data/perks';
import { perkBlocker, progressOf, respecCooldownLeft, respecCost } from '../../../sim/systems/progression';
import { formatMoney } from '../../../sim/util';
import { Button, Card, formatDays, useIsMobile } from '../../components';
import { dispatch } from '../../store';

function PerkTile({ s, perk }: { s: GameState; perk: PerkDef }) {
  const p = progressOf(s);
  const owned = p.perks.includes(perk.id);
  const why = owned ? null : perkBlocker(s, perk);
  const state = owned ? 'owned' : why ? 'locked' : 'ready';
  return (
    <div class={`perk perk-${state} ${perk.tier === 4 ? 'perk-cap' : ''}`}>
      <div class="perk-head">
        <span class="perk-tier num">{perk.tier === 4 ? 'CAP' : `T${perk.tier}`}</span>
        <span class="perk-name">{perk.name}</span>
        <span class="perk-cost num" title="Perk points">{perk.cost}</span>
      </div>
      <div class="perk-effect">{perk.effectText}</div>
      <div class="perk-desc small muted">{perk.description}</div>
      <div class="perk-foot">
        {owned ? (
          <span class="perk-owned small">Owned</span>
        ) : why ? (
          <span class="perk-why small muted">{why}</span>
        ) : (
          <Button size="sm" variant="primary" onClick={() => dispatch({ type: 'buyPerk', perkId: perk.id })}>
            Unlock
          </Button>
        )}
      </div>
    </div>
  );
}

function Branch({ s, id }: { s: GameState; id: PerkBranch }) {
  const def = PERK_BRANCHES.find((b) => b.id === id)!;
  const perks = PERKS.filter((p) => p.branch === id).sort((a, b) => a.tier - b.tier || a.cost - b.cost);
  const owned = perks.filter((p) => progressOf(s).perks.includes(p.id)).length;
  return (
    <section class="perk-branch" aria-label={def.name}>
      <header class="perk-branch-head">
        <span class="perk-branch-name">{def.name}</span>
        <span class="num muted">
          {owned}/{perks.length}
        </span>
      </header>
      <p class="perk-branch-pitch small muted">{def.pitch}</p>
      <div class="perk-col">
        {perks.map((perk) => (
          <PerkTile key={perk.id} s={s} perk={perk} />
        ))}
      </div>
    </section>
  );
}

export function PerkTree({ s }: { s: GameState }) {
  const isPhone = useIsMobile();
  const [branch, setBranch] = useState<PerkBranch>('scale');
  const p = progressOf(s);
  const cool = respecCooldownLeft(s);
  const cost = respecCost(s);
  return (
    <Card
      title="Perks"
      code="PRK"
      subtitle={`${p.perkPoints} point${p.perkPoints === 1 ? '' : 's'} to spend · one capstone per lab`}
      actions={
        p.perks.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={cool > 0 || s.finance.cash < cost}
            title={cool > 0 ? `Next reorg in ${formatDays(cool)}` : `Refund every point for ${formatMoney(cost)}`}
            onClick={() => dispatch({ type: 'respecPerks' })}
          >
            {cool > 0 ? `Reorg in ${formatDays(cool)}` : `Reorg ${formatMoney(cost)}`}
          </Button>
        )
      }
    >
      {isPhone ? (
        <>
          <div class="segmented perk-picker" role="tablist">
            {PERK_BRANCHES.map((b) => (
              <button key={b.id} type="button" role="tab" aria-selected={branch === b.id} class={`seg ${branch === b.id ? 'active' : ''}`} onClick={() => setBranch(b.id)}>
                {b.name}
              </button>
            ))}
          </div>
          <Branch s={s} id={branch} />
        </>
      ) : (
        <div class="perk-tree">
          {PERK_BRANCHES.map((b) => (
            <Branch key={b.id} s={s} id={b.id} />
          ))}
        </div>
      )}
    </Card>
  );
}
