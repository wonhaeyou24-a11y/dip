import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Station } from '../db/db';

// Leaflet 기본 마커 아이콘 경로 문제 회피 (인라인 SVG divIcon)
const pin = (label: string) =>
  L.divIcon({
    className: 'map-pin',
    html: `<span>${label}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

interface Props {
  facilityId: string;
  stations: Station[];
}

export function StationMap({ facilityId, stations }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const navigate = useNavigate();

  const pts = stations.filter((s) => s.gps).map((s) => ({ s, gps: s.gps! }));

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { attributionControl: false, zoomControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);
    map.setView([36.5, 127.9], 7);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (pts.length === 0) return;
    const bounds = L.latLngBounds([]);
    for (const { s, gps } of pts) {
      const m = L.marker([gps.lat, gps.lon], { icon: pin(s.siteId.replace('SITE-', '')) });
      m.on('click', () => navigate(`/f/${facilityId}/s/${s.id}`));
      m.addTo(layer);
      bounds.extend([gps.lat, gps.lon]);
    }
    if (pts.length === 1) map.setView([pts[0].gps.lat, pts[0].gps.lon], 16);
    else map.fitBounds(bounds.pad(0.25));
  }, [pts.map((p) => `${p.s.id}:${p.gps.lat},${p.gps.lon}`).join('|'), facilityId, navigate]);

  return (
    <div>
      <div ref={elRef} className="map" />
      {pts.length === 0 && <p className="muted">GPS가 기록된 측점이 없습니다.</p>}
    </div>
  );
}
