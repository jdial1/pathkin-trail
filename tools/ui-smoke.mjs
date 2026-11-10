// Browser smoke test of the real UI: leads a party along the whole Trail by
// tap and by drag, reloads mid-Stop to prove resume, rescues a stranded
// creature, plays the daily Stop, opens every screen, loads a version-1 save,
// and saves screenshots. Usage: node tools/ui-smoke.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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
  const count = (s, status) => s.roster.filter((c) => c.status === status).length;
  // Where the hidden rule says a creature belongs (test-only peek).
  const answer = (id) =>
    page.evaluate(async (cid) => {
      const { family } = await import('./js/core/families.js');
      const p = window.__pathkin.profile;
      return family(p.stop.family).place(p.stop.hyp, p.roster.find((c) => c.id === cid).traits);
    }, id);
  const send = async (id, target) => {
    await page.click(`.tray-kin[data-id="${id}"]`);
    await page.click(`[data-target="${target}"]`);
  };
  const seenFamilies = new Set();

  // Plays the current leg run to its summary, always sending correctly
  // (plus whatever `extras` does on each Stop).
  async function playLeg(extras = async () => {}) {
    let s = await state();
    while (s.screen === 'stop') {
      const key = `${s.stop.family}-${Object.keys(s.stop.placed).length === 0 ? s.stop.puzzleId : ''}`;
      if (!seenFamilies.has(s.stop.puzzleId)) {
        seenFamilies.add(s.stop.puzzleId);
        await shot(`stop-${s.stop.puzzleId}`);
      }
      await extras(s, key);
      s = await state();
      while (s.stop && s.stop.status === 'playing') {
        const id = s.stop.queue[0];
        await send(id, await answer(id));
        s = await state();
      }
      await page.waitForSelector('[data-act="stop-continue"]');
      await act('stop-continue');
      s = await state();
    }
    assert.equal(s.screen, 'summary');
    return s;
  }

  // ---- Title, roster, map ----
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.logo');
  assert.equal(await page.locator('[data-act="title-continue"]').count(), 0, 'Continue is hidden with no profile');
  await shot('01-title');
  await act('title-new');
  await act('slot-new', '[data-slot="1"]');
  await page.waitForSelector('[data-act="reroll"]');
  const before = (await state()).seed;
  await act('reroll');
  assert.notEqual((await state()).seed, before);
  await shot('02-roster');
  await act('roster-ok');
  await shot('03-map');
  await act('goto', '[data-screen="party"]');
  await page.selectOption('select[data-slot="crest"]', 'fin');
  await page.selectOption('select[data-slot="crest"]', '');
  await act('party-fill');
  assert.equal((await state()).selection.length, 16);
  await shot('04-party');
  await act('start-leg');

  // ---- Leg 1: a miss, a drag, a mid-Stop reload ----
  let missed = false;
  let dragged = false;
  let reloaded = false;
  let s = await playLeg(async (st) => {
    if (!missed) {
      missed = true;
      assert.ok(await page.locator('.kin.mini.guide').count(), 'trail guides are shown');
      const id = st.stop.queue[0];
      const right = await answer(id);
      const all = await page.$$eval('[data-target]', (els) => els.map((e) => e.dataset.target));
      await send(id, all.find((t) => t !== right));
      const after = await state();
      assert.equal(after.stop.patience, st.stop.patience - 1);
      assert.equal(after.stop.badges[id], 1);
      await shot('05-bounce');
      if (after.stop.status !== 'playing') return;
      const id2 = after.stop.queue[0];
      const target = await answer(id2);
      const from = await page.locator(`.tray-kin[data-id="${id2}"]`).boundingBox();
      const to = await page.locator(`[data-target="${target}"]`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y - 60, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
      await shot('06-dragging');
      await page.mouse.up();
      assert.equal((await state()).stop.placed[id2], target, 'drag delivered the creature');
      dragged = true;
    } else if (!reloaded && st.stop.status === 'playing') {
      // Kill and relaunch mid-Stop: the same puzzle state must come back.
      const id = st.stop.queue[0];
      await send(id, await answer(id));
      const mid = await state();
      if (mid.stop.status !== 'playing') return;
      await page.reload();
      await page.waitForSelector('.logo');
      await act('title-continue');
      await page.waitForSelector('.tray');
      assert.deepEqual(await state(), mid, 'mid-Stop state restored exactly');
      reloaded = true;
    }
  });
  assert.ok(missed && dragged && reloaded, `miss ${missed} drag ${dragged} reload ${reloaded}`);
  assert.equal(s.summary.to, 1);
  await shot('07-summary');
  await act('summary-ok');
  s = await state();
  assert.equal(s.screen, 'camp');
  assert.equal(s.camp, 1);
  assert.equal(count(s, 'delivered'), 0);
  await shot('08-camp1');

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
  s = await state();
  assert.ok(s.roster.some((c) => c.nickname === 'Pip' && c.favourite));
  await act('park');
  assert.equal(count(await state(), 'parked'), 1);
  await act('camp-tab', '[data-tab="resting"]');
  await page.click('.grid .kin');
  await act('retrieve');
  assert.equal(count(await state(), 'parked'), 0);

  // ---- Rescue: strand one creature near this camp, then bring it in ----
  const lostId = await page.evaluate(() => {
    const app = window.__pathkin;
    const victim = app.profile.roster.find((c) => c.at === 0 && c.status === 'available');
    app.profile = { ...app.profile, roster: app.profile.roster.map((c) => (c.id === victim.id ? { ...c, status: 'lost', lostAt: 1 } : c)) };
    app.render();
    return victim.id;
  });
  await act('camp-tab', '[data-tab="stranded"]');
  await page.click(`.grid .kin[data-id="${lostId}"]`);
  await page.waitForSelector('.rescue');
  await shot('09-rescue');
  const tokens = (await state()).hintTokens;
  assert.ok(tokens >= 1);
  await act('rescue-token');
  s = await state();
  const saved = s.roster.find((c) => c.id === lostId);
  assert.equal(saved.status, 'available');
  assert.equal(saved.at, 1);
  assert.equal(s.hintTokens, tokens - 1);
  assert.ok(s.goals.rescuer);
  await act('close-inspect', '.btn');

  // ---- Legs 2 to 4, taking one branch at each fork, on rising tiers ----
  const plan = [['a', 'steady'], ['b', 'hard'], [null, 'expert']];
  for (let i = 0; i < plan.length; i++) {
    const [branch, tier] = plan[i];
    await act('goto', '[data-screen="map"]');
    assert.equal((await state()).camp, i + 1);
    await act('set-tier', `[data-tier="${tier}"]`);
    if (i === 0) await shot('10-map-camp1');
    await act('goto', '[data-screen="party"]');
    await act('party-fill');
    if (branch) {
      assert.equal(await page.locator('[data-act="start-leg"]').count(), 2, 'a fork offers two paths');
      if (i === 0) await shot('11-party-fork');
    }
    await act('start-leg', branch ? `[data-branch="${branch}"]` : '');
    s = await state();
    assert.equal(s.stop.tier, tier);
    s = await playLeg();
    assert.equal(s.summary.to, i + 2);
    if (i === plan.length - 1) await shot('12-summary-home');
    await act('summary-ok');
  }
  s = await state();
  assert.ok(count(s, 'delivered') >= 1, 'somebody is home');
  assert.equal(s.stats.delivered, count(s, 'delivered'));
  assert.ok(seenFamilies.size === 12, 'played 12 Stops: ' + seenFamilies.size);
  await shot('13-home-camp');
  await act('goto', '[data-screen="map"]');
  await shot('14-map-home');
  // Selecting a camp by keyboard works too.
  await page.focus('[data-act="select-camp"][data-camp="0"]');
  await page.keyboard.press('Enter');
  assert.equal((await state()).camp, 0);
  await act('goto', '[data-screen="goals"]');
  await shot('15-goals');
  assert.ok((await state()).goals.first_home);
  await act('goto', '[data-screen="map"]');
  await act('end-trail');
  await act('confirm-yes');
  await shot('16-finale');
  await act('goto', '[data-screen="map"]');
  await act('to-title');

  // ---- Daily Stop ----
  await act('open-daily');
  await page.waitForSelector('.tray');
  await shot('17-daily');
  s = await state();
  assert.equal(s.kind, 'daily');
  const firstDaily = s.stop.queue[0];
  await send(firstDaily, await answer(firstDaily));
  const midDaily = await state();
  await page.reload();
  await page.waitForSelector('.logo');
  await act('open-daily');
  await page.waitForSelector('.screen.stop');
  assert.deepEqual(await state(), midDaily, 'the daily Stop resumes the same day');
  s = midDaily;
  while (s.stop.status === 'playing') {
    const id = s.stop.queue[0];
    await send(id, await answer(id));
    s = await state();
  }
  await act('stop-continue');
  await shot('18-daily-done');
  assert.equal(await page.evaluate(() => window.__pathkin.dailySolved), 1);
  await act('to-title');

  // ---- Collection Book, settings, Spanish, large text ----
  await act('open-book');
  assert.ok((await page.evaluate(() => window.__pathkin.book.size)) >= 36);
  await shot('19-book');
  await act('to-title');
  await act('open-settings');
  await page.check('[data-key="colourSafe"]');
  await page.selectOption('[data-key="language"]', 'es');
  await page.waitForFunction(() => document.querySelector('h2').textContent === 'Ajustes');
  await page.selectOption('[data-key="textSize"]', '2');
  await shot('20-settings-es-200pct');
  await page.selectOption('[data-key="textSize"]', '1');
  await act('settings-back');
  await act('title-continue');
  await shot('21-map-es');
  await page.reload();
  await page.waitForSelector('.logo');
  assert.equal(await page.evaluate(() => window.__pathkin.settings.language), 'es');
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');

  // ---- A version-1 save opens and lands on the new map ----
  const v1 = readFileSync(new URL('../tests/golden/save-v1-midstop.json', import.meta.url), 'utf8');
  await page.evaluate((text) => localStorage.setItem('pathkin.slot2', JSON.stringify({ ...JSON.parse(text), slot: 2 })), v1);
  await page.reload();
  await page.waitForSelector('.logo');
  await act('title-continue');
  await act('slot-open', '[data-slot="2"]');
  s = await state();
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.screen, 'map');
  assert.equal(s.roster.filter((c) => c.at === 1 && c.status === 'available').length, 16);
  await shot('22-migrated-v1');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('UI smoke passed; screenshots in ' + out);
} finally {
  await browser.close();
  server.kill();
}
