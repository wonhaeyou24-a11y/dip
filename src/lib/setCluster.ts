/**
 * 극점 → 절리군(Set) 자동 분류 (순수 함수).
 * 평사투영 프로그램(Dips 등)과 같은 방식: 극점은 축 자료(방향이 반대여도 같은 면)로 보고,
 * 퍼지 K-means(구면 거리 d² = 1 − (x·c)²)로 묶은 뒤 Set 평균은 방향텐서의 고유벡터로 구한다.
 * 같은 입력이면 항상 같은 결과가 나오도록 난수는 고정 시드를 쓴다.
 */
export interface Pole {
  dip: number;
  dipDir: number;
}
export interface SetResult {
  dip: number;
  dipDir: number;
  count: number;
  /** Fisher 집중도 K (극점이 2개 미만이면 null) */
  fisherK: number | null;
  members: number[];
}
export interface ClusterResult {
  sets: SetResult[];
  /** 극점마다 소속 Set 번호(0부터), 예외 극점은 -1 */
  labels: number[];
}

type V3 = [number, number, number];
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** 극점의 단위벡터 (동·북·아래). 극점 plunge = 90 − dip, trend = 경사방향 + 180 */
export function poleVec(p: Pole): V3 {
  const pl = (90 - p.dip) * RAD;
  const tr = norm360(p.dipDir + 180) * RAD;
  return [Math.cos(pl) * Math.sin(tr), Math.cos(pl) * Math.cos(tr), Math.sin(pl)];
}
export function vecToPlane(v: V3): { dip: number; dipDir: number } {
  let [x, y, z] = v;
  if (z < 0) [x, y, z] = [-x, -y, -z];
  const pl = Math.asin(Math.max(-1, Math.min(1, z))) * DEG;
  const tr = norm360(Math.atan2(x, y) * DEG);
  return { dip: 90 - pl, dipDir: norm360(tr + 180) };
}
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 3x3 대칭행렬의 최대 고유벡터 (거듭제곱법) */
function topEigen(T: number[][], init: V3): V3 {
  let v = init;
  for (let i = 0; i < 60; i++) {
    const n: V3 = [
      T[0][0] * v[0] + T[0][1] * v[1] + T[0][2] * v[2],
      T[1][0] * v[0] + T[1][1] * v[1] + T[1][2] * v[2],
      T[2][0] * v[0] + T[2][1] * v[1] + T[2][2] * v[2],
    ];
    const m = Math.hypot(n[0], n[1], n[2]);
    if (m < 1e-12) break;
    v = [n[0] / m, n[1] / m, n[2] / m];
  }
  return v;
}
function tensor(X: V3[], w: number[]): number[][] {
  const T = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  X.forEach((x, i) => {
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) T[a][b] += w[i] * x[a] * x[b];
  });
  return T;
}
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 두 면 사이의 각(°) — 축 자료라 0~90 */
export function planeAngle(a: Pole, b: Pole): number {
  return Math.acos(Math.min(1, Math.abs(dot(poleVec(a), poleVec(b))))) * DEG;
}

/** 극점들의 평균면(방향텐서 고유벡터) */
export function meanPlane(poles: Pole[], weights?: number[]): SetResult | null {
  if (!poles.length) return null;
  const X = poles.map(poleVec);
  const w = weights ?? X.map(() => 1);
  const c = topEigen(tensor(X, w), X[0]);
  const m = vecToPlane(c);
  let k: number | null = null;
  if (poles.length >= 2) {
    const R = X.reduce((s, x) => s + Math.abs(dot(x, c)), 0);
    const n = poles.length;
    k = R >= n - 1e-9 ? null : (n - 1) / (n - R);
  }
  return { dip: m.dip, dipDir: m.dipDir, count: poles.length, fisherK: k, members: [] };
}

/** 퍼지 K-means 로 k 개 Set 으로 묶는다. 극점이 k 개보다 적으면 극점 수만큼만 나눈다. */
export function clusterPoles(poles: Pole[], kWanted = 3, outlierDeg = 35, m = 2): ClusterResult {
  const n = poles.length;
  if (n === 0) return { sets: [], labels: [] };
  const k = Math.max(1, Math.min(kWanted, n));
  const X = poles.map(poleVec);
  const rand = rng(12345);
  let best: { J: number; C: V3[]; U: number[][] } | null = null;
  const memb = (C: V3[]) => {
    const U = X.map((x) => {
      const d2 = C.map((c) => Math.max(1 - dot(x, c) ** 2, 1e-9));
      const inv = d2.map((d) => Math.pow(1 / d, 1 / (m - 1)));
      const s = inv.reduce((a, b) => a + b, 0);
      return inv.map((v) => v / s);
    });
    return U;
  };
  for (let seed = 0; seed < 30; seed++) {
    const idx: number[] = [];
    while (idx.length < k) {
      const r = Math.floor(rand() * n);
      if (!idx.includes(r)) idx.push(r);
    }
    let C: V3[] = idx.map((i) => X[i]);
    for (let it = 0; it < 100; it++) {
      const U = memb(C);
      const Cn = C.map((c, j) => topEigen(tensor(X, U.map((u) => Math.pow(u[j], m))), c));
      const moved = Cn.some((c, j) => Math.abs(dot(c, C[j])) < 1 - 1e-10);
      C = Cn;
      if (!moved) break;
    }
    const U = memb(C);
    let J = 0;
    X.forEach((x, i) => C.forEach((c, j) => { J += Math.pow(U[i][j], m) * Math.max(1 - dot(x, c) ** 2, 1e-9); }));
    if (!best || J < best.J) best = { J, C, U };
  }
  const b = best!;
  const labels = b.U.map((u) => u.indexOf(Math.max(...u)));
  // 경사방향 순서로 번호를 붙인다 (J1, J2, …)
  const raw = b.C.map((c, j) => ({ j, pl: vecToPlane(c) }));
  raw.sort((p, q) => p.pl.dipDir - q.pl.dipDir);
  const remap = new Map(raw.map((r, i) => [r.j, i]));
  const lab2 = labels.map((l) => remap.get(l)!);
  // 자기 Set 평균에서 너무 먼 극점(기본 35° 초과)은 어느 Set 에도 넣지 않고(-1) 평균에서 뺀다 — 예외 극점
  const sets: SetResult[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (let s = 0; s < k; s++) {
      const mem = lab2.map((l, i) => (l === s ? i : -1)).filter((i) => i >= 0);
      const mp = mem.length >= 3 ? meanPlane(mem.map((i) => poles[i])) : null;
      if (mp) mem.forEach((i) => { if (planeAngle(poles[i], mp) > outlierDeg) lab2[i] = -1; });
    }
  }
  for (let s = 0; s < k; s++) {
    const members = lab2.map((l, i) => (l === s ? i : -1)).filter((i) => i >= 0);
    const mp = members.length ? meanPlane(members.map((i) => poles[i])) : null;
    const pl = mp ?? vecToPlane(b.C[raw[s].j]);
    sets.push({ dip: pl.dip, dipDir: pl.dipDir, count: members.length, fisherK: mp ? mp.fisherK : null, members });
  }
  return { sets, labels: lab2 };
}

/** 사용자가 극점을 다른 Set 으로 옮긴 뒤 평균을 다시 계산 */
export function recomputeSets(poles: Pole[], labels: number[], k: number): SetResult[] {
  const out: SetResult[] = [];
  for (let s = 0; s < k; s++) {
    const members = labels.map((l, i) => (l === s ? i : -1)).filter((i) => i >= 0);
    const mp = meanPlane(members.map((i) => poles[i]));
    out.push({ dip: mp?.dip ?? 0, dipDir: mp?.dipDir ?? 0, count: members.length, fisherK: mp?.fisherK ?? null, members });
  }
  return out;
}

/** 두 극점 사이각(°, 축 자료) */
function ang(a: Pole, b: Pole): number {
  return planeAngle(a, b);
}

/**
 * Set 개수 제안: k=1~5 로 묶어 보고 실루엣 점수(군집 응집·분리)가 가장 좋은 k 를 고른다.
 * 극점이 6개 미만이면 제안하지 않는다. quality 는 -1~1 (0.5 이상이면 뚜렷).
 */
export function suggestK(poles: Pole[], maxK = 5): { k: number; quality: number; scores: { k: number; q: number }[] } | null {
  if (poles.length < 6) return null;
  const scores: { k: number; q: number }[] = [];
  for (let k = 2; k <= Math.min(maxK, Math.floor(poles.length / 2)); k++) {
    const r = clusterPoles(poles, k);
    const lab = r.labels;
    let sum = 0;
    let cnt = 0;
    poles.forEach((p, i) => {
      if (lab[i] < 0) return;
      const own: number[] = [];
      const other = new Map<number, number[]>();
      poles.forEach((q, j) => {
        if (i === j || lab[j] < 0) return;
        const d = ang(p, q);
        if (lab[j] === lab[i]) own.push(d);
        else other.set(lab[j], [...(other.get(lab[j]) ?? []), d]);
      });
      if (!own.length || !other.size) return;
      const a = own.reduce((x, y) => x + y, 0) / own.length;
      const b = Math.min(...[...other.values()].map((v) => v.reduce((x, y) => x + y, 0) / v.length));
      sum += (b - a) / Math.max(a, b, 1e-9);
      cnt++;
    });
    scores.push({ k, q: cnt ? sum / cnt : -1 });
  }
  if (!scores.length) return null;
  const best = scores.slice().sort((x, y) => y.q - x.q)[0];
  return { k: best.k, quality: best.q, scores };
}
