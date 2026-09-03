import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fitToPoints, pinIcon, type MapPoint } from '../lib/leafletMap';

interface Props {
  points: MapPoint[];
  /** 마커 클릭 시 이동할 경로 생성 */
  linkFor?: (p: MapPoint) => string | undefined;
}

export function PointMap({ points, linkFor }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();

  const key = points
    .map((p) => `${p.id}:${p.lat.toFixed(6)},${p.lon.toFixed(6)}:${p.label}`)
    .join('|');

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.setView([36.5, 127.9], 7);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 50);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    map.invalidateSize();
    layer.clearLayers();
    const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    for (const p of pts) {
      const m = L.marker([p.lat, p.lon], { icon: pinIcon(p.label, p.kind) });
      const to = linkFor?.(p);
      if (to) m.on('click', () => navigate(to));
      m.addTo(layer);
    }
    fitToPoints(map, points);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const hasGps = points.some((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  return (
    <div>
      <div ref={elRef} className="map" />
      {!hasGps && <p className="muted" style={{ marginTop: 6 }}>GPS가 기록된 조사점이 없습니다.</p>}
    </div>
  );
}
