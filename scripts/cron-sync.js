/**
 * Cron job script a Google Calendar szinkronizációhoz
 * Ezt a scriptet a Render cron job futtatja rendszeres időközönként
 */

const https = require('https');
const http = require('http');

const API_URL = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL;
const API_KEY = process.env.GOOGLE_CALENDAR_SYNC_API_KEY;
const ENDPOINT = '/api/google-calendar/sync/cron';

if (!API_URL) {
  console.error(`[${new Date().toISOString()}] ERROR: APP_URL or RENDER_EXTERNAL_URL environment variable is not set.`);
  console.error('Please set APP_URL to your web service URL (e.g., https://maxillofacial-rehab.onrender.com)');
  process.exit(1);
}

async function attemptSync() {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_URL}${ENDPOINT}`);
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

/**
 * Fire a one-shot GET to an API endpoint (non-critical — failures logged but don't abort cron).
 */
async function callEndpoint(path, label) {
  return new Promise((resolve) => {
    const url = new URL(`${API_URL}${path}`);
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
        console.log(`[${new Date().toISOString()}] ${label}: status ${res.statusCode} — ${data.slice(0, 300)}`);
        resolve();
      });
    });
    req.on('error', (e) => { console.error(`[${new Date().toISOString()}] ${label} error:`, e.message); resolve(); });
    req.on('timeout', () => { req.destroy(); console.error(`[${new Date().toISOString()}] ${label} timeout`); resolve(); });
    req.end();
  });
}

// Fő futtatás
(async () => {
  try {
    if (!API_KEY) {
      console.warn(`[${new Date().toISOString()}] WARNING: GOOGLE_CALENDAR_SYNC_API_KEY is not set. The sync may fail if the endpoint requires authentication.`);
    }
    
    await syncCalendar();

    // Weekly OHIP-14 reminders: run on Monday between 08:00-08:01 Budapest time
    const nowBudapest = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Budapest' }));
    const isMonday = nowBudapest.getDay() === 1;
    const hour = nowBudapest.getHours();
    const minute = nowBudapest.getMinutes();
    if (isMonday && hour === 8 && minute === 0) {
      await callEndpoint('/api/ohip14/reminders', 'OHIP-14 reminders');
    }

    console.log(`[${new Date().toISOString()}] Cron job completed successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Cron job failed after retries:`, error.message);
    process.exit(0);
  }
})();

