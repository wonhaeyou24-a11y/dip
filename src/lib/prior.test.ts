import { describe, expect, it } from 'vitest';
import { isSlopeFacility, kindOfCategory, parsePriorJson, priorSoilPositions } from './prior';

const sample = {
  facility: '중부선14.51K_하남_절토사면',
  ledger: { 시설물번호: 'SL2005-0000129', 시설물종류: '절토사면', 시설물명: '중부선 14.51K(하남방향) 절토사면', '연장(m)': 480, '높이(m)': 63 },
  field_tests: [
    {
      table: 65,
      분류: '토질 연경도·표준관입·토양경도',
      절: '2.3.1 토양경도 조사',
      '제목(표 앞 문단)': '<표 2.3-1> 토양경도 시험 결과',
      '표 앞 문단': ['토양경도 시험을 실시하였다.'],
      '표 뒤 문단(주석 등)': ['주) 단위: mm'],
      grid: [
        ['토양경도시험(mm)'],
        ['구분', '지반종류', '측정위치', '측정치(mm)', '', '평균 (mm)', '분류'],
        ['SH-1', '실트질모래', '20.0', '15', '14', '14.4', '보통'],
        ['SH-2', '실트질모래', '40.0', '11', '12', '15.3', '조밀'],
        ['SH-3', '실트질모래', '60.0', '16', '16', '15.8', '조밀'],
      ],
      출처: '표65',
    },
    { table: 68, 분류: '암반 강도·평가', grid: [['슈미트해머시험(암반)']], 출처: '표68' },
    { table: 51, 분류: '계획선형오차', grid: [['측점', '기울기'], ['STA.20m', '89.4']], 출처: '표51' },
    { table: 99, 분류: '표가 아님' },
  ],
};

describe('전차자료 가져오기', () => {
  it('ledger 시설물명·번호를 우선 쓰고 전차 시험 표를 원문 그대로 읽는다', () => {
    const r = parsePriorJson(JSON.stringify(sample), 'a.json');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe('중부선 14.51K(하남방향) 절토사면');
    expect(r.facilityNo).toBe('SL2005-0000129');
    expect(r.prior.tests).toHaveLength(3); // grid 없는 항목은 제외
    expect(r.prior.tests[0].title).toBe('<표 2.3-1> 토양경도 시험 결과');
    expect(r.prior.tests[0].after).toEqual(['주) 단위: mm']);
    expect(r.prior.tests[0].grid[2][2]).toBe('20.0');
  });

  it('ledger 가 없으면 facility 문자열을 이름으로 쓴다', () => {
    const r = parsePriorJson(JSON.stringify({ facility: '시설물 A', field_tests: [] }), 'b.json');
    expect(r.ok && r.name).toBe('시설물 A');
  });

  it('형식이 틀리면 이유를 알려 준다', () => {
    expect(parsePriorJson('not json', 'x').ok).toBe(false);
    expect(parsePriorJson('[]', 'x').ok).toBe(false);
    expect(parsePriorJson('{}', 'x').ok).toBe(false);
  });

  it('전차 시험 종류를 이 앱에서 입력할 수 있는 조사 항목으로 연결한다', () => {
    expect(kindOfCategory('토질 연경도·표준관입·토양경도')).toBe('soil');
    expect(kindOfCategory('암반 강도·평가')).toBe('rebound');
    expect(kindOfCategory('반발경도·슈미트해머')).toBe('rebound');
    expect(kindOfCategory('불연속면')).toBe('discontinuity');
    expect(kindOfCategory('계획선형오차')).toBeNull();
    expect(kindOfCategory('수준측량')).toBeNull();
  });

  it('옹벽은 이 앱의 입력 대상이 아니다', () => {
    expect(isSlopeFacility({ name: '보강토옹벽 103k' })).toBe(false);
    expect(isSlopeFacility({ name: '절토사면 1' })).toBe(true);
    expect(isSlopeFacility({ name: 'x', prior: { source: '', importedAt: 0, tests: [], ledger: { 시설물종류: '옹벽' } } })).toBe(false);
  });

  it('전차 토양경도 표에서 측정 위치(m)를 읽는다', () => {
    const r = parsePriorJson(JSON.stringify(sample), 'a.json');
    if (!r.ok) throw new Error('parse');
    const pos = priorSoilPositions(r.prior);
    expect(pos.map((p) => p.pos)).toEqual([20, 40, 60]);
    expect(pos[0]).toEqual({ id: 'SH-1', pos: 20, soil: '실트질모래' });
  });

  it('토양경도 표가 없으면 위치 목록은 비어 있다', () => {
    expect(priorSoilPositions(undefined)).toEqual([]);
    expect(priorSoilPositions({ source: '', importedAt: 0, tests: [{ id: 't', category: '계획선형오차', title: '', grid: [['a']] }] })).toEqual([]);
  });
});

describe('전차 측정값 구조화·비교', () => {
  const prior = {
    source: 'a.json', importedAt: 0, tests: [{
      id: 'x', category: '토질 연경도·표준관입·토양경도', title: 't',
      grid: [['토양경도시험(mm)'], ['구분', '지반종류', '측정위치', '측정치(mm)', '', '', '평균 (mm)', '분류'], ['SH-1', '실트질모래', '20.0', '15', '14', '16', '15', '보통'], ['SH-2', '모래', '40.0', '11', '12', '', '11.5', '조밀']],
    }, {
      id: 'y', category: '암반 반발경도', title: 'r',
      grid: [['측정위치', '1', '2', '3', '4', '5', '6'], ['30m', '40', '41', '42', '43', '44', '45']],
    }],
  };
  it('토양경도 표에서 점별 측정값을 읽고 위치로 짝짓는다', async () => {
    const { priorSoilRecords, matchPriorSoil, compareWithPrior, priorReboundRecords, matchPriorRebound } = await import('./prior');
    const recs = priorSoilRecords(prior as never);
    expect(recs).toHaveLength(2);
    expect(recs[0].values).toEqual([15, 14, 16]);
    expect(recs[1].values).toEqual([11, 12]);
    expect(matchPriorSoil(prior as never, { staValue: 40.2, pointId: 'R-9' })?.id).toBe('SH-2');
    expect(matchPriorSoil(prior as never, { staValue: 99, pointId: 'R-9' })).toBeUndefined();
    expect(compareWithPrior([15, 14, 16], [15, 14, 16]).state).toBe('same');
    expect(compareWithPrior([15, 14, 16], [15, 13]).changed).toBe(1);
    expect(compareWithPrior([15, 14, 16], [15, 14]).state).toBe('partial');
    expect(compareWithPrior([15], []).state).toBe('empty');
    expect(priorReboundRecords(prior as never)[0].values).toHaveLength(6);
    expect(matchPriorRebound(prior as never, { staValue: 30 })?.label).toBe('30m');
  });
});

describe('전차 불연속면 기록', () => {
  const horizontal = {
    source: 'a.json', importedAt: 0, tests: [{
      id: 'd', category: '불연속면 조사', title: 'd',
      grid: [['구분', 'Set', '경사/경사방향', '절리상태'], ['Site-A', 'Set 1', '80/050', '3'], ['', 'Set 2', '60/200', '4'], ['Site-B', 'Set 1', '45/310', '2']],
    }],
  };
  const vertical = {
    source: 'b.json', importedAt: 0, tests: [{
      id: 'v', category: '불연속면', title: 'v',
      grid: [['Site-A', 'Set 1', 'Set 2', 'Set 3'], ['주향/경사', '80/050', '60/200', ''], ['절리상태', '3.6', '3.6', '3.6']],
    }],
  };
  it('가로형·세로형 표를 읽고 Site·Set 으로 짝짓는다', async () => {
    const m = await import('./prior');
    const h = m.priorDiscontinuityRecords(horizontal as never);
    expect(h).toHaveLength(3);
    expect(h[0]).toMatchObject({ site: 'A', setNo: 1, dip: 80, dipDir: 50, score: 3 });
    expect(h[2]).toMatchObject({ site: 'B', setNo: 1, score: 2 });
    const v = m.priorDiscontinuityRecords(vertical as never);
    expect(v.find((x) => x.setNo === 2)).toMatchObject({ dip: 60, dipDir: 200, score: 4 });
    expect(m.matchPriorSet(horizontal as never, 'SITE-B', 'Set 1')?.score).toBe(2);
    expect(m.compareOrientation(h[0], { dip: 78, dipDirection: 55 })).toBe('same');
    expect(m.compareOrientation(h[0], { dip: 50, dipDirection: 55 })).toBe('changed');
    expect(m.priorSetText(h[0])).toBe('80/050 · 절리상태 3');
  });
});
