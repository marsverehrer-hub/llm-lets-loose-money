// Browser smoke test: plays from a new game to the first launch at phone and desktop size, visits every screen,
// and fails on console errors, horizontal scroll or tap targets under 44px. Screenshots land in screens/.
// Usage: npm run smoke   (starts its own Vite dev server on 5390)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const PORT = 5390;
const URL = `http://localhost:${PORT}/?seed=1&fast=1`;
const VIEWPORTS = [
  { name: 'phone', opts: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  { name: 'desktop', opts: { viewport: { width: 1280, height: 800 } } },
];

async function loadChromium() {
  try { return (await import('playwright')).chromium; } catch { /* fall through */ }
  const req = createRequire(import.meta.url);
  for (const p of ['/opt/node-tools/node_modules/playwright', '/opt/node_modules/playwright']) {
    try { return req(p).chromium; } catch { /* next */ }
  }
  throw new Error('playwright not found');
}

const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid); } catch { /* already gone */ } };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(URL)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('dev server did not start');
}

const problems = [];
async function audit(page, label) {
  const r = await page.evaluate(() => {
    const small = [...document.querySelectorAll('button, input')].filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.height < 43.5 || b.width < 43.5) && el.type !== 'checkbox';
    }).map((el) => `${el.className || el.tagName} "${el.textContent.trim().slice(0, 20)}"`);
    return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, small };
  });
  if (r.scroll > 1) problems.push(`${label}: horizontal scroll of ${r.scroll}px`);
  if (r.small.length) problems.push(`${label}: small tap targets: ${[...new Set(r.small)].slice(0, 5).join('; ')}`);
}

await waitForServer();
mkdirSync('screens', { recursive: true });
const chromium = await loadChromium();
const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext(vp.opts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${vp.name}: console error: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${vp.name}: page error: ${e.message}`));
  const shot = async (name) => { await audit(page, `${vp.name}/${name}`); await page.screenshot({ path: `screens/${vp.name}-${name}.png`, fullPage: false }); };

  await page.goto(URL);
  await shot('0-newgame');
  await page.click('#start');
  await shot('1-desk');
  await page.click('text=Design a model');
  for (const step of ['size', 'data', 'tricks']) { await shot(`2-wizard-${step}`); await page.click('#wiz-next'); }
  await shot('2-wizard-plan');
  await page.click('#wiz-train');

  // Play until the first launch moment: end weeks, always take the first option.
  let sawCall = false;
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.moment').count()) break;
    const option = page.locator('.option').first();
    if (await option.count()) {
      if (!sawCall) { await shot('3-call'); sawCall = true; }
      await option.click();
      if (i === 1) await shot('3-outcome');
    } else {
      await page.click('#end-week');
    }
  }
  if (!(await page.locator('.moment').count())) problems.push(`${vp.name}: never reached a launch moment`);
  await page.waitForSelector('#moment-ok');
  await shot('4-launch');
  await page.click('#moment-ok');
  for (const tab of ['Lab', 'Market', 'Street', 'Empire', 'Desk']) {
    await page.click(`.tabs button:has-text("${tab}")`);
    await shot(`5-${tab.toLowerCase()}`);
  }
  await page.click('.tabs button:has-text("Street")');
  await page.click('button:has-text("Rich list")');
  await shot('6-richlist');
  await page.click('button:has-text("Companies")');
  await page.click('button[aria-label="Open Mistrial"]');
  await shot('6-dossier');
  if (await page.locator('#buy:not([disabled])').count()) await page.click('#buy');
  await page.locator('.sheet-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot('6-dossier-bid');
  await page.click('.sheet .x');
  await page.click('.tabs button:has-text("Empire")');
  await page.evaluate(() => window.scrollTo(0, 500));
  await shot('6-empire-finance');
  await page.click('.tabs button:has-text("Desk")');
  await page.click('#skip');
  await shot('6-after-skip');
  // Drive the sim directly to the end of the year to see the race moment.
  await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 200; i++) {
      const s = g.get();
      if (s.moments[0]?.kind === 'race') break;
      if (s.moments.length) g.act({ t: 'dismissMoment' });
      const run = Object.values(s.runs).find((r) => r.lab === s.labId && r.status === 'running' && r.call);
      if (run) g.act({ t: 'answerCall', run: run.id, option: 0 }); else g.nextWeek();
    }
  });
  await page.waitForSelector('.moment');
  await shot('7-race');
  await page.click('#moment-ok');
  await page.click('.tabs button:has-text("Market")');
  await page.click('text=Why they buy');
  await shot('8-market-why');
  await ctx.close();
}
await browser.close();
stop();
if (problems.length) { console.error('SMOKE FAILED\n' + problems.join('\n')); process.exit(1); }
console.log('smoke ok: new game to first launch on phone and desktop, every screen visited');
process.exit(0);
