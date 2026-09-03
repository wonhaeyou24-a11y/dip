/**
 * 전체 데이터 백업 / 복원 (JSON).
 * 사진은 base64 로 인라인 → 파일이 커질 수 있음. 기기 이전·보관용.
 */

import { db, type Photo } from '../db/db';

const MAGIC = 'dip-backup';
const VERSION = 1;

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function dataURLtoBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

interface PhotoDump extends Omit<Photo, 'blob' | 'thumbnail'> {
  blob: string;
  thumbnail?: string;
}

export async function exportBackup(): Promise<Blob> {
  const [facilities, stations, sets, measurements, photos] = await Promise.all([
    db.facilities.toArray(),
    db.stations.toArray(),
    db.sets.toArray(),
    db.measurements.toArray(),
    db.photos.toArray(),
  ]);

  const photoDumps: PhotoDump[] = await Promise.all(
    photos.map(async (p) => ({
      ...p,
      blob: await blobToDataURL(p.blob),
      thumbnail: p.thumbnail ? await blobToDataURL(p.thumbnail) : undefined,
    })),
  );

  const payload = {
    magic: MAGIC,
    version: VERSION,
    exportedAt: Date.now(),
    data: { facilities, stations, sets, measurements, photos: photoDumps },
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export interface ImportResult {
  facilities: number;
  stations: number;
  sets: number;
  measurements: number;
  photos: number;
}

/** 기존 데이터에 병합(put). 같은 id 는 덮어씀. */
export async function importBackup(file: File): Promise<ImportResult> {
  const parsed = JSON.parse(await file.text());
  if (parsed?.magic !== MAGIC) throw new Error('백업 파일 형식이 아닙니다.');

  const d = parsed.data;
  const photos: Photo[] = await Promise.all(
    (d.photos as PhotoDump[]).map(async (p) => ({
      ...p,
      blob: await dataURLtoBlob(p.blob),
      thumbnail: p.thumbnail ? await dataURLtoBlob(p.thumbnail) : undefined,
    })),
  );

  await db.transaction('rw', db.facilities, db.stations, db.sets, db.measurements, db.photos, async () => {
    await db.facilities.bulkPut(d.facilities);
    await db.stations.bulkPut(d.stations);
    await db.sets.bulkPut(d.sets);
    await db.measurements.bulkPut(d.measurements);
    await db.photos.bulkPut(photos);
  });

  return {
    facilities: d.facilities.length,
    stations: d.stations.length,
    sets: d.sets.length,
    measurements: d.measurements.length,
    photos: photos.length,
  };
}
