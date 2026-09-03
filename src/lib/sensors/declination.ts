/**
 * 자기편각(magnetic declination)
 *
 * 자북 기준으로 측정한 방위를 진북 기준으로 보정할 때 사용.
 *   진북 방위 = 자북 방위 + declinationDeg   (동편각 +, 서편각 -)
 *
 * 정밀 계산에는 WMM/IGRF 모델이 필요하나(용량 큼), 1차 개발에서는
 * 조사자가 GPS 좌표로 조회한 값을 직접 입력한다.
 * 조회: NOAA https://www.ngdc.noaa.gov/geomag/calculators/magcalc.shtml
 *
 * 대한민국 대략값: 약 -7° ~ -9° (서편각). 지역·연도에 따라 다름.
 */

export const DEFAULT_DECLINATION_KR = -8;

export interface DeclinationSetting {
  /** 적용할 편각(°) */
  deg: number;
  /** 출처: 수동 입력 / 기본값 */
  source: 'manual' | 'default';
}

export function defaultDeclination(): DeclinationSetting {
  return { deg: DEFAULT_DECLINATION_KR, source: 'default' };
}

export function clampDeclination(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return Math.max(-30, Math.min(30, deg));
}
