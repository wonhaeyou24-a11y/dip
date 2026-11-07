import { useState } from 'react';
import { updateFacility, type Facility, type PriorTest, type TestKind } from '../db/db';
import { createSoilPointsFromPrior, isSlopeFacility, kindOfCategory, priorSoilPositions, TEST_KIND_LABEL } from '../lib/prior';

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

function priorCount(tests: PriorTest[], kind: TestKind): number {
  return tests.filter((t) => kindOfCategory(t.category) === kind).length;
}

/** 전차 시험 현황 + 금회 조사 항목 선택. 전차 표는 원문 그대로(읽기 전용)이고, 고른 항목에 맞는 입력 버튼만 화면에 나온다. */
export function PriorPanel({ facility, counts }: Props) {
  const prior = facility.prior;
  const plan = facility.plan ?? [];
  const slope = isSlopeFacility(facility);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const tests = prior?.tests ?? [];
  const soilPositions = priorSoilPositions(prior);

  const toggle = (k: TestKind) => {
    const next = plan.includes(k) ? plan.filter((x) => x !== k) : [...plan, k];
    void updateFacility(facility.id, { plan: next });
  };

  const makeSoilPoints = async () => {
    const n = await createSoilPointsFromPrior(facility.id);
    setMsg(n ? `전차 위치 ${n}곳의 토양경도 조사점을 만들었습니다. 값을 입력하세요.` : '이미 같은 위치의 조사점이 있습니다.');
  };

  const ledger = (prior?.ledger ?? {}) as Record<string, unknown>;
  const info = [
    ledger['시설물번호'] ? `번호 ${ledger['시설물번호']}` : '',
    ledger['연장(m)'] ? `연장 ${ledger['연장(m)']}m` : '',
    ledger['높이(m)'] ? `높이 ${ledger['높이(m)']}m` : '',
  ].filter(Boolean);

  return (
    <>
      <div className="card">
        <h2>금회 조사 항목</h2>
        {!slope && (
          <p className="warn">
            옹벽입니다. 반발경도·탄산화 등 옹벽 시험은 이 앱이 아니라 데스크에서 입력합니다.
          </p>
        )}
        <p className="muted" style={{ marginBottom: 8 }}>
          전차에 있던 시험을 보고 이번에 조사할 항목을 고르세요. 고른 항목의 입력 버튼만 아래에 나옵니다.
        </p>
        <div className="btn-row" style={{ flexWrap: 'wrap' }}>
          {KINDS.map((k) => {
            const on = plan.includes(k);
            const pc = priorCount(tests, k);
            return (
              <button
                key={k}
                className={on ? 'primary' : 'ghost'}
                style={{ width: 'auto', flex: '1 1 140px' }}
                onClick={() => toggle(k)}
                aria-pressed={on}
              >
                {on ? '✓ ' : ''}
                {TEST_KIND_LABEL[k]}
                <br />
                <small>
                  전차 {pc}건 · 금회 {counts[k]}건
                </small>
              </button>
            );
          })}
        </div>
        {plan.length === 0 && <p className="muted" style={{ marginTop: 8 }}>아직 고르지 않았습니다. 고르기 전에는 모든 입력 버튼이 보입니다.</p>}
        {soilPositions.length > 0 && plan.includes('soil') && counts.soil === 0 && (
          <button className="ghost full" style={{ marginTop: 10 }} onClick={makeSoilPoints}>
            전차 토양경도 위치 {soilPositions.length}곳으로 조사점 만들기
          </button>
        )}
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
      </div>

      <div className="card">
        <h2>전차 시험 현황 ({tests.length})</h2>
        {!prior && (
          <p className="muted">
            전차자료가 없습니다. 프로젝트 화면에서 전차자료정리 결과(.json)를 가져오면 전차 시험 표가 여기에 나옵니다.
          </p>
        )}
        {prior && (
          <p className="muted" style={{ marginBottom: 8 }}>
            {prior.source} · {new Date(prior.importedAt).toLocaleDateString()} 가져옴
            {info.length ? ` · ${info.join(' · ')}` : ''}
          </p>
        )}
        {prior && tests.length === 0 && <p className="muted">전차 시험 표가 없습니다(전차보고서에서 시험·측량 표를 찾지 못했습니다).</p>}
        <div className="list">
          {tests.map((t) => {
            const kind = kindOfCategory(t.category);
            const open = openId === t.id;
            return (
              <div key={t.id} className="prior-item">
                <button className="prior-head" onClick={() => setOpenId(open ? null : t.id)} aria-expanded={open}>
                  <span>
                    <strong>{t.title}</strong>
                    <span className="muted">
                      {' '}
                      · {t.category}
                      {t.source ? ` · ${t.source}` : ''}
                    </span>
                  </span>
                  <span className="pill">{kind ? `금회 입력: ${TEST_KIND_LABEL[kind]}` : '데스크에서 입력'}</span>
                </button>
                {open && (
                  <div className="prior-body">
                    {(t.before ?? []).map((p, i) => (
                      <p key={`b${i}`} className="muted">
                        {p}
                      </p>
                    ))}
                    <div className="prior-scroll">
                      <table className="prior-table">
                        <tbody>
                          {t.grid.map((row, ri) => (
                            <tr key={ri}>
                              {row.map((c, ci) => (
                                <td key={ci}>{c}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {(t.after ?? []).map((p, i) => (
                      <p key={`a${i}`} className="muted">
                        {p}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
