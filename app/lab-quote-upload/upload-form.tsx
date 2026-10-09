'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';

interface UploadInfo {
  expiresAt: string;
  remainingUploads: number;
  maxFileSize: number;
  uploadAvailable: boolean;
}

export default function LabQuoteUploadForm() {
  const tokenRef = useRef('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [info, setInfo] = useState<UploadInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    tokenRef.current = token;
    const load = async () => {
      try {
        if (!token) throw new Error('Nyissa meg az ajánlatkérő e-mailben kapott feltöltési linket.');
        const res = await fetch('/api/lab-quote-upload', {
          headers: { 'x-upload-token': token }, cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'A feltöltési link nem használható.');
        setInfo(data);
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Nem sikerült betölteni a feltöltési oldalt.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, []);

  const handleUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || !info || uploading) return;
    setError('');
    if (!file.size || file.size > info.maxFileSize) {
      setError(`A fájl nem lehet üres, és legfeljebb ${Math.floor(info.maxFileSize / 1024 / 1024)} MB méretű lehet.`);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('description', description);
      const res = await fetch('/api/lab-quote-upload', {
        method: 'POST', headers: { 'x-upload-token': tokenRef.current }, body: form, credentials: 'omit',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'A feltöltés nem sikerült. Próbálja újra.');
      setUploadedFiles(previous => [...previous, file.name]);
      setInfo(previous => previous ? { ...previous, remainingUploads: data.remainingUploads } : previous);
      setFile(null);
      setDescription('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hálózati hiba. Próbálja újra.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <section className="w-full max-w-lg rounded-2xl bg-white dark:bg-gray-900 shadow-lg p-6 space-y-5">
        <div className="flex items-center gap-3">
          <FileUp className="w-8 h-8 text-blue-600" />
          <h1 className="text-xl font-semibold">Elkészült dokumentumok feltöltése</h1>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">Az ajánlatkéréshez tartozó árajánlatot és egyéb elkészült dokumentumokat itt közvetlenül eljuttathatja a kezelőorvoshoz.</p>
        {loading && <p className="flex items-center gap-2 text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Feltöltési link ellenőrzése…</p>}
        {error && <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        {uploadedFiles.length > 0 && <div role="status" className="rounded-lg bg-green-50 dark:bg-green-950 p-3 text-green-800 dark:text-green-200 text-sm">
          <p className="font-medium flex gap-2 items-center"><CheckCircle2 className="w-4 h-4" /> A dokumentumok megérkeztek:</p>
          <ul className="mt-2 space-y-1">{uploadedFiles.map((name, index) => <li key={index} className="break-all">{name}</li>)}</ul>
        </div>}
        {info && !info.uploadAvailable && <p className="text-sm text-amber-700 dark:text-amber-300">A dokumentumfeltöltés átmenetileg nem elérhető. Próbálja később, vagy jelezze a kezelőorvosnak.</p>}
        {info && info.remainingUploads > 0 && info.uploadAvailable && (
          <form onSubmit={handleUpload} className="space-y-4">
            <fieldset disabled={uploading} className="space-y-4">
              <div>
                <label htmlFor="quote-document" className="block text-sm font-medium mb-2">Dokumentum kiválasztása</label>
                <input ref={fileRef} id="quote-document" type="file" required accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png"
                  onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} className="w-full text-sm" />
                <p className="mt-2 text-xs text-gray-500">PDF, DOCX, XLSX, JPG vagy PNG · legfeljebb {Math.floor(info.maxFileSize / 1024 / 1024)} MB / fájl</p>
              </div>
              <div>
                <label htmlFor="quote-description" className="block text-sm font-medium mb-2">Megjegyzés (nem kötelező)</label>
                <textarea id="quote-description" value={description} onChange={event => setDescription(event.target.value)}
                  maxLength={2000} rows={3} className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-2 text-sm" />
              </div>
              <button type="submit" disabled={!file || uploading} className="btn-primary w-full flex justify-center items-center gap-2 disabled:opacity-50">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                {uploading ? 'Feltöltés folyamatban…' : 'Dokumentum feltöltése'}
              </button>
            </fieldset>
          </form>
        )}
        {info && <p className="text-xs text-gray-500">Link érvényessége: {new Date(info.expiresAt).toLocaleDateString('hu-HU', { timeZone: 'Europe/Budapest' })} · még {info.remainingUploads} fájl tölthető fel.</p>}
        <p className="text-xs text-gray-400">Semmelweis Egyetem · Fogpótlástani Klinika</p>
      </section>
    </main>
  );
}
