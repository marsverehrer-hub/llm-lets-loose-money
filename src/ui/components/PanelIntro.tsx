import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';

export interface PanelIntroProps {
  /** Stable id; the dismissal is remembered per id in localStorage. */
  id: string;
  /** One sentence: what this screen is for. */
  children: ComponentChildren;
  /** Optional 2-4 short "how to use it" steps, shown under the sentence. */
  steps?: ComponentChildren[];
}

const KEY = 'llm-lets-loose-money/intro-dismissed';

function readDismissed(): Record<string, true> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function writeDismissed(v: Record<string, true>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // storage blocked: the intro just shows again next time
  }
}

/** Forget every dismissed intro (Menu > Show screen tips again). */
export function resetPanelIntros(): void {
  writeDismissed({});
}

/**
 * v10: a short "what this screen is for" strip at the top of a panel, for players who don't know the genre or
 * the AI industry. Dismissible; stays dismissed per panel.
 */
export function PanelIntro({ id, children, steps }: PanelIntroProps) {
  const [hidden, setHidden] = useState(() => !!readDismissed()[id]);
  if (hidden) return null;
  return (
    <div class="panel-intro" role="note">
      <div class="panel-intro-body">
        <div class="panel-intro-text">{children}</div>
        {steps && steps.length > 0 && (
          <ol class="panel-intro-steps">
            {steps.map((st, i) => (
              <li key={i}>{st}</li>
            ))}
          </ol>
        )}
      </div>
      <button
        type="button"
        class="btn btn-sm btn-ghost"
        onClick={() => {
          writeDismissed({ ...readDismissed(), [id]: true });
          setHidden(true);
        }}
      >
        Got it
      </button>
    </div>
  );
}
