/**
 * 평사투영 운동학적 안정 검토 (Markland·Hocking 방식, 순수 함수) — 평면파괴·쐐기파괴·전도파괴 가능성.
 * 입력: Set 평균면(경사/경사방향), 사면(경사/경사방향), 마찰각.
 * 기준값(허용 방향 편차 등)은 옵션으로 바꿀 수 있고, 결과는 "가능성 검토"이며 최종 판단은 기술자가 한다.
 */
export interface Plane {
  dip: number;
  dipDir: number;
}
export interface SlopeInfo {
  dip: number;
  dipDir: number;
  friction: number;
}
export interface KinOptions {
  /** 평면파괴: 사면 경사방향과의 허용 편차(°) — 기본 20 */
  planarDirTol?: number;
  /** 전도파괴: 사면 반대방향(경사방향+180)과의 허용 편차(°) — 기본 20 */
  topplingDirTol?: number;
}
export interface KinResult {
  planar: { set: number; ok: boolean; reason: string }[];
  wedge: { a: number; b: number; trend: number; plunge: number; ok: boolean; reason: string }[];
  toppling: { set: number; ok: boolean; reason: string }[];
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;
/** 두 방위 사이의 작은 각 (0~180) */
export const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function normal(p: Plane): [number, number, number] {
  // 위쪽을 향하지 않는 법선: 경사방향 쪽으로 기운 평면의 아래쪽 법선 (동, 북, 위)
  const d = p.dip * RAD;
  const t = p.dipDir * RAD;
  return [Math.sin(d) * Math.sin(t), Math.sin(d) * Math.cos(t), Math.cos(d)];
}

/** 두 평면의 교선(아래로 향하는 선)의 방향(trend)·침강(plunge) */
export function intersection(a: Plane, b: Plane): { trend: number; plunge: number } | null {
  const n1 = normal(a);
  const n2 = normal(b);
  let v: [number, number, number] = [
    n1[1] * n2[2] - n1[2] * n2[1],
    n1[2] * n2[0] - n1[0] * n2[2],
    n1[0] * n2[1] - n1[1] * n2[0],
  ];
  const m = Math.hypot(v[0], v[1], v[2]);
  if (m < 1e-6) return null; // 평행
  v = [v[0] / m, v[1] / m, v[2] / m];
  if (v[2] > 0) v = [-v[0], -v[1], -v[2]]; // 아래로 향하게
  return { trend: norm360(Math.atan2(v[0], v[1]) * DEG), plunge: Math.asin(Math.min(1, -v[2])) * DEG };
}

export function kinematic(sets: Plane[], slope: SlopeInfo, opt: KinOptions = {}): KinResult {
  const pTol = opt.planarDirTol ?? 20;
  const tTol = opt.topplingDirTol ?? 20;
  const res: KinResult = { planar: [], wedge: [], toppling: [] };
  sets.forEach((s, i) => {
    const dd = angDiff(s.dipDir, slope.dipDir);
    const day = s.dip < slope.dip;
    const fr = s.dip > slope.friction;
    const ok = dd <= pTol && day && fr;
    res.planar.push({
      set: i,
      ok,
      reason: ok
        ? `방향 차 ${dd.toFixed(0)}°, 경사 ${s.dip.toFixed(0)}° < 사면 ${slope.dip}°, > 마찰각 ${slope.friction}°`
        : dd > pTol
          ? `방향 차 ${dd.toFixed(0)}° (허용 ${pTol}° 초과)`
          : !day
            ? `경사 ${s.dip.toFixed(0)}° ≥ 사면 ${slope.dip}° (사면에 노출 안 됨)`
            : `경사 ${s.dip.toFixed(0)}° ≤ 마찰각 ${slope.friction}° (미끄러지지 않음)`,
    });
    // 전도: 사면 안쪽으로 가파르게 기운 면(경사방향 ≈ 사면 반대) 이고 (90−경사)+φ < 사면경사
    const ddT = angDiff(s.dipDir, norm360(slope.dipDir + 180));
    const tp = ddT <= tTol && 90 - s.dip + slope.friction < slope.dip;
    res.toppling.push({
      set: i,
      ok: tp,
      reason: tp
        ? `사면 반대방향 차 ${ddT.toFixed(0)}°, (90−${s.dip.toFixed(0)})+φ ${slope.friction}° < 사면 ${slope.dip}°`
        : ddT > tTol
          ? `사면 반대방향과 ${ddT.toFixed(0)}° 차이 (허용 ${tTol}° 초과)`
          : `(90−${s.dip.toFixed(0)})+φ = ${(90 - s.dip + slope.friction).toFixed(0)}° ≥ 사면 ${slope.dip}°`,
    });
  });
  for (let a = 0; a < sets.length; a++) {
    for (let b = a + 1; b < sets.length; b++) {
      const x = intersection(sets[a], sets[b]);
      if (!x) continue;
      const toward = angDiff(x.trend, slope.dipDir) < 90; // 사면 쪽으로 빠져나가는 교선
      const day = x.plunge < slope.dip;
      const fr = x.plunge > slope.friction;
      const ok = toward && day && fr;
      res.wedge.push({
        a,
        b,
        trend: x.trend,
        plunge: x.plunge,
        ok,
        reason: ok
          ? `교선 ${x.plunge.toFixed(0)}/${x.trend.toFixed(0).padStart(3, '0')}: 사면 노출, 마찰각 초과`
          : !toward
            ? `교선이 사면 안쪽으로 향함 (${x.plunge.toFixed(0)}/${x.trend.toFixed(0).padStart(3, '0')})`
            : !day
              ? `교선 침강 ${x.plunge.toFixed(0)}° ≥ 사면 ${slope.dip}°`
              : `교선 침강 ${x.plunge.toFixed(0)}° ≤ 마찰각 ${slope.friction}°`,
      });
    }
  }
  return res;
}

// ───────── 3단계 판정 (없음 / 국부적 / 가능) — Set 평균 + 개별 극점·교선 ─────────
export type Level = 'none' | 'local' | 'possible';
export const LEVEL_TEXT: Record<Level, string> = { none: '가능성 낮음', local: '국부적 가능성 있음', possible: '가능성 있음' };

export interface Level3 {
  planar: { level: Level; critical: number[]; total: number };
  wedge: { level: Level; critical: [number, number][]; total: number };
  toppling: { level: Level; critical: number[]; total: number };
}

/**
 * poles: 모든 극점, labels: 극점별 Set 번호(-1=예외), sets: Set 평균(번호 순서).
 * possible = Set 평균이 기준을 만족, local = 평균은 아니지만 개별 극점(평면·전도) 또는 서로 다른 Set 극점 쌍의 교선(쐐기 2개 이상)이 기준을 만족.
 */
export function kinematic3(poles: Plane[], labels: number[], sets: Plane[], slope: SlopeInfo, opt: KinOptions = {}): Level3 {
  const pTol = opt.planarDirTol ?? 20;
  const tTol = opt.topplingDirTol ?? 20;
  const mean = kinematic(sets, slope, opt);
  const pCrit = (p: Plane) => angDiff(p.dipDir, slope.dipDir) <= pTol && p.dip < slope.dip && p.dip > slope.friction;
  const tCrit = (p: Plane) => angDiff(p.dipDir, (slope.dipDir + 180) % 360) <= tTol && 90 - p.dip + slope.friction < slope.dip;
  const planar: number[] = [];
  const toppling: number[] = [];
  poles.forEach((p, i) => {
    if (pCrit(p)) planar.push(i);
    if (tCrit(p)) toppling.push(i);
  });
  const wedge: [number, number][] = [];
  let pairs = 0;
  for (let a = 0; a < poles.length; a++) {
    for (let b = a + 1; b < poles.length; b++) {
      if (labels[a] === labels[b] && labels[a] >= 0) continue; // 같은 Set 끼리는 제외
      const x = intersection(poles[a], poles[b]);
      if (!x) continue;
      pairs++;
      if (angDiff(x.trend, slope.dipDir) < 90 && x.plunge < slope.dip && x.plunge > slope.friction) wedge.push([a, b]);
    }
  }
  const lv = (meanOk: boolean, n: number, minLocal: number): Level => (meanOk ? 'possible' : n >= minLocal ? 'local' : 'none');
  return {
    planar: { level: lv(mean.planar.some((r) => r.ok), planar.length, 1), critical: planar, total: poles.length },
    wedge: { level: lv(mean.wedge.some((r) => r.ok), wedge.length, 2), critical: wedge, total: pairs },
    toppling: { level: lv(mean.toppling.some((r) => r.ok), toppling.length, 1), critical: toppling, total: poles.length },
  };
}
