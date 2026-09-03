import { useEffect, useRef } from 'react';
import { drawPointMap, type MapPoint } from '../lib/mapImage';

interface Props {
  points: MapPoint[];
}

export function PointMap({ points }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = points.map((p) => `${p.id}:${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cssW = parent?.clientWidth ?? 320;
    const cssH = Math.round(cssW * 0.62);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    drawPointMap(ctx, cssW, cssH, points);
  }, [key, points]);

  return (
    <div className="pointmap">
      <canvas ref={ref} />
    </div>
  );
}
