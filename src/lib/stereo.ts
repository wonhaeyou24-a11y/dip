/**
 * 평사투영도 그리기 (순수 함수, SVG 문자열) — 샘플 보고서와 같은 등각투영망(울프) 하반구 투영.
 * 피셔 분포 밀도 등고선(회색 단계) + 극점(주황) + 사면 대원·마찰원(파랑) + Set 대원·극점(분홍, J1~).
 * 데스크(sync/stereoPlot.js)와 같은 코드다 — 한쪽을 고치면 다른 쪽도 같이 고칠 것.
 */
import { poleVec, type Pole } from './setCluster';

export interface PlotSet {
  dip: number;
  dipDir: number;
  name: string;
}
export interface PlotSlope {
  dip: number;
  dipDir: number;
  friction: number;
}
export type PlotKind = 'plain' | 'planar' | 'toppling';
export interface PlotOptions {
  poles: Pole[];
  sets?: PlotSet[];
  slope?: PlotSlope | null;
  kind?: PlotKind;
  size?: number;
  legend?: boolean;
  /** 영역 표시에 쓰는 허용 방향 편차(°) */
  tol?: number;
}

const RAD = Math.PI / 180;
const R = 200; // 원 반지름(px)
const CX = 250;
const CY = 230;
const FISHER_K = 50; // 계수 면적률 약 1% (1/(2K))

/** 단위벡터(동·북·아래) → 원 안 좌표(등각투영: r = tan(θ/2), θ = 연직에서 떨어진 각) */
export function wulff(v: [number, number, number]): [number, number] {
  let [x, y, z] = v;
  if (z < 0) [x, y, z] = [-x, -y, -z];
  const th = Math.acos(Math.min(1, z));
  const r = Math.tan(th / 2);
  const h = Math.hypot(x, y) || 1;
  return [(x / h) * r, -(y / h) * r];
}
const px = (p: [number, number]): [number, number] => [CX + p[0] * R, CY + p[1] * R];
const f1 = (n: number) => n.toFixed(1);

/** 평면(경사/경사방향)의 대원 점들 */
export function greatCirclePoints(dip: number, dipDir: number): [number, number][] {
  const strike = dipDir - 90;
  const pts: [number, number][] = [];
  for (let a = 0; a <= 180; a += 2) {
    const pl = Math.atan(Math.tan(dip * RAD) * Math.sin(a * RAD));
    const tr = (strike + a) * RAD;
    pts.push(px(wulff([Math.cos(pl) * Math.sin(tr), Math.cos(pl) * Math.cos(tr), Math.sin(pl)])));
  }
  return pts;
}
/** 침강 plunge 인 선들의 원(마찰원) */
function plungeCircle(plunge: number): string {
  const r = Math.tan(((90 - plunge) * RAD) / 2);
  return `<circle cx="${CX}" cy="${CY}" r="${f1(r * R)}" fill="none" stroke="#1f5fd1" stroke-width="1.2"/>`;
}
const poly = (pts: [number, number][], extra: string) => `<polyline points="${pts.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ')}" fill="none" ${extra}/>`;

/** 피셔 밀도(%): 1% 면적당 극점 비율. 축 자료라 |cos| 사용 */
export function fisherDensity(poles: Pole[], v: [number, number, number]): number {
  const n = poles.length || 1;
  let s = 0;
  for (const p of poles) {
    const c = poleVec(p);
    const d = Math.abs(c[0] * v[0] + c[1] * v[1] + c[2] * v[2]);
    s += Math.exp(FISHER_K * (d - 1));
  }
  const norm = FISHER_K / (2 * Math.PI * (1 - Math.exp(-2 * FISHER_K)));
  return ((s * norm * 0.01 * 4 * Math.PI) / n) * 100;
}

function inverseWulff(x: number, y: number): [number, number, number] | null {
  const r = Math.hypot(x, y);
  if (r > 1) return null;
  const th = 2 * Math.atan(r);
  const h = r || 1;
  return [(x / h) * Math.sin(th) * (r ? 1 : 0), (-y / h) * Math.sin(th) * (r ? 1 : 0), Math.cos(th)];
}

const GRAYS = ['#ffffff', '#f3f3f3', '#dcdcdc', '#c4c4c4', '#a8a8a8', '#858585', '#5d5d5d', '#3a3a3a', '#1f1f1f', '#000000'];

function contourSvg(poles: Pole[]): { svg: string; max: number } {
  if (!poles.length) return { svg: '', max: 0 };
  const N = 110;
  const g: number[][] = [];
  let max = 0;
  for (let j = 0; j < N; j++) {
    g.push([]);
    for (let i = 0; i < N; i++) {
      const v = inverseWulff(((i + 0.5) / N) * 2 - 1, ((j + 0.5) / N) * 2 - 1);
      const d = v ? fisherDensity(poles, v) : -1;
      g[j].push(d);
      if (d > max) max = d;
    }
  }
  const cell = (2 * R) / N;
  let out = '';
  for (let j = 0; j < N; j++) {
    let i = 0;
    while (i < N) {
      const lv = g[j][i] < 0 ? -1 : Math.min(9, Math.floor((g[j][i] / (max || 1)) * 10));
      let k = i;
      while (k + 1 < N && (g[j][k + 1] < 0 ? -1 : Math.min(9, Math.floor((g[j][k + 1] / (max || 1)) * 10))) === lv) k++;
      if (lv > 0) out += `<rect x="${f1(CX - R + i * cell)}" y="${f1(CY - R + j * cell)}" width="${f1((k - i + 1) * cell + 0.4)}" height="${f1(cell + 0.4)}" fill="${GRAYS[lv]}"/>`;
      i = k + 1;
    }
  }
  return { svg: out, max };
}

/** 영역(극점이 이 안에 있으면 위험): dipDir 범위 × dip 범위를 극점 좌표로 옮긴 다각형 */
function zonePolygon(dirFrom: number, dirTo: number, dipFrom: number, dipTo: number): string {
  const pts: [number, number][] = [];
  const pole = (dip: number, dir: number) => px(wulff(poleVec({ dip, dipDir: dir })));
  for (let d = dirFrom; d <= dirTo; d += 2) pts.push(pole(dipFrom, d));
  for (let d = dirTo; d >= dirFrom; d -= 2) pts.push(pole(dipTo, d));
  return `<polygon points="${pts.map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ')}" fill="#e4572e" fill-opacity="0.18" stroke="#e4572e" stroke-width="0.8" stroke-dasharray="4 3"/>`;
}

export function stereoSvg(o: PlotOptions): string {
  const kind = o.kind ?? 'plain';
  const tol = o.tol ?? 20;
  const size = o.size ?? 560;
  const { svg: cont, max } = contourSvg(o.poles);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${o.legend === false ? 500 : 640} 500" width="${size}" font-family="'Malgun Gothic','Apple SD Gothic Neo',sans-serif">`;
  s += `<rect width="100%" height="100%" fill="#fff"/>`;
  s += `<defs><clipPath id="disk"><circle cx="${CX}" cy="${CY}" r="${R}"/></clipPath></defs>`;
  s += `<g clip-path="url(#disk)">${cont}`;
  if (o.slope && kind === 'planar') {
    const sl = o.slope;
    s += zonePolygon(sl.dipDir - tol, sl.dipDir + tol, sl.friction, sl.dip);
  }
  if (o.slope && kind === 'toppling') {
    const sl = o.slope;
    const lo = 90 - sl.dip + sl.friction;
    if (lo < 90) s += zonePolygon(sl.dipDir + 180 - tol, sl.dipDir + 180 + tol, lo, 90);
  }
  s += `</g>`;
  s += `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="#222" stroke-width="1.4"/>`;
  for (let a = 0; a < 360; a += 10) {
    const r1 = R, r2 = R + (a % 30 === 0 ? 9 : 5);
    const x1 = CX + r1 * Math.sin(a * RAD), y1 = CY - r1 * Math.cos(a * RAD), x2 = CX + r2 * Math.sin(a * RAD), y2 = CY - r2 * Math.cos(a * RAD);
    s += `<line x1="${f1(x1)}" y1="${f1(y1)}" x2="${f1(x2)}" y2="${f1(y2)}" stroke="#222" stroke-width="0.8"/>`;
  }
  s += `<g font-size="16" fill="#111" text-anchor="middle"><text x="${CX}" y="${CY - R - 14}">N</text><text x="${CX + R + 18}" y="${CY + 5}">E</text><text x="${CX}" y="${CY + R + 26}">S</text><text x="${CX - R - 18}" y="${CY + 5}">W</text></g>`;
  if (o.slope) {
    s += poly(greatCirclePoints(o.slope.dip, o.slope.dipDir), 'stroke="#1f5fd1" stroke-width="1.4"');
    s += plungeCircle(o.slope.friction);
    s += `<text x="14" y="${CY + R + 30}" font-size="14" fill="#1f5fd1">Slope ${Math.round(o.slope.dip)}/${String(Math.round(o.slope.dipDir)).padStart(3, '0')} · 마찰각 ${Math.round(o.slope.friction)}°</text>`;
    if (kind === 'toppling') s += `<text x="14" y="${CY + R + 48}" font-size="14" fill="#c4421a">Toppling 영역(점선)</text>`;
    if (kind === 'planar') s += `<text x="14" y="${CY + R + 48}" font-size="14" fill="#c4421a">평면파괴 영역(점선)</text>`;
  }
  for (const set of o.sets ?? []) {
    s += poly(greatCirclePoints(set.dip, set.dipDir), 'stroke="#e0457b" stroke-width="1.1"');
    const p = px(wulff(poleVec(set)));
    s += `<rect x="${f1(p[0] - 3)}" y="${f1(p[1] - 3)}" width="6" height="6" fill="#e0457b"/><text x="${f1(p[0] + 6)}" y="${f1(p[1] - 4)}" font-size="12" fill="#e0457b">${set.name}</text>`;
  }
  for (const p of o.poles) {
    const q = px(wulff(poleVec(p)));
    s += `<circle cx="${f1(q[0])}" cy="${f1(q[1])}" r="3" fill="#ff6a00"/>`;
  }
  if (o.legend !== false) {
    const lx = 490;
    s += `<g font-size="11" fill="#111"><text x="${lx}" y="90">피셔분포</text><text x="${lx}" y="104">컨투어 적용 면적률 : 1.0%</text>`;
    for (let i = 0; i < 10; i++) {
      const v = ((9 - i + 1) / 10) * max;
      s += `<rect x="${lx}" y="${112 + i * 22}" width="30" height="22" fill="${GRAYS[9 - i]}" stroke="#333" stroke-width="0.6"/><text x="${lx + 36}" y="${112 + i * 22 + 5}">${v.toFixed(2)}%</text>`;
    }
    s += `<text x="${lx + 36}" y="${112 + 10 * 22 + 5}">0.00%</text>`;
    s += `<text x="${lx}" y="350">최대 밀집도 : ${max.toFixed(2)}%</text><text x="${lx}" y="364">가중치 적용전</text><text x="${lx}" y="392">등각투영망</text><text x="${lx}" y="406">하반구 투영</text></g>`;
  }
  s += `</svg>`;
  return s;
}
