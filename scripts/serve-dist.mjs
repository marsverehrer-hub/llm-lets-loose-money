// Static server for the built game (dist/), used for tailnet hosting (start-tailnet.bat).
// Listens on 127.0.0.1 only; `tailscale serve` publishes it over HTTPS to your tailnet.
// Unlike scripts/serve.ps1 it accepts any Host header, which the tailnet proxy needs.
// Usage: node scripts/serve-dist.mjs [port=5381] [root=dist]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const port = Number(process.argv[2] ?? 5381);
const root = resolve(process.argv[3] ?? 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json',
};

async function resolveFile(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^([/\\])+/, '');
  const full = resolve(join(root, clean));
  if (full !== root && !full.startsWith(root + sep)) return null; // no path traversal
  try {
    const st = await stat(full);
    if (st.isDirectory()) return resolveFile(join(clean, 'index.html'));
    return full;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  try {
    let file = await resolveFile(req.url ?? '/');
    // Single-page app: unknown paths without an extension fall back to index.html.
    if (!file && !extname(req.url ?? '')) file = join(root, 'index.html');
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const body = await readFile(file);
    const name = file.slice(root.length);
    // Hashed assets can be cached forever; the shell, manifest and service worker must stay fresh.
    const cache = name.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': cache });
    res.end(body);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Server error');
  }
});

server.on('error', async (err) => {
  if (err.code !== 'EADDRINUSE') {
    console.error(`Could not start the server: ${err.message}`);
    process.exit(1);
  }
  // Something already listens on the port. If it is this game, the existing server keeps serving the new build.
  try {
    const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    if (html.includes('LLM: Lets Loose Money')) {
      console.log(`The game is already being served on port ${port}. It serves the files in dist, so the new build is live.`);
      process.exit(0);
    }
  } catch {
    // fall through
  }
  console.error(`Port ${port} is used by another program. Close it, or pass a different port.`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port}/`);
  console.log('Keep this window open while people play. Close it to stop.');
});
