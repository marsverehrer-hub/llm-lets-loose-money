// Module-level store for the Models panel: the in-progress pre-training draft and which view is open.
// Kept outside React state so a half-built run survives switching panels. Reset after Train.
import { useEffect, useState } from 'preact/hooks';
import type { GameState, Id } from '../../../sim/types';
import { initSheet } from './model';
import type { Sheet } from './model';
import { onGameSwap } from '../../store';

export type StepId = 1 | 2 | 3 | 4 | 5;

export interface Draft {
  step: StepId;
  sheet: Sheet;
  /** Learning rates in the LR sweep: 3 or 5. */
  sweepCount: 3 | 5;
}

export type View =
  | { kind: 'list' }
  | { kind: 'train' }
  | { kind: 'finetune'; parentId: Id }
  /** Release wizard for an unreleased model (ModelPage Lifecycle tab). */
  | { kind: 'release'; modelId: Id }
  /** Distill wizard: the teacher model. */
  | { kind: 'distill'; teacherId: Id }
  /** Merge wizard: the first model of the pair. */
  | { kind: 'merge'; aId: Id };

let draft: Draft | null = null;
let view: View = { kind: 'list' };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** The current draft, created from the state the first time it is needed. */
export function getDraft(s: GameState): Draft {
  if (!draft) draft = { step: 1, sheet: initSheet(s), sweepCount: 3 };
  return draft;
}

export function updateDraft(fn: (d: Draft) => Draft): void {
  if (!draft) return;
  draft = fn(draft);
  emit();
}

/** Forget the draft. The next open starts from a fresh sheet. */
export function resetDraft(): void {
  draft = null;
  emit();
}

export function getView(): View {
  return view;
}

export function setView(next: View): void {
  view = next;
  emit();
}

/** Subscribes a component to draft and view changes. Returns nothing useful; the caller reads with getDraft/getView. */
export function useDraftStore(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
}

// A different game took over (new game or loaded save): a half-built run belongs to the old one.
onGameSwap(() => {
  draft = null;
  view = { kind: 'list' };
  emit();
});
