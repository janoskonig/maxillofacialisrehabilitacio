import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Adatvédelmi Irányelvek - Maxillofacialis Rehabilitációs Rendszer',
  description: 'Adatvédelmi irányelvek a Maxillofacialis Rehabilitációs Rendszerhez',
};

export default function PrivacyPolicyHu() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="mb-6">
            <Link href="/" className="text-medical-primary hover:underline text-sm">
              ← Vissza a főoldalra
            </Link>
          </div>
          
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-3xl font-bold text-gray-900">Adatvédelmi Irányelvek</h1>
            <Link 
              href="/privacy" 
              className="text-sm text-medical-primary hover:underline"
            >
              English version
            </Link>
          </div>

          <div className="prose prose-sm max-w-none text-gray-700 space-y-6">
            <p className="text-sm text-gray-600">
              <strong>Irányelv verzió:</strong> 1.1 &middot; <strong>Hatályba lépés:</strong> 2026. április 3.
            </p>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Adatkezelő</h2>
              <p>
                A Maxillofacialis Rehabilitációs Rendszer (&bdquo;Szolgáltatás&rdquo;) adatkezelője:
              </p>
              <ul className="list-none pl-0 space-y-1">
                <li><strong>Név:</strong> König János</li>
                <li><strong>Email:</strong> <a href="mailto:konig.janos@semmelweis.hu" className="text-medical-primary hover:underline">konig.janos@semmelweis.hu</a></li>
              </ul>
              <p className="mt-3">
                Az adatkezelés jellege és mértéke alapján a GDPR 37. cikke szerint nem szükséges adatvédelmi tisztviselő (DPO) 
                kijelölése. Adatvédelmi kérdésekkel kapcsolatban kérjük, forduljon közvetlenül az adatkezelőhöz a fenti email címen.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Gyűjtött Információk</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.1 Betegadatok</h3>
              <p>A következő betegadatokat gyűjtjük és tároljuk:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Személyazonosítási adatok (név, születési dátum, nem)</li>
                <li>TAJ szám (társadalombiztosítási azonosító jel)</li>
                <li>Kapcsolattartási adatok (telefonszám, email cím, postai cím)</li>
                <li>Egészségügyi adatok, diagnózis és kezelési információk (GDPR 9. cikk szerinti különleges adatkategória)</li>
                <li>Időpontfoglalási adatok</li>
                <li>Beutaló orvosi információk</li>
                <li>OHIP-14 életminőségi kérdőív válaszok</li>
                <li>Feltöltött orvosi dokumentumok</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.2 Egészségügyi dolgozók fiókadatai</h3>
              <p>A rendszert használó egészségügyi szakemberek esetében a következőket gyűjtjük:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email cím (felhasználónévként használva)</li>
                <li>Jelszó (bcrypt hash-ként tárolva; egyértékű jelszavakat soha nem tárolunk)</li>
                <li>Teljes név, szerepkör, intézmény, hozzáférés indoklása</li>
                <li>Tevékenységi naplók biztonsági és audit célokra</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.3 Google Calendar integráció</h3>
              <p>Ha úgy dönt, hogy összeköti a Google Calendar fiókját:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>OAuth tokenek (AES-256-GCM titkosítással tárolva)</li>
                <li>Naptári eseményazonosítók az időpontok szinkronizálásához</li>
                <li>NEM férünk hozzá és NEM tároljuk a teljes naptári adatait</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.4 Hozzájárulási nyilvántartás</h3>
              <p>Az Ön hozzájárulásának nyilvántartását tároljuk, beleértve az időbélyeget, IP-címet és a hozzájárulás időpontjában érvényes adatvédelmi irányelv verziószámát.</p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Az Adatkezelés Jogalapjai</h2>
              <p>Személyes adatokat a GDPR alábbi jogalapjai szerint kezelünk:</p>
              
              <div className="overflow-x-auto mt-3">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Adatkezelési tevékenység</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Jogalap</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Beteg egészségügyi adatok kezelése</td>
                      <td className="border border-gray-200 px-3 py-2">9. cikk (2)(h) &ndash; Egészségügyi ellátás + kifejezett hozzájárulás</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Személyzeti fiók kezelés</td>
                      <td className="border border-gray-200 px-3 py-2">6. cikk (1)(b) &ndash; Szerződés teljesítése</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Google Calendar szinkronizáció</td>
                      <td className="border border-gray-200 px-3 py-2">6. cikk (1)(a) &ndash; Hozzájárulás</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Hibakövetés (Sentry, ha engedélyezve)</td>
                      <td className="border border-gray-200 px-3 py-2">6. cikk (1)(a) &ndash; Hozzájárulás</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Email értesítések</td>
                      <td className="border border-gray-200 px-3 py-2">6. cikk (1)(b) &ndash; A szolgáltatás nyújtásához szükséges</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Biztonsági naplózás és audit</td>
                      <td className="border border-gray-200 px-3 py-2">6. cikk (1)(f) &ndash; Jogos érdek (rendszerbiztonság)</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Az Információk Használata</h2>
              <p>A gyűjtött információkat a következő célokra használjuk:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Betegnyilvántartás és orvosi időpontok kezelése</li>
                <li>Időpontok ütemezése és koordinálása az egészségügyi szakemberek között</li>
                <li>Időpontértesítések küldése emailben</li>
                <li>Időpontok szinkronizálása a Google Calendar-rel (ha engedélyezve)</li>
                <li>Biztonság fenntartása és jogosulatlan hozzáférés megelőzése</li>
                <li>Jogi és szabályozási követelmények betartása</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Adatbiztonság</h2>
              <p>Iparági szabványnak megfelelő biztonsági intézkedéseket alkalmazunk az Ön adatainak védelme érdekében:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Minden adat titkosítva van átvitel közben HTTPS/TLS használatával</li>
                <li>Az OAuth tokenek AES-256-GCM titkosítással vannak tárolva</li>
                <li>A jelszavak bcrypt hash algoritmussal vannak hash-elve</li>
                <li>A hozzáférés szerepkörök és jogosultságok alapján korlátozott (RBAC)</li>
                <li>Az adatbázis hozzáférés korlátozott és naplózott</li>
                <li>Az eseménynaplók hash-elt azonosítókat használnak a nyers PII tárolásának elkerülése érdekében</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Adatok Megosztása és Közlése</h2>
              <p>Nem értékesítjük, nem cseréljük, és nem adjuk bérbe az Ön személyes adatait. Az információkat csak a következő esetekben osztjuk meg:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Egészségügyi szakemberek:</strong> A betegadatok elérhetők a betegellátásban részt vevő jogosított egészségügyi szakemberek számára</li>
                <li><strong>Jogi követelmények:</strong> Ha törvény, bírósági végzés vagy kormányzati szabályozás előírja</li>
                <li><strong>Adatfeldolgozók:</strong> Megbízható harmadik fél szolgáltatókkal (lásd 9. fejezet), adatfeldolgozási megállapodások alapján</li>
                <li><strong>Vészhelyzetek:</strong> A betegek vagy mások egészségének és biztonságának védelme érdekében</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Adatok Megőrzése</h2>
              <p>Az alábbi megőrzési időszakokat alkalmazzuk:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Beteg egészségügyi nyilvántartások:</strong> 30 év az utolsó kezeléstől számítva, a magyar egészségügyi törvény (1997. évi CLIV. törvény) előírása szerint</li>
                <li><strong>Személyzeti fiókok:</strong> Megőrizve a fiók aktív állapotában; deaktiválás után kérésre törlődik</li>
                <li><strong>Esemény/audit naplók:</strong> 3 év (automatikusan törlődik)</li>
                <li><strong>Hozzájárulási nyilvántartások:</strong> Az adatkezelés időtartama alatt, valamint a visszavonás után 5 évig</li>
                <li><strong>Munkamenet sütik:</strong> Kijelentkezéskor vagy munkamenet lejártakor törlődik</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Az Ön GDPR Szerinti Jogai</h2>
              <p>Az Ön személyes adataival kapcsolatban a következő jogokkal rendelkezik:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Hozzáféréshez való jog (15. cikk):</strong> Kérheti személyes adatainak hozzáférését</li>
                <li><strong>Helyesbítéshez való jog (16. cikk):</strong> Kérheti pontatlan adatok javítását</li>
                <li><strong>Törléshez való jog (17. cikk):</strong> Kérheti adatainak törlését (az egészségügyi nyilvántartásokra vonatkozó törvényi megőrzési kötelezettségek figyelembevételével)</li>
                <li><strong>Korlátozáshoz való jog (18. cikk):</strong> Kérheti az adatkezelés korlátozását</li>
                <li><strong>Adathordozhatósághoz való jog (20. cikk):</strong> Kérheti adatainak géppel olvasható formátumú másolatát</li>
                <li><strong>Tiltakozáshoz való jog (21. cikk):</strong> Tiltakozhat jogos érdek alapú adatkezelés ellen</li>
                <li><strong>Hozzájárulás visszavonásának joga (7. cikk):</strong> Hozzájárulását bármikor visszavonhatja, anélkül, hogy ez a korábbi adatkezelés jogszerűségét érintené</li>
              </ul>
              <p className="mt-3">
                A betegek az adathordozhatósági és törlési jogaikat közvetlenül a páciens portálon keresztül gyakorolhatják 
                (Profil rész). Minden egyéb kéréssel kapcsolatban kérjük, forduljon hozzánk:{' '}
                <a href="mailto:konig.janos@semmelweis.hu" className="text-medical-primary hover:underline">konig.janos@semmelweis.hu</a>.
                30 napon belül válaszolunk.
              </p>
              <p className="mt-3">
                <strong>Panasztételi jog:</strong> Ha úgy véli, hogy adatvédelmi jogai sérültek, panaszt tehet 
                a magyar felügyeleti hatóságnál:
              </p>
              <ul className="list-none pl-6 space-y-1 mt-2">
                <li><strong>Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)</strong></li>
                <li>Cím: 1055 Budapest, Falk Miksa utca 9-11.</li>
                <li>Telefon: +36 (1) 391-1400</li>
                <li>Email: ugyfelszolgalat@naih.hu</li>
                <li>Honlap: <a href="https://naih.hu" className="text-medical-primary hover:underline" target="_blank" rel="noopener noreferrer">https://naih.hu</a></li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Harmadik Fél Szolgáltatások és Adatfeldolgozók</h2>
              <p>Rendszerünk a következő harmadik fél szolgáltatásokat (adatfeldolgozókat) használja:</p>
              
              <div className="overflow-x-auto mt-3">
                <table className="min-w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Szolgáltatás</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Cél</th>
                      <th className="border border-gray-200 px-3 py-2 text-left font-semibold">Adattárolás helye</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Google Calendar API</td>
                      <td className="border border-gray-200 px-3 py-2">Időpont szinkronizáció (opcionális, hozzájárulás alapú)</td>
                      <td className="border border-gray-200 px-3 py-2">EU/US (Google SCC-k)</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Sentry</td>
                      <td className="border border-gray-200 px-3 py-2">Hibamonitorozás (opcionális, hozzájárulás alapú, PII törlésével)</td>
                      <td className="border border-gray-200 px-3 py-2">US (Sentry DPA + SCC-k)</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">SMTP Email szolgáltató</td>
                      <td className="border border-gray-200 px-3 py-2">Tranzakciós emailek (időpont, megerősítés)</td>
                      <td className="border border-gray-200 px-3 py-2">EU</td>
                    </tr>
                    <tr>
                      <td className="border border-gray-200 px-3 py-2">Google Fonts</td>
                      <td className="border border-gray-200 px-3 py-2">Betűkészlet szolgáltatás (Inter betűtípus)</td>
                      <td className="border border-gray-200 px-3 py-2">Globális CDN</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3">
                Amennyiben adatok az EU/EGT-n kívülre kerülnek továbbításra, az Európai Bizottság által jóváhagyott 
                általános szerződési feltételekre (SCC) vagy azzal egyenértékű biztosítékokra támaszkodunk.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. Sütik és Helyi Tárolás</h2>
              <p>A következő sütiket és böngésző-tárolási lehetőségeket használjuk:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>auth-token</strong> (süti): Munkamenet-hitelesítés egészségügyi dolgozók számára. Elengedhetetlen, kijelentkezéskor törlődik.</li>
                <li><strong>patient_portal_session</strong> (süti): Munkamenet-hitelesítés betegek számára. Elengedhetetlen, kijelentkezéskor törlődik.</li>
                <li><strong>localStorage:</strong> Felhasználói felület beállítások (banner elutasítások, PWA értesítések, szerepkör gyorsítótár). Személyes adatot nem tartalmaz.</li>
                <li><strong>sessionStorage:</strong> Ideiglenes hiba/konzol naplók hibabejelentéshez. A lap bezárásakor törlődik.</li>
              </ul>
              <p className="mt-3">
                Nem használunk követő sütiket vagy harmadik fél reklám/analitikai sütiket. 
                Ha a Sentry hibakövetés engedélyezve van, az Ön előzetes hozzájárulását igényli.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">11. Gyermekek Adatvédelme</h2>
              <p>
                Rendszerünk egészségügyi szakemberek általi használatra készült, és minden korosztály betegadatait tartalmazhatja, 
                beleértve a kiskorúakat is. Minden betegadatot, beleértve a kiskorúak adatait, a GDPR és az alkalmazandó magyar 
                egészségügyi adatvédelmi törvényeknek megfelelően kezelünk. 16 év alatti betegek esetén a szülői felelősség 
                gyakorlója adja meg a hozzájárulást.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">12. Adatvédelmi Incidens Értesítés</h2>
              <p>
                Személyes adatok megsértése esetén, amely valószínűleg kockázatot jelent az Ön jogaira és szabadságaira nézve, 
                az incidensről való tudomásszerzéstől számított 72 órán belül értesítjük a NAIH-ot (33. cikk). Ha az incidens 
                valószínűleg magas kockázatot jelent, az érintett személyeket is indokolatlan késedelem nélkül értesítjük (34. cikk).
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">13. Az Adatvédelmi Irányelv Módosításai</h2>
              <p>
                Időnként frissíthetjük ezt az Adatvédelmi Irányelvet. A lényeges változásokról emailben vagy alkalmazáson 
                belüli értesítéssel tájékoztatjuk. Az irányelv verziószáma és hatályba lépési dátuma az oldal tetején látható. 
                Az értesítés utáni további használat az elfogadást jelenti; hozzájárulás-alapú adatkezelés változásaihoz 
                megújított hozzájárulást kérünk.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">14. Kapcsolatfelvétel</h2>
              <p>
                Ha bármilyen kérdése vagy észrevétele van ezzel az Adatvédelmi Irányelvvel vagy adatkezelési gyakorlatunkkal 
                kapcsolatban, kérjük, lépjen kapcsolatba velünk:
              </p>
              <p className="mt-2">
                <strong>Email:</strong> <a href="mailto:konig.janos@semmelweis.hu" className="text-medical-primary hover:underline">konig.janos@semmelweis.hu</a>
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
