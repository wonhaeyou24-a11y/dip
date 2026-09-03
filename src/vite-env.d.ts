/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// iOS Safari 전용 확장 (표준 타입에 없음)
interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

interface DeviceOrientationEventConstructoriOS {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}
