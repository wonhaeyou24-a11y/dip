import { updateStation, type SetOrientation, type Station } from '../db/db';
import { OrientationField } from './OrientationField';

const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, '0');

/** ② 이 측점의 사면 경사·경사방향 — 평사투영해석과 보고서 표의 "비탈면경사방향"에 쓴다. */
export function SlopeStep({ station }: { station: Station }) {
  const value: SetOrientation | null = station.slope
    ? { dip: station.slope.dip, dipDirection: station.slope.dipDir, strike: (station.slope.dipDir + 270) % 360, method: 'manual', declinationApplied: 0, measuredAt: 0 }
    : null;
  return (
    <div className="card" id="step-2">
      <h2>② 사면 방향 {station.slope ? `· ${pad(station.slope.dip, 2)}/${pad(station.slope.dipDir, 3)}` : ''}</h2>
      <p className="muted">사면 면에 폰을 대고 재거나 직접 입력하세요. 평사투영해석과 보고서 표의 "비탈면경사방향"에 쓰입니다.</p>
      <OrientationField
        value={value}
        onChange={(o) => void updateStation(station.id, { slope: { dip: Math.round(o.dip), dipDir: Math.round(o.dipDirection) % 360 } })}
      />
    </div>
  );
}
