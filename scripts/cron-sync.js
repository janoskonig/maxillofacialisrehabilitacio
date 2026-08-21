/**
 * Cron job script a Google Calendar szinkronizációhoz
 * Ezt a scriptet a Render cron job futtatja rendszeres időközönként
 */

const https = require('https');
const http = require('http');

/**
 * Europe/Budapest óra és perc — ne használj new Date(toLocaleString(...))-t: a szerver TZ-jében
 * újraértelmezi a stringet, és eltérő környezetben rossz időpontra futhat a cron.
 */
function getBudapestWallClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Budapest',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return {
    hour: Number.parseInt(map.hour, 10),
    minute: Number.parseInt(map.minute, 10),
    isMonday: map.weekday === 'Mon',
  };
}

const API_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
const API_KEY = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;
const ENDPOINT = '/api/google-calendar/sync/cron';
const DEBUG_INGEST = 'http://127.0.0.1:7480/ingest/422ab24a-0338-4af3-8664-a47d0382f7d8';

if (!API_URL) {
  console.error(`[${new Date().toISOString()}] ERROR: APP_URL or RENDER_EXTERNAL_URL environment variable is not set.`);
  console.error('Please set APP_URL to your web service URL (e.g., https://maxillofacial-rehab.onrender.com)');
  process.exit(1);
}

async function attemptSync() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}${ENDPOINT}`);
    if (API_KEY) {
      url.searchParams.set('api_key', API_KEY);
    }
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'x-api-key': API_KEY || '',
        'User-Agent': 'Render-Cron-Job/1.0',
      },
      timeout: 300000, // 5 perc timeout (a szinkronizáció hosszú időt vehet igénybe)
    };

    console.log(`[${new Date().toISOString()}] Starting Google Calendar sync...`);
    console.log(`URL: ${API_URL}${ENDPOINT}`);

    const req = client.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 207) {
          // 200 OK vagy 207 Multi-Status (részleges sikertelenség) esetén sikeresnek tekintjük
          try {
            const result = JSON.parse(data);
            console.log(`[${new Date().toISOString()}] Sync completed with status ${res.statusCode}!`);
            console.log(`Users processed: ${result.usersProcessed || 0}`);
            if (result.warnings) {
              console.warn(`[${new Date().toISOString()}] Warnings: ${result.warnings}`);
            }
            console.log(`Summary: ${result.summary?.totalCreated || 0} created, ${result.summary?.totalUpdated || 0} updated, ${result.summary?.totalDeleted || 0} deleted`);
            resolve(result);
          } catch (e) {
            console.log(`[${new Date().toISOString()}] Sync completed (non-JSON response):`, data);
            resolve(data);
          }
        } else {
          const error = new Error(`Sync failed with status ${res.statusCode}: ${data}`);
          console.error(`[${new Date().toISOString()}] ${error.message}`);
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`[${new Date().toISOString()}] Request error:`, error.message);
      reject(error);
    });

    req.on('timeout', () => {
      req.destroy();
      const error = new Error('Request timeout');
      console.error(`[${new Date().toISOString()}] ${error.message}`);
      reject(error);
    });

    req.end();
  });
}

async function syncCalendar(retries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await attemptSync();
    } catch (error) {
      const errorMessage = error.message || '';
      const isRetryable = 
        errorMessage.includes('521') || 
        errorMessage.includes('500') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('Connection terminated') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('ENOTFOUND');
      
      if (isRetryable && attempt < retries) {
        const waitTime = delayMs * attempt; // Exponential backoff: 5s, 10s, 15s
        console.warn(`[${new Date().toISOString()}] Attempt ${attempt} failed, retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }
      
      // Ha nem retry-hoz tartozó hiba, vagy elfogyott a retry-k, dobjuk a hibát
      throw error;
    }
  }
}

/** A futás során hibázott hívások — a végén ezek döntik el az exit kódot. */
const failures = [];

function recordFailure(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.error(`[${new Date().toISOString()}] ${label} FAILED — ${detail}`);
}

/**
 * Fire a one-shot GET to an API endpoint. Egy hívás hibája nem szakítja meg a futást,
 * de bekerül a `failures` listába, és a futás végén nem-nulla exit kóddal zárunk —
 * különben a Render "finished successfully"-t ír ki akkor is, ha minden végpont
 * 401-gyel elszállt, és a heti OHIP-14 emlékeztető hetekig némán kimarad.
 */
async function callEndpoint(path, label) {
  return new Promise((resolve) => {
    const url = new URL(`${API_URL}${path}`);
    if (API_KEY) {
      url.searchParams.set('api_key', API_KEY);
    }
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'GET',
      headers: { 'x-api-key': API_KEY || '', 'User-Agent': 'Render-Cron-Job/1.0' },
      timeout: 120000,
    };
    console.log(`[${new Date().toISOString()}] ${label}: calling ${API_URL}${path}`);
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        console.log(`[${new Date().toISOString()}] ${label}: status ${res.statusCode} — ${data.slice(0, 300)}`);
        if (!ok) {
          const hint =
            res.statusCode === 401 || res.statusCode === 403
              ? ' — a cron API kulcs nem egyezik: a GOOGLE_CALENDAR_SYNC_API_KEY értékének KARAKTERRE azonosnak kell lennie a cron és a web service-en (figyelj a beillesztéskor maradt szóközre/újsorra)'
              : '';
          recordFailure(label, `HTTP ${res.statusCode}${hint}`);
        }
        resolve();
      });
    });
    req.on('error', (e) => { recordFailure(label, e.message); resolve(); });
    req.on('timeout', () => { req.destroy(); recordFailure(label, 'timeout'); resolve(); });
    req.end();
  });
}

// Fő futtatás
(async () => {
  try {
    if (!API_KEY) {
      console.warn(`[${new Date().toISOString()}] WARNING: GOOGLE_CALENDAR_SYNC_API_KEY is not set. The sync may fail if the endpoint requires authentication.`);
    }

    const { hour, minute, isMonday } = getBudapestWallClock();

    console.log(
      `[${new Date().toISOString()}] Cron timing (Europe/Budapest): hour=${hour} minute=${minute} isMonday=${isMonday}`
    );

    // Weekly OHIP-14 reminders — run on Mondays between 08:00-08:59 Budapest time.
    // The ohip_reminder_log table guarantees at most one email per patient per 7 days,
    // so a wider window is safe and avoids missing the slot due to cold-start / sync delays.
    if (isMonday && hour === 8) {
      await callEndpoint('/api/ohip14/reminders', 'OHIP-14 reminders');
      // Beteg-önkitöltési nudge (életmód-anamnézis stb.) — ugyanabban a heti
      // ablakban; a patient_selffill_reminder_log heti cooldownt garantál.
      await callEndpoint('/api/patients/self-fill-reminders', 'Patient self-fill reminders');
    } else {
      console.log(
        `[${new Date().toISOString()}] OHIP-14 reminders skipped (isMonday=${isMonday}, hour=${hour}, expected Monday 8).`
      );
    }

    // Weekly missing-data reminders — Mondays between 07:00-07:59 Budapest time.
    // The missing_data_reminder_log enforces at most one email per (patient, doctor)
    // per 7 days, so a wider window is safe; a still-missing field re-notifies next week.
    if (isMonday && hour === 7) {
      await callEndpoint('/api/patients/missing-data-reminders', 'Missing-data reminders');
    } else {
      console.log(
        `[${new Date().toISOString()}] Missing-data reminders skipped (isMonday=${isMonday}, hour=${hour}, expected Monday 7).`
      );
    }

    // Napi beleegyezési emlékeztető — 09:00 Budapest körül.
    // A consent_reminder_log ~20h cooldownja garantál legfeljebb napi egy emailt
    // páciensenként, így a tág ablak biztonságos.
    if (hour === 9) {
      await callEndpoint('/api/patients/consent-reminders', 'Consent reminders');
    }

    // Napi adat-teljességi pillanatkép a trend-grafikonhoz — 06:00 körül.
    // A végpont idempotens (egy sor / nap), így a tág ablak biztonságos.
    if (hour === 6) {
      await callEndpoint('/api/patients/completeness-snapshot/record', 'Completeness snapshot');
    }

    // Lezáratlan kritikus feedbackek napi egyszeri push-összesítője 07:30 Budapest
    // körül. A 07:30–07:59 biztonsági ablak elvisel egy rövid cron-kimaradást; a
    // végpont Budapest szerinti naptári napra atomi deduplikációt végez.
    if (hour === 7 && minute >= 30) {
      await callEndpoint('/api/feedback/summary/cron', 'Critical feedback summary');
    }

    // Stuck-slot reaper — 5 percenként. Felszabadítja a jövőbeli, 'held'/'offered'
    // állapotban ragadt (élő hold nélküli) slotokat, hogy újra foglalhatók legyenek.
    // A művelet idempotens és csak orphan slotokat érint, így a tág ablak biztonságos.
    if (minute % 5 === 0) {
      await callEndpoint('/api/scheduling/stuck-slot-reaper', 'Stuck-slot reaper');
    }

    // Admin összegyűjtő email: minden cron futáskor hívjuk; a szerver max. ADMIN_NOTIFICATION_BATCH_INTERVAL_HOURS (alap 3) szerint küld.
    await callEndpoint('/api/admin/daily-summary', 'Admin notification batch summary');

    try {
      await syncCalendar();
    } catch (error) {
      recordFailure('Google Calendar sync', error.message);
    }

    finish();
  } catch (error) {
    recordFailure('Cron job', error.message);
    finish();
  }
})();

/**
 * Összegzés + exit kód. Nem-nulla kóddal zárunk, ha bármelyik végpont hibázott,
 * hogy a Render a futást sikertelennek jelölje (és értesítsen) — a néma 401-ek
 * miatt maradtak ki hetekig az OHIP-14 emlékeztetők.
 */
function finish() {
  if (failures.length === 0) {
    console.log(`[${new Date().toISOString()}] Cron job completed successfully`);
    process.exit(0);
  }
  console.error(`[${new Date().toISOString()}] Cron job completed with ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
