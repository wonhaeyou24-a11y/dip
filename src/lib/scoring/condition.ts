/**
 * 상세 절리상태 배점 엔진
 *
 * 근거: 「시설물 안전·유지관리 실시 세부지침」제14장 절토사면 14.2, 항목 7)
 *   상세 절리 상태표 — 5개 항목 ①연장성 ②틈새 ③거칠기 ④충진물질 ⑤풍화도
 *   각 항목 상태값 단계(1~5) → 점수구간 [0] / [1,2] / [3,4] / [5,6] / [7,8]
 *   2~5단계는 조사자가 구간의 하한/상한 중 선택.
 *
 *   절리상태 점수 = round( Σ(①~⑤ 점수) / 5 )        (분모 고정 5)
 *
 * 등급 산정은 하지 않는다 (사용자 확정).
 */

export const SCORING_CONFIG_VERSION = 'molit-2026-01-v1';

export const CONDITION_ITEMS = [
  'persistence',
  'aperture',
  'roughness',
  'infilling',
  'weathering',
] as const;
export type ConditionItemKey = (typeof CONDITION_ITEMS)[number];

export type Stage = 1 | 2 | 3 | 4 | 5;
export type Bound = 'lower' | 'upper';

/** 단계 → 선택 가능한 점수 */
export const STAGE_SCORES: Record<Stage, readonly number[]> = {
  1: [0],
  2: [1, 2],
  3: [3, 4],
  4: [5, 6],
  5: [7, 8],
};

export const ITEM_NAMES: Record<ConditionItemKey, string> = {
  persistence: '① 연장성',
  aperture: '② 틈새',
  roughness: '③ 거칠기',
  infilling: '④ 충진물질',
  weathering: '⑤ 풍화도',
};

/** 단계별 상태값 라벨 (배점표 원문) */
export const ITEM_LABELS: Record<ConditionItemKey, readonly [string, string, string, string, string]> = {
  persistence: ['< 1m', '1~3m 미만', '3~10m 미만', '10~20m 미만', '≥ 20m'],
  aperture: ['밀착 (0)', '< 0.1mm', '0.1~1mm 미만', '1~5mm 미만', '≥ 5mm'],
  roughness: ['매우 거침', '거침', '약간 거침', '평탄', '매우 평탄'],
  infilling: ['없음', '단단 < 5mm', '단단 ≥ 5mm', '연약 < 5mm', '연약 ≥ 5mm'],
  weathering: ['신선', '약한 풍화', '보통 풍화', '심한 풍화', '완전 풍화'],
};

export interface RatedItem {
  stage: Stage;
  /** 단계 1 은 'lower' 고정(0점). 2~5 는 조사자 선택. */
  bound: Bound;
  /** 파생 점수 (stage·bound) */
  score: number;
}

export interface Condition {
  persistence: RatedItem | null;
  aperture: RatedItem | null;
  roughness: RatedItem | null;
  infilling: RatedItem | null;
  weathering: RatedItem | null;

  // 부가 실측/기술값 (선택)
  persistenceValue_m?: number;
  apertureValue_mm?: number;
  infillingMaterial?: string;
  infillingWidth_mm?: number;

  // 자동 계산 결과 (저장)
  sum: number;
  mean: number;
  score: number;
  complete: boolean;
  scoringConfigVersion: string;

  freeText: string;
}

export function emptyCondition(): Condition {
  return {
    persistence: null,
    aperture: null,
    roughness: null,
    infilling: null,
    weathering: null,
    sum: 0,
    mean: 0,
    score: 0,
    complete: false,
    scoringConfigVersion: SCORING_CONFIG_VERSION,
    freeText: '',
  };
}

/** 단계·구간선택 → 점수. 단계 1 은 항상 0. */
export function scoreFor(stage: Stage, bound: Bound): number {
  const opts = STAGE_SCORES[stage];
  if (opts.length === 1) return opts[0];
  return bound === 'lower' ? opts[0] : opts[1];
}

export function makeRatedItem(stage: Stage, bound: Bound = 'lower'): RatedItem {
  const b: Bound = stage === 1 ? 'lower' : bound;
  return { stage, bound: b, score: scoreFor(stage, b) };
}

export interface ConditionScore {
  sum: number;
  mean: number;
  /** 절리상태 점수 = round(mean) */
  score: number;
  complete: boolean;
}

export function evaluateCondition(c: Condition): ConditionScore {
  const items = CONDITION_ITEMS.map((k) => c[k]);
  const complete = items.every((it) => it != null);
  const sum = items.reduce((s, it) => s + (it?.score ?? 0), 0);
  const mean = Math.round((sum / 5) * 10) / 10;
  const score = Math.round(sum / 5);
  return { sum, mean, score, complete };
}

/** evaluateCondition 결과를 Condition 에 반영한 새 객체 */
export function withScores(c: Condition): Condition {
  const { sum, mean, score, complete } = evaluateCondition(c);
  return { ...c, sum, mean, score, complete, scoringConfigVersion: SCORING_CONFIG_VERSION };
}

// ─────────────────────────────────────────────────────────────
// 실측값 → 단계 자동 산출
// ─────────────────────────────────────────────────────────────

/** 표 14.8 연장성: <1 / 1~3 / 3~10 / 10~20 / >20 (m) */
export function persistenceStageFromM(m: number): Stage {
  if (!Number.isFinite(m) || m < 1) return 1;
  if (m < 3) return 2;
  if (m < 10) return 3;
  if (m < 20) return 4;
  return 5;
}

/** 상세표 ②틈새: 밀착 / <0.1 / 0.1~1 / 1~5 / ≥5 (mm) */
export function apertureStageFromMm(mm: number): Stage {
  if (!Number.isFinite(mm) || mm < 0.001) return 1;
  if (mm < 0.1) return 2;
  if (mm < 1) return 3;
  if (mm < 5) return 4;
  return 5;
}

export type InfillingMaterialKind = 'none' | 'hard' | 'soft';

/** ④충진물질: 재료(없음/단단/연약) + 두께(<5 / ≥5 mm) → 단계 */
export function infillingStage(kind: InfillingMaterialKind, width_mm: number): Stage {
  if (kind === 'none') return 1;
  const thick = Number.isFinite(width_mm) && width_mm >= 5;
  if (kind === 'hard') return thick ? 3 : 2;
  return thick ? 5 : 4; // soft
}

// ─────────────────────────────────────────────────────────────
// 간격 (표 14.7) — 배점 미반영, DiscontinuitySet.spacing
// ─────────────────────────────────────────────────────────────

export const SPACING_CLASSES = [
  's_veryclose',
  's_close',
  's_moderate',
  's_wide',
  's_verywide',
] as const;
export type SpacingClass = (typeof SPACING_CLASSES)[number];

export const SPACING_LABELS: Record<SpacingClass, string> = {
  s_veryclose: '매우 조밀 (< 0.06m)',
  s_close: '조밀 (0.06~0.2m)',
  s_moderate: '보통 (0.2~0.6m)',
  s_wide: '넓음 (0.6~2m)',
  s_verywide: '매우 넓음 (≥ 2m)',
};

/** Excel 등 표기용 범위 텍스트 */
export const SPACING_RANGE_TEXT: Record<SpacingClass, string> = {
  s_veryclose: '< 0.06m',
  s_close: '0.06 ~ 0.2m',
  s_moderate: '0.2 ~ 0.6m',
  s_wide: '0.6 ~ 2m',
  s_verywide: '≥ 2m',
};

export function spacingClassFromM(m: number): SpacingClass {
  if (!Number.isFinite(m)) return 's_moderate';
  if (m < 0.06) return 's_veryclose';
  if (m < 0.2) return 's_close';
  if (m < 0.6) return 's_moderate';
  if (m < 2) return 's_wide';
  return 's_verywide';
}

// ─────────────────────────────────────────────────────────────
// 누수 (표 14.12) — 측점 공통
// ─────────────────────────────────────────────────────────────

export const SEEPAGE_CLASSES = ['g_dry', 'g_damp', 'g_wet', 'g_dropping', 'g_flowing'] as const;
export type SeepageClass = (typeof SEEPAGE_CLASSES)[number];

export const SEEPAGE_LABELS: Record<SeepageClass, string> = {
  g_dry: '완전건조',
  g_damp: '습함',
  g_wet: '젖어있음',
  g_dropping: '떨어짐',
  g_flowing: '흐름',
};
