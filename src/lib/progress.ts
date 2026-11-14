import type { DiscontinuitySet, SoilPoint, Station } from '../db/db';

export interface StepInfo {
  n: number;
  label: string;
  done: boolean;
  hint: string;
}
const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, '0');

/** 측점 조사 6단계 진행 — 측점 화면과 시설물 화면이 같은 기준을 쓴다 */
export function stationSteps(st: Station, sets: DiscontinuitySet[], photoCount: number): StepInfo[] {
  const nPoles = st.poles?.length ?? 0;
  const classified = (st.poleLabels ?? []).some((l) => l >= 0);
  const blockOk = !!(st.blockSize && (st.blockSize.x || st.blockSize.y || st.blockSize.z));
  const doneSets = sets.filter((x) => x.condition.complete).length;
  return [
    { n: 1, label: '측점 정보·위치', done: !!st.gps, hint: st.gps ? '위치 확인됨' : '위치(GPS)를 잡으세요' },
    { n: 2, label: '사면 방향', done: !!st.slope, hint: st.slope ? `${pad(st.slope.dip, 2)}/${pad(st.slope.dipDir, 3)}` : '사면에 폰을 대고 재세요' },
    { n: 3, label: '불연속면 측정', done: nPoles >= 3 && classified, hint: nPoles ? (classified ? `${nPoles}개 측정·분류됨` : `${nPoles}개 측정 — [자동 분류]를 누르세요`) : '[측정 시작]으로 면을 연속으로 재세요' },
    { n: 4, label: '절리군 절리상태', done: sets.length > 0 && doneSets === sets.length, hint: sets.length ? `${doneSets}/${sets.length} 완료` : '③에서 [Set 방향을 절리군에 저장]을 누르세요' },
    { n: 5, label: '누수·암괴·반발경도', done: !!st.seepage && blockOk, hint: !st.seepage ? '누수 상태를 선택하세요' : !blockOk ? '암괴크기를 입력하세요' : '입력됨' },
    { n: 6, label: '조사 사진', done: photoCount > 0, hint: photoCount ? `${photoCount}장` : '사진을 찍으세요' },
  ];
}

/** 절리군 조사 4단계 진행 (절리군 화면) */
export function setSteps(set: DiscontinuitySet, photoCount: number): StepInfo[] {
  return [
    { n: 1, label: '대표면 찾기', done: !!set.orientation, hint: set.orientation ? `${pad(set.orientation.dip, 2)}/${pad(set.orientation.dipDirection, 3)}` : '방향을 측정하거나 입력하세요' },
    { n: 2, label: '대표면 사진', done: photoCount > 0, hint: photoCount ? `${photoCount}장` : '대표면 사진을 찍으세요' },
    { n: 3, label: '간격', done: !!set.spacing, hint: set.spacing ? '입력됨' : '간격을 고르세요' },
    { n: 4, label: '상세 절리상태', done: !!set.condition?.complete, hint: set.condition?.complete ? `점수 ${set.condition.score}` : '①~⑤ 단계를 모두 고르세요' },
  ];
}

/** 토양경도 조사점 진행 */
export function soilDone(sp: SoilPoint): { done: boolean; n: number } {
  const n = sp.hardnessValues?.filter((x) => Number.isFinite(x)).length ?? 0;
  return { done: n >= 10, n };
}
