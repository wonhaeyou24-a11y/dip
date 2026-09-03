/**
 * 불연속면 주향·경사 계산 (순수 함수, 센서 API 의존 없음 → 테스트 가능)
 *
 * 측정 자세: 스마트폰의 **뒷면을 불연속면에 밀착**. 화면은 암반 반대쪽을 향함.
 *   → 기기 +Z축(화면 밖 방향)이 불연속면의 바깥쪽 법선(pole)이 된다.
 *
 * 좌표계
 *   기기: x=화면 오른쪽, y=화면 위쪽, z=화면 밖
 *   세계(ENU): x=동(E), y=북(N), z=상(Up)   ← W3C DeviceOrientation / MDN 기준
 *
 * 용어
 *   경사(dip)          평면과 수평면이 이루는 각 (0~90°)
 *   경사방향(dipDir)   경사 최대 방향의 방위각 (북=0, 시계방향, 0~360°)
 *   주향(strike)       우수법(RHR): dipDirection = strike + 90°  →  strike = dipDir - 90°
 */

export interface Orientation {
  /** 경사각 0~90 */
  dip: number;
  /** 경사방향 0~360 (북 기준 시계방향) */
  dipDirection: number;
  /** 주향 0~360 (우수법) */
  strike: number;
}

export interface OrientationOptions {
  /** 자기편각(°). 동편각 +, 서편각 -. 자북 기준 측정값을 진북 기준으로 보정. */
  declinationDeg?: number;
}

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

type Vec3 = [number, number, number];

export function normalize3(v: Vec3): Vec3 {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

/**
 * 평면의 법선벡터(세계 ENU 좌표)로부터 경사·경사방향·주향 산출.
 * @param east  법선의 동쪽 성분
 * @param north 법선의 북쪽 성분
 * @param up    법선의 상방 성분
 */
export function orientationFromPole(
  east: number,
  north: number,
  up: number,
  opts: OrientationOptions = {},
): Orientation {
  let [e, n, u] = normalize3([east, north, up]);

  // pole 은 상반구를 향하도록 (overhang 이면 방향이 뒤집힘 — 일반 절리는 dip ≤ 90)
  if (u < 0) {
    e = -e;
    n = -n;
    u = -u;
  }

  // 경사 = 법선과 연직축이 이루는 각
  const horiz = Math.hypot(e, n);
  const dip = Math.atan2(horiz, u) * DEG; // 0~90

  // 수평면이면 경사방향은 정의되지 않음 → 0 으로
  let dipDirection = 0;
  if (horiz > 1e-9) {
    // 동-북 성분의 방위각 (북=0, 시계방향). 동쪽으로 경사진 면 → 법선 수평성분이 동쪽 → 경사방향 090
    dipDirection = norm360(Math.atan2(e, n) * DEG);
  }

  const declination = opts.declinationDeg ?? 0;
  dipDirection = norm360(dipDirection + declination);
  const strike = norm360(dipDirection - 90);

  return {
    dip: round1(dip),
    dipDirection: round1(dipDirection),
    strike: round1(strike),
  };
}

/**
 * W3C DeviceOrientation 오일러각(alpha,beta,gamma, 도) → 기기→세계 회전행렬 (row-major 3x3).
 * worldVec = R · deviceVec.  (출처: MDN "Orientation and motion data explained")
 */
export function rotationMatrixFromEuler(alphaDeg: number, betaDeg: number, gammaDeg: number): number[] {
  const x = betaDeg * RAD; // X'
  const y = gammaDeg * RAD; // Y''
  const z = alphaDeg * RAD; // Z

  const cX = Math.cos(x), cY = Math.cos(y), cZ = Math.cos(z);
  const sX = Math.sin(x), sY = Math.sin(y), sZ = Math.sin(z);

  const m11 = cZ * cY - sZ * sX * sY;
  const m12 = -cX * sZ;
  const m13 = cY * sZ * sX + cZ * sY;

  const m21 = cY * sZ + cZ * sX * sY;
  const m22 = cZ * cX;
  const m23 = sZ * sY - cZ * cY * sX;

  const m31 = -cX * sY;
  const m32 = sX;
  const m33 = cX * cY;

  return [m11, m12, m13, m21, m22, m23, m31, m32, m33];
}

/** 기기→세계 회전행렬에서 기기 +Z축(=평면 법선)의 세계좌표 성분 [E, N, U]. */
export function poleFromMatrix(m: number[]): Vec3 {
  // 3x3 row-major 의 3번째 열
  return [m[2], m[5], m[8]];
}

export function orientationFromEuler(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  opts: OrientationOptions = {},
): Orientation {
  const m = rotationMatrixFromEuler(alphaDeg, betaDeg, gammaDeg);
  const [e, n, u] = poleFromMatrix(m);
  return orientationFromPole(e, n, u, opts);
}

// ─────────────────────────────────────────────────────────────
// 여러 샘플 결합 (안정화 구간 평균 + 신뢰도)
// ─────────────────────────────────────────────────────────────

export interface Sample {
  alpha: number;
  beta: number;
  gamma: number;
}

export type QualityRating = 'good' | 'fair' | 'poor';

export interface MeasurementQuality {
  /** 샘플 pole 벡터들이 평균 pole 에서 벗어난 평균각(°). 작을수록 안정. */
  spreadDeg: number;
  /** 경사각 표준편차(°) */
  dipStdDeg: number;
  /** 경사방향 표준편차(°, 원형) */
  dipDirStdDeg: number;
  sampleCount: number;
  rating: QualityRating;
}

export interface MeasurementResult {
  orientation: Orientation;
  quality: MeasurementQuality;
  /** 평균 법선벡터 [E,N,U] (디버깅/재현용) */
  meanPole: Vec3;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

function circularStdDeg(anglesDeg: number[]): number {
  if (anglesDeg.length === 0) return 0;
  let sx = 0;
  let sy = 0;
  for (const a of anglesDeg) {
    sx += Math.cos(a * RAD);
    sy += Math.sin(a * RAD);
  }
  const r = Math.hypot(sx, sy) / anglesDeg.length;
  if (r >= 1) return 0;
  // Mardia circular standard deviation
  return Math.sqrt(-2 * Math.log(r)) * DEG;
}

function std(xs: number[]): number {
  if (xs.length === 0) return 0;
  const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
  const varr = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
  return Math.sqrt(varr);
}

/** 각 사이 각도(°, 0~180) */
function angleBetween(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return Math.acos(d) * DEG;
}

/**
 * 안정화 구간 샘플들을 결합. 법선벡터를 벡터 평균하여 경사방향 wraparound 를 자연스럽게 처리.
 */
export function combineSamples(samples: Sample[], opts: OrientationOptions = {}): MeasurementResult {
  if (samples.length === 0) {
    return {
      orientation: { dip: 0, dipDirection: 0, strike: 270 },
      quality: { spreadDeg: 0, dipStdDeg: 0, dipDirStdDeg: 0, sampleCount: 0, rating: 'poor' },
      meanPole: [0, 0, 1],
    };
  }

  const poles: Vec3[] = [];
  const dips: number[] = [];
  const dipDirs: number[] = [];

  for (const s of samples) {
    const m = rotationMatrixFromEuler(s.alpha, s.beta, s.gamma);
    let p = normalize3(poleFromMatrix(m));
    if (p[2] < 0) p = [-p[0], -p[1], -p[2]];
    poles.push(p);
    const o = orientationFromPole(p[0], p[1], p[2], opts);
    dips.push(o.dip);
    dipDirs.push(o.dipDirection);
  }

  // 벡터 평균 pole
  let mp: Vec3 = [0, 0, 0];
  for (const p of poles) {
    mp[0] += p[0];
    mp[1] += p[1];
    mp[2] += p[2];
  }
  mp = normalize3(mp);
  if (mp[2] < 0) mp = [-mp[0], -mp[1], -mp[2]];

  const orientation = orientationFromPole(mp[0], mp[1], mp[2], opts);

  const spreadDeg = poles.reduce((s, p) => s + angleBetween(p, mp), 0) / poles.length;
  const dipStdDeg = std(dips);
  const dipDirStdDeg = circularStdDeg(dipDirs);

  let rating: QualityRating = 'poor';
  if (spreadDeg < 1.5 && dipStdDeg < 1 && dipDirStdDeg < 2) rating = 'good';
  else if (spreadDeg < 4 && dipStdDeg < 2.5 && dipDirStdDeg < 5) rating = 'fair';

  return {
    orientation,
    quality: {
      spreadDeg: round1(spreadDeg),
      dipStdDeg: round1(dipStdDeg),
      dipDirStdDeg: round1(dipDirStdDeg),
      sampleCount: samples.length,
      rating,
    },
    meanPole: mp,
  };
}

/** 표기용: "83/089" (경사/경사방향) */
export function formatDipDipDir(o: Orientation): string {
  const dd = Math.round(o.dip).toString().padStart(2, '0');
  const az = Math.round(norm360(o.dipDirection)).toString().padStart(3, '0');
  return `${dd}/${az}`;
}
