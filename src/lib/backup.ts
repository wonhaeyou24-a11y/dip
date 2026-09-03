/**
 * 전체 데이터 백업 / 복원 (JSON).
 * 사진이 data URL 문자열이라 그대로 직렬화됨 — 별도 변환 불필요.
 */

import { db } from '../db/db';

const MAGIC = 'dip-backup';
const VERSION = 2;

export async function exportBackup(): Promise<Blob> {
  const [facilities, stations, soils, sets, measurements, photos] = await Promise.all([
    db.facilities.toArray(),
    db.stations.toArray(),
    db.soils.toArray(),
    db.sets.toArray(),
    db.measurements.toArray(),
    db.photos.toArray(),
  ]);

  // 구버전 Blob 사진은 백업에서 제외 (data URL 만 보관)
  const cleanPhotos = photos
    .filter((p) => typeof p.dataUrl === 'string' && p.dataUrl.length > 0)
    .map(({ blob, thumbnail, ...rest }) => {
      void blob;
      void thumbnail;
      return rest;
    });

  const payload = {
    magic: MAGIC,
    version: VERSION,
    exportedAt: Date.now(),
    data: { facilities, stations, soils, sets, measurements, photos: cleanPhotos },
  };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export interface ImportResult {
  facilities: number;
  stations: number;
  soils: number;
  sets: number;
  measurements: number;
  photos: number;
}

/** 기존 데이터에 병합(put). 같은 id 는 덮어씀. */
export async function importBackup(file: File): Promise<ImportResult> {
  const parsed = JSON.parse(await file.text());
  if (parsed?.magic !== MAGIC) throw new Error('백업 파일 형식이 아닙니다.');
  const d = parsed.data;

  await db.transaction(
    'rw',
    [db.facilities, db.stations, db.soils, db.sets, db.measurements, db.photos],
    async () => {
      await db.facilities.bulkPut(d.facilities ?? []);
      await db.stations.bulkPut(d.stations ?? []);
      await db.soils.bulkPut(d.soils ?? []);
      await db.sets.bulkPut(d.sets ?? []);
      await db.measurements.bulkPut(d.measurements ?? []);
      await db.photos.bulkPut(d.photos ?? []);
    },
  );

  return {
    facilities: (d.facilities ?? []).length,
    stations: (d.stations ?? []).length,
    soils: (d.soils ?? []).length,
    sets: (d.sets ?? []).length,
    measurements: (d.measurements ?? []).length,
    photos: (d.photos ?? []).length,
  };
}
