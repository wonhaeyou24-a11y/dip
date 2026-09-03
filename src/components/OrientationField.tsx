import { useCallback, useEffect, useRef, useState } from 'react';
import type { SetOrientation } from '../db/db';
import { clampDeclination, DEFAULT_DECLINATION_KR } from '../lib/sensors/declination';
import {
  combineSamples,
  formatDipDipDir,
  orientationFromEuler,
  type MeasurementResult,
  type Orientation,
} from '../lib/sensors/orientation';
import {
  collectSamples,
  isOrientationSupported,
  isSecureContextOk,
  requestOrientationPermission,
  startOrientation,
  type HeadingSource,
  type OrientationSample,
  type SensorPermission,
} from '../lib/sensors/SensorService';

const MEASURE_MS = 2000;
const HEADING_LABEL: Record<HeadingSource, string> = {
  true: '진북 기준',
  magnetic: '자북 기준',
  relative: '상대값(나침반 불가)',
};

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

  // 센서
  const [perm, setPerm] = useState<SensorPermission | 'idle'>('idle');
  const [live, setLive] = useState<Orientation | null>(null);
  const [liveSrc, setLiveSrc] = useState<HeadingSource | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [result, setResult] = useState<MeasurementResult | null>(null);
  const [sawRelative, setSawRelative] = useState(false);
  const latest = useRef<OrientationSample | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const declRef = useRef(declination);
  declRef.current = declination;

  // 수동
  const [mDip, setMDip] = useState(value ? String(value.dip) : '');
  const [mDir, setMDir] = useState(value ? String(value.dipDirection) : '');

  useEffect(() => () => stopRef.current?.(), []);

  useEffect(() => {
    if (perm !== 'granted' || mode !== 'sensor') return;
    const id = window.setInterval(() => {
      const s = latest.current;
      if (!s) return;
      setLive(orientationFromEuler(s.alpha, s.beta, s.gamma, { declinationDeg: declRef.current }));
      setLiveSrc(s.headingSource);
    }, 150);
    return () => window.clearInterval(id);
  }, [perm, mode]);

  const startSensor = useCallback(async () => {
    setMode('sensor');
    setResult(null);
    const p = await requestOrientationPermission();
    setPerm(p);
    if (p === 'granted') {
      stopRef.current?.();
      stopRef.current = startOrientation((s) => {
        latest.current = s;
      });
    }
  }, []);

  const measure = useCallback(async () => {
    setMeasuring(true);
    setResult(null);
    try {
      const { samples, sawRelative: rel } = await collectSamples(MEASURE_MS);
      setSawRelative(rel);
      setResult(combineSamples(samples, { declinationDeg: clampDeclination(declRef.current) }));
    } finally {
      setMeasuring(false);
    }
  }, []);

  const adopt = useCallback(() => {
    if (!result) return;
    stopRef.current?.();
    stopRef.current = null;
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
  }, [result, onChange]);

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

  // ── 렌더 ──
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

  // sensor
  return (
    <div>
      {!isSecureContextOk() && <div className="warn">HTTPS(또는 localhost)에서만 센서가 동작합니다.</div>}
      {perm === 'denied' && <div className="warn">센서 권한이 거부되었습니다. 브라우저 설정에서 허용하세요.</div>}

      {perm === 'granted' && (
        <>
          <div className="readout">
            <div>
              <div className="val">{live ? Math.round(live.dip) : '–'}</div>
              <div className="lab">경사 °</div>
            </div>
            <div>
              <div className="val">
                {live ? Math.round(live.dipDirection).toString().padStart(3, '0') : '–'}
              </div>
              <div className="lab">경사방향 °</div>
            </div>
            <div>
              <div className="val">
                {live ? Math.round(live.strike).toString().padStart(3, '0') : '–'}
              </div>
              <div className="lab">주향 °</div>
            </div>
          </div>
          {liveSrc && (
            <div style={{ marginTop: 8 }}>
              <span className="pill">{HEADING_LABEL[liveSrc]}</span>
            </div>
          )}
          <div className="field" style={{ marginTop: 10 }}>
            <label>자기편각 (°, 서편각 −)</label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              value={declination}
              onChange={(e) => setDeclination(clampDeclination(parseFloat(e.target.value)))}
            />
          </div>

          {!result && (
            <button className="primary" style={{ marginTop: 12 }} onClick={measure} disabled={measuring}>
              {measuring ? '측정 중…' : `측정 (${MEASURE_MS / 1000}초)`}
            </button>
          )}

          {result && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="bigcode">{formatDipDipDir(result.orientation)}</div>
              <p className="muted" style={{ textAlign: 'center', marginTop: 6 }}>
                편차 {result.quality.spreadDeg}° · {result.quality.sampleCount}샘플 ·{' '}
                <span className={`dot ${result.quality.rating}`} />{' '}
                {result.quality.rating === 'good' ? '양호' : result.quality.rating === 'fair' ? '주의' : '재측정 권장'}
              </p>
              {result.quality.sampleCount === 0 && (
                <div className="warn">센서 데이터를 받지 못했습니다. 실기기에서 측정하세요.</div>
              )}
              {sawRelative && result.quality.sampleCount > 0 && (
                <div className="warn">이 기기는 절대방위(나침반) 미지원 — 경사방향 신뢰불가.</div>
              )}
              <div className="btn-row" style={{ marginTop: 12 }}>
                <button className="ghost" onClick={() => setResult(null)}>
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

      <button
        className="ghost"
        style={{ marginTop: 12, width: '100%' }}
        onClick={() => {
          stopRef.current?.();
          stopRef.current = null;
          setMode('idle');
          setResult(null);
          setPerm('idle');
        }}
      >
        취소
      </button>
    </div>
  );
}
