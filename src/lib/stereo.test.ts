import { describe, expect, it } from 'vitest';
import { kinematic3 } from './kinematic';
import { clusterPoles, suggestK } from './setCluster';
import { stereoSvg, wulff } from './stereo';

const P05A = [[88, 260], [80, 210], [65, 16], [75, 20], [85, 256], [75, 205], [43, 280], [53, 15], [80, 267], [75, 215], [66, 25]].map(([dip, dipDir]) => ({ dip, dipDir }));

describe('평사투영도', () => {
  it('등각투영: 연직 극점은 중심, 수평 극점은 가장자리(r=1)', () => {
    const c = wulff([0, 0, 1]);
    expect(Math.hypot(...c)).toBeCloseTo(0, 6);
    const e = wulff([1, 0, 0]);
    expect(Math.hypot(...e)).toBeCloseTo(1, 6);
  });
  it('SVG 에 극점·Set·범례가 들어간다', () => {
    const r = clusterPoles(P05A, 3);
    const svg = stereoSvg({ poles: P05A, sets: r.sets.map((s, i) => ({ dip: s.dip, dipDir: s.dipDir, name: 'J' + (i + 1) })), slope: { dip: 37, dipDir: 232, friction: 30 }, kind: 'toppling' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('J1');
    expect(svg).toContain('등각투영망');
    expect(svg.match(/fill="#ff6a00"/g)!.length).toBe(P05A.length);
  });
  it('Set 개수 제안: 샘플 05장 Site-A 는 3', () => {
    const s = suggestK(P05A);
    expect(s).not.toBeNull();
    expect(s!.k).toBe(3);
  });
  it('극점이 적으면 제안 없음', () => {
    expect(suggestK(P05A.slice(0, 4))).toBeNull();
  });
});

describe('3단계 판정', () => {
  it('평균은 낮아도 개별 극점이 기준을 만족하면 국부적', () => {
    const slope = { dip: 60, dipDir: 180, friction: 30 };
    // SET1: 사면 반대 방향 가파른 면 다수(평균은 전도 기준 만족) 이 아니라, 평균 방향은 무관하고 극점 하나만 전도 기준
    const poles = [{ dip: 50, dipDir: 90 }, { dip: 52, dipDir: 95 }, { dip: 80, dipDir: 10 }, { dip: 48, dipDir: 100 }];
    const labels = [0, 0, 1, 0];
    const sets = [{ dip: 50, dipDir: 95 }, { dip: 80, dipDir: 10 }];
    const r = kinematic3(poles, labels, sets, slope);
    expect(r.toppling.level).toBe('possible'); // SET2 평균(80/010)이 전도 기준
    const r2 = kinematic3(poles, [0, 0, 0, 0], [{ dip: 55, dipDir: 60 }], slope);
    expect(r2.toppling.level).toBe('local'); // 평균 55/060 은 아니지만 80/010 극점 하나가 기준
    expect(r2.planar.level).toBe('none');
  });
});
