// Step 3: how it is built. Architecture, tokenizer and context as trade-off tiles. MoE shows its expert stepper inline.
import { optionsByGroup, RUN_TUNING } from '../../../sim/data/trainingOptions';
import { EXPERT_STEPS, pct } from './model';
import type { Ctx } from './model';
import { OptionTiles } from './kit';

export function StepArch({ ctx }: { ctx: Ctx }) {
  const { s, sheet, defaults, patchCfg } = ctx;
  const cfg = sheet.cfg;
  const experts = cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS;
  const expertIdx = Math.max(0, EXPERT_STEPS.indexOf(experts));
  const active = RUN_TUNING.MOE_ACTIVE_FRACTION[experts] ?? 0;

  return (
    <div class="tw-stack">
      <div class="tw-group">
        <div class="tw-label">Architecture</div>
        <OptionTiles
          label="Architecture"
          rows={optionsByGroup(s, 'arch')}
          value={cfg.arch}
          recommended={defaults.arch}
          onPick={(id) => patchCfg({ arch: id })}
          extra={
            cfg.arch === 'moe' && (
              <div class="tw-inline" onClick={(e) => e.stopPropagation()}>
                <span class="tw-faint tw-small">Experts</span>
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={expertIdx === 0}
                  aria-label="Fewer experts"
                  onClick={() => patchCfg({ moeExperts: EXPERT_STEPS[expertIdx - 1] })}
                >
                  −
                </button>
                <span class="num tw-stepper-v">{experts}</span>
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={expertIdx >= EXPERT_STEPS.length - 1}
                  aria-label="More experts"
                  onClick={() => patchCfg({ moeExperts: EXPERT_STEPS[expertIdx + 1] })}
                >
                  +
                </button>
                <span class="num tw-small">{`${pct(active)} of parameters active per token`}</span>
              </div>
            )
          }
        />
      </div>

      <div class="tw-group">
        <div class="tw-label">Tokenizer</div>
        <OptionTiles
          label="Tokenizer"
          rows={optionsByGroup(s, 'tokenizer')}
          value={cfg.tokenizer}
          recommended={defaults.tokenizer}
          onPick={(id) => patchCfg({ tokenizer: id })}
        />
      </div>

      <div class="tw-group">
        <div class="tw-label">Context window</div>
        <OptionTiles
          label="Context window"
          rows={optionsByGroup(s, 'context')}
          value={cfg.context}
          recommended={defaults.context}
          onPick={(id) => patchCfg({ context: id })}
        />
      </div>
    </div>
  );
}
