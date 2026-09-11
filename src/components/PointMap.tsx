import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef, useState } from 'react';
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
  const meLayerRef = useRef<L.LayerGroup | null>(null);
  const centeredOnMeRef = useRef(false);
  const hasGpsRef = useRef(false);
  const myPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const navigate = useNavigate();

  const key = points
    .map((p) => `${p.id}:${p.lat.toFixed(6)},${p.lon.toFixed(6)}:${p.label}`)
    .join('|');
  const hasGps = points.some((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  hasGpsRef.current = hasGps;

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    map.setView([36.5, 127.9], 7);
    layerRef.current = L.layerGroup().addTo(map);
    meLayerRef.current = L.layerGroup().addTo(map);
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

  // 내 현위치 추적 (지도 위 파란 점 + 정확도 원)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const map = mapRef.current;
        const layer = meLayerRef.current;
        if (!map || !layer) return;
        const { latitude, longitude, accuracy } = pos.coords;
        myPosRef.current = { lat: latitude, lon: longitude };
        layer.clearLayers();
        L.circle([latitude, longitude], {
          radius: accuracy,
          color: '#4285f4',
          weight: 1,
          fillColor: '#4285f4',
          fillOpacity: 0.12,
        }).addTo(layer);
        L.circleMarker([latitude, longitude], {
          radius: 7,
          color: '#fff',
          weight: 2,
          fillColor: '#4285f4',
          fillOpacity: 1,
        }).addTo(layer);
        if (!centeredOnMeRef.current && !hasGpsRef.current) {
          map.setView([latitude, longitude], 16);
          centeredOnMeRef.current = true;
        }
      },
      () => {
        /* 위치 권한 거부·실패 — 조용히 무시 (조사점 표시는 그대로 동작) */
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const goToMyLocation = () => {
    const map = mapRef.current;
    if (!map || typeof navigator === 'undefined' || !navigator.geolocation) return;
    if (myPosRef.current) {
      map.setView([myPosRef.current.lat, myPosRef.current.lon], Math.max(map.getZoom(), 16));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        myPosRef.current = { lat: latitude, lon: longitude };
        map.setView([latitude, longitude], 16);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div>
      <div className="map-wrap">
        <div ref={elRef} className="map" />
        <button
          type="button"
          className="map-locate"
          onClick={goToMyLocation}
          disabled={locating}
          aria-label="내 위치로"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
            <line x1="12" y1="2" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="2" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="22" y2="12" />
          </svg>
        </button>
      </div>
      {!hasGps && (
        <p className="muted" style={{ marginTop: 6 }}>
          GPS가 기록된 조사점이 없습니다.
        </p>
      )}
    </div>
  );
}
