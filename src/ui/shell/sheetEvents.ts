// Window events that open the new-game and saves sheets. They live apart from the sheets, which App lazy-loads,
// so the menu and the game-over window can open them without pulling in the sheets' code.

/** Window event that opens the setup screen. The menu fires it after its confirm. */
export const NEW_GAME_EVENT = 'llm:newgame';
/** Window event that opens the saves sheet. */
export const SAVES_EVENT = 'llm:saves';

export function openNewGame(): void {
  window.dispatchEvent(new Event(NEW_GAME_EVENT));
}

export function openSaves(): void {
  window.dispatchEvent(new Event(SAVES_EVENT));
}
