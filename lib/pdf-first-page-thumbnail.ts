const DEFAULT_THUMB_WIDTH_PX = 96;
const pdfThumbCache = new Map<string, string>();

let workerConfigured = false;

async function ensurePdfWorker() {
  const pdfjs = await import('pdfjs-dist');
  if (!workerConfigured) {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
    workerConfigured = true;
  }
  return pdfjs;
}

/** Első oldal renderelése JPEG data URL-ként (böngészőben, auth cookie-val). */
export async function renderPdfFirstPageThumbnail(
  url: string,
  widthPx = DEFAULT_THUMB_WIDTH_PX,
): Promise<string | null> {
  const cacheKey = `${url}::${widthPx}`;
  const cached = pdfThumbCache.get(cacheKey);
  if (cached) return cached;

  const pdfjs = await ensurePdfWorker();
  const loadingTask = pdfjs.getDocument({ url, withCredentials: true });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = widthPx / baseViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) return null;

  await page.render({ canvasContext: context, viewport }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  pdfThumbCache.set(cacheKey, dataUrl);
  return dataUrl;
}
