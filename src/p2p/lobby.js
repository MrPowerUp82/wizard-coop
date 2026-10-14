import { campaignId } from '../../server/campaign.js';
import { sanitizeCurses } from '../../server/curses.js';
import { channel } from './channel.js';

export const LOBBY_ROOM = 'arcana-lobby';
export const ANNOUNCE_EVERY_MS = 3000;
export const ROOM_TTL_MS = 8000;

/** Announcements come from strangers and end up in the menu: keep only known shapes, short strings and bounded numbers. */
export function sanitizeAnnouncement(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info) || typeof info.code !== 'string') return null;
  const code = info.code.slice(0, 8).toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code) || info.code.length > 8) return null;
  const count = Number.isInteger(info.count) ? Math.max(0, Math.min(4, info.count)) : 0;
  return { code, count, running: info.running === true,
    host: (typeof info.host === 'string' ? info.host : '').slice(0, 16) || 'Arcanista',
    campaign: campaignId(info.campaign), curses: sanitizeCurses(info.curses) };
}

/**
 * Hosts of open rooms call this: while `snapshot()` says the room is listed (open, not over, not full)
 * it announces itself to everyone in the shared lobby room. Closed rooms never announce.
 */
export function announceRooms({ openRoom, snapshot, intervalMs = ANNOUNCE_EVERY_MS }) {
  let room = null;
  let rooms = null;
  const tick = () => {
    const info = snapshot();
    if (!info || info.visibility !== 'open' || info.over || info.full) return;
    if (!room) { room = openRoom(LOBBY_ROOM); rooms = channel(room, 'rooms'); }
    rooms.send({ code: info.code, count: info.count, running: info.running, host: info.host, campaign: info.campaign, curses: info.curses });
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return { stop() { clearInterval(timer); room?.leave(); room = null; } };
}

/**
 * The menu calls this while the join panel is open and reports the current list whenever it changes.
 * It must be an active peer: a Trystero "passive" peer never announces itself, so it would never find anyone.
 */
export function watchRooms({ openRoom, onUpdate, ttlMs = ROOM_TTL_MS, now = Date.now }) {
  const room = openRoom(LOBBY_ROOM);
  const known = new Map();
  let last = '';
  const publish = () => {
    for (const [code, entry] of known) if (now() - entry.seen > ttlMs) known.delete(code);
    const list = [...known.values()].map(entry => ({ code: entry.code, count: entry.count, running: entry.running, host: entry.host,
      campaign: entry.campaign, curses: entry.curses }));
    const signature = JSON.stringify(list);
    if (signature === last) return;
    last = signature;
    onUpdate(list);
  };
  channel(room, 'rooms').onMessage(info => {
    const clean = sanitizeAnnouncement(info);
    if (!clean) return;
    known.set(clean.code, { ...clean, seen: now() });
    publish();
  });
  const timer = setInterval(publish, 1000);
  return { stop() { clearInterval(timer); room.leave(); } };
}
