/**
 * Showcase screenshot harness.
 * Logs in with the demo admin and captures every key feature page at
 * desktop / tablet / mobile viewports into ./screenshots/<viewport>/.
 *
 *   node scripts/capture-showcase.js
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CHROME = path.join(__dirname, '..', '.demo-chrome', 'chrome-linux64', 'chrome');
const OUT = path.join(__dirname, '..', 'screenshots');

const CREDS = { email: 'admin@demo.hu', password: 'Demo1234!' };

const PATIENT_ID = process.env.DEMO_PATIENT_ID || '';
const EPISODE_ID = process.env.DEMO_EPISODE_ID || '';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  tablet: { width: 834, height: 1112, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

// Pages to capture. fullPage true = whole scrollable page.
const PAGES = [
  { name: '01-login', path: '/login', auth: false, fullPage: false },
  { name: '02-dashboard', path: '/', fullPage: true },
  { name: '03-patient-form-uj-beteg', path: '/patients/new', fullPage: true },
  { name: '04-betegut-pipeline', path: '/patients/pipeline', fullPage: false },
  { name: '05-betegut-gantt', path: '/patients/stages/gantt', fullPage: false },
  { name: '06-patient-detail', path: PATIENT_ID ? `/patients/${PATIENT_ID}` : '/', fullPage: true },
  { name: '06b-patient-clinical', path: PATIENT_ID ? `/patients/${PATIENT_ID}/view` : '/', fullPage: true },
  { name: '07-patient-history', path: PATIENT_ID ? `/patients/${PATIENT_ID}/history` : '/', fullPage: true },
  { name: '08-calendar', path: '/calendar', fullPage: false },
  { name: '09-time-slots', path: '/time-slots', fullPage: false },
  { name: '10-consilium', path: '/consilium', fullPage: true },
  { name: '11-messages', path: '/messages', fullPage: false },
  { name: '12-tasks', path: '/tasks', fullPage: true },
  { name: '13-tasks-overview', path: '/tasks/overview', fullPage: true },
  { name: '14-treatment-plans', path: '/treatment-plans', fullPage: true },
  { name: '15-waiting-times', path: '/waiting-times', fullPage: true },
  { name: '16-workload', path: '/workload', fullPage: true },
  { name: '17-admin', path: '/admin', fullPage: true },
  { name: '18-admin-stats', path: '/admin/stats', fullPage: true },
  { name: '19-settings', path: '/settings', fullPage: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

// Poll until loading placeholders/skeletons settle (or timeout).
async function waitForLoaded(page, maxMs = 16000) {
  const start = Date.now();
  let stable = 0;
  while (Date.now() - start < maxMs) {
    const signals = await page.evaluate(() => {
      const text = document.body.innerText || '';
      const loadingText = (text.match(/Betölt(és)?\.\.\./gi) || []).length;
      const skeletons = document.querySelectorAll('.animate-pulse, [aria-busy="true"], .skeleton').length;
      return loadingText + skeletons;
    }).catch(() => 0);
    if (signals === 0) { stable++; if (stable >= 2) return; }
    else stable = 0;
    await sleep(700);
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#email', { timeout: 20000 });
  await page.type('#email', CREDS.email, { delay: 15 });
  await page.type('#password', CREDS.password, { delay: 15 });
  await Promise.all([
    page.click('button[type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {}),
  ]);
  await sleep(1500);
  const url = page.url();
  console.log(`  login -> ${url}`);
}

async function dismissOverlays(page) {
  // Best-effort: accept cookie banner / close onboarding popups by button text.
  const labels = ['Összes elfogadása', 'Elfogadom', 'Elfogad', 'Rendben', 'Értem', 'Accept', 'Bezárás'];
  try {
    await page.evaluate((labels) => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      for (const b of btns) {
        const t = (b.textContent || '').trim();
        if (labels.some((l) => t === l || t.includes(l))) { b.click(); return; }
      }
    }, labels);
  } catch {}
}

async function main() {
  for (const v of Object.keys(VIEWPORTS)) fs.mkdirSync(path.join(OUT, v), { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=hu-HU', '--font-render-hinting=none'],
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'hu-HU,hu;q=0.9' });
  await page.emulateTimezone('Europe/Budapest');

  // Authenticate once (cookies shared across the browser).
  await page.setViewport(VIEWPORTS.desktop);
  await login(page);
  // Accept the cookie/consent banner once so it doesn't cover screenshots.
  await dismissOverlays(page);
  await sleep(800);

  for (const [vName, vp] of Object.entries(VIEWPORTS)) {
    console.log(`\n=== ${vName} (${vp.width}x${vp.height}) ===`);
    await page.setViewport(vp);
    for (const pg of PAGES) {
      if (ONLY.length && !ONLY.includes(pg.name)) continue;
      const url = `${BASE}${pg.path}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
        await waitForLoaded(page);
        await sleep(2500);
        await dismissOverlays(page);
        await sleep(600);
        // Scroll through to trigger lazy content, then back to top.
        await page.evaluate(async () => {
          await new Promise((res) => {
            let y = 0; const step = () => {
              window.scrollBy(0, 600); y += 600;
              if (y < document.body.scrollHeight && y < 12000) setTimeout(step, 80); else res();
            }; step();
          });
        });
        await sleep(500);
        await page.evaluate(() => window.scrollTo(0, 0));
        await sleep(500);
        const file = path.join(OUT, vName, `${pg.name}.png`);
        await page.screenshot({ path: file, fullPage: !!pg.fullPage });
        console.log(`  ✓ ${pg.name}  (${pg.path})`);
      } catch (e) {
        console.log(`  ✗ ${pg.name}  (${pg.path}) — ${e.message.split('\n')[0]}`);
        try { await page.screenshot({ path: path.join(OUT, vName, `${pg.name}.png`) }); } catch {}
      }
    }
  }

  await browser.close();
  console.log('\nDone. Screenshots in ./screenshots/{desktop,tablet,mobile}/');
}

main().catch((e) => { console.error(e); process.exit(1); });
