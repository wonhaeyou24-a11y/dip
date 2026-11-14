import { describe, expect, it } from 'vitest';
import { intersection, kinematic } from './kinematic';

const slope = { dip: 60, dipDir: 180, friction: 30 };

describe('운동학적 검토', () => {
  it('평면파괴: 사면과 같은 방향, 마찰각보다 가파르고 사면보다 완만', () => {
    const r = kinematic([{ dip: 45, dipDir: 185 }, { dip: 70, dipDir: 180 }, { dip: 45, dipDir: 270 }, { dip: 20, dipDir: 180 }], slope);
    expect(r.planar.map((p) => p.ok)).toEqual([true, false, false, false]);
  });
  it('전도파괴: 사면 안쪽으로 가파르게 기운 면', () => {
    const r = kinematic([{ dip: 80, dipDir: 5 }, { dip: 50, dipDir: 0 }, { dip: 80, dipDir: 180 }], slope);
    expect(r.toppling.map((p) => p.ok)).toEqual([true, false, false]);
  });
  it('교선: 수직면 두 개가 만나면 수직선, 알려진 값', () => {
    const x = intersection({ dip: 90, dipDir: 90 }, { dip: 90, dipDir: 0 });
    expect(x!.plunge).toBeCloseTo(90, 3);
    // 경사방향 90/경사 45 와 경사방향 270/경사 45 의 교선은 남북 수평선
    const y = intersection({ dip: 45, dipDir: 90 }, { dip: 45, dipDir: 270 })!;
    expect(y.plunge).toBeCloseTo(0, 3);
  });
  it('쐐기파괴: 사면 쪽으로 빠지는 교선', () => {
    // 두 면이 모두 남쪽(사면 방향)으로 기울되 방향이 다르면 교선이 남쪽으로 침강
    const r = kinematic([{ dip: 55, dipDir: 150 }, { dip: 55, dipDir: 210 }], slope);
    expect(r.wedge.length).toBe(1);
    expect(r.wedge[0].plunge).toBeGreaterThan(30);
    expect(r.wedge[0].plunge).toBeLessThan(60);
    expect(r.wedge[0].ok).toBe(true);
  });
  it('평행한 면은 교선 없음', () => {
    expect(intersection({ dip: 40, dipDir: 100 }, { dip: 40, dipDir: 100 })).toBeNull();
  });
});
