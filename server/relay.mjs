// OWNER: Agent MP-NET. Tiny WebSocket relay for 1v1 matches (GAME_DESIGN.md §15). Run: npm run relay (PORT defaults to 8787).
// Clients connect to ws://host:PORT/?room=CODE&role=host|guest. Rooms hold one host and one guest socket.
// Every text frame goes to the other socket in the room. A socket that closes (or is replaced) sends {"t":"bye"} to its peer.
import http from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 8787;
const CODE = /^[A-HJ-NP-Z]{6}$/;
const BYE = JSON.stringify({ t: 'bye' });
const rooms = new Map(); // code -> { host: WebSocket|null, guest: WebSocket|null }
const other = (role) => (role === 'host' ? 'guest' : 'host');
const send = (ws, data) => {
  if (ws && ws.readyState === 1) ws.send(data);
};

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://relay');
  const code = (url.searchParams.get('room') ?? '').toUpperCase();
  const role = url.searchParams.get('role');
  if (!CODE.test(code) || (role !== 'host' && role !== 'guest')) return ws.close(4000, 'bad room or role');

  // A guest can only join a room whose host is up.
  if (role === 'guest' && !rooms.get(code)?.host) return ws.close(4004, 'no host');
  let room = rooms.get(code);
  if (!room) rooms.set(code, (room = { host: null, guest: null }));

  // A reconnecting socket replaces its stale predecessor. The peer hears bye, so it knows to rejoin.
  const old = room[role];
  room[role] = ws;
  ws.alive = true;
  ws.room = code;
  ws.role = role;
  if (old) {
    old.close(4009, 'replaced');
    send(room[other(role)], BYE);
  }

  ws.on('pong', () => {
    ws.alive = true;
  });
  ws.on('message', (data) => {
    const r = rooms.get(ws.room);
    if (r && r[ws.role] === ws) send(r[other(ws.role)], data.toString());
  });
  ws.on('close', () => {
    const r = rooms.get(ws.room);
    if (!r || r[ws.role] !== ws) return; // already replaced
    r[ws.role] = null;
    send(r[other(ws.role)], BYE);
    if (!r.host && !r.guest) rooms.delete(ws.room);
  });
});

// Drop sockets that stopped answering pings, so half-open connections don't hold a room slot forever.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    else {
      ws.alive = false;
      ws.ping();
    }
  }
}, 30000).unref();

server.listen(PORT, () => console.log(`LLM relay listening on :${PORT}`));
