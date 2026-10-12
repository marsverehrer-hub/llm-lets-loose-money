// Open/close signal for the multiplayer lobby. Anything can call openLobby(); App mounts <Lobby/> while it is open.
import { useEffect, useState } from 'preact/hooks';

let open = false;
const listeners = new Set<() => void>();

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
