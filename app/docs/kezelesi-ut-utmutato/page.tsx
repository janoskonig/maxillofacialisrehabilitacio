import { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Kezelési út és ütemezés — Használati útmutató',
  description: 'Gyakorlati útmutató a kezelési utak és az ütemezés használatához',
};

export default function KezelesiUtUtmutatoPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-lg shadow-sm p-8">
          <div className="mb-6">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-medical-primary hover:underline text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Vissza a főoldalra
            </Link>
          </div>

          <div className="mb-8 flex items-start gap-4">
            <div className="p-3 bg-medical-primary/10 rounded-lg">
              <BookOpen className="w-8 h-8 text-medical-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Kezelési út és ütemezés — Használati útmutató
              </h1>
              <p className="text-sm text-gray-600 mt-1">
                Utolsó frissítés: {new Date().toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          <div className="prose prose-sm max-w-none text-gray-700 space-y-8">
            {/* Gyakorlati folyamat — fő szekció */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Gyakorlati folyamat</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">1.1 Új beteg jelentkezik</h3>
              <p>
                A beteg regisztrál — az első konzultációra vár. A stádiuma ennek megfelelő (pl. „Első vizsgálatra vár”).
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">1.2 Vizsgálat után: kezelési terv</h3>
              <p>
                Megtörténik a vizsgálat. Utána készül a kezelési terv. A kezelési tervhez tartozik egy <strong>séma</strong> (kezelési út): pl. lenyomatvétel → próbabehelyezés → átadás → kontrollok. Ezt választod ki a rendszerben (care pathway).
              </p>
              <p className="mt-2">
                A kezelési terv <strong>munkafázis</strong>-sorozata a <strong>care_pathways.work_phases_json</strong> sémájából származik (az epizódhoz rendelt kezelési út); a régi <code>steps_json</code> csak visszafelé kompatibilitásra maradt. Nem generikus stage→step leképezés: a pathway determinálja a munkafázisokat. A stage_steps tábla megszűnt.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">1.3 Lefoglalom az első kezelési időpontot (pl. lenyomatvétel)</h3>
              <p>
                A Dashboard → Worklist fülön megjelenik a beteg, következő munkafázis: lenyomatvétel. Kattintasz „Következő lépés foglalása” (gombfelirat) → kiválasztod az időpontot → kész. A betegnek van egy jövőbeli work időpontja.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">1.4 A beteg még ott van — következő időpontot szeretné egyeztetni</h3>
              <p>
                A beteg a rendelőben van, és szeretné a következő időpontot is (pl. próbabehelyezésre). <strong>Egy aktív kezelésben lévő betegnek egyszerre legfeljebb egy jövőbeli munkafázisú időpontja lehet.</strong> Tehát most nem foglalhatsz neki rögtön a próbabehelyezésre is — előbb le kell zajlania a lenyomatvételnek.
              </p>
              <p className="mt-2">
                <strong>Mit csinálj:</strong> A lenyomatvétel napján, amikor megcsináltátok, a rendszer frissül — a következő munkafázis (próbabehelyezés) lesz a worklisten. Akkor foglalhatod a következő időpontot. Ha azonban klinikai indok miatt már most kell mindkettőt lefoglalni, admin vagy beutaló orvos <strong>override</strong>-tal megteheti (min. 10 karakteres indoklás, audit alatt).
              </p>
            </section>

            {/* Rendszercél */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Rendszercél</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
                <p className="text-lg font-medium text-amber-900 italic">
                  „Új beteget csak akkor fogadjunk, ha már el is tudjuk őket látni; a kezelendők ne szoruljanak ki.”
                </p>
              </div>
              <p>
                A work pool (lenyomatvétel, próba, átadás) időpontjait csak a worklistből vagy override-tal foglalhatod. A beteg a portálon nem foglalhat közvetlenül ilyen slotot — így nem szorul ki a már felvett betegek ellátása.
              </p>
            </section>

            {/* Rövid fogalmak */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Rövid fogalomtár</h2>
              <ul className="space-y-2">
                <li><strong>Worklist</strong> — következő munkafázist váró betegek listája. Innen foglalsz.</li>
                <li><strong>One-hard-next</strong> — opcionális szabály (feature flag: <code>enforce_one_hard_next</code>): bekapcsolva max 1 jövőbeli munkafázisú időpont / epizód (kivéve átadásnál: 2). Alapból kikapcsolva.</li>
                <li><strong>Override</strong> — admin/beutaló orvos felülírja a szabályt, indoklás kötelező.</li>
                <li><strong>Blokk</strong> — pl. laborra várunk: addig nem foglalható a következő munkafázis.</li>
              </ul>
            </section>

            {/* Gyakori kérdések */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Gyakori kérdések</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Miért nem tudok foglalni?</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Már van jövőbeli work időpont? (csak ha <code>enforce_one_hard_next</code> flag be van kapcsolva — alapból nincs)</li>
                <li>Blokkolt az epizód? Előbb a blokkot kezelni kell.</li>
                <li>Nincs kezelési út? Először válassz pathway-t.</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">A beteg a portálon miért nem lát work időpontot?</h3>
              <p>A work (lenyomatvétel, próba, átadás) slotokat csak a rendelő foglalja worklistből. A beteg consult vagy admin által kiosztott időpontot kap.</p>
            </section>

            {/* Időpont-rendszer */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Időpont-rendszer (Slot-ok)</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Mi az a slot?</h3>
              <p>
                Egy slot egy szabad időablak, amelyre beteg foglalhat vagy a rendelő foglalhat számára. A slotokat kétféleképp lehet létrehozni:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>Manuális kiírás:</strong> az Időpontkezelés oldalon az „Új időpont" gombbal.</li>
                <li><strong>Google Naptár szinkron:</strong> ha a Beállítások oldalon be van kapcsolva, a Google Naptárból „szabad" nevű eseményeket importálja a rendszer automatikusan.</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Slot célok (slot_purpose)</h3>
              <p>Minden slotnak lehet célja, amely meghatározza, milyen típusú foglalásra használható:</p>
              <div className="overflow-x-auto mt-2">
                <table className="min-w-full text-sm border border-gray-200 rounded-lg">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium text-gray-700 border-b">Cél</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700 border-b">Jelentés</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-700 border-b">Ki foglalhat?</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    <tr>
                      <td className="px-4 py-2"><span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">consult</span></td>
                      <td className="px-4 py-2">Első konzultáció</td>
                      <td className="px-4 py-2">Beteg portálról + rendelő</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2"><span className="px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800">work</span></td>
                      <td className="px-4 py-2">Munkafázis (lenyomat, próba, átadás)</td>
                      <td className="px-4 py-2">Csak rendelő (worklist)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2"><span className="px-2 py-0.5 text-xs font-medium rounded-full bg-teal-100 text-teal-800">control</span></td>
                      <td className="px-4 py-2">Kontroll vizsgálat</td>
                      <td className="px-4 py-2">Rendelő + recall rendszer</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2"><span className="px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-100 text-yellow-800">flexible</span></td>
                      <td className="px-4 py-2">Rugalmas — bármelyik pool számára</td>
                      <td className="px-4 py-2">Bárki (beteg portál is)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2"><span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-500">(nincs)</span></td>
                      <td className="px-4 py-2">Nem címkézett</td>
                      <td className="px-4 py-2">Ugyanúgy kezelődik mint flexible</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Puha szűrés</h3>
              <p>
                A <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">flexible</code> (rugalmas) és a <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">NULL</code> (nem címkézett) slotok mindenhol bármire foglalhatók: konzultációra, munkafázisra és kontrollra is. A Google naptárból importált slotok rugalmasnak számítanak; egyelőre a slotok irányultságát a rendszer nem szigorúan használja.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Páciens portál korlátozás</h3>
              <p>
                A beteg a páciens portálon csak azokat a szabad slotokat látja, amelyek célja <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">consult</code> vagy <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">flexible</code>. A <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">work</code> és <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">control</code> slotok nem jelennek meg — ezeket a rendelő foglalja.
              </p>
            </section>

            {/* Kapacitás-kezelés */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Kapacitás-kezelés</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Éjszakai rebalance</h3>
              <p>
                Minden éjszaka lefut egy automatikus folyamat, amely a <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">flexible</code> (vagy nem címkézett) szabad slotokat átcímkézi, ha a heti kvóták alapján hiányzó slotok vannak. Például ha a heti cél 20 work slot, de csak 15 van címkézve, a rebalance 5 flexible slotot átcímkéz work-re.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">capacity_pool_config</h3>
              <p>A heti kvótákat a <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">capacity_pool_config</code> tábla tárolja. Mezők:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>consult_min:</strong> minimum konzultációs slotok száma (pl. 2)</li>
                <li><strong>consult_target:</strong> cél konzultációs slotok száma, ha van várakozó (pl. 4)</li>
                <li><strong>work_target:</strong> munkafázis cél (pl. 20)</li>
                <li><strong>control_target:</strong> kontroll cél (pl. 6)</li>
                <li><strong>flex_target:</strong> rugalmas cél (pl. 0 — ami nem lett átcímkézve, az marad flexible)</li>
              </ul>
              <p className="mt-2">
                Ezeket az Időpontkezelés oldalon a „Kapacitás kvóták" szekció alatt lehet szerkeszteni (admin jogosultsággal).
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">24 órás freeze horizon</h3>
              <p>
                A rebalance <strong>nem nyúl a következő 24 órán belüli slotokhoz</strong>. Ezzel elkerüljük, hogy közvetlenül a rendelés előtt átcímkéződjön egy már egyeztetett időpont.
              </p>
            </section>

            {/* Előrejelzés */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Előrejelzés (Forecast)</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">ETA becslés</h3>
              <p>
                A rendszer minden aktív kezelési epizódhoz becsli a kezelés várható befejezésének dátumát. Két értéket ad:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>P50:</strong> 50%-os valószínűségű becslés (medián)</li>
                <li><strong>P80:</strong> 80%-os valószínűségű becslés (konzervatív)</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Három bemenet-forgatókönyv</h3>
              <p>Az ETA számítás három lehetséges adatforrásból származik, prioritás szerint:</p>
              <ol className="list-decimal pl-6 space-y-1 mt-2">
                <li><strong>Analytics (történeti):</strong> korábbi hasonló kezelések tényleges időtartamaiból számol.</li>
                <li><strong>Pathway munkafázisok:</strong> a kezelési út (care pathway) munkafázisainak becsült időtartamából.</li>
                <li><strong>Fallback:</strong> ha nincs elég adat, fix alapértelmezett értékeket használ.</li>
              </ol>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
                <p className="text-sm text-amber-900">
                  <strong>Fontos:</strong> az ETA nem veszi figyelembe a szabad slotok hiányát — „ideális kadencia" alapú becslés. Ha nincs elég szabad időpont, a tényleges befejezés később lesz.
                </p>
              </div>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">BLOCKED_CAPACITY jelzés</h3>
              <p>
                Ha a kezelési terv szerinti időablakban (a következő lépésre megadott legkorábbi–legkésőbbi időszakban) nincs szabad <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">work</code> slot, a rendszer <strong>BLOCKED_CAPACITY</strong> jelzést ad. Ez figyelmeztet, hogy a beteg kezelése akadályozott — további szabad időpontok kiírása szükséges.
              </p>
            </section>

            {/* Főoldal — Teendőim */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. Főoldal — „Teendőim" panel</h2>
              <p>
                A főoldal nem egy tabos áttekintő widget, hanem egy <strong>teendő-központú panel</strong>: csak a napi, ténylegesen elvégzendő dolgokat mutatja, üres kártyák nélkül.
              </p>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Mit látsz itt</h3>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>Jóváhagyásra váró időpontok</strong> és <strong>mai időpontok</strong> — csak akkor jelennek meg, ha van ilyen.</li>
                <li><strong>Gyors belépő chipek</strong> a nyitott feladatokhoz (<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">/tasks</code>) és az olvasatlan üzenetekhez (<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">/messages</code>). Sürgősség szerint színezve: nem látott feladat, illetve olvasatlan beteg-üzenet → pirossal. Nullánál a chip nem jelenik meg.</li>
                <li>Ha nincs teendő → tiszta <strong>„Nincs sürgős teendőd"</strong> állapot.</li>
              </ul>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">A nehéz nézetek külön oldalra kerültek</h3>
              <p>A korábbi főoldali tabokat (GANTT, terhelés, pipeline) a bal oldali navigációból éred el:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>Beteg előkészítés</strong> — <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">/patients/pipeline</code></li>
                <li><strong>Stádium GANTT</strong> — <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">/patients/stages/gantt</code></li>
                <li><strong>Orvos terhelés</strong> — <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">/workload</code></li>
              </ul>
            </section>

            {/* Kezelőorvos és delegált betegek */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">9. Kezelőorvos és delegált betegek</h2>
              <p>
                Minden betegnek <strong>egyetlen kezelőorvosa</strong> lehet — egyetlen forrás (<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">patients.kezeleoorvos_user_id</code>), kézi, „ragadós" hozzárendeléssel. Így minden delegált beteg számon kérhető egy konkrét orvoson.
              </p>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Hozzárendelés</h3>
              <p>
                A beteg-űrlapon a <strong>kezelőorvos</strong> mezőből választasz (a dropdown az ismert fogpótlástanász/admin orvosokat listázza, a név alapján oldódik fel). Amint kézzel beállítottad, az éjszakai automatikus újraszámolás (recompute) <strong>nem írja felül</strong> — szemben a régi, automatikusan seedelt értékkel. Ha üresre állítod, a hozzárendelés törlődik, és a recompute újra seedelhet.
              </p>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Delegált betegek munkalista</h3>
              <p>
                A <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">/tasks/overview</code> oldalon a <strong>„Delegált betegek"</strong> fülön orvosonként látszik, hol tart minden delegált beteg:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>Fogpótlástanász</strong>: csak a saját delegált betegeit látja.</li>
                <li><strong>Admin</strong>: minden orvos betegeit, orvosonként csoportosítva.</li>
                <li>Oszlopok: nyitott epizód, következő időpont, utolsó találkozás, delegálva (mikor / ki által).</li>
                <li><strong>„Elakadt" jelzés</strong> (sárga sor): van nyitott epizód, de <strong>nincs jövőbeli időpont</strong> — ezzel a beteggel tenni kell valamit.</li>
              </ul>
            </section>

            {/* Beleegyezések és adatkezelési nyilatkozatok */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">10. Beleegyezések és adatkezelési nyilatkozatok</h2>
              <p>Két, jogilag <strong>külön</strong> dolgot kezelünk — ne keverd össze őket:</p>
              <ol className="list-decimal pl-6 space-y-2 mt-2">
                <li>
                  <strong>Adatvédelmi tájékoztató tudomásulvétele</strong> — a GDPR 13. cikk szerinti <em>tájékoztatási kötelezettség</em>, <strong>nem</strong> beleegyezés. A beteg az aktuális tájékoztató-verziót nyugtázza (jelenleg <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">1.1</code>). A verzió emelésekor a rendszer mindenkit újra megkér a nyugtázásra.
                </li>
                <li>
                  <strong>Kutatási hozzájárulás</strong> (<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">consent_status</code>) — valódi GDPR 9. cikk (2) a) szerinti beleegyezés. <em>Eldöntöttnek</em> számít: granted / declined / withdrawn / expired. <em>Még nyitott</em>: unknown / pending.
                </li>
              </ol>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Emlékeztetők</h3>
              <p>
                Regisztrációkor egyszeri felkérés megy ki. Ezután egy <strong>napi cron</strong> újraküldi a felkérést mindenkinek, akinek még van nyitott nyilatkozata (tájékoztató-nyugtázás és/vagy kutatási döntés), kb. <strong>20 órás cooldownnal</strong> (így legfeljebb naponta egyszer).
              </p>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Kiskorúak / cselekvőképesség</h3>
              <p>
                <strong>18 év alatt</strong> törvényes képviselő (gondviselő) nyilatkozik a beteg helyett.
              </p>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
                <p className="text-sm text-amber-900">
                  <strong>Nyitott jogi kérdés:</strong> a kiadott tájékoztató jelenleg 16 évet említ, a magyar cselekvőképesség viszont általában 18 év. A korhatár egyetlen konstans (<code className="bg-amber-100 px-1 py-0.5 rounded text-xs">GUARDIAN_REQUIRED_BELOW_AGE</code>), amelyet a DPO/jogász egyeztetése után kell véglegesíteni.
                </p>
              </div>
              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Kutatási export — etikai kapu</h3>
              <p>Kutatási (kohorsz) export csak akkor indítható, ha <strong>mindkettő</strong> teljesül:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li>érvényes <strong>kutatásetikai engedély (ETT TUKEB)</strong> van rögzítve (<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">ethics_approvals</code> tábla), és</li>
                <li>a <code className="bg-gray-100 px-1 py-0.5 rounded text-xs">RESEARCH_EXPORT_MODE</code> engedélyezett.</li>
              </ul>
              <p className="mt-2">
                Enélkül a kutatási export tiltott — a <strong>klinikai statisztika CSV</strong> viszont továbbra is elérhető. Az export csak a kutatásra ténylegesen felhasználható (granted, nem visszavont) betegeket viszi.
              </p>
            </section>
          </div>

          <div className="mt-12 pt-6 border-t border-gray-200">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-medical-primary hover:underline text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Vissza a főoldalra
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
