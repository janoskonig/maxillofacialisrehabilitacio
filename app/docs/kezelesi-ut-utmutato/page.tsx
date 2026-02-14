import { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ArrowLeft } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Kezelési út és ütemezés — Használati útmutató',
  description: 'Részletes útmutató a kezelési utak, a governance réteg és az ütemezési szabályok használatához',
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
            {/* Rendszercél */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">1. Rendszercél</h2>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 my-4">
                <p className="text-lg font-medium text-amber-900 italic">
                  „Új beteget csak akkor fogadjunk, ha már el is tudjuk őket látni; a kezelendők ne szoruljanak ki.”
                </p>
              </div>
              <p>
                A rendszer célja, hogy a már felvett betegek ellátása ne szoruljon ki az új betegek miatt.
                Ehhez három fő mechanizmus szükséges: <strong>előzetes ütemezés</strong>, <strong>pool-védelem</strong> és <strong>kapacitás-invariáns</strong>.
              </p>
            </section>

            {/* Fogalmak */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">2. Fogalmak szótára</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.1 Epizód (patient episode)</h3>
              <p>
                Egy beteg egy adott kezelési útjának nyitott folyamata. Minden epizódhoz tartozik egy beteg, egy kezelési út sablon és opcionálisan egy felelős orvos.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.2 WIP (Work In Progress)</h3>
              <p>
                A folyamatban lévő epizódok — azok, amelyek még nem zártak le. A worklist a WIP epizódok következő lépéseit mutatja.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.3 Kezelési út (care pathway)</h3>
              <p>
                Sablon, amely meghatározza a kezelés lépéseit: konzultáció → diagnosztika → impresszió → próbabehelyezés → átadás → kontrollok. Minden lépéshez tartozik:
              </p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>step_code</strong>: lépés azonosító (pl. consult_1, impression_1, delivery)</li>
                <li><strong>pool</strong>: consult / work / control</li>
                <li><strong>duration_minutes</strong>: várható időtartam</li>
                <li><strong>default_days_offset</strong>: az előző lépés után hány nappal jön ez</li>
                <li><strong>requires_precommit</strong>: speciális lépés (pl. átadás), ahol 2 jövőbeli work időpont megengedett</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.4 Kezeléstípus (treatment type)</h3>
              <p>
                A kezelési utak két dimenzió szerint osztályozhatók: <strong>reason</strong> (etiológia: traumás, veleszületett, onkológiai) és <strong>treatment_type</strong> (protetikai workflow: zárólemez, részleges akrilát, teljes lemez stb.). Minden pathway-nak pontosan az egyik kell legyen megadva.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.5 Pool (kapacitás típus)</h3>
              <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden my-3">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Pool</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Jelentés</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Példa</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2 font-medium">consult</td><td>Konzultáció</td><td>Első vizsgálat, felajánlás</td></tr>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2 font-medium">work</td><td>Munkafázis</td><td>Impresszió, próbabehelyezés, átadás</td></tr>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2 font-medium">control</td><td>Kontroll</td><td>6 hónapos, 12 hónapos ellenőrzés</td></tr>
                </tbody>
              </table>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.6 One-hard-next (egy-kemény-következő)</h3>
              <p>
                <strong>Szabály:</strong> Egy WIP epizódnak legfeljebb <strong>egy</strong> jövőbeli work pool időpontja lehet egyszerre. Kivétel: requires_precommit lépéseknél (pl. átadás) legfeljebb 2 jövőbeli work időpont engedélyezett. Ha mégis kell egy második foglalás → override szükséges (admin/sebészorvos, min. 10 karakteres indoklás).
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.7 Slot intent (időpont szándék)</h3>
              <p>
                „Lágy” tervezés — még nem foglalt időpont, de már van szándék rá. Az epizód aktiválásakor a rendszer automatikusan létrehozza a következő 2 work lépéshez az intenteket. Később át lehet alakítani valódi foglalássá.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.8 Episode block (epizód blokk)</h3>
              <p>
                Klinikai blokkoló, ami megakadályozza a következő lépés foglalását. Típusok: WAIT_LAB, WAIT_HEALING, WAIT_SURGERY, PATIENT_DELAY, WAIT_OR, WAIT_IMPLANT, OTHER. A blokkok megújíthatók; ha a megújítások száma &gt; 2, a rendszer figyelmeztet.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">2.9 BLOCKED_CAPACITY</h3>
              <p>
                Ha nincs elérhető work slot a következő lépés SLA-ablakában, az epizód <strong>blocked</strong> státuszba kerül, ok: „Nincs szabad work időpont az SLA ablakban”. Ebben az esetben rebalance vagy override szükséges.
              </p>
            </section>

            {/* Governance réteg */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">3. Governance réteg (rendszerszabályok)</h2>
              <p>
                A kezelési út önmagában csak lépéssorrendet és javasolt offseteket ad. A rendszercélhoz a governance réteg szükséges:
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">3.1 Pre-scheduling (előzetes ütemezés)</h3>
              <p>
                Az epizód aktiválásakor (care_pathway_id + assigned_provider_id beállításakor) a rendszer automatikusan létrehozza a következő 2 work lépéshez a slot_intent-et. Ez biztosítja, hogy a worklist „Következő lépés foglalása” gomb prioritást kapjon.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">3.2 Pool-védelem</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li><strong>Work pool:</strong> Csak worklistből vagy admin/sebészorvos override-tal foglalható. Epizód nélküli work foglalás tiltott (kivéve override).</li>
                <li><strong>Patient portál:</strong> A beteg közvetlenül nem foglalhat work vagy control pool slotot. Csak consult vagy admin által kiosztott időpont.</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">3.3 Kapacitás-invariáns</h3>
              <p>
                Ha nincs szabad work slot az SLA ablakban, az epizód BLOCKED_CAPACITY státuszba kerül. A UI jelzi: „Nincs kapacitás, rebalance vagy override”.
              </p>
            </section>

            {/* Munkafolyamat */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Munkafolyamat</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">4.1 Normál foglalás a worklistből</h3>
              <ol className="list-decimal pl-6 space-y-2">
                <li>Nyissa meg a Worklist widgetet (dashboard, Worklist fül).</li>
                <li>A lista a következő lépést váró epizódokat mutatja, prioritás szerint (overdue előrébb).</li>
                <li>Kattintson a „Következő lépés foglalása” gombra a kívánt sorhoz.</li>
                <li>Válassza ki az időpontot a SlotPicker-ben.</li>
                <li>A rendszer ellenőrzi: szabad-e az időpont, one-hard-next, no-show kockázat.</li>
                <li>Sikeres foglalás után a sor eltűnik a worklistből.</li>
              </ol>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">4.2 Epizód aktiválása</h3>
              <p>
                Új epizód esetén először válasszon kezelési utat (care pathway) és felelős orvost. Ekkor a rendszer automatikusan létrehozza a slot_intent-eket a következő 2 work lépéshez. Ha nincs pathway hozzárendelve, a worklist 409 hibát ad: „Epizódhoz nincs hozzárendelve kezelési út. Először válasszon pathway-t.”
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">4.3 Override (felülírás)</h3>
              <p>
                Ha a one-hard-next tiltja a foglalást, de klinikai indok van: admin vagy sebészorvos megadhat <strong>overrideReason</strong>-t (min. 10 karakter). A foglalás audit alatt létrejön (scheduling_override_audit). Ritkán használandó.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">4.4 Blokkolt epizód</h3>
              <p>
                Ha az epizódnak van aktív episode block-ja (pl. WAIT_LAB), a worklist blocked státuszt mutat. A következő lépés csak a blokk lejárta vagy feloldása után foglalható.
              </p>
            </section>

            {/* Engedélyezett műveletek */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">5. Engedélyezett ütemezési műveletek</h2>
              <p>A rendszer csak 3 típusú ütemezési műveletet tekinti „normál”-nak:</p>
              <ul className="list-disc pl-6 space-y-1 mt-2">
                <li><strong>Konzultáció / ellenőrzés felajánlása</strong> — patient-facing, consult vagy control pool</li>
                <li><strong>Következő munkafázis foglalása (worklist)</strong> — work pool, created_via: worklist</li>
                <li><strong>Override</strong> — auditált, admin vagy sebészorvos, overrideReason kötelező</li>
              </ul>
            </section>

            {/* Időzítési javaslatok */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">6. Időzítési javaslatok (default_days_offset)</h2>
              <table className="min-w-full border border-gray-200 rounded-lg overflow-hidden my-3">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Típus</th>
                    <th className="px-4 py-2 text-left text-sm font-medium text-gray-700">Javasolt offset</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2">Work technikai fázis</td><td>7–10 nap</td></tr>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2">Fogpróba után</td><td>7 nap</td></tr>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2">Átadás után kontroll 1</td><td>7 nap</td></tr>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2">Kontroll 2</td><td>30 nap</td></tr>
                  <tr className="border-t border-gray-200"><td className="px-4 py-2">Kontroll 3</td><td>180 nap</td></tr>
                </tbody>
              </table>
            </section>

            {/* Gyakori kérdések */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">7. Gyakori kérdések</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Miért nem tudok foglalni?</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Van-e már jövőbeli work időpont az epizódhoz? (one-hard-next)</li>
                <li>Blokkolt-e az epizód? Előbb a blokkot kell kezelni.</li>
                <li>Override szükséges? Admin/sebészorvos, overrideReason min. 10 karakter.</li>
                <li>Nincs kezelési út? Először válasszon pathway-t az epizódhoz.</li>
                <li>BLOCKED_CAPACITY? Nincs szabad work slot — rebalance vagy override.</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Mikor kell override?</h3>
              <p>Ha a one-hard-next tiltja, de klinikai indok van a második foglalásra. Mindig audit alatt, ritkán használandó.</p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Mi a requires_precommit?</h3>
              <p>Speciális lépések (pl. átadás), ahol 2 jövőbeli work időpont megengedett (mindkettő precommit típusú).</p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Miért nem foglalhat a beteg work időpontot?</h3>
              <p>A pool-védelem miatt a patient portál nem enged work vagy control pool slotot közvetlen foglalásra. Csak consult vagy admin által kiosztott időpont.</p>
            </section>

            {/* Kapcsolódó */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">8. További információk</h2>
              <p>
                A treatment scheduling részletesebb technikai leírása a projekt <code className="bg-gray-100 px-1 rounded">docs/</code> mappájában található: <code className="bg-gray-100 px-1 rounded">TREATMENT_SCHEDULING_HASZNALATI_UTASITAS.md</code>, <code className="bg-gray-100 px-1 rounded">SCHEDULING_MOVES.md</code>.
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
