// The crash screen. A render error (CrashGuard's boundary) and an error outside rendering (the window listeners
// installed here) both end in one box with a bug report. Every error is also logged to the console, never swallowed.
import { Component, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { SAVE_VERSION } from '../sim/state';
import { exportSlot, getActiveSlotId } from '../sim/save';
import { Button, Modal } from './components';
import { getState } from './store';

interface CrashReport {
  text: string;
}

let current: CrashReport | null = null;
const subscribers = new Set<() => void>();

function describe(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? '' };
  return { message: String(error), stack: '' };
}

function buildReport(source: string, error: unknown): string {
  const { message, stack } = describe(error);
  let day = '?';
  try {
    day = String(getState().day);
  } catch {
    // The store itself may be the thing that broke; the report still goes out without the day.
  }
  return [
    'LLM: Lets Loose Money crash report',
    `Source: ${source}`,
    `Save version: ${SAVE_VERSION}`,
    `Game day: ${day}`,
    `Time: ${new Date().toISOString()}`,
    '',
    `Error: ${message}`,
    '',
    stack || '(no stack)',
  ].join('\n');
}

/** Keeps the first failure (the cause) and logs every one. Only the first one takes the screen. */
export function reportCrash(error: unknown, source: string): void {
  console.error(error);
  if (current) return;
  current = { text: buildReport(source, error) };
  subscribers.forEach((notify) => notify());
}

/** Messages that browsers raise as errors but that break nothing. They are logged, not shown. */
const BENIGN = /ResizeObserver loop/;

/** Errors that happen outside rendering: event handlers, timers, the game loop. */
export function installCrashHandlers(): void {
  window.addEventListener('error', (e) => {
    if (BENIGN.test(e.message)) {
      console.warn(e.message);
      return;
    }
    reportCrash(e.error ?? e.message, 'error');
  });
  // Logged, not shown: rejections here are mostly network (multiplayer) failures, and the game is still playable.
  window.addEventListener('unhandledrejection', (e) => console.error('Unhandled rejection:', e.reason));
}

function useCrashReport(): CrashReport | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const notify = () => tick((n) => n + 1);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, []);
  return current;
}

class Boundary extends Component<{ children?: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };
  componentDidCatch(error: unknown) {
    reportCrash(error, 'render');
    this.setState({ failed: true }); // stop rendering the broken tree while the crash screen takes over
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Wraps the whole app: renders it, or the crash screen once anything has failed. */
export function CrashGuard({ children }: { children?: ComponentChildren }) {
  const crash = useCrashReport();
  return crash ? <CrashScreen report={crash} /> : <Boundary>{children}</Boundary>;
}

function CrashScreen({ report }: { report: CrashReport }) {
  const [status, setStatus] = useState('');
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Clipboard access can be refused (no permission, insecure page). Then the text is selected for a manual copy.
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus(`${what} copied.`);
    } catch {
      textRef.current?.select();
      setStatus(`Could not reach the clipboard. The text is selected: copy it by hand.`);
    }
  };

  const copySave = () => {
    let text: string | null = null;
    try {
      const id = getActiveSlotId();
      text = id ? exportSlot(id) : null;
    } catch {
      text = null;
    }
    if (text) void copy(text, 'Save');
    else setStatus('There is no saved game to copy yet.');
  };

  return (
    <Modal
      open
      title="Something broke"
      subtitle="The game stopped on an error. Saved games are still in this browser. Copy the report for a bug report."
      footer={
        <>
          <Button onClick={copySave}>Copy save</Button>
          <Button onClick={() => window.location.reload()}>Reload</Button>
          <Button variant="primary" onClick={() => copy(report.text, 'Report')}>
            Copy report
          </Button>
        </>
      }
    >
      <textarea ref={textRef} readOnly rows={12} value={report.text} style={{ width: '100%', fontFamily: 'var(--code)', fontSize: '12px' }} />
      {status && <p class="small muted" role="status">{status}</p>}
    </Modal>
  );
}
