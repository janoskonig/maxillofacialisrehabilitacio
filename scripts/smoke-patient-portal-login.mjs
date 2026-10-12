// Native form smoke test: no valid login tokens, patient sessions, or outbound email.
// Run against a running app:
//   node scripts/smoke-patient-portal-login.mjs http://localhost:3000
//   PORTAL_SMOKE_BROWSER=webkit node scripts/smoke-patient-portal-login.mjs
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const baseUrl = new URL(
  process.argv[2] || process.env.PORTAL_SMOKE_BASE_URL || 'http://localhost:3000',
);
assert(['http:', 'https:'].includes(baseUrl.protocol), 'Base URL must use HTTP or HTTPS');
const browserName = process.env.PORTAL_SMOKE_BROWSER || 'chromium';
const browserType = { chromium, webkit }[browserName];
assert(browserType, 'PORTAL_SMOKE_BROWSER must be chromium or webkit');

const browser = await browserType.launch({ headless: true });
try {
  for (const javaScriptEnabled of [true, false]) {
    for (const verifyEmail of [false, true]) {
      const label = `${browserName} ${verifyEmail ? 'email verification' : 'magic link'} / JavaScript ${javaScriptEnabled ? 'on' : 'off'}`;
      const context = await browser.newContext({ javaScriptEnabled, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(30_000);
        const confirmationUrl = new URL('/patient-portal/sign-in', baseUrl);
        confirmationUrl.searchParams.set('token', '0'.repeat(64));
        if (verifyEmail) confirmationUrl.searchParams.set('mode', 'email');

        const landing = await page.goto(confirmationUrl.href, { waitUntil: 'load' });
        assert.equal(landing?.status(), 200, `${label}: confirmation must load`);
        assert.equal(new URL(page.url()).origin, baseUrl.origin, `${label}: unexpected host redirect`);
        assert.equal(landing.headers()['referrer-policy'], 'strict-origin', `${label}: confirmation HTTP policy`);
        const policy = await page.locator('meta[name="referrer"]').getAttribute('content');
        assert.equal(policy, 'strict-origin', `${label}: confirmation metadata policy`);

        const endpoint = `/api/patient-portal/auth/${verifyEmail ? 'verify-email' : 'verify'}`;
        const form = page.locator(`form[action="${endpoint}"]`);
        assert.equal(await form.getAttribute('method'), 'post', `${label}: form must use native POST`);

        // React can restore its controlled input during the submit handler.
        // Override only the body of the actual native POST to guarantee rejection
        // before a token query. Keep the browser's Origin and Referer untouched.
        let interceptedPosts = 0;
        await page.route(new URL(endpoint, baseUrl).href, async route => {
          if (route.request().method() === 'POST') {
            interceptedPosts += 1;
            await route.continue({ postData: 'token=not-a-token' });
          } else {
            await route.continue();
          }
        });
        await form.locator('input[name="token"]').evaluate(input => {
          input.value = 'not-a-token';
        });

        const [response] = await Promise.all([
          page.waitForResponse(candidate =>
            candidate.request().method() === 'POST'
            && new URL(candidate.url()).pathname === endpoint,
          ),
          form.locator('button[type="submit"]').click(),
        ]);
        const headers = await response.request().allHeaders();
        assert.equal(headers.origin, baseUrl.origin, `${label}: browser-generated Origin`);
        assert.equal(headers.referer, `${baseUrl.origin}/`, `${label}: Referer must omit token path/query`);
        assert.equal(interceptedPosts, 1, `${label}: native POST must use the safe malformed body`);
        assert.equal(response.status(), 303, `${label}: malformed token must redirect, not fail origin validation`);
        assert.equal(response.headers()['set-cookie'], undefined, `${label}: invalid token must not set a cookie`);

        const destination = new URL(response.headers().location || '', baseUrl);
        assert.equal(destination.origin, baseUrl.origin, `${label}: redirect origin`);
        assert.equal(destination.pathname, '/patient-portal', `${label}: redirect path`);
        assert.equal(destination.searchParams.get('error'), 'invalid_token', `${label}: redirect error`);
        console.log(`${label}: POST 303 -> /patient-portal?error=invalid_token`);

        await page.waitForURL(url =>
          url.origin === baseUrl.origin
          && url.pathname === '/patient-portal'
          && url.searchParams.get('error') === 'invalid_token',
        );
        assert.equal(
          (await context.cookies()).some(cookie => cookie.name === 'patient_portal_session'),
          false,
          `${label}: invalid token must not create a session`,
        );
        console.log(`PASS ${label}: native Origin, token-free Referer, 303 invalid_token, no session`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
