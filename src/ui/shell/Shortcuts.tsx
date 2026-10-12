import { useEffect } from 'preact/hooks';
import { Modal } from '../components';
import { handleUiScaleKey } from '../uiScale';

/** Window event that asks App to open the shortcuts overlay (fired from the MENU). */
export const SHORTCUTS_EVENT = 'llm:open-shortcuts';

export function openShortcuts(): void {
  window.dispatchEvent(new Event(SHORTCUTS_EVENT));
}

const ROWS: { keys: string; what: string }[] = [
  { keys: 'Space', what: 'Pause or resume time' },
  { keys: '1', what: 'Normal speed (1×)' },
  { keys: '2', what: 'Fast (3×)' },
  { keys: '3', what: 'Very fast (10×)' },
  { keys: 'M', what: 'Mute or unmute sound effects' },
  { keys: 'L', what: 'Open or close the notification log' },
  { keys: 'S', what: 'Open saves (load, rename, export, import)' },
  { keys: 'Ctrl Alt =', what: 'Bigger interface' },
  { keys: 'Ctrl Alt -', what: 'Smaller interface' },
  { keys: 'Ctrl Alt 0', what: 'Interface size back to auto' },
  { keys: '?', what: 'Show or hide this list' },
  { keys: 'Esc', what: 'Close menus and dialogs' },
];

export interface ShortcutsProps {
  open: boolean;
  onClose: () => void;
}

/** Small cheat-sheet dialog. Opened with ? or from the MENU. */
export function Shortcuts({ open, onClose }: ShortcutsProps) {
  // App mounts this component all the time, so the interface size keys work with no dialog open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleUiScaleKey(e)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Modal open={open} title="Keyboard shortcuts" subtitle="Press ? any time to see this again." onClose={onClose} width={420}>
      <div class="shortcut-list">
        {ROWS.map((r) => (
          <div key={r.keys} class="shortcut-row">
            <span class="kbd">{r.keys}</span>
            <span class="shortcut-what">{r.what}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
