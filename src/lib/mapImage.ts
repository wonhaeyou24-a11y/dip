/**
 * 조사점 위치도 — 실측 GPS 좌표를 등거리 도법으로 평면에 배치한 모식도.
 * 베이스 지도 타일이 없어 완전 오프라인 + CORS 문제 없이 Excel 삽입 가능.
 */

export interface MapPoint {
  id: string;
  label: string; // 마커 안 글자 (A, 1 …)
  lat: number;
  lon: number;
  kind: 'station' | 'soil';
}

const COL = {
  bg: '#ffffff',
  grid: '#e6e6ec',
  frame: '#8a8a92',
  station: '#007aff',
  soil: '#ff9500',
  text: '#1c1c1e',
  sub: '#6a6a70',
};

export function drawPointMap(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  points: MapPoint[],
  title = '조사점 위치도',
): void {
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, W, H);

  const pad = 40;
  const titleH = 34;
  const plot = { x: pad, y: pad + titleH, w: W - pad * 2, h: H - pad * 2 - titleH };

  ctx.fillStyle = COL.text;
  ctx.font = '600 18px -apple-system, "Malgun Gothic", sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(title, pad, pad - 6);

  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  ctx.strokeStyle = COL.frame;
  ctx.lineWidth = 1;
  ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

  if (pts.length === 0) {
    ctx.fillStyle = COL.sub;
    ctx.font = '15px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('GPS가 기록된 조사점이 없습니다', plot.x + plot.w / 2, plot.y + plot.h / 2 - 8);
    return;
  }

  // 좌표 범위 (단일점이면 고정 span)
  let minLat = Math.min(...pts.map((p) => p.lat));
  let maxLat = Math.max(...pts.map((p) => p.lat));
  let minLon = Math.min(...pts.map((p) => p.lon));
  let maxLon = Math.max(...pts.map((p) => p.lon));
  const midLat = (minLat + maxLat) / 2;

  const mPerLat = 110540;
  const mPerLon = 111320 * Math.cos((midLat * Math.PI) / 180);

  let spanLatM = (maxLat - minLat) * mPerLat;
  let spanLonM = (maxLon - minLon) * mPerLon;
  const minSpan = 30; // 최소 30 m
  if (spanLatM < minSpan) {
    const d = (minSpan - spanLatM) / 2 / mPerLat;
    minLat -= d;
    maxLat += d;
    spanLatM = minSpan;
  }
  if (spanLonM < minSpan) {
    const d = (minSpan - spanLonM) / 2 / mPerLon;
    minLon -= d;
    maxLon += d;
    spanLonM = minSpan;
  }
  // 15% 여백
  {
    const dLat = (maxLat - minLat) * 0.15;
    const dLon = (maxLon - minLon) * 0.15;
    minLat -= dLat;
    maxLat += dLat;
    minLon -= dLon;
    maxLon += dLon;
    spanLatM = (maxLat - minLat) * mPerLat;
    spanLonM = (maxLon - minLon) * mPerLon;
  }

  // 종횡비 유지 — 더 작은 스케일에 맞춰 중앙 배치
  const scale = Math.min(plot.w / spanLonM, plot.h / spanLatM);
  const drawW = spanLonM * scale;
  const drawH = spanLatM * scale;
  const ox = plot.x + (plot.w - drawW) / 2;
  const oy = plot.y + (plot.h - drawH) / 2;

  const toXY = (lat: number, lon: number) => ({
    x: ox + ((lon - minLon) * mPerLon) * scale,
    y: oy + ((maxLat - lat) * mPerLat) * scale,
  });

  // 격자 (약 5칸)
  ctx.strokeStyle = COL.grid;
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const gx = plot.x + (plot.w * i) / 5;
    const gy = plot.y + (plot.h * i) / 5;
    ctx.beginPath();
    ctx.moveTo(gx, plot.y);
    ctx.lineTo(gx, plot.y + plot.h);
    ctx.moveTo(plot.x, gy);
    ctx.lineTo(plot.x + plot.w, gy);
    ctx.stroke();
  }

  // 마커
  for (const p of pts) {
    const { x, y } = toXY(p.lat, p.lon);
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fillStyle = p.kind === 'soil' ? COL.soil : COL.station;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = '700 12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.label, x, y + 0.5);
  }

  // 북쪽 화살표 (우상단)
  const nx = plot.x + plot.w - 22;
  const ny = plot.y + 26;
  ctx.fillStyle = COL.text;
  ctx.beginPath();
  ctx.moveTo(nx, ny - 12);
  ctx.lineTo(nx - 6, ny + 6);
  ctx.lineTo(nx + 6, ny + 6);
  ctx.closePath();
  ctx.fill();
  ctx.font = '700 12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('N', nx, ny + 8);

  // 축척 막대 (좌하단)
  const targets = [5, 10, 20, 50, 100, 200, 500, 1000];
  const barMax = plot.w * 0.3;
  let barM = targets[0];
  for (const t of targets) if (t * scale <= barMax) barM = t;
  const barPx = barM * scale;
  const bx = plot.x + 10;
  const by = plot.y + plot.h - 16;
  ctx.strokeStyle = COL.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx + barPx, by);
  ctx.moveTo(bx, by - 4);
  ctx.lineTo(bx, by + 4);
  ctx.moveTo(bx + barPx, by - 4);
  ctx.lineTo(bx + barPx, by + 4);
  ctx.stroke();
  ctx.fillStyle = COL.text;
  ctx.font = '11px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${barM} m`, bx, by - 5);
}

/** 위치도를 data URL(JPEG) 로 렌더 — Excel 삽입용 */
export function renderPointMapDataUrl(points: MapPoint[], W = 900, H = 560): string {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  drawPointMap(ctx, W, H, points);
  return canvas.toDataURL('image/jpeg', 0.9);
}
