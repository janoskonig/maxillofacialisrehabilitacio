import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Felhasználási Feltételek - Maxillofacialis Rehabilitációs Rendszer',
  description: 'Felhasználási feltételek a Maxillofacialis Rehabilitációs Rendszerhez',
};

export default function TermsOfServiceHu() {
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
            <h1 className="text-3xl font-bold text-gray-900">Felhasználási Feltételek</h1>
            <Link 
              href="/terms" 
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
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Feltételek Elfogadása</h2>
              <p>
                A Maxillofacialis Rehabilitációs Rendszer ("Szolgáltatás") elérésével és használatával Ön elfogadja és 
                kötelezettséget vállal arra, hogy betartja ezen megállapodás feltételeit és rendelkezéseit. Ha nem ért egyet 
                a fentiekben foglaltakkal, kérjük, ne használja ezt a szolgáltatást.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Szolgáltatás Leírása</h2>
              <p>
                A Maxillofacialis Rehabilitációs Rendszer egy orvosi időpontfoglalási és betegadat-kezelő rendszer, amelyet 
                a maxillofaciális rehabilitációban specializálódott egészségügyi szakemberek számára terveztek. A Szolgáltatás 
                lehetővé teszi:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Betegnyilvántartás kezelését</li>
                <li>Időpontok ütemezését az egészségügyi szakemberek között</li>
                <li>Időpontkezelést a fogpótlástanászok számára</li>
                <li>Google Calendar integrációt (opcionális)</li>
                <li>Email értesítéseket az időpontokról</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Felhasználói Fiókok és Felelősségek</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">3.1 Fiók Létrehozása</h3>
              <p>
                A Szolgáltatás használatához érvényes email címmel fiókot kell létrehoznia. Ön felelős a fiókja 
                hitelesítő adatainak titoktartásáért.
              </p>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">3.2 Felhasználói Szerepkörök</h3>
              <p>A Szolgáltatás különböző felhasználói szerepköröket támogat eltérő jogosultságokkal:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Admin:</strong> Teljes rendszer hozzáférés és felhasználókezelés</li>
                <li><strong>Sebészorvos:</strong> Időpontokat foglalhat betegeknek</li>
                <li><strong>Fogpótlástanász:</strong> Időpontokat kezelhet és megtekintheti az időpontokat</li>
                <li><strong>Technikus:</strong> Korlátozott hozzáférés műszaki műveletekhez</li>
                <li><strong>Szerkesztő:</strong> Létrehozhat és szerkeszthet betegadatokat</li>
                <li><strong>Megtekintő:</strong> Csak olvasási hozzáférés a betegadatokhoz</li>
              </ul>

              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">3.3 Felhasználói Felelősségek</h3>
              <p>Ön vállalja, hogy:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Pontos és teljes információkat ad meg fiókja létrehozásakor</li>
                <li>Fenntartja és szükség szerint frissíti fiókja információit</li>
                <li>Biztonságban tartja és titokban tartja jelszavát</li>
                <li>Azonnal értesít minket fiókja jogosulatlan használatáról</li>
                <li>Csak törvényes célokra és ezen Feltételeknek megfelelően használja a Szolgáltatást</li>
                <li>Betartja az összes alkalmazandó egészségügyi szabályozást és adatvédelmi törvényt</li>
                <li>Fenntartja a betegtitoktartást és az adatbiztonságot</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Orvosi Információk és Adatvédelmi Megfelelőség</h2>
              <p>
                A Szolgáltatás érzékeny orvosi információkat kezel. A felhasználók felelősek:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Az alkalmazandó egészségügyi adatvédelmi törvények betartásáért (beleértve az Európában érvényes GDPR-t és a vonatkozó magyar szabályozásokat)</li>
                <li>A betegtitoktartás fenntartásáért</li>
                <li>Hogy a Szolgáltatást csak törvényes egészségügyi célokra használják</li>
                <li>A szükséges beteg hozzájárulások megszerzéséért, ahol szükséges</li>
                <li>Bármilyen adatsértés vagy biztonsági incidens azonnali jelentéséért</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Tiltott Használat</h2>
              <p>A Szolgáltatást nem használhatja:</p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Bármilyen törvénytelen célra vagy mások felkérésére törvénytelen cselekmények elvégzésére</li>
                <li>Nemzetközi, szövetségi, tartományi vagy állami szabályozások, szabályok, törvények vagy helyi rendeletek megsértésére</li>
                <li>Szellemi tulajdonjogaink vagy mások szellemi tulajdonjogainak megsértésére</li>
                <li>Zaklatásra, bántalmazásra, sértésre, rágalmazásra, becsületsértésre, megfélemlítésre vagy diszkriminációra</li>
                <li>Hamis vagy félrevezető információk beküldésére</li>
                <li>Vírusok vagy bármilyen más kártékony kód feltöltésére vagy továbbítására</li>
                <li>Mások személyes adatainak gyűjtésére vagy követésére</li>
                <li>Spam, phishing, pharming, pretexting, spider, crawl vagy scrape műveletekre</li>
                <li>Bármilyen obszcén vagy erkölcstelen célra</li>
                <li>A Szolgáltatás biztonsági funkcióinak megkerülésére vagy zavarására</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Harmadik Fél Integrációk</h2>
              
              <h3 className="text-lg font-semibold text-gray-800 mt-4 mb-2">6.1 Google Calendar</h3>
              <p>
                A Szolgáltatás opcionális integrációt kínál a Google Calendar-rel. E funkció engedélyezésével:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Ön engedélyezi a Szolgáltatásnak, hogy hozzáférjen a Google Calendar-jához események létrehozásához, frissítéséhez és törléséhez</li>
                <li>Megérti, hogy az időpontok ütemezésekor automatikusan létrejönnek naptári események</li>
                <li>Bármikor megszüntetheti az integrációt a fiókbeállításokon keresztül</li>
                <li>Elfogadja a Google Felhasználási Feltételeit és Adatvédelmi Irányelvét</li>
              </ul>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Szolgáltatás Elérhetősége</h2>
              <p>
                Törekszünk a Szolgáltatás folyamatos elérhetőségének biztosítására, de nem garantáljuk, hogy a Szolgáltatás 
                mindig elérhető lesz. A Szolgáltatás a következő okok miatt lehet elérhetetlen:
              </p>
              <ul className="list-disc pl-6 space-y-1">
                <li>Ütemezett karbantartás</li>
                <li>Nem ütemezett karbantartás vagy javítás</li>
                <li>Technikai hibák</li>
                <li>Ellenőrzésünkön kívüli körülmények</li>
              </ul>
              <p className="mt-3">
                Nem vállalunk felelősséget a Szolgáltatás elérhetetlenségéből eredő veszteségekért vagy károkért.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Szellemi Tulajdon</h2>
              <p>
                A Szolgáltatás és eredeti tartalma, funkciói és működése a Maxillofacialis Rehabilitációs Rendszer tulajdona, 
                és nemzetközi szerzői jogi, védjegyjogi, szabadalmi, üzleti titok és egyéb szellemi tulajdonjogi törvények 
                védik.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Felelősség Korlátozása</h2>
              <p>
                A törvény által megengedett maximális mértékig a Maxillofacialis Rehabilitációs Rendszer nem vállal felelősséget 
                közvetett, véletlen, különleges, következményes vagy büntető károkért, vagy bármilyen nyereség vagy bevétel 
                elvesztéséért, akár közvetlenül, akár közvetve keletkezett, vagy bármilyen adat, használat, jóindulat vagy egyéb 
                immateriális veszteségért, amely a Szolgáltatás használatából ered.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. Kártérítés</h2>
              <p>
                Ön vállalja, hogy megvédi, kártalanítja és mentesíti a Maxillofacialis Rehabilitációs Rendszert és tisztviselőit, 
                igazgatóit, alkalmazottait és ügynökeit minden követelés, kötelezettség, kár, veszteség és költség, beleértve 
                az ésszerű jogi és számviteli díjakat, tekintet nélkül, amelyek a Szolgáltatáshoz való hozzáféréséből vagy 
                használatából, vagy ezen Feltételek megsértéséből erednek.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">11. Felmondás</h2>
              <p>
                Bármikor, előzetes értesítés vagy felelősségvállalás nélkül megszüntethetjük vagy felfüggeszthetjük fiókját 
                és a Szolgáltatáshoz való hozzáférését bármilyen okból, beleértve, ha Ön megsérti ezeket a Feltételeket. 
                A felmondás esetén a Szolgáltatás használati jogának azonnal megszűnik.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">12. Feltételek Módosítása</h2>
              <p>
                Fenntartjuk a jogot ezen Feltételek bármikori módosítására. A felhasználókat értesítjük minden lényeges 
                változásról az új Feltételek ezen az oldalon való közzétételével és az "Utolsó frissítés" dátum frissítésével. 
                A Szolgáltatás további használata az ilyen változások után az új Feltételek elfogadását jelenti.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">13. Irányadó Jog</h2>
              <p>
                Ezeket a Feltételeket a magyar törvények szerint kell értelmezni és alkalmazni, a jogütközési rendelkezésektől 
                függetlenül.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">14. Kapcsolattartási Információk</h2>
              <p>
                Ha bármilyen kérdése van ezekkel a Felhasználási Feltételekkel kapcsolatban, kérjük, lépjen kapcsolatba velünk:
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

