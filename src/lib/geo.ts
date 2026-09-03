import type { Gps } from '../db/db';

export function getCurrentGps(timeoutMs = 12000): Promise<Gps> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('이 기기는 위치 기능을 지원하지 않습니다.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        }),
      (err) => reject(new Error(err.message || '위치를 가져오지 못했습니다.')),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

export function formatGps(g?: Gps): string {
  if (!g) return '—';
  return `${g.lat.toFixed(6)}, ${g.lon.toFixed(6)} (±${Math.round(g.accuracy)}m)`;
}
