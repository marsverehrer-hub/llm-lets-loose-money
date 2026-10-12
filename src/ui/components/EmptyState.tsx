import type { ComponentChildren } from 'preact';

export interface EmptyStateProps {
  /** @deprecated Terminal theme renders no icons. */
  icon?: string;
  title: ComponentChildren;
  text?: ComponentChildren;
  /** Optional call to action, e.g. a Button. */
  action?: ComponentChildren;
  class?: string;
}

/** One dim uppercase line (plus optional detail and action) for empty lists. */
export function EmptyState({ title, text, action, class: cls }: EmptyStateProps) {
  return (
    <div class={`empty ${cls ?? ''}`}>
      <div class="empty-title">{title}</div>
      {text != null && <div class="empty-text">{text}</div>}
      {action}
    </div>
  );
}
