import { describe, expect, it } from 'vitest';
import {
  combineSamples,
  formatDipDipDir,
  orientationFromEuler,
  orientationFromPole,
  poleFromMatrix,
  rotationMatrixFromEuler,
  type Sample,
} from './orientation';

const near = (a: number, b: number, tol = 0.2) => Math.abs(a - b) <= tol;

describe('orientationFromPole', () => {
  it('수평면: pole = 위쪽 → 경사 0', () => {
    const o = orientationFromPole(0, 0, 1);
    expect(o.dip).toBe(0);
    expect(o.dipDirection).toBe(0);
  });

  it('동쪽으로 45° 경사: pole (E,0,U 균등)', () => {
    const o = orientationFromPole(1, 0, 1);
    expect(near(o.dip, 45)).toBe(true);
    expect(near(o.dipDirection, 90)).toBe(true);
    expect(near(o.strike, 0)).toBe(true);
  });

  it('북쪽으로 30° 경사', () => {
    const o = orientationFromPole(0, Math.sin(30 * Math.PI / 180), Math.cos(30 * Math.PI / 180));
    expect(near(o.dip, 30)).toBe(true);
    expect(near(o.dipDirection, 0)).toBe(true);
    expect(near(o.strike, 270)).toBe(true);
  });

  it('수직면, 법선이 동쪽 → 경사 90 / 경사방향 090', () => {
    const o = orientationFromPole(1, 0, 0);
    expect(near(o.dip, 90)).toBe(true);
    expect(near(o.dipDirection, 90)).toBe(true);
  });

  it('overhang(up<0)이면 법선을 뒤집어 상반구로', () => {
    const o = orientationFromPole(0.5, 0, -0.866); // 뒤집으면 (-0.5,0,0.866)
    expect(near(o.dip, 30)).toBe(true);
    expect(near(o.dipDirection, 270)).toBe(true); // 서쪽 경사
  });

  it('자기편각 보정 적용', () => {
    const base = orientationFromPole(1, 0, 1);
    const corr = orientationFromPole(1, 0, 1, { declinationDeg: 10 });
    expect(near(corr.dipDirection, base.dipDirection + 10)).toBe(true);
    expect(near(corr.strike, (base.strike + 10) % 360)).toBe(true);
  });
});

describe('rotationMatrixFromEuler / poleFromMatrix', () => {
  it('0,0,0 → 단위행렬 3번째 열 = (0,0,1)', () => {
    const p = poleFromMatrix(rotationMatrixFromEuler(0, 0, 0));
    expect(near(p[0], 0)).toBe(true);
    expect(near(p[1], 0)).toBe(true);
    expect(near(p[2], 1)).toBe(true);
  });
});

describe('orientationFromEuler (측정 자세 시나리오)', () => {
  it('폰 수평(화면 위) → 경사 0', () => {
    expect(orientationFromEuler(0, 0, 0).dip).toBe(0);
  });

  it('폰을 앞으로 90° 기울임(beta=90) → 수직면, 남쪽 경사', () => {
    const o = orientationFromEuler(0, 90, 0);
    expect(near(o.dip, 90)).toBe(true);
    expect(near(o.dipDirection, 180)).toBe(true);
  });

  it('폰을 옆으로 90° 굴림(gamma=90) → 수직면, 동쪽 경사', () => {
    const o = orientationFromEuler(0, 0, 90);
    expect(near(o.dip, 90)).toBe(true);
    expect(near(o.dipDirection, 90)).toBe(true);
  });

  it('수평 상태에서 방위(alpha)만 회전 → 경사 불변 0', () => {
    expect(orientationFromEuler(137, 0, 0).dip).toBe(0);
  });
});

describe('combineSamples', () => {
  const mk = (a: number, b: number, g: number): Sample => ({ alpha: a, beta: b, gamma: g });

  it('동일 샘플 반복 → rating good, 편차 0', () => {
    const r = combineSamples([mk(30, 40, 10), mk(30, 40, 10), mk(30, 40, 10)]);
    expect(r.quality.rating).toBe('good');
    expect(r.quality.spreadDeg).toBe(0);
    expect(r.quality.sampleCount).toBe(3);
  });

  it('흔들린 샘플 → rating 저하', () => {
    const r = combineSamples([mk(30, 40, 10), mk(50, 20, -15), mk(10, 60, 35)]);
    expect(r.quality.rating).not.toBe('good');
    expect(r.quality.spreadDeg).toBeGreaterThan(4);
  });

  it('빈 입력 방어', () => {
    const r = combineSamples([]);
    expect(r.quality.sampleCount).toBe(0);
  });
});

describe('formatDipDipDir', () => {
  it('경사/경사방향 DD/DDD 포맷', () => {
    expect(formatDipDipDir({ dip: 83, dipDirection: 89, strike: 359 })).toBe('83/089');
    expect(formatDipDipDir({ dip: 5, dipDirection: 7, strike: 277 })).toBe('05/007');
  });
});
