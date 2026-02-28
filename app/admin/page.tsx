'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/auth';
import { Settings, ListOrdered } from 'lucide-react';
import { CarePathwaysEditor } from '@/components/admin/CarePathwaysEditor';
import { StageCatalogEditor } from '@/components/admin/StageCatalogEditor';
import { StepCatalogEditor } from '@/components/admin/StepCatalogEditor';
import { TreatmentTypesEditor } from '@/components/admin/TreatmentTypesEditor';
import { ToothTreatmentCatalogEditor } from '@/components/admin/ToothTreatmentCatalogEditor';
import { Logo } from '@/components/Logo';
import { UserManagementTab } from './_components/UserManagementTab';

export default function AdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adminTab, setAdminTab] = useState<'felhasznalok' | 'folyamatok'>('felhasznalok');
  const [editPathwayId, setEditPathwayId] = useState<string | null>(null);
  const carePathwaysRef = useRef<HTMLDivElement>(null);

  const effectiveTab = currentUser?.role === 'fogpótlástanász' ? 'folyamatok' : adminTab;

  useEffect(() => {
    const checkAuth = async () => {
      const user = await getCurrentUser();
      if (!user) { router.push('/login'); return; }
      setCurrentUser(user);
      setAuthorized(user.role === 'admin' || user.role === 'fogpótlástanász');
      setLoading(false);
    };
    checkAuth();
  }, [router]);

  useEffect(() => {
    if (editPathwayId && carePathwaysRef.current) {
      carePathwaysRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [editPathwayId]);

  if (loading) {
    return (<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-600">Betöltés...</p></div>);
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white shadow rounded-lg p-6 max-w-md w-full text-center">
          <p className="text-gray-700">Nincs jogosultsága az admin felülethez.</p>
          <button className="btn-secondary mt-4" onClick={() => router.push('/')}>Vissza a főoldalra</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center gap-4">
              <Logo width={60} height={69} />
              <h1 className="text-2xl font-bold text-medical-primary">Admin felület</h1>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {currentUser?.role === 'admin' && (
                  <button onClick={() => setAdminTab('felhasznalok')} className={`px-4 py-2 text-sm font-medium transition-colors ${effectiveTab === 'felhasznalok' ? 'bg-medical-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                    Felhasználók
                  </button>
                )}
                <button onClick={() => setAdminTab('folyamatok')} className={`px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1 ${effectiveTab === 'folyamatok' ? 'bg-medical-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>
                  <Settings className="w-4 h-4" />
                  Folyamatok
                </button>
              </div>
              <Link href="/" className="btn-secondary text-sm">Vissza</Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {effectiveTab === 'folyamatok' ? (
          <div className="space-y-8">
            <div className="card border-l-4 border-blue-500 bg-blue-50/40">
              <div className="flex items-start gap-3">
                <ListOrdered className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-base font-semibold text-blue-900 mb-2">Mikor mit szerkesztesz</h3>
                  <p className="text-sm text-blue-800 mb-2">
                    A beteg űrlap <strong>Kezelési terv</strong> szekciójában a három kategória (Felső állcsont, Alsó állcsont, Arcot érintő rehabilitáció) <strong>fix, itt nem szerkeszthető</strong>.
                  </p>
                  <ol className="text-sm text-blue-900 space-y-2 list-decimal list-inside">
                    <li><strong>Kezeléstípusok</strong> — A „Tervezett fogpótlás típusa" legördülő opciói.</li>
                    <li><strong>Kezelési utak</strong> — Lépéssor egy típus vagy indikációhoz.</li>
                    <li><strong>Részlépések</strong> — A lépések megjelenítési nevei.</li>
                    <li><strong>Stádiumok</strong> — Stádium katalógus indikáció szerint.</li>
                    <li><strong>Fog-szintű kezelési típusok</strong> — Kezelések fogakhoz rendelése.</li>
                  </ol>
                </div>
              </div>
            </div>

            <div className="card border-l-4 border-amber-400 bg-amber-50/30">
              <h3 className="text-sm font-semibold text-amber-900 mb-1">Epizódok és stádiumok szerkesztése (betegnél)</h3>
              <p className="text-sm text-amber-800 mb-2">A beteg profiljánál a „Stádiumok" oldalon állítható.</p>
              <Link href="/" className="text-sm text-medical-primary hover:underline font-medium">Beteglista megnyitása →</Link>
            </div>

            <section className="card" aria-labelledby="section-treatment-types">
              <div className="mb-4"><h2 id="section-treatment-types" className="text-lg font-semibold text-gray-900">1. Kezeléstípusok</h2></div>
              <TreatmentTypesEditor onEditPathway={(id) => setEditPathwayId(id)} />
            </section>

            <section ref={carePathwaysRef} className="card" aria-labelledby="section-care-pathways">
              <div className="mb-4"><h2 id="section-care-pathways" className="text-lg font-semibold text-gray-900">2. Kezelési utak</h2></div>
              <CarePathwaysEditor editPathwayId={editPathwayId} onEditPathwayIdClear={() => setEditPathwayId(null)} />
            </section>

            <section className="card" aria-labelledby="section-step-catalog">
              <div className="mb-4"><h2 id="section-step-catalog" className="text-lg font-semibold text-gray-900">3. Részlépések</h2></div>
              <StepCatalogEditor />
            </section>

            <section className="card" aria-labelledby="section-stage-catalog">
              <div className="mb-4"><h2 id="section-stage-catalog" className="text-lg font-semibold text-gray-900">4. Stádiumok</h2></div>
              <StageCatalogEditor />
            </section>

            <section className="card" aria-labelledby="section-tooth-treatment-catalog">
              <div className="mb-4"><h2 id="section-tooth-treatment-catalog" className="text-lg font-semibold text-gray-900">5. Fog-szintű kezelési típusok</h2></div>
              <ToothTreatmentCatalogEditor />
            </section>
          </div>
        ) : (
          <UserManagementTab />
        )}
      </main>
    </div>
  );
}
