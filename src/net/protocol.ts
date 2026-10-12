// OWNER: Agent MP-NET. Wire protocol for 1v1 online multiplayer. See GAME_DESIGN.md §15 (Network).
// Messages travel as JSON text. Both transports (PeerJS data channel and the WebSocket relay) use the same encoding.
import type { MpSettings, RivalAttack, RivalSnapshot } from '../sim/types';

export const PROTOCOL_VERSION = 2;
/** PeerJS peer id for a room: the host registers this id, the guest connects to it. */
export const PEER_PREFIX = 'llmllm-';
export const ROOM_CODE_LENGTH = 6;
/** A–Z without I and O, so codes read clearly out loud. */
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export type NetMsg =
  | { t: 'hello'; name: string; color: string; version: number }
  | { t: 'welcome'; seed: number; settings: MpSettings; hostName: string; hostColor: string; protocol: number }
  | { t: 'snap'; snap: RivalSnapshot }
  /** `done` is set once the sender's match has a result: the receiver stops waiting on lockstep for it. */
  | { t: 'day'; day: number; speed: number; done?: boolean }
  | { t: 'attack'; attack: RivalAttack }
  | { t: 'chat'; text: string }
  /**
   * v12 shared match speed. set: pause or slow down, applies at once on both sides. ask/yes/no: speed-up request.
   * resume/ready/hold: the 30-second countdown out of a pause.
   */
  | { t: 'spd'; op: SpeedOp; speed?: number }
  | { t: 'ping'; at: number }
  | { t: 'pong'; at: number }
  | { t: 'bye' };

export type SpeedOp = 'set' | 'ask' | 'yes' | 'no' | 'resume' | 'ready' | 'hold';
const SPEED_OPS: readonly string[] = ['set', 'ask', 'yes', 'no', 'resume', 'ready', 'hold'];

export function generateRoomCode(): string {
  const bytes = new Uint32Array(ROOM_CODE_LENGTH);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 2 ** 32);
  let out = '';
  for (const b of bytes) out += ROOM_ALPHABET[b % ROOM_ALPHABET.length];
  return out;
}

/** Uppercase and drop anything that is not a letter, so pasted codes with spaces or dashes still work. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '');
}

export function isRoomCode(code: string): boolean {
  return new RegExp(`^[A-HJ-NP-Z]{${ROOM_CODE_LENGTH}}$`).test(code);
}

export function peerIdFor(room: string): string {
  return PEER_PREFIX + room;
}

export function encodeNetMsg(msg: NetMsg): string {
  return JSON.stringify(msg);
}

/** Parse and shape-check an incoming frame. Returns null for anything we don't understand. */
export function decodeNetMsg(raw: unknown): NetMsg | null {
  if (typeof raw !== 'string') return null;
  try {
    return parseNetMsg(JSON.parse(raw));
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseNetMsg(v: unknown): NetMsg | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'hello':
      return isStr(v.name) && isStr(v.color) && isNum(v.version) ? (v as NetMsg) : null;
    case 'welcome':
      return isNum(v.seed) && isObj(v.settings) && isStr(v.hostName) && isStr(v.hostColor) && isNum(v.protocol)
        ? (v as NetMsg)
        : null;
    case 'snap':
      return isObj(v.snap) ? (v as NetMsg) : null;
    case 'day':
      return isNum(v.day) && isNum(v.speed) ? (v as NetMsg) : null;
    case 'attack':
      return isObj(v.attack) ? (v as NetMsg) : null;
    case 'chat':
      return isStr(v.text) ? (v as NetMsg) : null;
    case 'spd':
      return isStr(v.op) && SPEED_OPS.includes(v.op) && (v.speed === undefined || isNum(v.speed)) ? (v as NetMsg) : null;
    case 'ping':
    case 'pong':
      return isNum(v.at) ? (v as NetMsg) : null;
    case 'bye':
      return v as NetMsg;
    default:
      return null;
  }
}
