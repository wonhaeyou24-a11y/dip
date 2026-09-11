import { useMemo } from 'react';

interface Props {
  dip: number | null;
  dipDirection: number | null;
  heading?: number | null;
  quality?: 'good' | 'fair' | 'poor' | null;
  size?: number;
}

const RED = '#e11d2e';
const CX = 120;
const CY = 104;
const R = 84;
const VIEW_W = 240;
const VIEW_H = 284;

function toXY(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

/** 방향성(경사/경사방향)을 나침반 형태로 표시 — 크로스바=주향, 스템=경사방향(길이=경사크기) */
export function CompassDial({ dip, dipDirection, heading, quality, size = 240 }: Props) {
  const ticks = useMemo(() => {
    const els: React.ReactNode[] = [];
    for (let d = 0; d < 360; d += 10) {
      const major = d % 30 === 0;
      const [x1, y1] = toXY(CX, CY, R, d);
      const [x2, y2] = toXY(CX, CY, major ? R - 11 : R - 6, d);
      els.push(
        <line
          key={d}
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="var(--text-3)"
          strokeWidth={major ? 2 : 1}
        />,
      );
    }
    const labels: [number, string][] = [
      [0, 'N'],
      [90, 'E'],
      [180, 'S'],
      [270, 'W'],
    ];
    for (const [d, t] of labels) {
      const [x, y] = toXY(CX, CY, R - 22, d);
      els.push(
        <text
          key={`l${d}`}
          x={x}
          y={y + 4}
          textAnchor="middle"
          fontSize={13}
          fontWeight={700}
          fill="var(--text-2)"
        >
          {t}
        </text>,
      );
    }
    return els;
  }, []);

  const has = dip != null && dipDirection != null;
  const stemLen = has ? Math.max(10, (dip! / 90) * R) : 0;
  const [sx, sy] = has ? toXY(CX, CY, stemLen, dipDirection!) : [CX, CY];
  const strikeDeg = has ? dipDirection! - 90 : 0;
  const [p1x, p1y] = has ? toXY(CX, CY, R, strikeDeg) : [CX, CY];
  const [p2x, p2y] = has ? toXY(CX, CY, R, strikeDeg + 180) : [CX, CY];

  // 메인 다이얼 바깥쪽, 아래 여백에 배치 — 스템/크로스바(최대 반경 R)가 절대 닿지 않는 위치
  const mx = 46;
  const my = CY + R + 40;
  const mr = 22;
  const hd = heading ?? null;
  const hArrow = hd != null ? toXY(mx, my, 16, hd) : null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      width="100%"
      style={{ maxWidth: size, display: 'block', margin: '0 auto' }}
    >
      <circle
        cx={CX}
        cy={CY}
        r={R}
        fill="var(--card)"
        stroke="var(--sep)"
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.12))' }}
      />
      {ticks}
      <circle cx={CX} cy={CY} r={2.5} fill="var(--text-3)" />

      {has && (
        <>
          <line x1={p1x} y1={p1y} x2={p2x} y2={p2y} stroke={RED} strokeWidth={4} strokeLinecap="round" />
          <line x1={CX} y1={CY} x2={sx} y2={sy} stroke={RED} strokeWidth={4} strokeLinecap="round" />
          <circle cx={sx} cy={sy} r={5.5} fill={RED} />
        </>
      )}

      {quality && (
        <circle
          cx={CX + R - 4}
          cy={CY - R + 4}
          r={6}
          fill={
            quality === 'good' ? 'var(--good)' : quality === 'fair' ? 'var(--fair)' : 'var(--poor)'
          }
        />
      )}

      {/* 참고용 미니 나침반: 폰이 향한 방위 */}
      <circle
        cx={mx}
        cy={my}
        r={mr}
        fill="var(--card)"
        stroke="var(--sep)"
        style={{ filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.12))' }}
      />
      <line x1={mx} y1={my - mr} x2={mx} y2={my - mr + 5} stroke="var(--text-3)" strokeWidth={1.5} />
      {hArrow && (
        <line x1={mx} y1={my} x2={hArrow[0]} y2={hArrow[1]} stroke={RED} strokeWidth={3} strokeLinecap="round" />
      )}
      <text x={mx} y={my + mr + 16} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--text-2)">
        {hd != null ? `${Math.round(hd)}°` : '–'}
      </text>
    </svg>
  );
}
