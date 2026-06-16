// Captures screenshots of the running app showing the simulated treatment plans
// and months-ahead scheduling. Run AFTER run-simulation.ts and with the dev server up.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_PATH=/opt/node22/lib/node_modules \
//     node scripts/sim/screenshots.mjs
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'fs';

const BASE = 'http://localhost:3000';
const OUT = 'sim-out';
const CRED = { email: 'admin@example.com', password: 'changeme' };

// A patient with a long, fully-booked plan (from the sim seed).
const sample = JSON.parse(fs.readFileSync('sim-out/sample-targets.json', 'utf8'));

const shots = [
  { name: '01-login', url: '/login', wait: 1500 },
  { name: '02-dashboard', url: '/', wait: 3500 },
  { name: '03-treatment-plans', url: '/treatment-plans', wait: 6000 },
  { name: '04-episode-stages', url: `/patients/${sample.patientId}/stages`, wait: 5000 },
  { name: '05-gantt-timeline', url: '/patients/stages/gantt', wait: 6000 },
  { name: '06-calendar', url: '/calendar', wait: 4000, action: 'monthView' },
  { name: '07-pipeline', url: '/patients/pipeline', wait: 4000 },
  { name: '08-tasks-worklist', url: '/tasks/overview', wait: 4000 },
];

async function getAuthCookie() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(CRED),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/auth-token=([^;]+)/);
  if (!m) throw new Error('no auth-token cookie from login');
  return m[1];
}

(async () => {
  const token = await getAuthCookie();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([
    { name: 'auth-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  // Seed localStorage role used by the client-side guard + dismiss cookie banner.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('userEmail', 'admin@example.com');
      localStorage.setItem('userRole', 'admin');
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('gdpr-cookie-consent', JSON.stringify({ necessary: true, errorTracking: false, analytics: false }));
    } catch {}
  });

  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const results = [];
  for (const s of shots) {
    const url = BASE + s.url;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(s.wait ?? 2500);
      if (s.action === 'monthView') {
        // Switch the calendar to month view to show the spread of appointments.
        await page.getByRole('button', { name: 'Hónap', exact: true }).click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(2000);
      }
      const file = `${OUT}/${s.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      results.push({ name: s.name, url: s.url, file, ok: true });
      console.log(`✓ ${s.name} -> ${file}`);
    } catch (e) {
      results.push({ name: s.name, url: s.url, ok: false, error: String(e).slice(0, 200) });
      console.log(`✗ ${s.name}: ${e}`);
    }
  }
  fs.writeFileSync(`${OUT}/screenshots.json`, JSON.stringify(results, null, 2));
  await browser.close();
})();
