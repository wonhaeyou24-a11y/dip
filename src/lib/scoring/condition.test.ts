import { describe, expect, it } from 'vitest';
import {
  apertureStageFromMm,
  emptyCondition,
  evaluateCondition,
  infillingStage,
  makeRatedItem,
  persistenceStageFromM,
  scoreFor,
  spacingClassFromM,
  withScores,
} from './condition';

describe('scoreFor', () => {
  it('단계 1 → 0점', () => {
    expect(scoreFor(1, 'lower')).toBe(0);
    expect(scoreFor(1, 'upper')).toBe(0);
  });
  it('단계 3 → 3(하한) / 4(상한)', () => {
    expect(scoreFor(3, 'lower')).toBe(3);
    expect(scoreFor(3, 'upper')).toBe(4);
  });
  it('단계 5 → 7 / 8', () => {
    expect(scoreFor(5, 'lower')).toBe(7);
    expect(scoreFor(5, 'upper')).toBe(8);
  });
});

describe('evaluateCondition — 세부지침 예시 (Site-A Set 1)', () => {
  it('① 1~3m(1~2,2) ② 0.1~1(3~4,4) ③ 약간거침(3~4,4) ④ 연약<5(5~6,5) ⑤ 보통풍화(3~4,4) → 합19, 평균3.8, 점수4', () => {
    const c = withScores({
      ...emptyCondition(),
      persistence: makeRatedItem(2, 'upper'), // 2
      aperture: makeRatedItem(3, 'upper'), // 4
      roughness: makeRatedItem(3, 'upper'), // 4
      infilling: makeRatedItem(4, 'lower'), // 5
      weathering: makeRatedItem(3, 'upper'), // 4
    });
    expect(c.sum).toBe(19);
    expect(c.mean).toBe(3.8);
    expect(c.score).toBe(4);
    expect(c.complete).toBe(true);
  });

  it('미완성이면 complete=false, 채운 항목만 합산', () => {
    const r = evaluateCondition({
      ...emptyCondition(),
      persistence: makeRatedItem(2, 'lower'),
    });
    expect(r.complete).toBe(false);
    expect(r.sum).toBe(1);
  });

  it('전부 1단계 → 점수 0', () => {
    const c = withScores({
      ...emptyCondition(),
      persistence: makeRatedItem(1),
      aperture: makeRatedItem(1),
      roughness: makeRatedItem(1),
      infilling: makeRatedItem(1),
      weathering: makeRatedItem(1),
    });
    expect(c.sum).toBe(0);
    expect(c.score).toBe(0);
  });

  it('반올림: 합 17 → 평균 3.4 → 점수 3 / 합 18 → 3.6 → 4', () => {
    const base = (scores: number[]) =>
      withScores({
        ...emptyCondition(),
        persistence: { stage: 3, bound: 'lower', score: scores[0] },
        aperture: { stage: 3, bound: 'lower', score: scores[1] },
        roughness: { stage: 3, bound: 'lower', score: scores[2] },
        infilling: { stage: 3, bound: 'lower', score: scores[3] },
        weathering: { stage: 3, bound: 'lower', score: scores[4] },
      });
    expect(base([3, 3, 3, 4, 4]).score).toBe(3); // 17/5=3.4
    expect(base([4, 4, 3, 3, 4]).score).toBe(4); // 18/5=3.6
  });
});

describe('실측값 → 단계', () => {
  it('연장성 m', () => {
    expect(persistenceStageFromM(0.5)).toBe(1);
    expect(persistenceStageFromM(2)).toBe(2);
    expect(persistenceStageFromM(7)).toBe(3);
    expect(persistenceStageFromM(15)).toBe(4);
    expect(persistenceStageFromM(25)).toBe(5);
  });
  it('틈새 mm', () => {
    expect(apertureStageFromMm(0)).toBe(1);
    expect(apertureStageFromMm(0.05)).toBe(2);
    expect(apertureStageFromMm(0.5)).toBe(3);
    expect(apertureStageFromMm(3)).toBe(4);
    expect(apertureStageFromMm(8)).toBe(5);
  });
  it('충진물질 재료·두께', () => {
    expect(infillingStage('none', 0)).toBe(1);
    expect(infillingStage('hard', 3)).toBe(2);
    expect(infillingStage('hard', 6)).toBe(3);
    expect(infillingStage('soft', 3)).toBe(4);
    expect(infillingStage('soft', 9)).toBe(5);
  });
  it('간격 등급 (표 14.7)', () => {
    expect(spacingClassFromM(0.03)).toBe('s_veryclose');
    expect(spacingClassFromM(0.1)).toBe('s_close');
    expect(spacingClassFromM(0.4)).toBe('s_moderate');
    expect(spacingClassFromM(1)).toBe('s_wide');
    expect(spacingClassFromM(3)).toBe('s_verywide');
  });
});
