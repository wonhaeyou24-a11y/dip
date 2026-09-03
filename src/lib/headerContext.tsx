import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface HeaderCtx {
  subtitle: string;
  setSubtitle: (s: string) => void;
}

const Ctx = createContext<HeaderCtx>({ subtitle: '', setSubtitle: () => {} });

export function HeaderProvider({ children }: { children: ReactNode }) {
  const [subtitle, setSubtitle] = useState('');
  return <Ctx.Provider value={{ subtitle, setSubtitle }}>{children}</Ctx.Provider>;
}

export const useHeader = () => useContext(Ctx);

/** 화면에서 헤더 부제(시설물명 등) 설정 */
export function useHeaderSubtitle(text: string | undefined | null): void {
  const { setSubtitle } = useHeader();
  useEffect(() => {
    setSubtitle(text ?? '');
    return () => setSubtitle('');
  }, [text, setSubtitle]);
}
