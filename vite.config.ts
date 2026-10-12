import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// `.ts.net` is the tailnet MagicDNS suffix: a phone on the tailnet reaches the dev and preview servers by name.
const TAILNET_HOSTS = ['.ts.net', 'localhost'];

export default defineConfig({
  // Relative asset paths: the same build works at a domain root (localhost, the tunnel) and in a sub-folder
  // (GitHub Pages serves the game at /llm-lets-loose-money/).
  base: './',
  plugins: [preact()],
  server: { port: 5320, allowedHosts: TAILNET_HOSTS },
  preview: { port: 5380, allowedHosts: TAILNET_HOSTS },
});
