import { useCallback, useEffect, useRef, useState } from 'react';
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
import { clampDeclination, DEFAULT_DECLINATION_KR } from '../lib/sensors/declination';

const MEASURE_MS = 2000;

const HEADING_LABEL: Record<HeadingSource, string> = {
  true: '진북 기준',
  magnetic: '자북 기준',
  relative: '상대값 (나침반 불가)',
};

interface HistItem {
  code: string;
  dip: number;
  dipDir: number;
  strike: number;
  rating: string;
  ts: number;
}

export function MeasureScreen() {
  const [perm, setPerm] = useState<SensorPermission | 'idle'>('idle');
  const [declination, setDeclination] = useState(DEFAULT_DECLINATION_KR);
  const [live, setLive] = useState<{ sample: OrientationSample; ori: Orientation } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [result, setResult] = useState<MeasurementResult | null>(null);
  const [resultMeta, setResultMeta] = useState<{
    sawRelative: boolean;
    worstAcc?: number;
    headingSource: HeadingSource;
  } | null>(null);
  const [history, setHistory] = useState<HistItem[]>([]);

  const latestSample = useRef<OrientationSample | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const declRef = useRef(declination);
  declRef.current = declination;

  // 라이브 미리보기: 원시 샘플은 ref 에 담고 150ms 간격으로만 렌더
  useEffect(() => {
    if (perm !== 'granted') return;
    const id = window.setInterval(() => {
      const s = latestSample.current;
      if (!s) return;
      setLive({
        sample: s,
        ori: orientationFromEuler(s.alpha, s.beta, s.gamma, { declinationDeg: declRef.current }),
      });
    }, 150);
    return () => window.clearInterval(id);
  }, [perm]);

  useEffect(() => () => stopRef.current?.(), []);

  const start = useCallback(async () => {
    const p = await requestOrientationPermission();
    setPerm(p);
    if (p === 'granted') {
      stopRef.current?.();
      stopRef.current = startOrientation((s) => {
        latestSample.current = s;
      });
    }
  }, []);

  const measure = useCallback(async () => {
    setMeasuring(true);
    setResult(null);
    try {
      const { samples, sawRelative, worstCompassAccuracyDeg } = await collectSamples(MEASURE_MS);
      const r = combineSamples(samples, { declinationDeg: clampDeclination(declRef.current) });
      setResult(r);
      setResultMeta({
        sawRelative,
        worstAcc: worstCompassAccuracyDeg,
        headingSource: samples[samples.length - 1]?.headingSource ?? 'relative',
      });
    } finally {
      setMeasuring(false);
    }
  }, []);

  const save = useCallback(() => {
    if (!result) return;
    const o = result.orientation;
    setHistory((h) => [
      {
        code: formatDipDipDir(o),
        dip: o.dip,
        dipDir: o.dipDirection,
        strike: o.strike,
        rating: result.quality.rating,
        ts: Date.now(),
      },
      ...h,
    ]);
    setResult(null);
    setResultMeta(null);
  }, [result]);

  if (!isOrientationSupported()) {
    return (
      <div className="card">
        <div className="warn">이 브라우저는 방향 센서(DeviceOrientation)를 지원하지 않습니다.</div>
      </div>
    );
  }

  return (
    <>
      {!isSecureContextOk() && (
        <div className="warn">
          HTTPS 가 아닙니다. 센서는 HTTPS(또는 localhost)에서만 동작합니다.
        </div>
      )}

      {perm !== 'granted' && (
        <div className="card">
          <h2>센서</h2>
          <p className="muted">
            스마트폰 뒷면을 불연속면에 밀착한 뒤 측정합니다. 먼저 센서 사용을 허용하세요.
          </p>
          <button className="primary" onClick={start}>
            센서 시작
          </button>
          {perm === 'denied' && (
            <p className="warn" style={{ marginTop: 12 }}>
              센서 권한이 거부되었습니다. 브라우저 설정에서 동작 및 방향 접근을 허용해 주세요.
            </p>
          )}
        </div>
      )}

      {perm === 'granted' && (
        <>
          <div className="card">
            <h2>실시간 방위</h2>
            <div className="readout">
              <div>
                <div className="val">{live ? Math.round(live.ori.dip) : '–'}</div>
                <div className="lab">경사 °</div>
              </div>
              <div>
                <div className="val">
                  {live ? Math.round(live.ori.dipDirection).toString().padStart(3, '0') : '–'}
                </div>
                <div className="lab">경사방향 °</div>
              </div>
              <div>
                <div className="val">
                  {live ? Math.round(live.ori.strike).toString().padStart(3, '0') : '–'}
                </div>
                <div className="lab">주향 °</div>
              </div>
            </div>
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="pill">
                {live ? HEADING_LABEL[live.sample.headingSource] : '대기'}
              </span>
              {live?.sample.compassAccuracyDeg != null && (
                <span className="pill">나침반 정확도 ±{Math.round(live.sample.compassAccuracyDeg)}°</span>
              )}
            </div>
          </div>

          <div className="card">
            <div className="field">
              <label htmlFor="decl">자기편각 (°, 서편각 −)</label>
              <input
                id="decl"
                type="number"
                inputMode="decimal"
                step="0.1"
                value={declination}
                onChange={(e) => setDeclination(clampDeclination(parseFloat(e.target.value)))}
              />
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              자북 기준 측정을 진북으로 보정. 정확값은 GPS 좌표로 NOAA에서 조회.
            </p>
          </div>

          {!result && (
            <button className="primary" onClick={measure} disabled={measuring}>
              {measuring ? `측정 중… (${MEASURE_MS / 1000}초)` : `측정 (${MEASURE_MS / 1000}초)`}
            </button>
          )}

          {result && (
            <div className="card">
              <h2>
                측정 결과{' '}
                <span className="pill">
                  <span className={`dot ${result.quality.rating}`} />
                  {result.quality.rating === 'good'
                    ? '양호'
                    : result.quality.rating === 'fair'
                      ? '주의'
                      : '재측정 권장'}
                </span>
              </h2>
              <div className="bigcode">{formatDipDipDir(result.orientation)}</div>
              <div className="readout" style={{ marginTop: 12 }}>
                <div>
                  <div className="val">{result.orientation.dip}</div>
                  <div className="lab">경사 °</div>
                </div>
                <div>
                  <div className="val">{result.orientation.dipDirection}</div>
                  <div className="lab">경사방향 °</div>
                </div>
                <div>
                  <div className="val">{result.orientation.strike}</div>
                  <div className="lab">주향 °</div>
                </div>
              </div>
              <p className="muted" style={{ marginTop: 10 }}>
                편차 {result.quality.spreadDeg}° · 경사 σ{result.quality.dipStdDeg}° · 경사방향 σ
                {result.quality.dipDirStdDeg}° · {result.quality.sampleCount}샘플
              </p>

              {result.quality.sampleCount === 0 && (
                <div className="warn" style={{ marginTop: 10 }}>
                  방향 센서 데이터를 받지 못했습니다. 실기기(스마트폰)에서 센서를 켜고 측정하세요.
                </div>
              )}
              {result.quality.sampleCount > 0 && resultMeta?.sawRelative && (
                <div className="warn" style={{ marginTop: 10 }}>
                  이 기기는 절대방위(나침반)를 제공하지 않습니다. 경사방향·주향을 신뢰할 수 없습니다.
                </div>
              )}
              {resultMeta &&
                resultMeta.worstAcc != null &&
                (resultMeta.worstAcc < 0 || resultMeta.worstAcc > 20) && (
                  <div className="warn" style={{ marginTop: 10 }}>
                    자기장 간섭 가능성. 기기를 8자로 흔들어 나침반을 보정한 뒤 재측정하세요.
                  </div>
                )}
              {resultMeta?.headingSource === 'magnetic' && (
                <p className="muted" style={{ marginTop: 8 }}>
                  자북 기준 측정 → 편각 {declination}° 적용됨.
                </p>
              )}

              <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="ghost" onClick={() => setResult(null)}>
                  재측정
                </button>
                <button className="primary" onClick={save}>
                  저장
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="card">
              <h2>이번 세션 측정 ({history.length})</h2>
              <div className="hist">
                {history.map((h) => (
                  <div className="hist-item" key={h.ts}>
                    <strong>{h.code}</strong>
                    <span className="muted">
                      경사 {h.dip}° / 경사방향 {h.dipDir}° / 주향 {h.strike}°
                    </span>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ marginTop: 8 }}>
                ※ 아직 임시 저장입니다. 영구 저장(IndexedDB)은 STEP 3·4에서 연결합니다.
              </p>
            </div>
          )}
        </>
      )}
    </>
  );
}
