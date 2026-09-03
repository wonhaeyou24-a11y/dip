/** 측점 ID 후보 (SITE-A ~ SITE-Z) */
export const SITE_IDS = Array.from({ length: 26 }, (_, i) => `SITE-${String.fromCharCode(65 + i)}`);

/** 토양경도 ID 후보 (R-1 ~ R-30) */
export const SOIL_IDS = Array.from({ length: 30 }, (_, i) => `R-${i + 1}`);

/** 절리군 이름 후보 (SET1 ~ SET30) */
export const SET_NAMES = Array.from({ length: 30 }, (_, i) => `SET${i + 1}`);

/** 비탈면 위치 (측점) */
export const SLOPE_POSITIONS = ['상부', '중부', '하부'] as const;
export type SlopePosition = (typeof SLOPE_POSITIONS)[number];

/** 비탈면 위치 (토양경도) */
export const SOIL_SLOPE_POSITIONS = ['상', '중', '하'] as const;
export type SoilSlopePosition = (typeof SOIL_SLOPE_POSITIONS)[number];

export function nextSiteId(count: number): string {
  return SITE_IDS[count] ?? `SITE-${count + 1}`;
}
export function nextSoilId(count: number): string {
  return SOIL_IDS[count] ?? `R-${count + 1}`;
}
export function nextSetName(count: number): string {
  return SET_NAMES[count] ?? `SET${count + 1}`;
}

/** 측점 위치설명: "측점 58m 비탈면 하부" */
export function composeLocation(staValue?: number, slope?: SlopePosition | null): string {
  if (staValue == null && !slope) return '';
  const sta = staValue != null ? `측점 ${staValue}m 비탈면` : '비탈면';
  return slope ? `${sta} ${slope}` : sta;
}

/** 토양경도 위치설명: "30m 상" */
export function composeSoilLocation(staValue?: number, slope?: SoilSlopePosition | null): string {
  if (staValue == null && !slope) return '';
  const sta = staValue != null ? `${staValue}m` : '';
  return [sta, slope].filter(Boolean).join(' ');
}

/** 지도 마커 라벨: "SITE-A" → "A", "R-1" → "1" */
export function markerLabel(id: string): string {
  return id.replace(/^SITE-/, '').replace(/^R-/, '');
}

/** [min, max] 범위에서 count 개의 랜덤 정수 생성 */
export function randomValues(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Array.from({ length: count }, () => Math.round(lo + Math.random() * (hi - lo)));
}

export function valueStats(values: number[]): { n: number; min: number; max: number; mean: number } {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length === 0) return { n: 0, min: 0, max: 0, mean: 0 };
  const sum = v.reduce((s, x) => s + x, 0);
  return {
    n: v.length,
    min: Math.min(...v),
    max: Math.max(...v),
    mean: Math.round((sum / v.length) * 10) / 10,
  };
}
