import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { renderPointMapDataUrl, type MapPoint } from './mapImage';

export type { MapPoint };

const STATION_COL = '#007aff';
const SOIL_COL = '#ff9500';

/** 지도 마커 divIcon (숫자/알파벳 라벨) */
export function pinIcon(label: string, kind: 'station' | 'soil'): L.DivIcon {
  const bg = kind === 'soil' ? SOIL_COL : STATION_COL;
  return L.divIcon({
    className: 'map-pin',
    html: `<span style="background:${bg}">${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

export function fitToPoints(map: L.Map, points: MapPoint[]): void {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length === 0) {
    map.setView([36.5, 127.9], 7);
  } else if (pts.length === 1) {
    map.setView([pts[0].lat, pts[0].lon], 17);
  } else {
    map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number])).pad(0.3), {
      animate: false,
    });
  }
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  kind: 'station' | 'soil',
) {
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fillStyle = kind === 'soil' ? SOIL_COL : STATION_COL;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '700 12px -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 0.5);
}

/**
 * 실제 지도(OSM) + 마커를 이미지(JPEG data URL)로 캡처 — Excel 삽입용.
 * OSM 타일은 CORS 허용(Access-Control-Allow-Origin: *) → crossOrigin 로 canvas 오염 없이 합성 가능.
 * 실패(오프라인·CORS)하면 모식도(renderPointMapDataUrl)로 폴백.
 */
export async function captureMapImage(points: MapPoint[], W = 940, H = 580): Promise<string> {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (pts.length === 0 || typeof document === 'undefined') {
    return renderPointMapDataUrl(points, W, H);
  }

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'absolute',
    left: '-99999px',
    top: '0',
    width: `${W}px`,
    height: `${H}px`,
    overflow: 'hidden',
  });
  document.body.appendChild(container);

  let map: L.Map | null = null;
  try {
    map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: false,
      inertia: false,
      preferCanvas: false,
    });
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      crossOrigin: 'anonymous',
      maxZoom: 19,
    });
    tiles.addTo(map);
    fitToPoints(map, points);
    map.invalidateSize();

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      tiles.on('load', finish);
      window.setTimeout(finish, 6000);
    });
    await new Promise((r) => window.setTimeout(r, 400));

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.fillStyle = '#e8e8ec';
    ctx.fillRect(0, 0, W, H);

    const cRect = container.getBoundingClientRect();
    const tileImgs = Array.from(
      container.querySelectorAll<HTMLImageElement>('.leaflet-tile-pane img.leaflet-tile'),
    );
    let drawn = 0;
    for (const img of tileImgs) {
      if (!img.complete || img.naturalWidth === 0) continue;
      const r = img.getBoundingClientRect();
      try {
        ctx.drawImage(img, r.left - cRect.left, r.top - cRect.top, r.width, r.height);
        drawn++;
      } catch {
        /* tainted tile — skip */
      }
    }
    if (drawn === 0) throw new Error('no tiles drawn');

    for (const p of pts) {
      const cp = map.latLngToContainerPoint([p.lat, p.lon]);
      drawMarker(ctx, cp.x, cp.y, p.label, p.kind);
    }

    // 범례 + 방위
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(8, H - 30, 190, 22);
    ctx.strokeStyle = '#999';
    ctx.strokeRect(8, H - 30, 190, 22);
    drawMarker(ctx, 22, H - 19, '', 'station');
    drawMarker(ctx, 108, H - 19, '', 'soil');
    ctx.fillStyle = '#222';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('측점', 34, H - 19);
    ctx.fillText('토양경도', 120, H - 19);

    const url = canvas.toDataURL('image/jpeg', 0.85);
    if (!url || url.length < 200) throw new Error('empty');
    return url;
  } catch {
    return renderPointMapDataUrl(points, W, H);
  } finally {
    try {
      map?.remove();
    } catch {
      /* ignore */
    }
    container.remove();
  }
}
