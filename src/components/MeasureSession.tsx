import { useCallback, useEffect, useRef, useState } from 'react';
import { CompassDial } from './CompassDial';
import { DEFAULT_DECLINATION_KR, clampDeclination } from '../lib/sensors/declination';
import { combineSamples, type MeasurementResult } from '../lib/sensors/orientation';
import {
  isOrientationSupported,
  isSecureContextOk,
  requestOrientationPermission,
  sampleHeadingDeg,
  startOrientation,
  type OrientationSample,
  type SensorPermission,
} from '../lib/sensors/SensorService';
import { planeAngle, type Pole, type SetResult } from '../lib/setCluster';

const TICK_MS = 90;
const WINDOW_MS = 500;
const BUFFER_MS = 2000;
const MIN_SAMPLES = 3;
const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, '0');

/** 실시간 센서 값 (0.5초 창). active 가 false 면 센서를 끈다. */
export function useLiveOrientation(active: boolean) {
  const [perm, setPerm] = useState<SensorPermission | 'idle'>('idle');
  const [live, setLive] = useState<MeasurementResult | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [declination] = useState(DEFAULT_DECLINATION_KR);
  const buf = useRef<{ s: OrientationSample; t: number }[]>([]);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    let dead = false;
    void (async () => {
      const p = await requestOrientationPermission();
      if (dead) return;
      setPerm(p);
      if (p === 'granted') stop.current = startOrientation((s) => buf.current.push({ s, t: Date.now() }));
    })();
    return () => {
      dead = true;
      stop.current?.();
      stop.current = null;
      buf.current = [];
    };
  }, [active]);

  useEffect(() => {
    if (!active || perm !== 'granted') return;
    const id = window.setInterval(() => {
      const now = Date.now();
      buf.current = buf.current.filter((b) => now - b.t <= BUFFER_MS);
      const win = buf.current.filter((b) => now - b.t <= WINDOW_MS).map((b) => b.s);
      if (win.length < MIN_SAMPLES) {
        setLive(null);
        setHeading(null);
        return;
      }
      setLive(combineSamples(win, { declinationDeg: clampDeclination(declination) }));
      setHeading(sampleHeadingDeg(win[win.length - 1], clampDeclination(declination)));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, perm, declination]);

  return { perm, live, heading };
}

interface Props {
  title: string;
  /** 'measure': 여러 불연속면을 연속으로 잰다 / 'find': 목표 면을 찾는다 */
  mode: 'measure' | 'find';
  poles?: Pole[];
  /** measure 모드: 지금까지 묶인 Set 들 (가장 가까운 Set 힌트용) */
  sets?: SetResult[];
  /** find 모드: 찾을 면 */
  target?: Pole;
  targetLabel?: string;
  onAdd?: (dip: number, dipDir: number) => void;
  onUndo?: () => void;
  onClose: () => void;
}

/** 전체 화면 측정 창 — 폰을 면에 대고 [측정]을 누르면 한 개씩 쌓인다. 찾기 모드는 목표 면과의 차이를 보여 준다. */
export function MeasureSession({ title, mode, poles = [], sets = [], target, targetLabel, onAdd, onUndo, onClose }: Props) {
  const { perm, live, heading } = useLiveOrientation(true);
  const [flash, setFlash] = useState('');
  const [manual, setManual] = useState({ dip: '', dir: '' });
  const cur: Pole | null = live ? { dip: live.orientation.dip, dipDir: live.orientation.dipDirection } : null;
  const diff = cur && target ? planeAngle(cur, target) : null;
  const near = cur && sets.length ? sets.map((s, i) => ({ i, a: s.count ? planeAngle(cur, s) : 999 })).sort((x, y) => x.a - y.a)[0] : null;

  const record = useCallback(() => {
    if (!cur || !onAdd) return;
    onAdd(Math.round(cur.dip), Math.round(cur.dipDir));
    setFlash(`#${poles.length + 1} ${pad(cur.dip, 2)}/${pad(cur.dipDir, 3)} 저장`);
    if (navigator.vibrate) navigator.vibrate(40);
  }, [cur, onAdd, poles.length]);

  useEffect(() => {
    const t = flash ? window.setTimeout(() => setFlash(''), 1800) : 0;
    return () => window.clearTimeout(t);
  }, [flash]);

  const found = diff !== null && diff <= 10;
  return (
    <div className="measure-full" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: found ? '#0f5132' : 'var(--bg, #fff)', color: found ? '#fff' : 'inherit', overflowY: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        <button className="ghost" onClick={onClose}>
          {mode === 'measure' ? '완료' : '닫기'}
        </button>
      </div>
      {!isSecureContextOk() && <div className="warn">HTTPS(또는 localhost)에서만 센서가 동작합니다.</div>}
      {perm === 'denied' && <div className="warn">센서 권한이 거부되었습니다. 브라우저 설정에서 허용하세요.</div>}
      {!isOrientationSupported() && <div className="warn">이 기기는 방향 센서를 지원하지 않습니다. 아래에서 직접 입력하세요.</div>}
      {perm === 'granted' && (
        <CompassDial dip={live?.orientation.dip ?? null} dipDirection={live?.orientation.dipDirection ?? null} heading={heading} quality={live?.quality.rating ?? null} />
      )}
      <div className="readout" style={{ marginTop: 6 }}>
        <div>
          <div className="val">{cur ? Math.round(cur.dip) : '–'}</div>
          <div className="lab">경사 °</div>
        </div>
        <div>
          <div className="val">{cur ? pad(cur.dipDir, 3) : '–'}</div>
          <div className="lab">경사방향 °</div>
        </div>
      </div>

      {mode === 'find' && target && (
        <div style={{ textAlign: 'center', margin: '12px 0' }}>
          <div>
            찾는 면: <strong>{targetLabel}</strong> {pad(target.dip, 2)}/{pad(target.dipDir, 3)}
          </div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>
            {diff === null ? '폰을 면에 밀착하세요' : found ? `✔ 이 면입니다 (${diff.toFixed(0)}° 차이)` : `${diff.toFixed(0)}° 차이`}
          </div>
          {diff !== null && !found && <div className="muted">10° 이내로 맞추면 초록색으로 바뀝니다. 다른 면으로 옮겨 보세요.</div>}
        </div>
      )}

      {mode === 'measure' && (
        <>
          {near && near.a < 999 && (
            <p style={{ textAlign: 'center', margin: '8px 0' }}>
              지금 면은 <strong>SET{near.i + 1}</strong> 에 가장 가깝습니다 ({near.a.toFixed(0)}°)
            </p>
          )}
          <button className="primary" style={{ width: '100%', fontSize: 20, padding: 16 }} onClick={record} disabled={!cur}>
            측정 저장 (#{poles.length + 1})
          </button>
          {flash && <p style={{ textAlign: 'center', color: '#0a7d3b' }}>{flash}</p>}
          <details style={{ marginTop: 10 }}>
            <summary>직접 입력</summary>
            <div className="row-inline" style={{ gap: 6 }}>
              <input inputMode="decimal" placeholder="경사" value={manual.dip} onChange={(e) => setManual({ ...manual, dip: e.target.value })} style={{ width: 70 }} />
              <input inputMode="decimal" placeholder="경사방향" value={manual.dir} onChange={(e) => setManual({ ...manual, dir: e.target.value })} style={{ width: 90 }} />
              <button
                onClick={() => {
                  const d = parseFloat(manual.dip), dd = parseFloat(manual.dir);
                  if (Number.isFinite(d) && Number.isFinite(dd) && d >= 0 && d <= 90 && dd >= 0 && dd <= 360) {
                    onAdd?.(d, dd % 360);
                    setManual({ dip: '', dir: '' });
                  }
                }}
              >
                추가
              </button>
            </div>
          </details>
          <div style={{ marginTop: 12 }}>
            <div className="row-inline" style={{ justifyContent: 'space-between' }}>
              <strong>측정 {poles.length}개</strong>
              {poles.length > 0 && onUndo && (
                <button className="ghost" onClick={onUndo}>
                  마지막 취소
                </button>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              {poles.map((p, i) => (
                <span key={i} className="pill">
                  #{i + 1} {pad(p.dip, 2)}/{pad(p.dipDir, 3)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
