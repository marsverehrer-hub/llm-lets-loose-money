// Step 3: how it is built. Architecture, shape, MoE top-k, tokenizer and context as trade-off tiles. MoE shows its expert
// stepper inline; the shape slider trades knowledge for reasoning and speed.
import { optionsByGroup, RUN_TUNING } from '../../../sim/data/trainingOptions';
import { EXPERT_STEPS, MOE_TOPK_CHOICES, pct, shapeEffect, shapeName } from './model';
import type { Ctx } from './model';
import { Chip, OptionTiles, Slider } from './kit';

export function StepArch({ ctx }: { ctx: Ctx }) {
  const { s, sheet, defaults, patchCfg } = ctx;
  const cfg = sheet.cfg;
  const experts = cfg.moeExperts ?? RUN_TUNING.MOE_DEFAULT_EXPERTS;
  const expertIdx = Math.max(0, EXPERT_STEPS.indexOf(experts));
  const active = RUN_TUNING.MOE_ACTIVE_FRACTION[experts] ?? 0;
  const shape = cfg.shape ?? 0;
  const topK = cfg.moeTopK ?? 2;

  return (
    <div class="tw-stack">
      <div class="tw-group">
        <div class="tw-label">Architecture</div>
        <OptionTiles
          s={s}
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
        <div class="tw-label">Shape</div>
        <div class="tw-shape-row">
          <Slider value={shape} min={-1} max={1} step={0.5} label="Shape: wide and shallow to deep and narrow" onInput={(v) => patchCfg({ shape: v })} />
          <span class="num tw-small">{shapeName(shape)}</span>
        </div>
        <div class="tw-small tw-muted">{shapeEffect(shape)}</div>
      </div>

      {cfg.arch === 'moe' && (
        <div class="tw-group">
          <div class="tw-label">Experts per token</div>
          <div class="tw-chips" role="group" aria-label="Experts per token">
            {MOE_TOPK_CHOICES.map((k) => (
              <Chip
                key={k}
                on={topK === k}
                disabled={k >= experts}
                title={k >= experts ? `Needs fewer than ${experts} experts` : `${k} expert${k > 1 ? 's' : ''} light up per token`}
                onClick={() => patchCfg({ moeTopK: k })}
              >
                {String(k)}
              </Chip>
            ))}
            <span class="num tw-small tw-muted">{`${topK} of ${experts} experts light up per token`}</span>
          </div>
        </div>
      )}

      <div class="tw-group">
        <div class="tw-label">Tokenizer</div>
        <OptionTiles
          s={s}
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
          s={s}
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
