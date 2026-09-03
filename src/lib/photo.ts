/** 이미지 blob → 축소 썸네일 blob (긴 변 maxPx) */
export async function makeThumbnail(blob: Blob, maxPx = 480, quality = 0.7): Promise<Blob> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return blob;
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', quality);
  });
}

const urlCache = new WeakMap<Blob, string>();

/** blob → object URL (blob 별 캐시, 자동 해제는 하지 않음 — 짧은 수명 화면용) */
export function blobUrl(blob: Blob): string {
  let u = urlCache.get(blob);
  if (!u) {
    u = URL.createObjectURL(blob);
    urlCache.set(blob, u);
  }
  return u;
}
