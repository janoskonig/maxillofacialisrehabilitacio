// Screenshots of the SIM treatment-plan scenarios, captured against the dev
// server running on the THROWAWAY maxfac_sim DB, logged in as the real account.
//
//   node scripts/sim/scenario-screenshots.mjs
//
// Requires: dev server up on BASE (DATABASE_URL -> maxfac_sim) and chromium
// installed (`npx playwright install chromium`).
import { config } from 'dotenv';
import { chromium } from 'playwright';
import fs from 'fs';

// A sim-belépési jelszó env-ből (.env.sim, gitignore-olt) — nincs hardcode jelszó.
config({ path: '.env.local' });
config({ path: '.env.sim', override: true });

const BASE = process.env.SIM_BASE || 'http://localhost:3100';
const OUT = 'sim-out';
const CRED = { email: 'jancheeta876@gmail.com', password: process.env.SIM_ME_PASSWORD || 'changeme' };

const sample = JSON.parse(fs.readFileSync(`${OUT}/sample-targets.json`, 'utf8'));

const shots = [
  { name: '01-treatment-plans', url: '/treatment-plans', wait: 6000 },
  { name: '02-dashboard', url: '/', wait: 4000 },
  { name: '03-patient-stages', url: sample.patientId ? `/patients/${sample.patientId}/stages` : '/treatment-plans', wait: 5000 },
  { name: '04-pipeline', url: '/patients/pipeline', wait: 4000 },
  { name: '05-tasks-overview', url: '/tasks/overview', wait: 4000 },
  { name: '06-calendar', url: '/calendar', wait: 4000 },
];

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CRED),
  });
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/auth-token=([^;]+)/);
  if (!m) throw new Error(`no auth-token cookie (login status ${res.status})`);
  return m[1];
}

(async () => {
  const token = await login();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'auth-token', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Lax' }]);
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('userEmail', 'jancheeta876@gmail.com');
      localStorage.setItem('userRole', 'fogpótlástanász');
      localStorage.setItem('isLoggedIn', 'true');
      localStorage.setItem('gdpr-cookie-consent', JSON.stringify({ necessary: true, errorTracking: false, analytics: false }));
    } catch {}
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  const results = [];
  for (const s of shots) {
    try {
      await page.goto(BASE + s.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(s.wait ?? 2500);
      const file = `${OUT}/${s.name}.png`;
      await page.screenshot({ path: file, fullPage: true });
      results.push({ name: s.name, url: s.url, file, ok: true });
      console.log(`✓ ${s.name} -> ${file}`);
    } catch (e) {
      results.push({ name: s.name, url: s.url, ok: false, error: String(e).slice(0, 160) });
      console.log(`✗ ${s.name}: ${e}`);
    }
  }
  fs.writeFileSync(`${OUT}/scenario-screenshots.json`, JSON.stringify(results, null, 2));
  await browser.close();
})();
