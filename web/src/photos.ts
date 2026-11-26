// Pin photos, stored on this phone in IndexedDB (works offline; localStorage is too small for pictures).
// Photos are shrunk before saving so a day of pictures doesn't fill the phone: longest side 1600 px, JPEG.

const DB = 'traillink-photos', STORE = 'photos';
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Shrink and re-encode a camera photo (also drops the original file's metadata). */
async function shrink(file: Blob, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', 0.82));
  } catch {
    return file; // unusual formats: keep as-is
  }
}

export async function savePhoto(file: Blob): Promise<string> {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const small = await shrink(file);
  await tx('readwrite', s => s.put(small, id));
  return id;
}

const urls = new Map<string, string>();
/** An object URL for showing the photo (cached). Null if the photo is gone. */
export async function photoUrl(id: string): Promise<string | null> {
  if (urls.has(id)) return urls.get(id)!;
  const b = await tx<Blob | undefined>('readonly', s => s.get(id) as IDBRequest<Blob | undefined>).catch(() => undefined);
  if (!b) return null;
  const u = URL.createObjectURL(b); urls.set(id, u); return u;
}
export async function deletePhoto(id: string) {
  const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); }
  await tx('readwrite', s => s.delete(id)).catch(() => {});
}

/** Fill every <img data-photo="id"> inside root with its picture. */
export function hydratePhotos(root: ParentNode) {
  root.querySelectorAll<HTMLImageElement>('img[data-photo]:not([src])').forEach(img => {
    void photoUrl(img.dataset.photo!).then(u => { if (u) img.src = u; else img.classList.add('missing'); });
  });
}
