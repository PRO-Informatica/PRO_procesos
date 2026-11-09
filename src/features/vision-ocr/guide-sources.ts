export const GUIDE_QUEUE_LIMIT = 20;
export const GUIDE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const GUIDE_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const GUIDE_BATCH_MAX_BYTES = 100 * 1024 * 1024;

export type GuideSource = {
  id: string;
  file: File;
  pageNumber?: number;
  totalPages?: number;
};
export function guideSourceLabel(source: GuideSource) {
  return source.pageNumber ? `${source.file.name} · página ${source.pageNumber} de ${source.totalPages}` : source.file.name;
}
export function validateGuideSource(file: Pick<File, "name" | "type" | "size">, pdf: boolean) {
  if (!file.size) return "El archivo está vacío.";
  if (pdf) {
    if (file.type !== "application/pdf" && !(file.type === "" && /\.pdf$/iu.test(file.name))) return "Selecciona un archivo PDF.";
    if (file.size > GUIDE_PDF_MAX_BYTES) return "El PDF supera 20 MiB.";
  } else {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return "Selecciona fotos JPG, PNG o WEBP.";
    if (file.size > GUIDE_PHOTO_MAX_BYTES) return "Cada foto debe pesar como máximo 10 MiB.";
  }
  return null;
}

// A PDF is kept in memory once, with page references in the queue. Only the
// current page is rasterized; never allocate twenty full-size canvases at once.
export async function openGuidePdf(file: File) {
  const validation = validateGuideSource(file, true);
  if (validation) throw Error(validation);
  const signature = new TextDecoder().decode(await file.slice(0, 5).arrayBuffer());
  if (signature !== "%PDF-") throw Error("El contenido no corresponde a un PDF válido.");
  const { getDocumentProxy } = await import("unpdf");
  try {
    return await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw Error("No se pudo abrir el PDF. Comprueba que no esté dañado ni protegido con contraseña.");
  }
}
export async function countGuidePdfPages(file: File) {
  const pdf = await openGuidePdf(file);
  try {
    if (pdf.numPages > GUIDE_QUEUE_LIMIT) throw Error(`El PDF puede contener hasta ${GUIDE_QUEUE_LIMIT} páginas. Divídelo antes de cargarlo.`);
    return pdf.numPages;
  } finally { await pdf.loadingTask.destroy(); }
}

// Small local thumbnails do not run OCR and are never uploaded. Render pages
// sequentially with one PDF proxy to keep memory bounded on mobile devices.
export async function guidePdfThumbnails(file: File, onPage: (page: number, preview: string) => void, isCancelled: () => boolean) {
  const pdf = await openGuidePdf(file);
  try {
    for (let number = 1; number <= Math.min(pdf.numPages, GUIDE_QUEUE_LIMIT); number++) {
      if (isCancelled()) return;
      const page = await pdf.getPage(number);
      const original = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 360 / Math.max(original.width, original.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      try {
        const context = canvas.getContext("2d");
        if (!context) throw Error("Tu navegador no pudo mostrar las miniaturas.");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (!isCancelled()) onPage(number, canvas.toDataURL("image/jpeg", 0.8));
      } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
  } finally { await pdf.loadingTask.destroy(); }
}
export async function renderGuidePdfPage(source: GuideSource): Promise<File> {
  const pdf = await openGuidePdf(source.file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    if (!source.pageNumber || source.pageNumber < 1 || source.pageNumber > pdf.numPages) throw Error("Página de PDF no válida.");
    const page = await pdf.getPage(source.pageNumber);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 2800 / Math.max(original.width, original.height)) });
    canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw Error("Tu navegador no pudo preparar la página del PDF.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    // Keep the complete page, before crop/enhancement. No JPEG recompression of
    // faint handwriting. Noisy scans may need a smaller raster to fit Storage.
    const encode = () => new Promise<Blob>((resolve, reject) => canvas!.toBlob((value) => value ? resolve(value) : reject(Error("No se pudo convertir la página.")), "image/png"));
    let blob = await encode();
    while (blob.size > GUIDE_PHOTO_MAX_BYTES && Math.max(canvas.width, canvas.height) > 1800) {
      const smaller = document.createElement("canvas");
      smaller.width = Math.round(canvas.width * 0.8); smaller.height = Math.round(canvas.height * 0.8);
      const smallerContext = smaller.getContext("2d");
      if (!smallerContext) throw Error("No se pudo ajustar la página del PDF.");
      smallerContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas.width = 0; canvas.height = 0; canvas = smaller;
      blob = await encode();
    }
    if (blob.size > GUIDE_PHOTO_MAX_BYTES) throw Error("Esta página supera 10 MiB como imagen. Exporta una foto de la guía para cargarla por separado.");
    return new File([blob], `${source.file.name.replace(/\.pdf$/iu, "").slice(0, 140)}-pagina-${source.pageNumber}.png`, { type: "image/png" });
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    await pdf.loadingTask.destroy();
  }
}
