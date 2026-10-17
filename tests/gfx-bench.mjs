// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts Journey stage 1 (First Service) from the visible menus and keeps serving through the station
// buttons (Serve table N / kitchen pick-up), so guests walk in, waiters carry dishes and stoves steam.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('.screen[aria-label="title"] .logo', { timeout: 15000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.waitForSelector('#gfx-section #gfx-preset');
  await page.locator('#gfx-preset').selectOption(preset);
  await page.waitForFunction((p) => document.body.getAttribute('data-gfx-preset') === p, preset);
  await page.getByRole('button', { name: '← Back' }).click();
  await page.waitForSelector('.screen[aria-label="title"]');
}

// The station list is rebuilt every tick, so click the live coordinates (as the e2e does).
async function clickAt(page, selector) {
  const pt = await page.evaluate((s) => {
    const e = document.querySelector(s);
    const r = e && e.getBoundingClientRect();
    return r && r.width ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, selector);
  if (pt) await page.mouse.click(pt.x, pt.y);
}

export async function start(page) {
  await page.getByRole('button', { name: '▶ Play' }).click();
  await page.locator('.mode-card', { hasText: 'Journey' }).click();
  await page.waitForSelector('.level-grid');
  await page.locator('.level-cell:not(.locked)').first().click();
  await page.waitForSelector('.station-list', { state: 'attached', timeout: 8000 });
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      try {
        const b = await page.evaluate(() => {
          const t = [...document.querySelectorAll('.station-list .station button[aria-label^="Serve table"]')]
            .map((x) => x.getAttribute('aria-label'));
          const k = document.querySelector('.station.kitchen button');
          return { serve: t[0] || null, pickup: !!(k && !k.disabled), results: !!document.querySelector('.screen .results-table') };
        });
        if (b.results) await page.getByRole('button', { name: /Play again|Retry/ }).click({ timeout: 1000 });
        else if (b.pickup) await clickAt(page, '.station.kitchen button');
        else if (b.serve) await clickAt(page, `.station-list button[aria-label="${b.serve}"]`);
      } catch { /* list rebuilt mid-click */ }
      await new Promise((r) => setTimeout(r, 300));
    }
  })();
  await page.waitForTimeout(500);
}
