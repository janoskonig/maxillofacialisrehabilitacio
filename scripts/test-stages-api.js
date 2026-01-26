/**
 * Teszt script a betegstádiumok API-khoz
 * Használat: node scripts/test-stages-api.js <base-url> <auth-token> <patient-id>
 * 
 * Példa:
 * node scripts/test-stages-api.js http://localhost:3000 YOUR_AUTH_TOKEN patient-uuid
 */

const https = require('https');
const http = require('http');

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const AUTH_TOKEN = process.argv[3];
const PATIENT_ID = process.argv[4];

if (!AUTH_TOKEN) {
  console.error('❌ Hiba: Auth token megadása kötelező');
  console.error('Használat: node scripts/test-stages-api.js <base-url> <auth-token> <patient-id>');
  process.exit(1);
}

if (!PATIENT_ID) {
  console.error('❌ Hiba: Patient ID megadása kötelező');
  console.error('Használat: node scripts/test-stages-api.js <base-url> <auth-token> <patient-id>');
  process.exit(1);
}

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${path}`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Cookie': `auth-token=${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      const bodyString = JSON.stringify(body);
      options.headers['Content-Length'] = Buffer.byteLength(bodyString);
    }

    const req = client.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const jsonData = data ? JSON.parse(data) : {};
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: jsonData,
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data: data,
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function runTests() {
  console.log('🧪 Betegstádiumok API Tesztelés\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Patient ID: ${PATIENT_ID}\n`);

  try {
    // Test 1: GET timeline
    console.log('1️⃣ GET /api/patients/[id]/stages - Timeline lekérdezése');
    const timelineResponse = await makeRequest('GET', `/api/patients/${PATIENT_ID}/stages`);
    console.log(`   Status: ${timelineResponse.status}`);
    if (timelineResponse.status === 200) {
      console.log(`   ✅ Sikeres - Current stage: ${timelineResponse.data.timeline?.currentStage?.stage || 'Nincs'}`);
      console.log(`   Epizódok száma: ${timelineResponse.data.timeline?.episodes?.length || 0}`);
    } else {
      console.log(`   ❌ Hiba: ${JSON.stringify(timelineResponse.data)}`);
    }
    console.log('');

    // Test 2: POST new stage
    console.log('2️⃣ POST /api/patients/[id]/stages - Új stádium létrehozása');
    const newStageResponse = await makeRequest('POST', `/api/patients/${PATIENT_ID}/stages`, {
      stage: 'arajanlatra_var',
      notes: 'Teszt stádium változtatás',
    });
    console.log(`   Status: ${newStageResponse.status}`);
    if (newStageResponse.status === 201) {
      console.log(`   ✅ Sikeres - Új stádium: ${newStageResponse.data.stage?.stage}`);
      console.log(`   Episode ID: ${newStageResponse.data.stage?.episodeId}`);
    } else {
      console.log(`   ❌ Hiba: ${JSON.stringify(newStageResponse.data)}`);
    }
    console.log('');

    // Test 3: GET episodes
    console.log('3️⃣ GET /api/patients/[id]/stages/episodes - Epizódok lekérdezése');
    const episodesResponse = await makeRequest('GET', `/api/patients/${PATIENT_ID}/stages/episodes`);
    console.log(`   Status: ${episodesResponse.status}`);
    if (episodesResponse.status === 200) {
      console.log(`   ✅ Sikeres - Epizódok száma: ${episodesResponse.data.episodes?.length || 0}`);
      if (episodesResponse.data.episodes?.length > 0) {
        console.log(`   Első epizód stádiumai: ${episodesResponse.data.episodes[0].stages?.length || 0}`);
      }
    } else {
      console.log(`   ❌ Hiba: ${JSON.stringify(episodesResponse.data)}`);
    }
    console.log('');

    // Test 4: POST new episode
    console.log('4️⃣ POST /api/patients/[id]/stages/new-episode - Új epizód indítása');
    const newEpisodeResponse = await makeRequest('POST', `/api/patients/${PATIENT_ID}/stages/new-episode`, {
      stage: 'uj_beteg',
      notes: 'Teszt új epizód',
    });
    console.log(`   Status: ${newEpisodeResponse.status}`);
    if (newEpisodeResponse.status === 201) {
      console.log(`   ✅ Sikeres - Új epizód ID: ${newEpisodeResponse.data.episodeId}`);
      console.log(`   Stádium: ${newEpisodeResponse.data.stage?.stage}`);
    } else {
      console.log(`   ❌ Hiba: ${JSON.stringify(newEpisodeResponse.data)}`);
    }
    console.log('');

    // Test 5: GET current stages
    console.log('5️⃣ GET /api/patients/stages/current - Jelenlegi stádiumok');
    const currentStagesResponse = await makeRequest('GET', '/api/patients/stages/current');
    console.log(`   Status: ${currentStagesResponse.status}`);
    if (currentStagesResponse.status === 200) {
      console.log(`   ✅ Sikeres - Betegek száma: ${currentStagesResponse.data.currentStages?.length || 0}`);
    } else {
      console.log(`   ❌ Hiba: ${JSON.stringify(currentStagesResponse.data)}`);
    }
    console.log('');

    // Test 6: GET current stages with filter
    console.log('6️⃣ GET /api/patients/stages/current?stage=arajanlatra_var - Szűrés stádium szerint');
    const filteredStagesResponse = await makeRequest('GET', '/api/patients/stages/current?stage=arajanlatra_var');
    console.log(`   Status: ${filteredStagesResponse.status}`);
    if (filteredStagesResponse.status === 200) {
      console.log(`   ✅ Sikeres - Szűrt betegek száma: ${filteredStagesResponse.data.currentStages?.length || 0}`);
    } else {
      console.log(`   ❌ Hiba: ${JSON.stringify(filteredStagesResponse.data)}`);
    }
    console.log('');

    console.log('✅ Tesztelés befejezve!\n');

  } catch (error) {
    console.error('❌ Tesztelési hiba:', error.message);
    process.exit(1);
  }
}

runTests();
