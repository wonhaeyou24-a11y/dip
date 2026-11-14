import { useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { flushAndRun } from '../components/StickyBar';

/**
 * 화면 이동 규칙
 *  - 헤더 ‹ 와 아래 "…목록" 버튼은 같은 일을 한다: 입력을 저장한 뒤 **정해진 부모 화면**으로 간다.
 *  - 직전 화면이 바로 그 부모 화면이면 기록을 한 칸 되감고(뒤로가기와 같음), 아니면 부모 화면으로 **교체**한다.
 *    → 앞뒤로 눌러도 방금 나온 자식 화면으로 되돌아가는 순환이 생기지 않는다.
 */
const visited = new Map<number, string>();
const histIdx = (): number => {
  const st = window.history.state as { idx?: number } | null;
  return st && typeof st.idx === 'number' ? st.idx : 0;
};

/** 기록 칸 번호 → 그 칸의 화면 경로를 기억한다 (App 에서 한 번 둔다). */
export function NavTracker() {
  const loc = useLocation();
  useEffect(() => {
    visited.set(histIdx(), loc.pathname);
  }, [loc]);
  return null;
}

/** 부모 화면으로: 저장 → (직전이 부모면 뒤로, 아니면 교체 이동) */
export function useGoParent(parent: string | undefined) {
  const navigate = useNavigate();
  return useCallback(() => {
    if (!parent) return;
    flushAndRun(() => {
      const idx = histIdx();
      if (idx > 0 && visited.get(idx - 1) === parent) navigate(-1);
      else navigate(parent, { replace: true });
    });
  }, [navigate, parent]);
}

/**
 * 전체 화면 창(측정·찾기)을 뒤로가기 기록에 연결한다.
 *  open: 같은 화면에 기록을 한 칸 더 쌓고 flag 를 켠다 → 폰 뒤로가기는 창만 닫는다.
 *  close: 그 칸을 되감는다.
 */
export function useOverlay(flag: string) {
  const loc = useLocation();
  const navigate = useNavigate();
  const isOpen = (loc.state as { ps?: string } | null)?.ps === flag;
  const open = useCallback(() => navigate(loc.pathname, { state: { ps: flag } }), [navigate, loc.pathname, flag]);
  const close = useCallback(() => {
    if (isOpen) navigate(-1);
  }, [navigate, isOpen]);
  return { isOpen, open, close };
}
