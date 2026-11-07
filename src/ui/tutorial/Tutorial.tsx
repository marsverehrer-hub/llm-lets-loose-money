import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { navigate } from '../nav';
import { Button, Modal, useIsMobile } from '../components';
import { dispatch, useGame } from '../store';
import { unlockPanel } from '../unlocks';
import { STEPS, TUTORIAL_STEPS, type StepDef } from './steps';

/** Veterans with a save past this day skip the tutorial. */
const VETERAN_DAY = 30;

/**
 * Onboarding. Step 0 is a welcome modal; steps 1..7 are coach-mark cards that
 * advance themselves when the game state shows the player did the thing.
 * Progress lives in s.tutorialStep, so it survives reloads and saves.
 */
export function Tutorial() {
  const s = useGame();
  const step = s.tutorialStep;
  const [name, setName] = useState(s.company.name);
  // A new game or loaded save keeps this component mounted, so follow the current company's name.
  useEffect(() => setName(s.company.name), [s.company.name]);
  // Per-step bookkeeping. Reset whenever the step changes.
  const track = useRef({ step: Number.NaN, sawPause: false });

  // Veterans: an old save that is well past the opening months does not need a tutorial.
  useEffect(() => {
    if (step === 0 && s.day > VETERAN_DAY) dispatch({ type: 'setTutorialStep', step: -1 });
  });

  // Hidden panels must not break the tour: the panel a step points at (and its pulse) is open while the step is active.
  useEffect(() => {
    const def = step >= 1 && step <= TUTORIAL_STEPS ? STEPS[step] : undefined;
    if (!def) return;
    unlockPanel(s, def.go);
    if (def.highlight) unlockPanel(s, def.highlight);
  });

  useEffect(() => {
    const tr = track.current;
    if (tr.step !== step) {
      tr.step = step;
      tr.sawPause = false;
    }
    if (s.speed === 0) tr.sawPause = true;

    let done = false;
    switch (step) {
      case 1:
        done = s.research.current === 'transformers' || s.research.completed.includes('transformers');
        break;
      case 2:
        done = s.training !== null || s.models.length > 0;
        break;
      case 3:
        // Needs a pause and a resume, so a player who already has time running still learns the key.
        done = s.speed > 0 && tr.sawPause;
        break;
      case 4:
        done = s.models.some((m) => m.releasedDay !== null);
        break;
      case 5:
        done = s.products.length > 0;
        break;
      case 6: {
        const r = s.staff.roles;
        done = r.researcher.count > 2 || r.engineer.count > 1 || r.safety.count > 0 || r.sales.count > 0 || r.marketing.count > 0;
        break;
      }
      default:
        break; // 0 = welcome (player decides), 7 = finale (button), -1 = done
    }
    if (done) dispatch({ type: 'setTutorialStep', step: step + 1 });
  });

  const skip = () => dispatch({ type: 'setTutorialStep', step: -1 });

  const start = () => {
    const n = name.trim().slice(0, 32);
    if (n && n !== s.company.name) dispatch({ type: 'renameCompany', name: n });
    dispatch({ type: 'setTutorialStep', step: 1 });
  };

  const welcomeOpen = step === 0 && !s.gameOver;

  return (
    <>
      <Modal
        open={welcomeOpen}
        title="Welcome, future trillionaire"
        subtitle="Two founders, one engineer, eight rented GPUs and a garage that smells of cold brew."
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={skip}>
              Skip, I've raised before
            </Button>
            <Button variant="primary" onClick={start}>
              Start tutorial ›
            </Button>
          </>
        }
      >
        <div class="tut-welcome-body">
          <p>
            Everyone in the valley is about to call you a visionary. Train models nobody asked for. Ship products people will pretend to need. Raise money from
            investors who don't understand it either.
          </p>
          <p>The only way to lose is running out of cash, so try not to.</p>
        </div>
        <div class="field">
          <label class="field-label" for="tut-company-name">
            What's the company called?
          </label>
          <input
            id="tut-company-name"
            class="input"
            value={name}
            maxLength={32}
            placeholder="Lets Loose Labs"
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') start();
            }}
          />
          <div class="tut-name-hint">You can rename it later by clicking the name in the top bar.</div>
        </div>
      </Modal>

      {step >= 1 && step <= TUTORIAL_STEPS && !s.gameOver && <Coach step={step} onSkip={skip} />}
    </>
  );
}

/** Phones: the card can be folded to a one-line bar. The choice lasts for the browser tab's session. */
const MIN_KEY = 'llm-tut-minimised';
function readMinimised(): boolean {
  try {
    return globalThis.sessionStorage?.getItem(MIN_KEY) === '1';
  } catch {
    return false; // storage blocked: the card opens expanded
  }
}
function writeMinimised(on: boolean): void {
  try {
    globalThis.sessionStorage?.setItem(MIN_KEY, on ? '1' : '0');
  } catch {
    // storage blocked: the choice lasts until a reload
  }
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
interface Layout {
  /** The target the layout was measured for: a stale layout from the previous step is ignored. */
  name: string;
  ring: Box;
  /** Where the card goes (desktop only); null keeps the bottom-left corner. */
  pos: { top: number; left: number } | null;
}

const GAP = 12;
const EDGE = 16;
const MIN_BELOW = 220;

/** The first visible control with this data-tut name (one control can exist twice, e.g. a desktop and a phone row). */
function findTarget(name: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tut="${name}"]`)) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

/** Next to the target: below it when there is room, else above; flipped if the first choice covers it. */
function placeCard(t: Box, w: number, h: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(EDGE, Math.min(t.left, vw - w - EDGE));
  const belowTop = t.top + t.height + GAP;
  const aboveTop = t.top - GAP - h;
  const covers = (top: number) => top < t.top + t.height && top + h > t.top && left < t.left + t.width && left + w > t.left;
  const fits = (top: number) => top >= EDGE && top + h <= vh - EDGE && !covers(top);
  const order = vh - belowTop - EDGE >= MIN_BELOW ? [belowTop, aboveTop] : [aboveTop, belowTop];
  const top = order.find(fits) ?? order[0];
  return { top: Math.max(EDGE, Math.min(top, vh - h - EDGE)), left };
}

/** Follows the target every animation frame, so the card and ring stay put while the panel lays out or scrolls. */
function useTargetLayout(name: string | undefined, card: { current: HTMLElement | null }, place: boolean): Layout | null {
  const [layout, setLayout] = useState<Layout | null>(null);
  useEffect(() => {
    if (!name) {
      setLayout(null);
      return;
    }
    let raf = 0;
    let shown: HTMLElement | null = null;
    let last: Layout | null = null;
    const tick = () => {
      const el = findTarget(name);
      let next: Layout | null = null;
      if (el) {
        if (el !== shown) {
          shown = el;
          el.scrollIntoView({ block: 'center' });
        }
        const r = el.getBoundingClientRect();
        const ring = { top: r.top, left: r.left, width: r.width, height: r.height };
        const c = card.current;
        next = { name, ring, pos: place && c ? placeCard(ring, c.offsetWidth, c.offsetHeight) : null };
      }
      if (!sameLayout(last, next)) {
        last = next;
        setLayout(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // card is a ref object: reading .current each frame is the point.
  }, [name, place]);
  return layout;
}

function sameBox(a: Box, b: Box): boolean {
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}
function sameLayout(a: Layout | null, b: Layout | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.name !== b.name || !sameBox(a.ring, b.ring)) return false;
  return a.pos === b.pos || (!!a.pos && !!b.pos && a.pos.top === b.pos.top && a.pos.left === b.pos.left);
}

/** The sticky note: strip, text and whatever buttons the caller passes. Missions (missions/) reuse it. */
export type CardDef = Pick<StepDef, 'title' | 'body' | 'phoneBody' | 'target'>;
export function CoachCard({ def, label, actions }: { def: CardDef | undefined; label: string; actions: ComponentChildren }) {
  const isPhone = useIsMobile();
  const [minimised, setMinimised] = useState(readMinimised);
  const cardRef = useRef<HTMLElement>(null);
  const folded = isPhone && minimised;
  // Phones keep the card at the bottom (its own layout); the ring still marks the control.
  const found = useTargetLayout(def?.target, cardRef, !isPhone);
  const layout = found && def?.target === found.name ? found : null;

  // Phones: publish the card's height so the toasts stack above it (mobile.css reads --tut-h).
  useEffect(() => {
    const el = cardRef.current;
    if (!isPhone || !el) return;
    const root = document.documentElement;
    const put = () => root.style.setProperty('--tut-h', `${el.offsetHeight + 8}px`);
    put();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(put);
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--tut-h');
    };
  }, [isPhone, label, folded]);

  if (!def) return null;
  const body = isPhone && def.phoneBody ? def.phoneBody : def.body;

  const toggle = () => {
    const next = !minimised;
    setMinimised(next);
    writeMinimised(next);
  };

  return (
    <>
      {layout && (
        <div
          class="tut-ring"
          aria-hidden="true"
          style={{ top: layout.ring.top, left: layout.ring.left, width: layout.ring.width, height: layout.ring.height }}
        />
      )}
    <aside
      ref={cardRef}
      class={`tut-card ${folded ? 'is-min' : ''} ${layout?.pos ? 'is-placed' : ''}`}
      style={layout?.pos ? { top: layout.pos.top, left: layout.pos.left, bottom: 'auto' } : undefined}
      role="region"
      aria-label={label}
    >
      <div class="tut-strip">
        {folded ? (
          <span class="tut-strip-text">
            {label} · {def.title}
          </span>
        ) : (
          <span>{label}</span>
        )}
        {isPhone && (
          <button type="button" class="tut-toggle" aria-expanded={!minimised} onClick={toggle}>
            {minimised ? 'Show' : 'Hide'}
          </button>
        )}
      </div>
      {!folded && (
        <div class="tut-main">
          <div class="tut-title">{def.title}</div>
          <p class="tut-body">{body}</p>
          <div class="tut-actions">
            {actions}
          </div>
        </div>
      )}
    </aside>
    </>
  );
}

function Coach({ step, onSkip }: { step: number; onSkip: () => void }) {
  const def = STEPS[step];
  if (!def) return null;
  const finale = step === TUTORIAL_STEPS;
  return (
    <CoachCard
      def={def}
      label={`Tutorial ${step} of ${TUTORIAL_STEPS}`}
      actions={
        finale ? (
          <>
            <Button variant="primary" size="sm" onClick={() => dispatch({ type: 'setTutorialStep', step: -1 })}>
              Let's go
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate(def.go)}>
              Finance ›
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="sm" onClick={() => navigate(def.go, def.intent)}>
              Go ›
            </Button>
            <Button variant="ghost" size="sm" class="tut-skip" onClick={onSkip}>
              Skip
            </Button>
          </>
        )
      }
    />
  );
}
