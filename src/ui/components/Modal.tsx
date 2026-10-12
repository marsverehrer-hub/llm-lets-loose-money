import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

export interface ModalProps {
  open: boolean;
  title?: ComponentChildren;
  subtitle?: ComponentChildren;
  /** Called on Escape, the × button and backdrop click. Omit to make the modal sticky. */
  onClose?: () => void;
  /** Footer buttons, right-aligned. */
  footer?: ComponentChildren;
  /** Max width in px. Default 500. */
  width?: number;
  tone?: 'default' | 'danger';
  /** Close when the dark backdrop is clicked. Default true (if onClose is set). */
  closeOnBackdrop?: boolean;
  class?: string;
  children?: ComponentChildren;
}

/** Centered dialog over a blurred backdrop. Renders nothing while closed. */
export function Modal({ open, title, subtitle, onClose, footer, width, tone = 'default', closeOnBackdrop = true, class: cls, children }: ModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      class="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && closeOnBackdrop && onClose) onClose();
      }}
    >
      <div
        class={`modal ${tone === 'danger' ? 'modal-danger' : ''} ${cls ?? ''}`}
        style={width ? { width: `min(${width}px, 100%)` } : undefined}
        role="dialog"
        aria-modal="true"
      >
        {(title != null || onClose) && (
          <div class="modal-header">
            <div style={{ minWidth: '0px' }}>
              {title != null && <h2 class="modal-title">{title}</h2>}
              {subtitle != null && (
                <div class="small muted" style={{ marginTop: '6px' }}>
                  {subtitle}
                </div>
              )}
            </div>
            {onClose && (
              <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Close" onClick={onClose}>
                ×
              </button>
            )}
          </div>
        )}
        <div class="modal-body">{children}</div>
        {footer != null && <div class="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
