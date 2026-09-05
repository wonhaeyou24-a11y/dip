/**
 * DeviceOrientation 센서 래퍼.
 *
 * 브라우저/기기 파편화 흡수:
 *  - iOS 13+ : DeviceOrientationEvent.requestPermission() 필요 (사용자 탭 이벤트에서 호출).
 *              webkitCompassHeading = 진북 기준 방위 → alpha 를 이 값으로 보정.
 *  - Android : 'deviceorientationabsolute' 이벤트의 alpha = 자북 기준.
 *  - 그 외   : 'deviceorientation'. event.absolute 로 절대/상대 판별.
 *
 * ※ 실제 정확도·간섭 특성은 실기기 테스트로 검증해야 함 (개발계획 §4.3).
 */

export type HeadingSource = 'true' | 'magnetic' | 'relative';

export interface OrientationSample {
  alpha: number;
  beta: number;
  gamma: number;
  absolute: boolean;
  headingSource: HeadingSource;
  /** iOS webkitCompassAccuracy: 각도(°), 작을수록 좋음. -1 이면 불량. */
  compassAccuracyDeg?: number;
  timestamp: number;
}

export type SensorPermission = 'granted' | 'denied' | 'unsupported' | 'prompt';

const iosDOE = (): DeviceOrientationEventConstructoriOS | null => {
  const DOE = (globalThis as unknown as { DeviceOrientationEvent?: DeviceOrientationEventConstructoriOS })
    .DeviceOrientationEvent;
  return DOE ?? null;
};

export function isOrientationSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
}

/** 센서는 HTTPS(또는 localhost) 에서만 동작. */
export function isSecureContextOk(): boolean {
  if (typeof window === 'undefined') return false;
  return window.isSecureContext === true;
}

/** iOS 권한 요청. 사용자 제스처(클릭/탭) 핸들러 안에서 호출해야 함. */
export async function requestOrientationPermission(): Promise<SensorPermission> {
  if (!isOrientationSupported()) return 'unsupported';
  const DOE = iosDOE();
  if (DOE && typeof DOE.requestPermission === 'function') {
    try {
      const res = await DOE.requestPermission();
      return res === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }
  // 권한 개념이 없는 브라우저(대부분의 Android)
  return 'granted';
}

function toSample(evt: Event): OrientationSample | null {
  const e = evt as DeviceOrientationEventiOS;
  if (e.alpha == null && e.beta == null && e.gamma == null) return null;

  let alpha = e.alpha ?? 0;
  const beta = e.beta ?? 0;
  const gamma = e.gamma ?? 0;

  let headingSource: HeadingSource;
  let absolute = e.absolute === true;

  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    // iOS: 진북 기준 방위. 회전행렬용 alpha 로 환산.
    alpha = (360 - e.webkitCompassHeading) % 360;
    headingSource = 'true';
    absolute = true;
  } else if (e.type === 'deviceorientationabsolute' || e.absolute === true) {
    headingSource = 'magnetic';
  } else {
    headingSource = 'relative';
  }

  return {
    alpha,
    beta,
    gamma,
    absolute,
    headingSource,
    compassAccuracyDeg:
      typeof e.webkitCompassAccuracy === 'number' ? e.webkitCompassAccuracy : undefined,
    timestamp: evt.timeStamp || Date.now(),
  };
}

/**
 * 방위 이벤트 구독 시작. 반환된 함수를 호출하면 구독 해제.
 */
export function startOrientation(onSample: (s: OrientationSample) => void): () => void {
  if (!isOrientationSupported()) return () => {};

  const hasAbsolute = 'ondeviceorientationabsolute' in window;
  const eventName = hasAbsolute ? 'deviceorientationabsolute' : 'deviceorientation';

  const handler = (evt: Event) => {
    const s = toSample(evt);
    if (s) onSample(s);
  };

  window.addEventListener(eventName, handler as EventListener, true);
  return () => window.removeEventListener(eventName, handler as EventListener, true);
}

/** 샘플로부터 "폰이 향한 방위"(참고용 미니 나침반) 계산 — 자북 샘플은 편각 보정. */
export function sampleHeadingDeg(s: OrientationSample, declinationDeg: number): number | null {
  if (s.headingSource === 'relative') return null;
  const norm = (d: number) => ((d % 360) + 360) % 360;
  if (s.headingSource === 'true') return norm(360 - s.alpha);
  return norm(s.alpha + declinationDeg);
}

export interface CollectResult {
  samples: OrientationSample[];
  /** 수집 중 relative(나침반 불가) 샘플이 하나라도 있었는지 */
  sawRelative: boolean;
  /** 관측된 최악 나침반 정확도(iOS) */
  worstCompassAccuracyDeg?: number;
}

/**
 * durationMs 동안 방위 샘플 수집 (안정화 측정용).
 */
export function collectSamples(durationMs: number): Promise<CollectResult> {
  return new Promise((resolve) => {
    const samples: OrientationSample[] = [];
    let sawRelative = false;
    let worst: number | undefined;

    const stop = startOrientation((s) => {
      samples.push(s);
      if (s.headingSource === 'relative') sawRelative = true;
      if (typeof s.compassAccuracyDeg === 'number' && s.compassAccuracyDeg >= 0) {
        worst = worst == null ? s.compassAccuracyDeg : Math.max(worst, s.compassAccuracyDeg);
      }
    });

    window.setTimeout(() => {
      stop();
      resolve({ samples, sawRelative, worstCompassAccuracyDeg: worst });
    }, durationMs);
  });
}
