import { useCallback, useEffect, useRef, useState } from 'react';
import { CompassDial } from './CompassDial';
import type { SetOrientation } from '../db/db';
import { clampDeclination, DEFAULT_DECLINATION_KR } from '../lib/sensors/declination';
import { combineSamples, formatDipDipDir, type MeasurementResult } from '../lib/sensors/orientation';
import {
  isOrientationSupported,
  isSecureContextOk,
  requestOrientationPermission,
  sampleHeadingDeg,
  startOrientation,
  type OrientationSample,
  type SensorPermission,
} from '../lib/sensors/SensorService';

// 실시간 표시용 롤링 창 — 짧게 잡아 "나침반처럼" 즉각 반응하면서 약간의 노이즈만 상쇄
const TICK_MS = 90;
const WINDOW_MS = 500;
const BUFFER_MS = 2000;
const MIN_SAMPLES = 3;

function norm360(d: number) {
  return ((d % 360) + 360) % 360;
}

interface Props {
  value: SetOrientation | null;
  onChange: (o: SetOrientation) => void;
}

type Mode = 'idle' | 'sensor' | 'manual';

export function OrientationField({ value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [declination, setDeclination] = useState(value?.declinationApplied ?? DEFAULT_DECLINATION_KR);

  const [perm, setPerm] = useState<SensorPermission | 'idle'>('idle');
  const [live, setLive] = useState<MeasurementResult | null>(null);
  const [heading, setHeading] = useState<number | null>(null);
  const [sawRelative, setSawRelative] = useState(false);

  const bufRef = useRef<{ s: OrientationSample; t: number }[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const declRef = useRef(declination);
  declRef.current = declination;

  const [mDip, setMDip] = useState(value ? String(value.dip) : '');
  const [mDir, setMDir] = useState(value ? String(value.dipDirection) : '');

  const stopSensor = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    bufRef.current = [];
  }, []);

  useEffect(() => () => stopSensor(), [stopSensor]);

  const currentWindow = useCallback(() => {
    const now = Date.now();
    return bufRef.current.filter((b) => now - b.t <= WINDOW_MS).map((b) => b.s);
  }, []);

  // 실시간 갱신 루프
  useEffect(() => {
    if (perm !== 'granted' || mode !== 'sensor') return;
    const id = window.setInterval(() => {
      const now = Date.now();
      bufRef.current = bufRef.current.filter((b) => now - b.t <= BUFFER_MS);
      const win = currentWindow();
      if (win.length < MIN_SAMPLES) {
        setLive(null);
        setHeading(null);
        return;
      }
      if (win.some((s) => s.headingSource === 'relative')) setSawRelative(true);
      setLive(combineSamples(win, { declinationDeg: clampDeclination(declRef.current) }));
      const last = win[win.length - 1];
      setHeading(sampleHeadingDeg(last, clampDeclination(declRef.current)));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [perm, mode, currentWindow]);

  const startSensor = useCallback(async () => {
    setMode('sensor');
    setLive(null);
    setHeading(null);
    setSawRelative(false);
    bufRef.current = [];
    const p = await requestOrientationPermission();
    setPerm(p);
    if (p === 'granted') {
      stopRef.current?.();
      stopRef.current = startOrientation((s) => {
        bufRef.current.push({ s, t: Date.now() });
      });
    }
  }, []);

  const cancel = useCallback(() => {
    stopSensor();
    setMode('idle');
    setPerm('idle');
  }, [stopSensor]);

  /** 저장 — 현재 보이는 값을 그대로 채택 */
  const saveNow = useCallback(() => {
    const win = currentWindow();
    if (win.length === 0) return;
    const r = combineSamples(win, { declinationDeg: clampDeclination(declRef.current) });
    stopSensor();
    onChange({
      ...r.orientation,
      method: 'sensor',
      declinationApplied: clampDeclination(declRef.current),
      quality: r.quality,
      measuredAt: Date.now(),
    });
    setMode('idle');
    setPerm('idle');
  }, [currentWindow, onChange, stopSensor]);

  const saveManual = useCallback(() => {
    const dip = Math.max(0, Math.min(90, parseFloat(mDip)));
    const dir = norm360(parseFloat(mDir));
    if (!Number.isFinite(dip) || !Number.isFinite(dir)) return;
    onChange({
      dip: Math.round(dip * 10) / 10,
      dipDirection: Math.round(dir * 10) / 10,
      strike: Math.round(norm360(dir - 90) * 10) / 10,
      method: 'manual',
      declinationApplied: 0,
      measuredAt: Date.now(),
    });
    setMode('idle');
  }, [mDip, mDir, onChange]);

  // ── idle ──
  if (mode === 'idle') {
    return (
      <div>
        {value ? (
          <div className="ori-current">
            <span className="ori-code">{formatDipDipDir(value)}</span>
            <span className="muted">
              경사 {value.dip}° / 경사방향 {value.dipDirection}° / 주향 {value.strike}°
            </span>
            <span className="pill">{value.method === 'sensor' ? '센서' : '수동'}</span>
          </div>
        ) : (
          <p className="muted">방향성 미측정</p>
        )}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={startSensor} disabled={!isOrientationSupported()}>
            {value ? '다시 측정' : '측정'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              setMDip(value ? String(value.dip) : '');
              setMDir(value ? String(value.dipDirection) : '');
              setMode('manual');
            }}
          >
            직접 입력
          </button>
        </div>
      </div>
    );
  }

  // ── manual ──
  if (mode === 'manual') {
    return (
      <div>
        <div className="field">
          <label>경사 (°, 0~90)</label>
          <input type="number" inputMode="decimal" value={mDip} onChange={(e) => setMDip(e.target.value)} />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>경사방향 (°, 0~360)</label>
          <input type="number" inputMode="decimal" value={mDir} onChange={(e) => setMDir(e.target.value)} />
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="ghost" onClick={() => setMode('idle')}>
            취소
          </button>
          <button className="primary" onClick={saveManual}>
            저장
          </button>
        </div>
      </div>
    );
  }

  // ── sensor (실시간 나침반) ──
  return (
    <div>
      {!isSecureContextOk() && <div className="warn">HTTPS(또는 localhost)에서만 센서가 동작합니다.</div>}
      {perm === 'denied' && <div className="warn">센서 권한이 거부되었습니다. 브라우저 설정에서 허용하세요.</div>}

      {perm === 'granted' && (
        <>
          <CompassDial
            dip={live?.orientation.dip ?? null}
            dipDirection={live?.orientation.dipDirection ?? null}
            heading={heading}
            quality={live?.quality.rating ?? null}
          />

          <div className="readout" style={{ marginTop: 6 }}>
            <div>
              <div className="val">{live ? Math.round(live.orientation.dip) : '–'}</div>
              <div className="lab">경사 °</div>
            </div>
            <div>
              <div className="val">
                {live ? Math.round(live.orientation.dipDirection).toString().padStart(3, '0') : '–'}
              </div>
              <div className="lab">경사방향 °</div>
            </div>
            <div>
              <div className="val">
                {live ? Math.round(live.orientation.strike).toString().padStart(3, '0') : '–'}
              </div>
              <div className="lab">주향 °</div>
            </div>
          </div>

          <p className="muted" style={{ textAlign: 'center', marginTop: 8 }}>
            {!live ? '센서 데이터 대기 중… (폰을 면에 밀착)' : `편차 ${live.quality.spreadDeg}°`}
          </p>
          {sawRelative && (
            <div className="warn">이 기기는 절대방위(나침반) 미지원 — 경사방향 신뢰불가.</div>
          )}

          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="ghost" onClick={cancel}>
              취소
            </button>
            <button className="primary" onClick={saveNow} disabled={!live}>
              저장
            </button>
          </div>

          <details style={{ marginTop: 10 }}>
            <summary className="muted">자기편각 설정</summary>
            <div className="field" style={{ marginTop: 8 }}>
              <label>자기편각 (°, 서편각 −)</label>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={declination}
                onChange={(e) => setDeclination(clampDeclination(parseFloat(e.target.value)))}
              />
            </div>
          </details>
        </>
      )}

      {perm !== 'granted' && (
        <button className="ghost" style={{ marginTop: 12, width: '100%' }} onClick={cancel}>
          취소
        </button>
      )}
    </div>
  );
}
