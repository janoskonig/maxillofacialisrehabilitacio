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
                A kezelési terv részlépéssorozata a <strong>care_pathways.steps_json</strong>-ból származik (az epizódhoz rendelt kezelési út). Nem generikus stage→step mapping: a pathway determinálja a lépéseket. A stage_steps tábla megszűnt.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">1.3 Lefoglalom az első kezelési időpontot (pl. lenyomatvétel)</h3>
              <p>
                A Dashboard → Worklist fülön megjelenik a beteg, következő lépés: lenyomatvétel. Kattintasz „Következő lépés foglalása” → kiválasztod az időpontot → kész. A betegnek van egy jövőbeli work időpontja.
              </p>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">1.4 A beteg még ott van — következő időpontot szeretné egyeztetni</h3>
              <p>
                A beteg a rendelőben van, és szeretné a következő időpontot is (pl. próbabehelyezésre). <strong>Egy WIP betegnek egyszerre legfeljebb egy jövőbeli munkafázisú időpontja lehet.</strong> Tehát most nem foglalhatsz neki rögtön a próbabehelyezésre is — előbb le kell zajlania a lenyomatvételnek.
              </p>
              <p className="mt-2">
                <strong>Mit csinálj:</strong> A lenyomatvétel napján, amikor megcsináltátok, a rendszer frissül — a következő lépés (próbabehelyezés) lesz a worklisten. Akkor foglalhatod a következő időpontot. Ha azonban klinikai indok miatt már most kell mindkettőt lefoglalni, admin vagy sebészorvos <strong>override</strong>-tal megteheti (min. 10 karakteres indoklás, audit alatt).
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
                <li><strong>Worklist</strong> — következő lépést váró betegek listája. Innen foglalsz.</li>
                <li><strong>One-hard-next</strong> — egyszerre max 1 jövőbeli munkafázisú időpont / beteg (kivéve átadásnál: 2).</li>
                <li><strong>Override</strong> — admin/sebészorvos felülírja a szabályt, indoklás kötelező.</li>
                <li><strong>Blokk</strong> — pl. laborra várunk: addig nem foglalható következő lépés.</li>
              </ul>
            </section>

            {/* Gyakori kérdések */}
            <section>
              <h2 className="text-xl font-semibold text-gray-900 mt-6 mb-3">4. Gyakori kérdések</h2>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">Miért nem tudok foglalni?</h3>
              <ul className="list-disc pl-6 space-y-1">
                <li>Már van jövőbeli work időpont? (one-hard-next — várj a lezárásig, vagy override)</li>
                <li>Blokkolt az epizód? Előbb a blokkot kezelni kell.</li>
                <li>Nincs kezelési út? Először válassz pathway-t.</li>
              </ul>

              <h3 className="text-lg font-medium text-gray-800 mt-4 mb-2">A beteg a portálon miért nem lát work időpontot?</h3>
              <p>A work (lenyomatvétel, próba, átadás) slotokat csak a rendelő foglalja worklistből. A beteg consult vagy admin által kiosztott időpontot kap.</p>
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
