/**
 * 이미지 처리 — React 비의존. 사진은 **base64 data URL 문자열**로 저장한다.
 *   · <img src="data:..."> 로 바로 표시 (object URL 생명주기 문제 없음)
 *   · Excel(ExcelJS) 에도 그대로 삽입
 *   · IndexedDB 에 문자열로 저장 → 어떤 상황에서도 유실 없음 (Blob 직렬화 이슈 회피)
 */

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error ?? new Error('read fail'));
    fr.readAsDataURL(blob);
  });
}

/**
 * 이미지 파일 → 축소 JPEG data URL.
 * <img>+canvas 사용 (createImageBitmap 미지원/HEIC/EXIF 이슈 최소화).
 * 디코딩 실패 시 원본을 그대로 data URL 로 보존 (자료 유실 방지).
 */
export async function toResizedDataUrl(
  file: Blob,
  maxPx: number,
  quality = 0.8,
): Promise<{ dataUrl: string; resized: boolean }> {
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const longest = Math.max(img.naturalWidth, img.naturalHeight) || maxPx;
          const scale = Math.min(1, maxPx / longest);
          const w = Math.max(1, Math.round(img.naturalWidth * scale));
          const h = Math.max(1, Math.round(img.naturalHeight * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('no canvas ctx'));
          ctx.drawImage(img, 0, 0, w, h);
          const out = canvas.toDataURL('image/jpeg', quality);
          if (!out || out.length < 32) return reject(new Error('empty canvas'));
          resolve(out);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('이미지 디코딩 실패'));
      };
      img.src = url;
    });
    return { dataUrl, resized: true };
  } catch {
    // 디코딩 실패 — 원본을 그대로 보존 (표시가 안 될 수는 있어도 자료는 남는다)
    const dataUrl = await blobToDataURL(file);
    return { dataUrl, resized: false };
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** data URL → Uint8Array (ExcelJS buffer 삽입용) */
export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // atob 폴백 (테스트 환경 등)
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) |
      (B64.indexOf(clean[i + 3]) & 63);
    bytes.push((n >> 16) & 255);
    if (clean[i + 2] !== '=') bytes.push((n >> 8) & 255);
    if (clean[i + 3] !== '=') bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
}

export function dataUrlExtension(dataUrl: string): 'jpeg' | 'png' | 'gif' {
  if (dataUrl.startsWith('data:image/png')) return 'png';
  if (dataUrl.startsWith('data:image/gif')) return 'gif';
  return 'jpeg';
}
