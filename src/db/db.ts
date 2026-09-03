/**
 * 로컬 저장소 (IndexedDB via Dexie) — 완전 오프라인.
 *
 * 계층: Facility(시설물) → Station(측점) → DiscontinuitySet(절리군) → Condition(절리상태)
 *       Station 하위에 Photo(측점 단위), DiscontinuitySet 하위에 OrientationMeasurement(원자료)
 *
 * 설계 근거: docs/절리상태_평가_설계.md §4
 */

import Dexie, { type EntityTable } from 'dexie';
import type { Condition } from '../lib/scoring/condition';
import type { SeepageClass, SpacingClass } from '../lib/scoring/condition';
import { emptyCondition } from '../lib/scoring/condition';
import type { MeasurementQuality, Orientation } from '../lib/sensors/orientation';

export type DiscontinuityType = '절리' | '층리' | '단층' | '편리·엽리' | '기타';

export const PHOTO_CATEGORIES = [
  '조사 전경사진 ①',
  '조사 전경사진 ②',
  '절리 측정 사진',
  '거칠기 조사 사진',
  '슈미트(반발경도) 측정 사진',
  '주향/경사 측정 사진',
  '점검망치 조사 사진',
] as const;
export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number];

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
  /** "Site-A" */
  siteId: string;
  /** "측점 58m 비탈면 하부" */
  location: string;
  gps?: Gps;
  surveyor: string;
  surveyedAt: number;
  /** 반발경도 R (값만) */
  reboundHardness?: number;
  /** 강도 (MPa) */
  wallStrength_MPa?: number;
  /** 누수 (표 14.12), 측점 공통 */
  seepage: SeepageClass | null;
  /** 암괴크기 (m) */
  blockSize?: { x: number; y: number; z: number };
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
  /** "Set 1" */
  name: string;
  order: number;
  dtype: DiscontinuityType;
  orientation: SetOrientation | null;
  spacing: SpacingClass | null;
  /** 간격 실측 (선택) */
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
  stationId: string;
  category: PhotoCategory;
  blob: Blob;
  thumbnail?: Blob;
  gps?: Gps;
  takenAt: number;
  note?: string;
}

class AppDB extends Dexie {
  facilities!: EntityTable<Facility, 'id'>;
  stations!: EntityTable<Station, 'id'>;
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
  }
}

export const db = new AppDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// ─────────────────────────────────────────────────────────────
// 생성 헬퍼
// ─────────────────────────────────────────────────────────────

export async function createFacility(name: string): Promise<string> {
  const now = Date.now();
  const id = uid();
  await db.facilities.add({ id, name: name.trim() || '이름없는 시설물', createdAt: now, updatedAt: now });
  return id;
}

export async function createStation(
  facilityId: string,
  init: Partial<Pick<Station, 'siteId' | 'location' | 'surveyor'>> = {},
): Promise<string> {
  const now = Date.now();
  const id = uid();
  const count = await db.stations.where('facilityId').equals(facilityId).count();
  await db.stations.add({
    id,
    facilityId,
    siteId: init.siteId ?? `Site-${String.fromCharCode(65 + count)}`,
    location: init.location ?? '',
    surveyor: init.surveyor ?? '',
    surveyedAt: now,
    seepage: null,
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
    name: `Set ${count + 1}`,
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

export async function updateFacility(id: string, patch: Partial<Facility>): Promise<void> {
  await db.facilities.update(id, { ...patch, updatedAt: Date.now() });
}
export async function updateStation(id: string, patch: Partial<Station>): Promise<void> {
  await db.stations.update(id, { ...patch, updatedAt: Date.now() });
}
export async function updateSet(id: string, patch: Partial<DiscontinuitySet>): Promise<void> {
  await db.sets.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteFacilityCascade(facilityId: string): Promise<void> {
  await db.transaction('rw', db.facilities, db.stations, db.sets, db.measurements, db.photos, async () => {
    const setIds = await db.sets.where('facilityId').equals(facilityId).primaryKeys();
    await db.measurements.where('setId').anyOf(setIds).delete();
    await db.sets.where('facilityId').equals(facilityId).delete();
    await db.photos.where('facilityId').equals(facilityId).delete();
    await db.stations.where('facilityId').equals(facilityId).delete();
    await db.facilities.delete(facilityId);
  });
}

export async function deleteStationCascade(stationId: string): Promise<void> {
  await db.transaction('rw', db.stations, db.sets, db.measurements, db.photos, async () => {
    const setIds = await db.sets.where('stationId').equals(stationId).primaryKeys();
    await db.measurements.where('setId').anyOf(setIds).delete();
    await db.sets.where('stationId').equals(stationId).delete();
    await db.photos.where('stationId').equals(stationId).delete();
    await db.stations.delete(stationId);
  });
}

export async function deleteSetCascade(setId: string): Promise<void> {
  await db.transaction('rw', db.sets, db.measurements, async () => {
    await db.measurements.where('setId').equals(setId).delete();
    await db.sets.delete(setId);
  });
}
