/** 측점 ID 후보 (SITE-A ~ SITE-Z) */
export const SITE_IDS = Array.from({ length: 26 }, (_, i) => `SITE-${String.fromCharCode(65 + i)}`);

/** 비탈면 위치 */
export const SLOPE_POSITIONS = ['상부', '중부', '하부'] as const;
export type SlopePosition = (typeof SLOPE_POSITIONS)[number];

/** 측점거리·위치 → 위치설명 문자열 */
export function composeLocation(staValue?: number, slope?: SlopePosition | null): string {
  if (staValue == null && !slope) return '';
  const sta = staValue != null ? `측점 ${staValue}m 비탈면` : '비탈면';
  return slope ? `${sta} ${slope}` : sta;
}

/** 절리군 이름 후보 (SET1 ~ SET30) */
export const SET_NAMES = Array.from({ length: 30 }, (_, i) => `SET${i + 1}`);

/** count(0-based) → 다음 기본 SITE ID */
export function nextSiteId(count: number): string {
  return SITE_IDS[count] ?? `SITE-${count + 1}`;
}

/** count(0-based) → 다음 기본 SET 이름 */
export function nextSetName(count: number): string {
  return SET_NAMES[count] ?? `SET${count + 1}`;
}
