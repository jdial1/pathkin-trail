// Browser smoke test of the real UI: leads parties through all twelve Stops
// by tap and by drag, reloads mid-Stop to prove resume, rescues a stranded
// creature, plays the daily Stop, opens every screen, loads saves from both
// older versions, and saves screenshots. Usage: node tools/ui-smoke.mjs [outDir]
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
  // The move a player who knew the hidden rule would make (test-only peek).
  const answer = () =>
    page.evaluate(async () => {
      const { bots } = await import('./js/core/bots.js');
      const game = await import('./js/core/game.js');
      const app = window.__pathkin;
      return bots.perfect(app.profile.stop, game.stopCtx(app.profile, app.content));
    });
  // Carries out a move through the interface, the way a player would by tapping.
  async function perform(action) {
    if (action.lift) return page.click(`[data-target="${action.lift}"]`);
    if (action.keeper !== undefined) {
      const basket = await page.evaluate(() => window.__pathkin.ui.basket);
      for (let i = 0; i < 8; i++) if ((basket ^ action.items) & (1 << i)) await page.click(`[data-act="item"][data-item="${i}"]`);
      return page.click(`[data-keeper="${action.keeper}"]`);
    }
    if (action.convoy) {
      const ui = await page.evaluate(() => ({ dirs: window.__pathkin.ui.dirs, convoy: window.__pathkin.ui.convoy }));
      for (const id of ui.convoy) await page.click(`.tray-kin[data-id="${id}"]`);
      for (let j = 0; j < 3; j++) if (ui.dirs[j] !== action.dirs[j]) await page.click(`[data-act="switch"][data-switch="${j}"]`);
      for (const id of action.convoy) await page.click(`.tray-kin[data-id="${id}"]`);
      return act('launch');
    }
    await page.click(`.tray-kin[data-id="${action.id}"]`);
    return page.click(`[data-target="${action.target}"]`);
  }
  const played = new Set();

  // Plays the current leg run to its summary with correct moves
  // (plus whatever `extras` does at the start of each Stop).
  async function playLeg(extras = async () => {}) {
    let s = await state();
    while (s.screen === 'stop') {
      const fresh = !played.has(s.stop.puzzleId);
      if (fresh) {
        played.add(s.stop.puzzleId);
        await shot(`stop-${played.size.toString().padStart(2, '0')}-${s.stop.family}-start`);
      }
      await extras(s);
      s = await state();
      let moves = 0;
      while (s.stop && s.stop.status === 'playing') {
        const before = JSON.stringify(s.stop);
        await perform(await answer());
        s = await state();
        assert.notEqual(JSON.stringify(s.stop), before, `${s.stop.family}: a move through the interface changed nothing`);
        if (fresh && ++moves === 2) await shot(`stop-${played.size.toString().padStart(2, '0')}-${s.stop.family}-mid`);
        assert.ok(moves < 80, s.stop.family + ' never ended');
      }
      await page.waitForSelector('[data-act="stop-continue"]');
      assert.equal(s.stop.status, 'solved', s.stop.family);
      if (fresh) await shot(`stop-${played.size.toString().padStart(2, '0')}-${s.stop.family}-result`);
      await act('stop-continue');
      s = await state();
    }
    assert.equal(s.screen, 'summary');
    return s;
  }
  async function startLeg(tier, branch) {
    await act('set-tier', `[data-tier="${tier}"]`);
    await act('goto', '[data-screen="party"]');
    await act('party-fill');
    await act('start-leg', branch ? `[data-branch="${branch}"]` : '');
    assert.equal((await state()).stop.tier, tier);
  }

  // ---- Title, roster, map ----
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('.logo');
  assert.equal(await page.locator('[data-act="title-continue"]').count(), 0, 'Continue is hidden with no profile');
  await shot('01-title');
  await act('title-new');
  await act('slot-new', '[data-slot="1"]');
  await shot('01b-new-trail');
  await act('nt-start');
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

  // ---- Leg 1, first party: a miss, a drag, a mid-Stop reload ----
  let missed = false;
  let dragged = false;
  let reloaded = false;
  let s = await playLeg(async (st) => {
    if (!missed) {
      missed = true;
      assert.ok(await page.locator('.kin.mini.guide').count(), 'trail guides are shown');
      const right = await answer();
      const all = await page.$$eval('[data-target]', (els) => els.map((e) => e.dataset.target));
      await perform({ id: right.id, target: all.find((t) => t !== right.target) });
      const after = await state();
      assert.equal(after.stop.patience, st.stop.patience - 1);
      assert.equal(after.stop.badges[right.id], 1);
      await shot('05-bounce');
      if (after.stop.status !== 'playing') return;
      const move = await answer();
      const from = await page.locator(`.tray-kin[data-id="${move.id}"]`).boundingBox();
      const to = await page.locator(`[data-target="${move.target}"]`).boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y - 60, { steps: 4 });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 6 });
      await shot('06-dragging');
      await page.mouse.up();
      await page.waitForTimeout(120); // the app ignores a tap that lands right on the heels of a drag
      assert.equal((await state()).stop.placed[move.id], move.target, 'drag delivered the creature');
      dragged = true;
    } else if (!reloaded && st.stop.status === 'playing') {
      // Kill and relaunch mid-Stop: the same puzzle state must come back.
      await perform(await answer());
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

  // ---- A second party through leg 1, then both paths of the fork, then home ----
  await act('goto', '[data-screen="map"]');
  await page.click('[data-act="select-camp"][data-camp="0"]');
  assert.equal((await state()).camp, 0);
  await startLeg('steady');
  await playLeg();
  await act('summary-ok');
  await act('goto', '[data-screen="map"]');
  assert.equal((await state()).camp, 1);
  await shot('10-map-camp1');
  await act('goto', '[data-screen="party"]');
  assert.equal(await page.locator('[data-act="start-leg"]').count(), 2, 'a fork offers two paths');
  await act('party-fill');
  await shot('11-party-fork');
  await act('goto', '[data-screen="map"]');
  await startLeg('hard', 'a');
  s = await playLeg();
  assert.equal(s.summary.to, 2);
  await act('summary-ok');
  await act('goto', '[data-screen="map"]');
  await page.click('[data-act="select-camp"][data-camp="1"]');
  await startLeg('expert', 'b');
  await playLeg();
  await act('summary-ok');
  await act('goto', '[data-screen="map"]');
  assert.equal((await state()).camp, 2);
  await startLeg('expert');
  s = await playLeg();
  assert.equal(s.summary.home, true);
  await shot('12-summary-home');
  await act('summary-ok');
  s = await state();
  assert.ok(count(s, 'delivered') >= 1, 'somebody is home');
  assert.equal(s.stats.delivered, count(s, 'delivered'));
  assert.equal(played.size, 12, 'all twelve Stops were played through the interface');
  await shot('13-home-camp');
  await act('goto', '[data-screen="map"]');
  await shot('14-map-home');
  // Selecting a camp by keyboard works too.
  await page.focus('[data-act="select-camp"][data-camp="0"]');
  await page.keyboard.press('Enter');
  assert.equal((await state()).camp, 0);
  await act('goto', '[data-screen="goals"]');
  await shot('15-goals');
  s = await state();
  assert.ok(s.goals.first_home && s.goals.both_forks);
  await act('goto', '[data-screen="map"]');
  await act('end-trail');
  await act('confirm-yes');
  await shot('16-finale');
  await act('goto', '[data-screen="map"]');
  await act('to-title');

  // ---- Daily Stop ----
  await act('open-daily');
  await page.waitForSelector('.screen.stop');
  await shot('17-daily');
  s = await state();
  assert.equal(s.kind, 'daily');
  await perform(await answer());
  const midDaily = await state();
  if (midDaily.stop.status === 'playing') {
    await page.reload();
    await page.waitForSelector('.logo');
    await act('open-daily');
    await page.waitForSelector('.screen.stop');
    assert.deepEqual(await state(), midDaily, 'the daily Stop resumes the same day');
  }
  s = midDaily;
  while (s.stop.status === 'playing') {
    await perform(await answer());
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

  // ---- Practice: the two extra puzzle kinds, played through the interface ----
  for (const id of ['p_queue_route_01', 'p_fold_sequence_01']) {
    await act('open-practice');
    await act('practice-tier', '[data-tier="steady"]');
    await act('practice-start', `[data-puzzle="${id}"]`);
    await page.waitForSelector('.screen.stop');
    await shot('23-practice-' + id);
    s = await state();
    assert.equal(s.kind, 'practice');
    let moves = 0;
    while (s.stop.status === 'playing') {
      const before = JSON.stringify(s.stop);
      await perform(await answer());
      s = await state();
      assert.notEqual(JSON.stringify(s.stop), before, id + ': a move changed nothing');
      assert.ok(++moves < 80);
    }
    assert.equal(s.stop.status, 'solved');
    await act('stop-continue');
    await act('to-title');
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('pathkin.slot1') !== null), true, 'practice never overwrites a Trail');

  // ---- Picture maker, trinkets, play record ----
  await act('title-continue');
  await act('goto', '[data-screen="camp"]');
  await page.click('.grid .kin');
  await page.waitForSelector('.sheet [data-act="trinket"]');
  await page.click('[data-act="trinket"]:not([data-trinket=""])');
  s = await state();
  assert.ok(s.roster.some((c) => c.trinket), 'a creature wears a trinket');
  await shot('24-trinket');
  await act('close-inspect', '.btn');
  await act('open-photo');
  await act('photo-pick', '[data-sticker="star"]');
  await page.click('.photo', { position: { x: 60, y: 60 } });
  await page.click('.photo', { position: { x: 200, y: 40 } });
  assert.equal(await page.evaluate(() => window.__pathkin.ui.photo.stickers.length), 2);
  await act('photo-scene', ':nth-child(4)');
  await shot('25-photo');
  const download = page.waitForEvent('download', { timeout: 15000 });
  await act('photo-save');
  assert.match((await download).suggestedFilename(), /\.png$/, 'the picture is saved as a PNG');
  await act('photo-back');
  await act('goto', '[data-screen="map"]');
  await page.locator('.mapbody').dblclick({ position: { x: 20, y: 20 } });
  assert.match(await page.locator('.map').getAttribute('style'), /width: 170%/, 'double-tap zooms the map');
  await act('to-title');
  await act('open-settings');
  await act('open-record');
  assert.ok((await page.locator('.record li').count()) >= 12, 'the play record lists the Stops played');
  await shot('26-record');
  await act('open-settings-back');
  await act('settings-back');

  // ---- Saves from every older version open and land on the map ----
  for (const [slot, file, atCamp] of [[2, 'save-v1-midstop', 1], [3, 'save-v2-midstop', 2]]) {
    const version = await page.evaluate(async () => (await import('./js/core/game.js')).SCHEMA_VERSION);
    const text = readFileSync(new URL(`../tests/golden/${file}.json`, import.meta.url), 'utf8');
    await page.evaluate(([n, doc]) => localStorage.setItem('pathkin.slot' + n, JSON.stringify({ ...JSON.parse(doc), slot: n })), [slot, text]);
    await page.reload();
    await page.waitForSelector('.logo');
    await act('title-continue');
    await act('slot-open', `[data-slot="${slot}"]`);
    s = await state();
    assert.equal(s.schemaVersion, version);
    assert.equal(s.screen, 'map');
    assert.equal(s.roster.filter((c) => c.at === atCamp && c.status === 'available').length, 16);
    await shot(`22-migrated-${file}`);
    await act('to-title');
  }

  assert.deepEqual(errors, [], 'no page errors');
  console.log('UI smoke passed; screenshots in ' + out);
} finally {
  await browser.close();
  server.kill();
}
