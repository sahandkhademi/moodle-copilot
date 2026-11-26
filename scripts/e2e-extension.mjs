// End-to-end check: loads the built extension in real Chromium (demo data) and drives it.
// Run: npm run build && node scripts/e2e-extension.mjs [screenshot-dir]
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const EXT = path.resolve('.output/chrome-mv3');
// Uses any Playwright-downloaded Chrome for Testing (or CHROME_PATH). Branded Chrome ignores --load-extension.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  for (const d of fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const sub of fs.readdirSync(path.join(cache, d))) {
      const exe = path.join(cache, d, sub, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
      if (fs.existsSync(exe)) return exe;
    }
  }
  throw new Error('No Chromium found. Run: npx playwright install chromium');
}
const exe = findChrome();
const OUT = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mc-shots-'));
console.log('screenshots →', OUT);
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mc-')), {
  executablePath: exe, headless: false,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 400, height: 900 },
});
const log = (...a) => console.log('•', ...a);
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const id = new URL(sw.url()).host;
log('extension loaded, id', id);
await new Promise((r) => setTimeout(r, 2500)); // first silent check
log('badge after install:', JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))));
log('snapshot saved:', await sw.evaluate(async () => Object.keys((await chrome.storage.local.get('bg.gradeSnapshot'))['bg.gradeSnapshot'] ?? {}).length), 'grades');

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`chrome-extension://${id}/sidepanel.html`);
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/1-dashboard.png` });
const dbsBefore = await page.locator('text=/Database Systems/').last().locator('xpath=ancestor::*[contains(., "%")][1]').innerText().catch(() => '?');
log('DBS row before:', JSON.stringify(dbsBefore.replace(/\s+/g, ' ').slice(0, 80)));
log('dashboard title present:', await page.getByRole('heading', { name: 'Dashboard' }).isVisible());

// Settings → Simulate new grade (Now)
await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/2-settings.png`, fullPage: true });
await page.getByRole('button', { name: /Simulate new grade/i }).click();
await page.waitForTimeout(3000);
const notes = await sw.evaluate(() => chrome.notifications.getAll());
log('notifications:', JSON.stringify(Object.keys(notes)));
log('badge after new grade:', JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))));
await page.screenshot({ path: `${OUT}/3-after-sim.png` });

// Dashboard shows the new grade?
await page.getByRole('button', { name: 'Dashboard' }).click();
await page.waitForTimeout(800);
const dbsAfter = await page.locator('text=/Database Systems/').last().locator('xpath=ancestor::*[contains(., "%")][1]').innerText().catch(() => '?');
log('DBS row after:', JSON.stringify(dbsAfter.replace(/\s+/g, ' ').slice(0, 80)));
await page.screenshot({ path: `${OUT}/3b-dashboard-after.png`, fullPage: true });

// Assistant tab without key
await page.getByRole('button', { name: 'Assistant' }).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/4-assistant.png` });

// Mark-as-done updates the badge
const before = await sw.evaluate(() => chrome.action.getBadgeText({}));
await sw.evaluate(() => chrome.storage.local.set({ 'bg.unseenGrades': [] }));
await page.waitForTimeout(1500);
log('badge after clearing unseen:', JSON.stringify(await sw.evaluate(() => chrome.action.getBadgeText({}))), '(was', JSON.stringify(before) + ')');
log('page errors:', errors.length ? errors : 'none');
await ctx.close();
