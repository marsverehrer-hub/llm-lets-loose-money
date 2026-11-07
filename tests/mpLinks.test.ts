import { describe, it, expect, vi, afterEach } from 'vitest';
import { closeLobby, inviteUrl, isLobbyOpen, takeInviteLink, takeJoinCode } from '../src/ui/mp/lobbyState';
import { parseIceServers } from '../src/net/transport';

afterEach(() => {
  closeLobby();
  vi.unstubAllGlobals();
});

describe('invite links', () => {
  it('keeps the origin and path, so a GitHub Pages subpath survives', () => {
    expect(inviteUrl('https://user.github.io/llm-lets-loose-money/?x=1#top', 'ABCDEF')).toBe(
      'https://user.github.io/llm-lets-loose-money/?join=ABCDEF',
    );
  });

  it('opens the lobby with the code once, and drops the param so a reload does not rejoin', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', new URL('https://user.github.io/llm-lets-loose-money/?join=ABCDEF&keep=1'));
    vi.stubGlobal('history', { state: null, replaceState: replace });
    takeInviteLink();
    expect(replace).toHaveBeenCalledWith(null, '', 'https://user.github.io/llm-lets-loose-money/?keep=1');
    expect(isLobbyOpen()).toBe(true);
    expect(takeJoinCode()).toBe('ABCDEF');
    expect(takeJoinCode()).toBe('');
  });

  it('does nothing without the param', () => {
    const replace = vi.fn();
    vi.stubGlobal('location', new URL('https://user.github.io/llm-lets-loose-money/'));
    vi.stubGlobal('history', { state: null, replaceState: replace });
    takeInviteLink();
    expect(replace).not.toHaveBeenCalled();
    expect(isLobbyOpen()).toBe(false);
  });
});

describe('extra ICE servers (VITE_ICE_SERVERS)', () => {
  it('reads a JSON array of RTCIceServer and warns about anything else', () => {
    const turn = [{ urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }];
    expect(parseIceServers(JSON.stringify(turn))).toEqual(turn);
    expect(parseIceServers(undefined)).toEqual([]);
    expect(parseIceServers('')).toEqual([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(parseIceServers('{nope')).toEqual([]);
    expect(parseIceServers('{"urls":"turn:turn.example.com:3478"}')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
