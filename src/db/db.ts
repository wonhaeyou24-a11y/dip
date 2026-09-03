/**
 * 로컬 저장소 (IndexedDB via Dexie) — 완전 오프라인, 자료 최우선 보존.
 *
 * 계층: Facility(시설물)
 *        ├─ Station(측점) → DiscontinuitySet(절리군) → Condition(절리상태)
 *        └─ SoilPoint(토양경도)
 *       Photo 는 Station 또는 SoilPoint 에 소속 (ownerType/ownerId).
 *
 * 사진은 base64 data URL 문자열로 저장 (Blob 직렬화/URL 생명주기 이슈 회피).
 * 설계 근거: docs/절리상태_평가_설계.md §4
 */

import Dexie, { type EntityTable, type Transaction } from 'dexie';
import type { Condition } from '../lib/scoring/condition';
import type { SeepageClass, SpacingClass } from '../lib/scoring/condition';
import { emptyCondition } from '../lib/scoring/condition';
import { blobToDataURL } from '../lib/image';
import {
  composeLocation,
  composeSoilLocation,
  nextSetName,
  nextSiteId,
  nextSoilId,
  type SlopePosition,
  type SoilSlopePosition,
} from '../lib/labels';
import type { MeasurementQuality, Orientation } from '../lib/sensors/orientation';

export type DiscontinuityType = '절리' | '층리' | '단층' | '편리·엽리' | '기타';

/** 측점 조사 사진 (7종) */
export const STATION_PHOTO_CATEGORIES = [
  '조사 전경사진 ①',
  '조사 전경사진 ②',
  '절리 측정 사진',
  '거칠기 조사 사진',
  '슈미트(반발경도) 측정 사진',
  '주향/경사 측정 사진',
  '점검망치 조사 사진',
] as const;

/** 토양경도 조사 사진 (2종) */
export const SOIL_PHOTO_CATEGORIES = ['토양경도 조사 사진 ①', '토양경도 조사 사진 ②'] as const;

export type OwnerType = 'station' | 'soil';

export interface Facility {
  id: string;
  name: string;
  client?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Gps {
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

export interface Station {
  id: string;
  facilityId: string;
  siteId: string; // "SITE-A"
  staValue?: number; // 측점 거리(m)
  slopePosition?: SlopePosition | null; // 상부/중부/하부
  location: string; // 자동 구성 "측점 58m 비탈면 하부"
  gps?: Gps;
  surveyor: string;
  surveyedAt: number;
  /** 반발경도 R 값 (최대 20개) */
  reboundValues?: number[];
  wallStrength_MPa?: number; // (현재 UI 미사용, 결과보고 빈칸)
  seepage: SeepageClass | null;
  blockSize?: { x: number; y: number; z: number };
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SoilPoint {
  id: string;
  facilityId: string;
  pointId: string; // "R-1"
  order: number;
  staValue?: number; // 거리(m)
  slopePosition?: SoilSlopePosition | null; // 상/중/하
  location: string; // "30m 상"
  gps?: Gps;
  surveyor: string;
  surveyedAt: number;
  /** 토양경도 값 (최대 10개) */
  hardnessValues?: number[];
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SetOrientation extends Orientation {
  method: 'sensor' | 'manual';
  declinationApplied: number;
  quality?: MeasurementQuality;
  measuredAt: number;
}

export interface DiscontinuitySet {
  id: string;
  stationId: string;
  facilityId: string;
  name: string;
  order: number;
  dtype: DiscontinuityType;
  orientation: SetOrientation | null;
  spacing: SpacingClass | null;
  spacing_min_m?: number;
  spacing_max_m?: number;
  spacing_mode_m?: number;
  condition: Condition;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface OrientationMeasurement {
  id: string;
  setId: string;
  orientation: Orientation;
  method: 'sensor' | 'manual';
  declinationApplied: number;
  quality?: MeasurementQuality;
  adoptedAsCurrent: boolean;
  measuredAt: number;
}

export interface Photo {
  id: string;
  facilityId: string;
  ownerType: OwnerType;
  ownerId: string; // stationId 또는 soilPointId
  category: string;
  /** base64 data URL (표시·Excel 공용) */
  dataUrl: string;
  gps?: Gps;
  takenAt: number;
  note?: string;
  // 구버전 호환 (v1)
  blob?: Blob;
  thumbnail?: Blob;
  stationId?: string;
}

class AppDB extends Dexie {
  facilities!: EntityTable<Facility, 'id'>;
  stations!: EntityTable<Station, 'id'>;
  soils!: EntityTable<SoilPoint, 'id'>;
  sets!: EntityTable<DiscontinuitySet, 'id'>;
  measurements!: EntityTable<OrientationMeasurement, 'id'>;
  photos!: EntityTable<Photo, 'id'>;

  constructor() {
    super('dip');
    this.version(1).stores({
      facilities: 'id, updatedAt',
      stations: 'id, facilityId, updatedAt',
      sets: 'id, stationId, facilityId, order',
      measurements: 'id, setId, measuredAt',
      photos: 'id, stationId, facilityId, category',
    });
    const v2v3Stores = {
      facilities: 'id, updatedAt',
      stations: 'id, facilityId, updatedAt',
      soils: 'id, facilityId, order',
      sets: 'id, stationId, facilityId, order',
      measurements: 'id, setId, measuredAt',
      photos: 'id, facilityId, ownerType, ownerId, category',
    };
    // 사진 소유자 필드 (동기 modify — 트랜잭션 유지). blob→dataUrl 변환은
    // migrateLegacyPhotos() 에서 별도 처리 (upgrade 트랜잭션 내 비-Dexie await 금지)
    const ownerMigration = (tx: Transaction) =>
      tx
        .table('photos')
        .toCollection()
        .modify((p: Record<string, unknown>) => {
          if (p.stationId && !p.ownerId) {
            p.ownerType = 'station';
            p.ownerId = p.stationId;
          }
        });
    this.version(2).stores(v2v3Stores).upgrade(ownerMigration);
    this.version(3).stores(v2v3Stores).upgrade(ownerMigration);
  }
}

export const db = new AppDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ─────────────────────────────────────────────────────────────
// 영구 저장소 요청 (자료 유실 방지 — 브라우저 저장소 정리에서 제외)
// ─────────────────────────────────────────────────────────────
export interface StorageStatus {
  persisted: boolean;
  supported: boolean;
  usageMB?: number;
  quotaMB?: number;
}

/**
 * 구버전(Blob) 사진을 dataUrl 문자열로 변환 (백그라운드, 1회).
 * Dexie upgrade 트랜잭션 밖에서 실행 — FileReader await 안전.
 */
export async function migrateLegacyPhotos(): Promise<number> {
  let count = 0;
  const legacy = await db.photos
    .filter((p) => !p.dataUrl && (p.blob instanceof Blob || p.thumbnail instanceof Blob))
    .toArray();
  for (const p of legacy) {
    const src = p.thumbnail instanceof Blob ? p.thumbnail : p.blob;
    if (!(src instanceof Blob)) continue;
    try {
      const dataUrl = await blobToDataURL(src);
      await db.photos.update(p.id, {
        dataUrl,
        ownerType: p.ownerType ?? 'station',
        ownerId: p.ownerId ?? p.stationId ?? '',
      });
      count++;
    } catch {
      /* 변환 실패해도 원본 blob 은 유지 */
    }
  }
  return count;
}

export async function ensurePersistentStorage(): Promise<StorageStatus> {
  const s = navigator.storage;
  if (!s || !('persist' in s)) return { persisted: false, supported: false };
  let persisted = (await s.persisted?.()) ?? false;
  if (!persisted && s.persist) {
    try {
      persisted = await s.persist();
    } catch {
      /* ignore */
    }
  }
  let usageMB: number | undefined;
  let quotaMB: number | undefined;
  try {
    const est = await s.estimate?.();
    if (est) {
      usageMB = (est.usage ?? 0) / 1024 / 1024;
      quotaMB = (est.quota ?? 0) / 1024 / 1024;
    }
  } catch {
    /* ignore */
  }
  return { persisted, supported: true, usageMB, quotaMB };
}

// ─────────────────────────────────────────────────────────────
// 생성 헬퍼
// ─────────────────────────────────────────────────────────────

export async function createFacility(name: string): Promise<string> {
  const now = Date.now();
  const id = uid();
  await db.facilities.add({ id, name: name.trim() || '이름없는 시설물', createdAt: now, updatedAt: now });
  return id;
}

export async function createStation(facilityId: string): Promise<string> {
  const now = Date.now();
  const id = uid();
  const count = await db.stations.where('facilityId').equals(facilityId).count();
  await db.stations.add({
    id,
    facilityId,
    siteId: nextSiteId(count),
    location: '',
    surveyor: '',
    surveyedAt: now,
    seepage: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function createSoilPoint(facilityId: string): Promise<string> {
  const now = Date.now();
  const id = uid();
  const count = await db.soils.where('facilityId').equals(facilityId).count();
  await db.soils.add({
    id,
    facilityId,
    pointId: nextSoilId(count),
    order: count,
    location: '',
    surveyor: '',
    surveyedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function createSet(stationId: string): Promise<string> {
  const station = await db.stations.get(stationId);
  if (!station) throw new Error('station not found');
  const now = Date.now();
  const id = uid();
  const count = await db.sets.where('stationId').equals(stationId).count();
  await db.sets.add({
    id,
    stationId,
    facilityId: station.facilityId,
    name: nextSetName(count),
    order: count,
    dtype: '절리',
    orientation: null,
    spacing: null,
    condition: emptyCondition(),
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ─────────────────────────────────────────────────────────────
// 갱신 헬퍼
// ─────────────────────────────────────────────────────────────

export async function updateFacility(id: string, patch: Partial<Facility>): Promise<void> {
  await db.facilities.update(id, { ...patch, updatedAt: Date.now() });
}
export async function updateStation(id: string, patch: Partial<Station>): Promise<void> {
  await db.stations.update(id, { ...patch, updatedAt: Date.now() });
}
export async function updateSoilPoint(id: string, patch: Partial<SoilPoint>): Promise<void> {
  await db.soils.update(id, { ...patch, updatedAt: Date.now() });
}
export async function updateSet(id: string, patch: Partial<DiscontinuitySet>): Promise<void> {
  await db.sets.update(id, { ...patch, updatedAt: Date.now() });
}

/** 측점거리·위치 중 하나를 바꾸고, 두 값으로 location 재구성 (현재 저장값 기준). */
export async function setStationLocationPart(
  id: string,
  part: { staValue?: number; slopePosition?: SlopePosition | null },
): Promise<void> {
  await db.transaction('rw', db.stations, async () => {
    const row = await db.stations.get(id);
    if (!row) return;
    const staValue = 'staValue' in part ? part.staValue : row.staValue;
    const slopePosition = 'slopePosition' in part ? (part.slopePosition ?? null) : row.slopePosition;
    await db.stations.update(id, {
      staValue,
      slopePosition,
      location: composeLocation(staValue, slopePosition),
      updatedAt: Date.now(),
    });
  });
}

export async function setSoilLocationPart(
  id: string,
  part: { staValue?: number; slopePosition?: SoilSlopePosition | null },
): Promise<void> {
  await db.transaction('rw', db.soils, async () => {
    const row = await db.soils.get(id);
    if (!row) return;
    const staValue = 'staValue' in part ? part.staValue : row.staValue;
    const slopePosition = 'slopePosition' in part ? (part.slopePosition ?? null) : row.slopePosition;
    await db.soils.update(id, {
      staValue,
      slopePosition,
      location: composeSoilLocation(staValue, slopePosition),
      updatedAt: Date.now(),
    });
  });
}

/** 같은 측점의 직전 절리군에서 종류·간격·절리상태 복사 (방향성 제외). */
export async function copyPreviousSet(setId: string): Promise<boolean> {
  const cur = await db.sets.get(setId);
  if (!cur) return false;
  const siblings = await db.sets.where('stationId').equals(cur.stationId).sortBy('order');
  const idx = siblings.findIndex((s) => s.id === setId);
  const prev = idx > 0 ? siblings[idx - 1] : undefined;
  if (!prev) return false;
  await updateSet(setId, {
    dtype: prev.dtype,
    spacing: prev.spacing,
    spacing_min_m: prev.spacing_min_m,
    spacing_max_m: prev.spacing_max_m,
    spacing_mode_m: prev.spacing_mode_m,
    condition: { ...prev.condition },
    note: prev.note,
  });
  return true;
}

// ─────────────────────────────────────────────────────────────
// 삭제 (cascade)
// ─────────────────────────────────────────────────────────────

export async function deleteFacilityCascade(facilityId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.facilities, db.stations, db.soils, db.sets, db.measurements, db.photos],
    async () => {
      const setIds = await db.sets.where('facilityId').equals(facilityId).primaryKeys();
      await db.measurements.where('setId').anyOf(setIds).delete();
      await db.sets.where('facilityId').equals(facilityId).delete();
      await db.photos.where('facilityId').equals(facilityId).delete();
      await db.stations.where('facilityId').equals(facilityId).delete();
      await db.soils.where('facilityId').equals(facilityId).delete();
      await db.facilities.delete(facilityId);
    },
  );
}

export async function deleteStationCascade(stationId: string): Promise<void> {
  await db.transaction('rw', [db.stations, db.sets, db.measurements, db.photos], async () => {
    const setIds = await db.sets.where('stationId').equals(stationId).primaryKeys();
    await db.measurements.where('setId').anyOf(setIds).delete();
    await db.sets.where('stationId').equals(stationId).delete();
    await db.photos.where('ownerId').equals(stationId).delete();
    await db.stations.delete(stationId);
  });
}

export async function deleteSoilCascade(soilId: string): Promise<void> {
  await db.transaction('rw', [db.soils, db.photos], async () => {
    await db.photos.where('ownerId').equals(soilId).delete();
    await db.soils.delete(soilId);
  });
}

export async function deleteSetCascade(setId: string): Promise<void> {
  await db.transaction('rw', [db.sets, db.measurements], async () => {
    await db.measurements.where('setId').equals(setId).delete();
    await db.sets.delete(setId);
  });
}
