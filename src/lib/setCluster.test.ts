import { describe, expect, it } from 'vitest';
import { clusterPoles, planeAngle } from './setCluster';

// 04-1 샘플(보고서 완성본) 사이트별 측정과 그 Set 결과(J1~J3)
const CASES: { name: string; pts: [number, number][]; want: [number, number][] }[] = [
  { name: '05장 Site-A', pts: [[88, 260], [80, 210], [65, 16], [75, 20], [85, 256], [75, 205], [43, 280], [53, 15], [80, 267], [75, 215], [66, 25]], want: [[65, 19], [77, 210], [84, 261]] },
  { name: '04장 Site-A', pts: [[81, 210], [75, 210], [28, 39], [24, 59], [33, 55], [80, 201], [77, 203]], want: [[28, 51], [78, 206]] },
];

describe('극점 Set 자동 분류', () => {
  for (const c of CASES) {
    it(c.name + ': 샘플 Set 평균과 가깝다', () => {
      const r = clusterPoles(c.pts.map(([dip, dipDir]) => ({ dip, dipDir })), c.want.length === 2 ? 3 : 3);
      for (const w of c.want) {
        const near = Math.min(...r.sets.map((s) => planeAngle(s, { dip: w[0], dipDir: w[1] })));
        expect(near).toBeLessThan(8);
      }
    });
  }
  it('같은 입력이면 같은 결과', () => {
    const p = CASES[0].pts.map(([dip, dipDir]) => ({ dip, dipDir }));
    expect(clusterPoles(p, 3)).toEqual(clusterPoles(p, 3));
  });
  it('극점이 적으면 극점 수만큼만', () => {
    expect(clusterPoles([{ dip: 50, dipDir: 100 }], 3).sets.length).toBe(1);
  });
});
