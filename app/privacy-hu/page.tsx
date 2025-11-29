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
              <strong>Utolsó frissítés:</strong> {new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Bevezetés</h2>
              <p>
                A Maxillofacialis Rehabilitációs Rendszer ("mi," "rendszerünk," vagy "szolgáltatásunk") elkötelezett az 
                Ön adatainak védelme mellett. Ez az Adatvédelmi Irányelv elmagyarázza, hogyan gyűjtjük, használjuk, 
                közöljük és védjük az Ön adatait, amikor az orvosi időpontfoglalási és betegadat-kezelő rendszerünket használja.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Gyűjtött Információk</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.1 Betegadatok</h3>
              <p>A következő betegadatokat gyűjtjük és tároljuk:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Személyazonosítási adatok (név, születési dátum, nem)</li>
                <li>TAJ szám (magyarországi társadalombiztosítási azonosító)</li>
                <li>Kapcsolattartási adatok (telefonszám, email cím, lakcím)</li>
                <li>Orvosi anamnézis és kezelési információk</li>
                <li>Időpontfoglalási adatok</li>
                <li>Beutaló orvosok által megadott információk</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.2 Felhasználói fiók információk</h3>
              <p>A rendszert használó egészségügyi szakemberek esetében a következőket gyűjtjük:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Email cím (felhasználónévként használva)</li>
                <li>Jelszó (titkosítva és hash-elve)</li>
                <li>Szerepkör és jogosultságok</li>
                <li>Tevékenységi naplók biztonsági és audit célokra</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">2.3 Google Calendar integráció</h3>
              <p>Ha úgy dönt, hogy összeköti a Google Calendar fiókját:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>OAuth tokenek (titkosítva és biztonságosan tárolva)</li>
                <li>Naptári eseményazonosítók az időpontok szinkronizálásához</li>
                <li>NEM férünk hozzá és NEM tároljuk a teljes naptári adatait</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Az Információk Használata</h2>
              <p>A gyűjtött információkat a következő célokra használjuk:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Betegnyilvántartás és orvosi időpontok kezelése</li>
                <li>Időpontok ütemezése és koordinálása az egészségügyi szakemberek között</li>
                <li>Időpontértesítések küldése emailben</li>
                <li>Időpontok szinkronizálása a Google Calendar-rel (ha engedélyezve)</li>
                <li>Biztonság fenntartása és jogosulatlan hozzáférés megelőzése</li>
                <li>Jogi és szabályozási követelmények betartása</li>
                <li>Rendszerfunkcionalitás és felhasználói élmény javítása</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Adatbiztonság</h2>
              <p>Iparági szabványnak megfelelő biztonsági intézkedéseket alkalmazunk az Ön adatainak védelme érdekében:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Minden adat titkosítva van átvitel közben HTTPS/TLS használatával</li>
                <li>Az OAuth tokenek titkosítva vannak tárolás közben AES-256-GCM titkosítással</li>
                <li>A jelszavak biztonságos hash algoritmusokkal vannak hash-elve</li>
                <li>A hozzáférés szerepkörök és jogosultságok alapján korlátozott</li>
                <li>Rendszeres biztonsági auditok és monitorozás</li>
                <li>Az adatbázis hozzáférés korlátozott és naplózott</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Adatok Megosztása és Közlése</h2>
              <p>Nem értékesítjük, nem cseréljük, és nem adjuk bérbe az Ön személyes adatait. Az információkat csak a következő esetekben osztjuk meg:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Egészségügyi szakemberek:</strong> A betegadatok elérhetők a betegellátásban részt vevő jogosított egészségügyi szakemberek számára</li>
                <li><strong>Jogi követelmények:</strong> Ha törvény, bírósági végzés vagy kormányzati szabályozás előírja</li>
                <li><strong>Szolgáltatók:</strong> Megbízható harmadik fél szolgáltatókkal, akik a rendszer működtetésében segítenek (pl. hosting, email szolgáltatások), szigorú titoktartási megállapodások mellett</li>
                <li><strong>Vészhelyzetek:</strong> A betegek vagy mások egészségének és biztonságának védelme érdekében</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Ön Jogai</h2>
              <p>Az Ön személyes adataival kapcsolatban a következő jogokkal rendelkezik:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Hozzáférés:</strong> Kérheti személyes adatainak hozzáférését</li>
                <li><strong>Helyesbítés:</strong> Kérheti pontatlan információk javítását</li>
                <li><strong>Törlés:</strong> Kérheti adatainak törlését (jogi megőrzési követelményeknek megfelelően)</li>
                <li><strong>Kifogás:</strong> Kifogást tehet bizonyos adatfeldolgozások ellen</li>
                <li><strong>Adathordozhatóság:</strong> Kérheti adatainak másolását hordozható formátumban</li>
                <li><strong>Hozzájárulás visszavonása:</strong> Bármikor visszavonhatja a Google Calendar integrációhoz adott hozzájárulását</li>
              </ul>
              <p className="mt-3">
                Jogai gyakorlásához kérjük, lépjen kapcsolatba velünk: <a href="mailto:janos.koenig@gmail.com" className="text-medical-primary hover:underline">janos.koenig@gmail.com</a>.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Adatok Megőrzése</h2>
              <p>
                A betegadatokat addig őrizzük meg, ameddig szükséges az egészségügyi szolgáltatások nyújtásához és a 
                jogi és szabályozási követelmények betartásához. Az orvosi nyilvántartásokat hosszabb ideig is megőrizhetjük, 
                ahogy azt a magyarországi egészségügyi szabályozások előírják.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Sütik és Követés</h2>
              <p>
                Munkamenet sütiket használunk a bejelentkezési munkamenet fenntartásához. Ezek a sütik elengedhetetlenek 
                a rendszer működéséhez, és törlődnek, amikor kijelentkezik. Nem használunk követő sütiket vagy harmadik 
                fél analitikai eszközöket, amelyek személyes információkat gyűjtenének.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Harmadik Fél Szolgáltatások</h2>
              <p>Rendszerünk a következő harmadik fél szolgáltatásokkal integrálódik:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Google Calendar API:</strong> Az időpontok szinkronizálásához (csak akkor, ha Ön kifejezetten engedélyezi ezt a funkciót)</li>
                <li><strong>Email szolgáltatások:</strong> Időpontértesítések küldéséhez</li>
              </ul>
              <p className="mt-3">
                Ezeknek a szolgáltatásoknak saját adatvédelmi irányelveik vannak. Javasoljuk, hogy tekintse át a Google 
                Adatvédelmi Irányelvét, ha a Google Calendar integrációt használja.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. Gyermekek Adatvédelme</h2>
              <p>
                Rendszerünk egészségügyi szakemberek általi használatra készült, és minden korosztály betegadatait tartalmazhatja, 
                beleértve a kiskorúakat is. Minden betegadatot az alkalmazandó egészségügyi adatvédelmi törvényeknek megfelelően kezelünk.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">11. Az Adatvédelmi Irányelv Módosításai</h2>
              <p>
                Időnként frissíthetjük ezt az Adatvédelmi Irányelvet. A felhasználókat értesítjük minden lényeges változásról 
                az új Adatvédelmi Irányelv ezen az oldalon való közzétételével és az "Utolsó frissítés" dátum frissítésével.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">12. Kapcsolatfelvétel</h2>
              <p>
                Ha bármilyen kérdése vagy észrevétele van ezzel az Adatvédelmi Irányelvvel vagy adatkezelési gyakorlatunkkal 
                kapcsolatban, kérjük, lépjen kapcsolatba velünk:
              </p>
              <p className="mt-2">
                <strong>Email:</strong> <a href="mailto:janos.koenig@gmail.com" className="text-medical-primary hover:underline">janos.koenig@gmail.com</a>
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

