// Browser smoke test of the real UI: plays one whole leg by tap and by drag,
// reloads mid-Stop to prove resume, and saves screenshots.
// Usage: node tools/ui-smoke.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const { chromium } = createRequire(import.meta.url)('playwright-core');
const out = process.argv[2] || fileURLToPath(new URL('../build/ui-smoke/', import.meta.url));
mkdirSync(out, { recursive: true });
const port = 8791;
const server = spawn(process.execPath, [fileURLToPath(new URL('./serve.mjs', import.meta.url)), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const opts = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' };
const browser = await chromium.launch(opts);
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
  const act = (name, extra = '') => page.click(`[data-act="${name}"]${extra}`);
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__pathkin.profile)));
  // Where the hidden rule says a creature belongs (test-only peek).
  const answer = (id) =>
    page.evaluate(async (cid) => {
      const { family } = await import('./js/core/families.js');
      const p = window.__pathkin.profile;
      return family(p.stop.family).place(p.stop.hyp, p.roster.find((c) => c.id === cid).traits);
    }, id);

  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.logo');
  assert.equal(await page.locator('[data-act="title-continue"]').count(), 0, 'Continue is hidden with no profile');
  await shot('01-title');
  await act('title-new');
  await act('slot-new', '[data-slot="1"]');
  await page.waitForSelector('[data-act="reroll"]');
  await shot('02-roster');
  const before = (await state()).seed;
  await act('reroll');
  assert.notEqual((await state()).seed, before);
  await act('roster-ok');
  await shot('03-map');
  await act('goto', '[data-screen="party"]');
  await page.selectOption('select[data-slot="crest"]', 'fin');
  await shot('04-party-filter');
  await page.selectOption('select[data-slot="crest"]', '');
  await act('party-fill');
  assert.equal((await state()).selection.length, 16);
  await shot('05-party');
  await act('start-leg');

  let stopNo = 0;
  let usedDrag = false;
  let reloaded = false;
  while ((await state()).screen === 'stop') {
    stopNo++;
    let s = await state();
    await shot(`06-stop${stopNo}-start`);
    let first = true;
    while (s.stop.status === 'playing') {
      const id = s.stop.queue[0];
      let target = await answer(id);
      if (first) {
        // One deliberate miss per Stop: must bounce, badge, and cost patience.
        first = false;
        const all = await page.$$eval('[data-target]', (els) => els.map((e) => e.dataset.target));
        const wrong = all.find((t) => t !== target);
        await page.click(`.tray-kin[data-id="${id}"]`);
        await page.click(`[data-target="${wrong}"]`);
        const after = await state();
        assert.equal(after.stop.patience, s.stop.patience - 1);
        assert.equal(after.stop.badges[id], 1);
        await shot(`07-stop${stopNo}-bounce`);
        s = after;
        if (s.stop.status !== 'playing') break;
      }
      if (!usedDrag) {
        usedDrag = true;
        const from = await page.locator(`.tray-kin[data-id="${id}"]`).boundingBox();
        const to = await page.locator(`[data-target="${target}"]`).boundingBox();
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(from.x + 40, from.y - 60, { steps: 4 });
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
        await shot('08-dragging');
        await page.mouse.up();
        assert.equal((await state()).stop.placed[id], target, 'drag delivered the creature');
      } else {
        await page.click(`.tray-kin[data-id="${id}"]`);
        await page.click(`[data-target="${target}"]`);
      }
      s = await state();
      if (!reloaded && s.stop.status === 'playing' && s.stop.observations.length >= 3) {
        // Kill and relaunch mid-Stop: the same puzzle state must come back.
        reloaded = true;
        await page.reload();
        await page.waitForSelector('.logo');
        await act('title-continue');
        await page.waitForSelector('.tray');
        assert.deepEqual(await state(), s, 'mid-Stop state restored exactly');
        await shot('09-resumed');
      }
    }
    await page.waitForSelector('[data-act="stop-continue"]');
    await shot(`10-stop${stopNo}-result`);
    await act('stop-continue');
  }
  assert.ok(reloaded && usedDrag && stopNo === 3, `stops ${stopNo} reload ${reloaded} drag ${usedDrag}`);
  let s = await state();
  assert.equal(s.screen, 'summary');
  await shot('11-summary');
  await act('summary-ok');
  await shot('12-camp');
  s = await state();
  assert.equal(s.roster.filter((c) => c.status === 'delivered').length, 16);

  // Long-press opens the trait sheet; nickname and favourite stick.
  const box = await page.locator('.grid .kin').first().boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.waitForSelector('.sheet .traits');
  await page.mouse.up();
  await page.waitForTimeout(120);
  await page.fill('input[data-change="nickname"]', 'Pip');
  await page.keyboard.press('Tab');
  await act('fav');
  await shot('13-inspect');
  s = await state();
  assert.ok(s.roster.some((c) => c.nickname === 'Pip' && c.favourite));
  await act('close-inspect', '.btn');

  // Park and retrieve at Camp.
  await act('camp-tab', '[data-tab="available"]');
  await page.click('.grid .kin');
  await act('park');
  assert.equal((await state()).roster.filter((c) => c.status === 'parked').length, 1);
  await act('camp-tab', '[data-tab="parked"]');
  await page.click('.grid .kin');
  await act('retrieve');
  assert.equal((await state()).roster.filter((c) => c.status === 'parked').length, 0);

  // Settings apply live and persist.
  await act('goto', '[data-screen="map"]');
  await act('to-title');
  await act('open-settings');
  await page.check('[data-key="colourSafe"]');
  await page.selectOption('[data-key="textSize"]', '2');
  await shot('14-settings-200pct');
  await act('settings-back');
  await act('title-continue');
  await shot('15-map-200pct-coloursafe');
  await page.reload();
  await page.waitForSelector('.logo');
  assert.equal(await page.evaluate(() => window.__pathkin.settings.textSize), 2);
  assert.equal(await page.evaluate(() => document.documentElement.style.fontSize), '32px');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('UI smoke passed; screenshots in ' + out);
} finally {
  await browser.close();
  server.kill();
}
