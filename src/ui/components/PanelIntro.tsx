import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

export interface PanelIntroProps {
  /** Stable id; the tip shows on the first visit only (remembered per id in localStorage). */
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
    // storage blocked: the tip just shows again next time
  }
}

/** Forget every seen tip (Menu > Show screen tips again). */
export function resetPanelIntros(): void {
  writeDismissed({});
}

/**
 * A single quiet "what this screen is for" line. It shows on the first visit to a screen and is marked seen right away;
 * after that it is not shown. Menu > Show screen tips again brings them back.
 */
export function PanelIntro({ id, children, steps }: PanelIntroProps) {
  const [seen] = useState(() => !!readDismissed()[id]);
  useEffect(() => {
    if (!seen) writeDismissed({ ...readDismissed(), [id]: true });
  }, [id, seen]);
  // v22: a seen tip is gone (Menu > Show screen tips again brings it back); screens stay uncluttered.
  if (seen) return null;
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
    </div>
  );
}
