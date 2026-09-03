import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetOrientation } from '../db/db';
import { clampDeclination, DEFAULT_DECLINATION_KR } from '../lib/sensors/declination';
import {
  combineSamples,
  formatDipDipDir,
  type MeasurementResult,
} from '../lib/sensors/orientation';
import {
  isOrientationSupported,
  isSecureContextOk,
  requestOrientationPermission,
  startOrientation,
  type OrientationSample,
  type SensorPermission,
} from '../lib/sensors/SensorService';

// 적응형 자동 측정 파라미터
const TICK_MS = 120;
const WINDOW_MS = 1500; // 결과 산출에 쓰는 최근 구간
const BUFFER_MS = 4000;
const MIN_SAMPLES = 6;
const STABLE_SPREAD = 1.5; // °, 이하이면 안정
const STABLE_DIP_STD = 1.2;
const STABLE_DIPDIR_STD = 2.8;
const HOLD_MS = 700; // 이만큼 안정 유지되면 자동 확정
const WARN_AFTER_MS = 9000;

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
  const [holdPct, setHoldPct] = useState(0); // 자동 확정까지 진행률 0~100
  const [slow, setSlow] = useState(false); // 오래 안정 안 됨
  const [result, setResult] = useState<MeasurementResult | null>(null);
  const [sawRelative, setSawRelative] = useState(false);

  const bufRef = useRef<{ s: OrientationSample; t: number }[]>([]);
  const stopRef = useRef<(() => void) | null>(null);
  const stableSinceRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const declRef = useRef(declination);
  declRef.current = declination;

  const [mDip, setMDip] = useState(value ? String(value.dip) : '');
  const [mDir, setMDir] = useState(value ? String(value.dipDirection) : '');

  const stopSensor = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    bufRef.current = [];
    stableSinceRef.current = null;
  }, []);

  useEffect(() => () => stopSensor(), [stopSensor]);

  const finalize = useCallback(() => {
    const now = Date.now();
    const win = bufRef.current.filter((b) => now - b.t <= WINDOW_MS).map((b) => b.s);
    const r = combineSamples(win, { declinationDeg: clampDeclination(declRef.current) });
    setResult(r);
    stableSinceRef.current = null;
  }, []);

  // 측정 루프
  useEffect(() => {
    if (perm !== 'granted' || mode !== 'sensor' || result) return;
    const id = window.setInterval(() => {
      const now = Date.now();
      bufRef.current = bufRef.current.filter((b) => now - b.t <= BUFFER_MS);
      const win = bufRef.current.filter((b) => now - b.t <= WINDOW_MS).map((b) => b.s);
      if (win.length < MIN_SAMPLES) {
        setLive(null);
        setHoldPct(0);
        return;
      }
      if (win.some((s) => s.headingSource === 'relative')) setSawRelative(true);
      const r = combineSamples(win, { declinationDeg: clampDeclination(declRef.current) });
      setLive(r);

      const stable =
        r.quality.spreadDeg <= STABLE_SPREAD &&
        r.quality.dipStdDeg <= STABLE_DIP_STD &&
        r.quality.dipDirStdDeg <= STABLE_DIPDIR_STD;

      if (stable) {
        if (stableSinceRef.current == null) stableSinceRef.current = now;
        const held = now - stableSinceRef.current;
        setHoldPct(Math.min(100, Math.round((held / HOLD_MS) * 100)));
        if (held >= HOLD_MS) finalize();
      } else {
        stableSinceRef.current = null;
        setHoldPct(0);
      }
      setSlow(now - startedAtRef.current > WARN_AFTER_MS && !stable);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [perm, mode, result, finalize]);

  const startSensor = useCallback(async () => {
    setMode('sensor');
    setResult(null);
    setLive(null);
    setSawRelative(false);
    setSlow(false);
    setHoldPct(0);
    bufRef.current = [];
    stableSinceRef.current = null;
    startedAtRef.current = Date.now();
    const p = await requestOrientationPermission();
    setPerm(p);
    if (p === 'granted') {
      stopRef.current?.();
      stopRef.current = startOrientation((s) => {
        bufRef.current.push({ s, t: Date.now() });
      });
    }
  }, []);

  const restart = useCallback(() => {
    setResult(null);
    setLive(null);
    setHoldPct(0);
    setSlow(false);
    bufRef.current = [];
    stableSinceRef.current = null;
    startedAtRef.current = Date.now();
  }, []);

  const adopt = useCallback(() => {
    if (!result) return;
    stopSensor();
    onChange({
      ...result.orientation,
      method: 'sensor',
      declinationApplied: clampDeclination(declRef.current),
      quality: result.quality,
      measuredAt: Date.now(),
    });
    setMode('idle');
    setResult(null);
    setPerm('idle');
  }, [result, onChange, stopSensor]);

  const cancel = useCallback(() => {
    stopSensor();
    setMode('idle');
    setResult(null);
    setPerm('idle');
  }, [stopSensor]);

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

  // ── sensor ──
  const shown = result ?? live;
  const rating = shown?.quality.rating ?? 'poor';

  return (
    <div>
      {!isSecureContextOk() && <div className="warn">HTTPS(또는 localhost)에서만 센서가 동작합니다.</div>}
      {perm === 'denied' && <div className="warn">센서 권한이 거부되었습니다. 브라우저 설정에서 허용하세요.</div>}

      {perm === 'granted' && (
        <>
          <div className="readout">
            <div>
              <div className="val">{shown ? Math.round(shown.orientation.dip) : '–'}</div>
              <div className="lab">경사 °</div>
            </div>
            <div>
              <div className="val">
                {shown ? Math.round(shown.orientation.dipDirection).toString().padStart(3, '0') : '–'}
              </div>
              <div className="lab">경사방향 °</div>
            </div>
            <div>
              <div className="val">
                {shown ? Math.round(shown.orientation.strike).toString().padStart(3, '0') : '–'}
              </div>
              <div className="lab">주향 °</div>
            </div>
          </div>

          {!result && (
            <>
              <div className="hold-bar" aria-hidden>
                <div className={`hold-fill ${rating}`} style={{ width: `${holdPct}%` }} />
              </div>
              <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>
                {!live
                  ? '센서 데이터 대기 중… (폰을 면에 밀착)'
                  : holdPct > 0
                    ? '안정 — 고정 중…'
                    : `측정 중 · 편차 ${live.quality.spreadDeg}°`}
              </p>
              {slow && (
                <div className="warn">
                  안정되지 않습니다. 손을 고정하거나 「지금 확정」을 누르세요. 자기장 간섭이 있으면 8자로 흔들어 보정.
                </div>
              )}
              <div className="btn-row" style={{ marginTop: 10 }}>
                <button className="ghost" onClick={cancel}>
                  취소
                </button>
                <button className="primary" onClick={finalize} disabled={!live}>
                  지금 확정
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

          {result && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="bigcode">{formatDipDipDir(result.orientation)}</div>
              <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>
                편차 {result.quality.spreadDeg}° · {result.quality.sampleCount}샘플 ·{' '}
                <span className={`dot ${result.quality.rating}`} />{' '}
                {result.quality.rating === 'good'
                  ? '양호'
                  : result.quality.rating === 'fair'
                    ? '주의'
                    : '재측정 권장'}
              </p>
              {result.quality.sampleCount === 0 && (
                <div className="warn">센서 데이터를 받지 못했습니다. 실기기에서 측정하세요.</div>
              )}
              {sawRelative && result.quality.sampleCount > 0 && (
                <div className="warn">이 기기는 절대방위(나침반) 미지원 — 경사방향 신뢰불가.</div>
              )}
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="ghost" onClick={restart}>
                  재측정
                </button>
                <button className="primary" onClick={adopt}>
                  채택
                </button>
              </div>
            </div>
          )}
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
