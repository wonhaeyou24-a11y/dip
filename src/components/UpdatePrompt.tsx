import { useRegisterSW } from 'virtual:pwa-register/react';

declare const __BUILD_ID__: string;

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, r) {
      // 1시간마다 새 버전 확인
      if (r) setInterval(() => void r.update(), 60 * 60 * 1000);
    },
  });

  if (!needRefresh) return null;

  return (
    <div className="update-toast">
      <span>새 버전이 있습니다.</span>
      <button
        onClick={() => {
          void updateServiceWorker(true);
        }}
      >
        업데이트
      </button>
      <button className="ghost" onClick={() => setNeedRefresh(false)}>
        나중에
      </button>
    </div>
  );
}

export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
