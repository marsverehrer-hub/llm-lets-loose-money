// Player-facing words for save and load outcomes (sim/save.ts and ui/store.ts return these codes). Sentence case.
import { MAX_SLOTS } from '../sim/save';

const TEXT: Record<string, string> = {
  quota: 'Storage is full. Delete or export a save.',
  blocked: 'Saving is blocked in this browser, so progress will not survive a reload.',
  full: `All ${MAX_SLOTS} save slots are in use. Delete a save first.`,
  match: 'Saves cannot be loaded during a multiplayer match.',
  missing: 'That save no longer exists.',
  unreadable: 'That save cannot be opened. It may come from a newer version of the game.',
  unsaved: 'The current game could not be saved, so switching would lose its latest progress.',
  invalid: 'That file is not a save from this game.',
  newer: 'That save comes from a newer version of the game. Update the game to open it.',
};

/** The message for a save or load error code. */
export function saveMessage(code: string): string {
  return TEXT[code] ?? 'Something went wrong with the save.';
}
