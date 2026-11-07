// Screen smoke test: opens every panel at desktop and phone width on a bot-played save and fails on
// console/page errors, horizontal scroll, or a desktop panel taller than its target (DESIGN.md "Short screens").
// Usage: npm run screens   (starts the Vite dev server on 5390 itself, kills it on exit)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5390;
const URL_BASE = `http://localhost:${PORT}/`;
const OUT = join(ROOT, 'screens');
const PANELS = ['dashboard', 'models', 'products', 'research', 'data', 'benchmarks', 'compute', 'staff', 'market', 'marketing', 'contracts', 'finance', 'lab', 'achievements', 'field'];
const TARGETS = { dashboard: 1400, research: 1800, data: 1800 };
const DESKTOP_DEFAULT_TARGET = 1500;
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900, opts: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
  { name: '375', width: 375, height: 812, opts: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } },
];

async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch {
    /* fall through to the resolved copies below */
  }
  const req = createRequire(import.meta.url);
  for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/node_modules/playwright']) {
    try {
      return req(p).chromium;
    } catch {
      /* try the next location */
    }
  }
  throw new Error('playwright not found (tried import, /opt/node-tools, /opt/node_modules)');
}

function startDevServer() {
  // Own process group, so kill() also takes the vite process that npx starts (its pipes would keep us alive).
  const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  child.on('error', (e) => console.error('vite failed to start:', e.message));
  return {
    kill() {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
      child.stdout.destroy();
      child.stderr.destroy();
    },
  };
}

async function waitForServer(timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server did not answer on ${URL_BASE} within ${timeoutMs} ms`);
}

async function setUpSave(page) {
  await page.goto(URL_BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: /raised before/i }).click();
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    const store = await import('/src/ui/store.ts');
    const { tick } = await import('/src/sim/engine.ts');
    const { botDay } = await import('/scripts/bot.ts');
    const s = store.getState();
    for (let i = 0; i < 900; i++) botDay(s, false, 'frontier');
    tick(s);
    s.events.pending = null;
    s.pendingMoment = null;
    store.refresh();
  });
  const decide = page.getByText('Decide later', { exact: true });
  if (await decide.first().isVisible().catch(() => false)) await decide.first().click();
}

async function main() {
  const chromium = await loadChromium();
  mkdirSync(OUT, { recursive: true });
  const dev = startDevServer();
  let browser;
  const rows = [];
  const failures = [];
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext(vp.opts);
      const page = await context.newPage();
      let current = 'setup';
      const errors = {};
      const note = (text) => (errors[current] ??= []).push(text);
      page.on('console', (m) => {
        if (m.type() === 'error') note(m.text());
      });
      page.on('pageerror', (e) => note(`pageerror: ${e.message}`));
      await setUpSave(page);
      for (const id of PANELS) {
        current = id;
        await page.evaluate((panel) => window.__nav(panel), id);
        await page.waitForTimeout(800);
        const m = await page.evaluate(() => ({
          docW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
          mainH: document.querySelector('main')?.scrollHeight ?? 0,
        }));
        const hscroll = m.docW > m.innerW;
        const target = vp.width === 1440 ? (TARGETS[id] ?? DESKTOP_DEFAULT_TARGET) : null;
        const tall = target !== null && m.mainH > target;
        const errs = errors[id] ?? [];
        await page.screenshot({ path: join(OUT, `${vp.name}-${id}.png`), fullPage: true });
        rows.push({ vp: vp.name, id, mainH: m.mainH, target, docW: m.docW, innerW: m.innerW, hscroll, errs: errs.length, tall });
        if (errs.length) failures.push(`${vp.name} ${id}: ${errs.length} console/page error(s): ${errs[0]}`);
        if (hscroll) failures.push(`${vp.name} ${id}: horizontal scroll (document ${m.docW}px > viewport ${m.innerW}px)`);
        if (tall) failures.push(`${vp.name} ${id}: main height ${m.mainH}px over target ${target}px`);
      }
      for (const [phase, list] of Object.entries(errors)) {
        if (phase === 'setup' && list.length) failures.push(`${vp.name} setup: ${list.length} console/page error(s): ${list[0]}`);
      }
      await context.close();
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    dev.kill();
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('viewport', 9)}${pad('panel', 14)}${pad('mainH', 8)}${pad('target', 8)}${pad('docW/innerW', 14)}${pad('hscroll', 9)}${pad('errors', 8)}tall`);
  for (const r of rows) {
    console.log(
      `${pad(r.vp, 9)}${pad(r.id, 14)}${pad(r.mainH, 8)}${pad(r.target ?? '-', 8)}${pad(`${r.docW}/${r.innerW}`, 14)}${pad(r.hscroll ? 'YES' : 'no', 9)}${pad(r.errs, 8)}${r.tall ? 'OVER' : ''}`,
    );
  }
  if (failures.length) {
    console.log('\nFAILURES:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  } else {
    console.log('\nAll screens clean.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
