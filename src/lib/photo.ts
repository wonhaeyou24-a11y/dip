import { useEffect, useState } from 'react';

/**
 * 이미지 파일을 <img>+canvas 로 리사이즈/재인코딩.
 * createImageBitmap 미지원(구형 iOS)·EXIF 회전 이슈를 피하고, 저장 용량을 줄여
 * 다시 열 때 메모리 문제를 방지한다.
 */
export function resizeImage(file: Blob, maxPx: number, quality = 0.82): Promise<Blob> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const src = Math.max(img.naturalWidth, img.naturalHeight) || maxPx;
      const scale = Math.min(1, maxPx / src);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => resolve(b && b.size > 0 ? b : file), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export interface ProcessedPhoto {
  display: Blob;
  thumbnail: Blob;
}

/** 촬영 원본 → 표시/보고용(최대 1600px) + 썸네일(480px) */
export async function processPhoto(file: Blob): Promise<ProcessedPhoto> {
  const display = await resizeImage(file, 1600, 0.82);
  const thumbnail = await resizeImage(file, 480, 0.7);
  return { display, thumbnail };
}

/** blob → object URL. 마운트 시 생성, 언마운트/변경 시 해제. */
export function useObjectUrl(blob: Blob | null | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

export async function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
