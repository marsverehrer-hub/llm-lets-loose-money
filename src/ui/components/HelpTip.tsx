import type { ComponentChildren } from 'preact';
import { Tooltip } from './Tooltip';

export interface HelpTipProps {
  /** Plain-language explanation: what it is, why it matters, what to do about it. 1-3 short sentences. */
  children: ComponentChildren;
  /** Accessible label. Default "What is this?". */
  label?: string;
  class?: string;
}

/** v10: a small "?" next to a term that explains it in plain language on hover or tap. */
export function HelpTip({ children, label = 'What is this?', class: cls }: HelpTipProps) {
  return (
    <Tooltip content={<span class="helptip-text">{children}</span>} class={`helptip ${cls ?? ''}`}>
      <span class="helptip-mark" role="img" aria-label={label} tabIndex={0}>
        ?
      </span>
    </Tooltip>
  );
}
