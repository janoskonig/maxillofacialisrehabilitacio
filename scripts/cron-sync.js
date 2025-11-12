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

async function syncCalendar() {
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
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            console.log(`[${new Date().toISOString()}] Sync successful!`);
            console.log(`Users processed: ${result.usersProcessed || 0}`);
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

// Fő futtatás
(async () => {
  try {
    if (!API_KEY) {
      console.warn(`[${new Date().toISOString()}] WARNING: GOOGLE_CALENDAR_SYNC_API_KEY is not set. The sync may fail if the endpoint requires authentication.`);
    }
    
    await syncCalendar();
    console.log(`[${new Date().toISOString()}] Cron job completed successfully`);
    process.exit(0);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Cron job failed:`, error.message);
    process.exit(1);
  }
})();

