import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(process.env.PLAYWRIGHT_MODULE || import.meta.url);
const {chromium} = require('playwright');
const output = process.env.UI_OUTPUT_DIR || 'test-results';
await mkdir(output, {recursive: true});
const password = 'local-ui-test-token-at-least-24-characters';
const submitted = [];
let inspectCalls = 0;
const app = await createApp({password, engine: {
  health: () => ({ytDlp: true, ffmpeg: true}),
  inspect: async () => {
    inspectCalls++;
    return {title: 'Tu biblioteca comienza con una idea', duration: 125, thumbnail: null,
      formats: ['mp4', 'mp3', 'wav', 'm4a', 'flac'], qualities: ['720', '360']};
  },
  process: async (job, dir, progress, signal) => {
    submitted.push({format: job.format, quality: job.quality});
    progress({phase: 'downloading', percent: 46, bytes: 460000, totalBytes: 1000000});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 1500);
      signal.addEventListener('abort', () => {clearTimeout(timer); reject(Error('Cancelado.'));}, {once: true});
    });
    progress({phase: 'converting', percent: 25});
    await new Promise(resolve => setTimeout(resolve, 300));
    const file = path.join(dir, 'vydo.' + job.format); await writeFile(file, 'media'); return file;
  }
}});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + app.server.address().port;
let browser;
try {
  browser = await chromium.launch({headless: true, ...(process.env.BROWSER_BIN ? {executablePath: process.env.BROWSER_BIN} : {})});
  const context = await browser.newContext({colorScheme: 'light', viewport: {width: 1753, height: 897}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400 && ['script', 'stylesheet', 'image'].includes(response.request().resourceType())) errors.push(`Asset failed: ${response.url()}`);
  });
  await page.goto(base);
  await page.locator('#password').fill(password); await page.locator('#login-button').click();
  await page.locator('#gate').waitFor({state: 'hidden'}); await page.locator('#subtitle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  assert.equal(await page.locator('a[href*="github"]').count(), 0);
  assert.equal(await page.locator('#preview').isVisible(), false);
  assert.equal(await page.locator('.hero .logo-light').evaluate(img => img.naturalWidth > 0), true);
  await page.screenshot({path: path.join(output, 'vydo-3.1-desktop-light.png'), fullPage: true});
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'), 'true');
  await page.screenshot({path: path.join(output, 'vydo-3.1-desktop-dark.png'), fullPage: true});
  await page.reload(); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.emulateMedia({colorScheme: 'light'}); assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.locator('#theme-toggle').click();
  for (const width of [320, 390, 768, 1024, 1753]) {
    await page.setViewportSize({width, height: width < 600 ? 844 : 897});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
    if (width === 390 || width === 768) await page.screenshot({path: path.join(output, `vydo-3.1-${width}-light.png`), fullPage: true});
  }
  // No analysis may run until the user confirms authorization.
  await page.locator('#url').fill('https://youtu.be/LY43o01dkU4');
  await page.locator('#analyze').click(); await page.locator('#consent-dialog').waitFor(); assert.equal(inspectCalls, 0);
  await page.locator('#permission').check(); await page.locator('#consent-form button[type="submit"], #consent-form .primary').click();
  await page.locator('#preview').waitFor(); assert.deepEqual(await page.locator('#quality option').allTextContents(), ['720p', '360p']);
  await page.locator('#quality').selectOption('360'); await page.locator('#start').click();
  await page.locator('#progress-panel').waitFor();
  await page.screenshot({path: path.join(output, 'vydo-3.1-progress.png'), fullPage: true});
  // Reload recovers the same authenticated job instead of creating a duplicate.
  await page.reload(); await page.locator('#finished').waitFor(); assert.equal(submitted.length, 1);
  let pending = page.waitForEvent('download'); await page.locator('#download').click();
  assert.match((await pending).suggestedFilename(), /\.mp4$/); assert.deepEqual(submitted[0], {format: 'mp4', quality: '360'});
  // MP3 stays on the compact main selector and starts immediately after analysis.
  await page.locator('#url').fill('https://youtu.be/LY43o01dkU4');
  await page.locator('[name="mode"][value="audio"]').check(); await page.locator('#analyze').click();
  await page.locator('#permission').check(); await page.locator('#consent-form .primary').click();
  await page.locator('#progress-panel').waitFor(); await page.locator('#finished').waitFor();
  pending = page.waitForEvent('download'); await page.locator('#download').click(); assert.match((await pending).suggestedFilename(), /\.mp3$/);
  // All existing audio formats remain accessible through secondary settings.
  for (const format of ['wav', 'm4a', 'flac']) {
    await page.locator('#settings-button').click(); await page.locator('#preferred-audio').selectOption(format);
    await page.locator('[data-close="settings"]').click(); await page.locator('#analyze').click();
    await page.locator('#finished').waitFor({state: 'hidden'}); await page.locator('#finished').waitFor();
    assert.equal(submitted.at(-1).format, format);
    pending = page.waitForEvent('download'); await page.locator('#download').click(); assert.match((await pending).suggestedFilename(), new RegExp(`\\.${format}$`));
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.screenshot({path: path.join(output, 'vydo-3.1-mobile-result.png'), fullPage: true});
  await page.locator('#theme-toggle').click(); await page.screenshot({path: path.join(output, 'vydo-3.1-mobile-dark.png'), fullPage: true});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  // Keyboard controls, validation errors and cancellation remain functional.
  await page.locator('#theme-toggle').focus(); await page.keyboard.press('Space');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.locator('[name="mode"][value="mp4"]').check();
  await page.locator('[name="mode"][value="mp4"]').press('ArrowRight');
  assert.equal(await page.locator('[name="mode"][value="audio"]').isChecked(), true);
  await page.locator('#url').fill('https://example.test/video'); await page.locator('#analyze').click();
  await page.locator('#permission').check(); await page.locator('#consent-form .primary').click();
  await page.locator('#alert').waitFor(); assert.match(await page.locator('#alert').textContent(), /YouTube/);
  await page.locator('#url').fill('https://youtu.be/LY43o01dkU4');
  await page.locator('[name="mode"][value="mp4"]').check(); await page.locator('#analyze').click();
  await page.locator('#permission').check(); await page.locator('#consent-form .primary').click();
  await page.locator('#preview').waitFor(); await page.locator('#start').click();
  await page.locator('#cancel').click(); await page.locator('#alert').waitFor();
  assert.match(await page.locator('#alert').textContent(), /cancelado/i);
  const systemContext = await browser.newContext({colorScheme: 'dark'});
  const systemPage = await systemContext.newPage(); await systemPage.goto(base);
  assert.equal(await systemPage.locator('html').getAttribute('data-theme'), 'dark');
  await systemPage.emulateMedia({colorScheme: 'light'}); await systemPage.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  await systemContext.close();
  assert.deepEqual(errors, []);
  console.log('UI PASS: original logos, both themes, persistence/system preference, consent, exact quality, job recovery, five formats, authenticated file downloads, 320–1753px layouts; no browser errors.');
} finally { await browser?.close(); await app.close(); }
