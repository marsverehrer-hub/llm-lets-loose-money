import type { ComponentChildren } from 'preact';
import { Modal } from './Modal';

export interface SheetProps {
  open: boolean;
  /** Sticky header title. */
  title?: ComponentChildren;
  subtitle?: ComponentChildren;
  /** Close button and Escape. Omit to make the sheet sticky. */
  onClose?: () => void;
  /** Sticky bottom action bar (put the primary action here on mobile). */
  footer?: ComponentChildren;
  /** Desktop width in px. Default 500. Ignored on phones, where the sheet is full screen. */
  width?: number;
  tone?: 'default' | 'danger';
  class?: string;
  children?: ComponentChildren;
}

/**
 * Overlay that is a centred dialog on desktop and a full-screen sheet on phones (<= 760px). The header (with the
 * close button) and the footer stay pinned; the body scrolls between them. Built on Modal, so it has the same
 * Escape and backdrop behaviour. Rules live in ui/mobile.css (every .modal is a sheet on phones).
 */
export function Sheet({ open, title, subtitle, onClose, footer, width, tone, class: cls, children }: SheetProps) {
  return (
    <Modal
      open={open}
      title={title}
      subtitle={subtitle}
      onClose={onClose}
      footer={footer}
      width={width}
      tone={tone}
      closeOnBackdrop={false}
      class={`sheet ${cls ?? ''}`}
    >
      {children}
    </Modal>
  );
}
