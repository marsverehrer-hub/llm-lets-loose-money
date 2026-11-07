// Open/close signal for the multiplayer lobby. Anything can call openLobby(); App mounts <Lobby/> while it is open.
import { useEffect, useState } from 'preact/hooks';

let open = false;
const listeners = new Set<() => void>();
/** Room code from an invite link, held until the lobby takes it. */
let joinCode = '';

function emit(): void {
  for (const l of listeners) l();
}

export function openLobby(): void {
  if (open) return;
  open = true;
  emit();
}

export function closeLobby(): void {
  if (!open) return;
  open = false;
  emit();
}

export function isLobbyOpen(): boolean {
  return open;
}

/** Re-renders the caller when the lobby opens or closes. */
export function useLobbyOpen(): boolean {
  const [, setV] = useState(0);
  useEffect(() => {
    const l = () => setV((v) => v + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return open;
}

/** An invite link: this page's origin and path, so it works under a GitHub Pages subpath. */
export function inviteUrl(href: string, room: string): string {
  const u = new URL(href);
  return `${u.origin}${u.pathname}?join=${room}`;
}

/** `?join=CODE` opens the lobby with the code filled in. The param goes, so a reload does not rejoin. */
export function takeInviteLink(): void {
  const u = new URL(location.href);
  const code = u.searchParams.get('join');
  if (code === null) return;
  u.searchParams.delete('join');
  history.replaceState(history.state, '', u.toString());
  joinCode = code;
  openLobby();
}

/** The invite code, handed over once to the lobby that opens with it. */
export function takeJoinCode(): string {
  const code = joinCode;
  joinCode = '';
  return code;
}
