import { updateFacility, type Facility, type TestKind } from '../db/db';
import { isSlopeFacility, TEST_KIND_LABEL } from '../lib/prior';

interface Counts {
  discontinuity: number;
  rebound: number;
  soil: number;
}

interface Props {
  facility: Facility;
  /** 금회 입력 건수: 불연속면(절리군 수) · 암반 반발경도(값이 있는 측점 수) · 토양경도(조사점 수) */
  counts: Counts;
}

const KINDS: TestKind[] = ['discontinuity', 'rebound', 'soil'];

/**
 * 금회 조사 항목 선택 — 한 줄짜리 간단한 선택 칩.
 * 전차 값은 따로 표로 보여 주지 않는다: 각 입력 화면(절리군·반발경도·토양경도)의 입력칸과 선택 버튼에 연하게 들어가 있어
 * 그것을 보면서 바로 금회 값을 쓴다.
 */
export function PriorPanel({ facility, counts }: Props) {
  const plan = facility.plan ?? [];
  const slope = isSlopeFacility(facility);

  const toggle = (k: TestKind) => {
    const next = plan.includes(k) ? plan.filter((x) => x !== k) : [...plan, k];
    void updateFacility(facility.id, { plan: next });
  };

  return (
    <div className="card">
      <h2>금회 조사 항목</h2>
      {!slope && <p className="warn">옹벽입니다. 옹벽 시험은 이 앱이 아니라 데스크에서 입력합니다.</p>}
      <div className="chip-row">
        {KINDS.map((k) => {
          const on = plan.includes(k);
          return (
            <button key={k} className={`chip${on ? ' on' : ''}`} onClick={() => toggle(k)} aria-pressed={on}>
              {on ? '✓ ' : ''}
              {TEST_KIND_LABEL[k]} <small>{counts[k]}</small>
            </button>
          );
        })}
      </div>
      {plan.length === 0 && <p className="muted">고르기 전에는 모든 입력 버튼이 보입니다.</p>}
    </div>
  );
}
