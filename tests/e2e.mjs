/**
 * Bistro Builder — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the REAL visible on-screen UI in headless Chrome (playwright-core +
 * system Chrome): title → settings open/close → help → Learn lesson 1 →
 * results → Journey stage 1 played to the end-of-day results screen by
 * clicking the actual Serve/Pick up buttons (or number/K keys, the documented
 * keyboard controls) → pause/resume → leave service (resign results) → home.
 * Runs twice: desktop 1280x800, then a fresh mobile context 390x844 w/ touch.
 *
 * The repo's server.js is the StarHermit authoritative host (score replay
 * validation) — NOT a dev server — so this file embeds its own minimal
 * static server on an ephemeral port, with tiny /api/v1 stubs so the game's
 * offline-capable API calls resolve without console noise.
 *
 * State synchronization reads the semantic station-mirror DOM (the text
 * version of the 3D board); every action goes through real UI interaction.
 * Any pageerror / console error (minus benign GPU/swiftshader noise) fails
 * the run. Screenshots: /tmp/bistro-builder-e2e-<stage>-<pass>.png.
 *
 * Run: npm run test:e2e
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.ts': 'text/typescript', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Minimal /api/v1 stubs (the game falls back to local boards offline).
    if (url.pathname.startsWith('/api/v1/')) {
      res.setHeader('Content-Type', 'application/json');
      if (url.pathname === '/api/v1/time') return res.end(JSON.stringify({ now: Date.now() }));
      if (url.pathname === '/api/v1/scores' && req.method === 'GET') return res.end(JSON.stringify({ entries: [] }));
      return res.end(JSON.stringify({ ok: true }));
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (p === '/' || p === '\\') p = '/index.html';
    const file = join(ROOT, p);
    if (!file.startsWith(ROOT)) throw new Error('bad path');
    const body = await readFile(file);
    res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('not found');
  }
});

const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const SHOT = (stage, pass) => `/tmp/bistro-builder-e2e-${stage}-${pass}.png`;

/** Snapshot of the semantic station mirror (text version of the board). */
function readBoard(page) {
  return page.evaluate(() => {
    const waiting = [], urgent = [];
    for (const b of document.querySelectorAll('.station-list .station button[aria-label^="Serve table"]')) {
      const id = parseInt(b.getAttribute('aria-label').replace(/\D+/g, ''), 10);
      (b.closest('.station').classList.contains('urgent') ? urgent : waiting).push(id);
    }
    const pickup = document.querySelector('.station.kitchen button');
    const chip = (re) => {
      for (const s of document.querySelectorAll('.stat-chip')) if (re.test(s.textContent)) return s.textContent.trim();
      return '';
    };
    const screenLabel = document.querySelector('.screen')?.getAttribute('aria-label') || null;
    return {
      waiting, urgent,
      pickupEnabled: !!(pickup && !pickup.disabled),
      served: chip(/Served/), coins: chip(/Coins/), clock: chip(/⏱/),
      screen: screenLabel,
      resultsOpen: !!document.querySelector('.screen .results-table'),
      outcome: document.querySelector('.outcome-head')?.textContent || null,
    };
  });
}

/**
 * Real mouse click at a selector's live position. The station mirror is
 * rebuilt every simulation tick (innerHTML swap), so Playwright's
 * stability-checked locator.click() never settles; clicking the coordinates
 * of the element's current bounding box is the same physical click a player
 * makes and survives the rebuilds.
 */
async function clickAt(page, selector) {
  for (let i = 0; i < 40; i++) {
    const pt = await page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, selector);
    if (pt) {
      await page.mouse.click(pt.x, pt.y);
      return;
    }
    await page.waitForTimeout(75);
  }
  throw new Error('not clickable: ' + selector);
}

/** One real UI action based on the board state; true if something was done. */
async function actOnce(page, board, useKeys) {
  const table = board.urgent[0] ?? board.waiting[0];
  if (table != null) {
    if (useKeys) await page.keyboard.press(String(table + 1));
    else await clickAt(page, `.station-list button[aria-label="Serve table ${table + 1}"]`);
    return true;
  }
  if (board.pickupEnabled) {
    if (useKeys) await page.keyboard.press('k');
    else await clickAt(page, '.station.kitchen button');
    return true;
  }
  return false;
}

/** Play the day through the visible UI until the results screen appears. */
async function playUntilResults(page, pass, useKeys, timeoutMs) {
  const t0 = Date.now();
  let lastLog = '', actions = 0, shots = 0;
  while (Date.now() - t0 < timeoutMs) {
    const b = await readBoard(page);
    if (b.resultsOpen) return { actions, outcome: b.outcome };
    if (b.screen === 'Paused') throw new Error('game unexpectedly paused during play');
    const status = `${b.served} ${b.coins} ${b.clock}`;
    if (status.trim() && status !== lastLog) { console.log(`  [${pass}] ${status}`); lastLog = status; }
    try {
      if (await actOnce(page, b, useKeys)) {
        actions++;
        if (shots === 0) { await page.screenshot({ path: SHOT('play', pass) }); shots++; }
      }
    } catch { /* mirror rebuilt mid-click; next poll retries */ }
    await page.waitForTimeout(250);
  }
  throw new Error(`timed out waiting for results (${Math.round(timeoutMs / 1000)}s)`);
}

async function runPass(browser, pass, viewport, hasTouch) {
  const errors = [];
  const context = await browser.newContext({ viewport, hasTouch });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !browserNoise.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  const step = async (name, fn) => { await fn(); console.log(`ok - [${pass}] ${name}`); };
  const useKeys = hasTouch; // mobile: rails are drawers; use the documented 1–9/K keys

  try {
    await step('load + title visible', async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
      await page.waitForSelector('.screen[aria-label="title"] .logo', { timeout: 10000 });
      await page.screenshot({ path: SHOT('title', pass) });
    });

    await step('settings open, toggle reduced motion, close', async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.waitForSelector('#settings-form');
      const row = page.locator('.setting-row', { hasText: 'Reduced motion' }).locator('input');
      await row.check();
      if (!await page.evaluate(() => document.body.classList.contains('reduced-motion')))
        throw new Error('reduced-motion setting did not apply to <body>');
      await page.screenshot({ path: SHOT('settings', pass) });
      await row.uncheck();
      await page.getByRole('button', { name: '← Back' }).click();
      await page.waitForSelector('.screen[aria-label="title"]');
    });

    await step('help opens and closes', async () => {
      await page.getByRole('button', { name: 'Help' }).click();
      await page.waitForSelector('.screen[aria-label="help"] .help-card');
      await page.getByRole('button', { name: '← Back' }).click();
      await page.waitForSelector('.screen[aria-label="title"]');
    });

    await step('learn lesson 1: serve a guest → lesson complete results', async () => {
      await page.getByRole('button', { name: '▶ Play' }).click();
      await page.waitForSelector('.screen[aria-label="modes"]');
      await page.locator('.mode-card', { hasText: 'Learn' }).click();
      await page.waitForSelector('.screen[aria-label="learn"]');
      await page.locator('.mode-card', { hasText: 'Serve a guest' }).click();
      // wait out the 3-2-1 countdown, then serve table 1 via the visible UI
      await page.waitForTimeout(3000);
      await page.waitForSelector('.station-list button[aria-label="Serve table 1"]', { state: 'attached', timeout: 8000 });
      if (useKeys) await page.keyboard.press('1');
      else await clickAt(page, '.station-list button[aria-label="Serve table 1"]');
      await page.waitForSelector('.screen .results-table', { timeout: 15000 });
      const head = await page.textContent('.outcome-head');
      if (!/Lesson complete/.test(head)) throw new Error('unexpected lesson outcome: ' + head);
      await page.screenshot({ path: SHOT('lesson', pass) });
    });

    await step('journey grid: 40 stages, stage 1 unlocked', async () => {
      await page.getByRole('button', { name: 'Home' }).click();
      await page.waitForSelector('.screen[aria-label="title"]');
      await page.getByRole('button', { name: '▶ Play' }).click();
      await page.locator('.mode-card', { hasText: 'Journey' }).click();
      await page.waitForSelector('.level-grid');
      const cells = await page.locator('.level-cell').count();
      if (cells !== 40) throw new Error(`expected 40 stages, got ${cells}`);
      const unlocked = await page.locator('.level-cell:not(.locked)').count();
      if (unlocked < 1) throw new Error('no journey stage unlocked');
      await page.screenshot({ path: SHOT('journey', pass) });
    });

    await step('journey stage 1: play a full day to results', async () => {
      await page.locator('.level-cell:not(.locked)').first().click(); // stage 1: First Service
      await page.waitForSelector('.station-list', { state: 'attached', timeout: 8000 });
      // fast-forward 2× (end state is identical) so the 120 s day takes ~60 s
      await page.getByRole('button', { name: 'Toggle fast-forward' }).click();
      const { actions, outcome } = await playUntilResults(page, pass, useKeys, 110000);
      console.log(`  [${pass}] outcome: ${outcome} (ui actions: ${actions})`);
      if (!/Goal reached|Day complete|goal missed/.test(outcome || ''))
        throw new Error('unexpected journey outcome: ' + outcome);
      await page.screenshot({ path: SHOT('results', pass) });
    });

    await step('progress persisted to localStorage', async () => {
      const save = await page.evaluate(() => {
        const raw = localStorage.getItem('bistrobuilder.save.v1');
        if (!raw) return null;
        const wrapped = JSON.parse(raw);
        return wrapped && wrapped.payload ? JSON.parse(wrapped.payload) : null;
      });
      if (!save || !save.progress || save.progress.stats.rounds < 1)
        throw new Error('progress not persisted after a full round');
      console.log(`  [${pass}] rounds: ${save.progress.stats.rounds}, wins: ${save.progress.stats.wins}, served: ${save.progress.stats.served}`);
    });

    await step('pause → resume → leave service → resign results → home', async () => {
      await page.getByRole('button', { name: /Play again|Retry/ }).click();
      await page.waitForSelector('.station-list', { state: 'attached', timeout: 8000 });
      await page.waitForTimeout(3200); // countdown
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.waitForSelector('.screen[aria-label="Paused"]');
      const frozen = (await readBoard(page)).clock;
      await page.waitForTimeout(700);
      if ((await readBoard(page)).clock !== frozen) throw new Error('clock kept running while paused');
      await page.screenshot({ path: SHOT('pause', pass) });
      await page.getByRole('button', { name: '▶ Resume' }).click();
      await page.waitForSelector('.screen[aria-label="Paused"]', { state: 'detached' });
      // rewind via the documented U key: view + clock must keep running afterwards
      await page.keyboard.press('u');
      await page.waitForTimeout(400);
      const c1 = (await readBoard(page)).clock;
      await page.waitForTimeout(1600);
      const c2 = (await readBoard(page)).clock;
      if (!c1 || c1 === c2) throw new Error(`clock frozen after rewind (${c1} -> ${c2})`);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.waitForSelector('.screen[aria-label="Paused"]');
      await page.getByRole('button', { name: 'Leave service' }).click();
      await page.waitForSelector('.screen .results-table', { timeout: 10000 });
      const head = await page.textContent('.outcome-head');
      console.log(`  [${pass}] resign outcome: ${head}`);
      await page.screenshot({ path: SHOT('resign-results', pass) });
      await page.getByRole('button', { name: 'Home' }).click();
      await page.waitForSelector('.screen[aria-label="title"]');
    });
  } finally {
    if (errors.length) {
      console.log(`PAGE ERRORS [${pass}]:\n` + errors.join('\n'));
      throw new Error(`${errors.length} page error(s) in ${pass} pass`);
    }
    await context.close();
  }
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
console.log(`static server on http://127.0.0.1:${server.address().port}/`);

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
try {
  await runPass(browser, 'desktop', { width: 1280, height: 800 }, false);
  await runPass(browser, 'mobile', { width: 390, height: 844 }, true);
  console.log('\nE2E PASS — bistro-builder playable end-to-end on desktop + mobile, no page errors');
} finally {
  await browser.close();
  server.close();
}
