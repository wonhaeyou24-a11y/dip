import type { ReactNode } from 'react';

/** 화면 하단 고정 액션바. 현장에서 스크롤 없이 저장/이동. */
export function StickyBar({ children }: { children: ReactNode }) {
  return <div className="sticky-bar">{children}</div>;
}

/** 현재 포커스된 입력의 onBlur(자동 저장)를 강제로 실행시킨 뒤 콜백. */
export function flushAndRun(fn: () => void): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
  // onBlur 처리(Dexie 저장)가 마이크로태스크로 끝나도록 한 틱 양보
  setTimeout(fn, 0);
}
