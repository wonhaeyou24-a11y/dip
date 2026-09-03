const ExcelJS = require('exceljs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// DiscontinuityShot — 최종 결과 보고 Excel (형식 검토용 샘플 v2)
//  · 파일 = 시설물 1개, 시트 1개
//  · 시트에 측점별 "불연속면 특성" 표를 세로로 이어 정리
//  · 각 측점 표 하단에 조사 사진 영역
// ─────────────────────────────────────────────────────────────

const OUT = path.join(__dirname, '불연속면조사_결과보고_샘플_v2.xlsx');

const facility = { name: '○○터널 절취사면', surveyor: '홍길동', surveyDate: '2026-09-03' };

const ITEM_NAMES = ['① 연장성', '② 틈새', '③ 거칠기', '④ 충진물질', '⑤ 풍화도'];

// 조사 사진 항목 (측점 단위)
const PHOTO_CAPTIONS = [
  '조사 전경사진 ①', '조사 전경사진 ②',
  '절리 측정 사진', '거칠기 조사 사진',
  '슈미트(반발경도) 측정 사진', '주향/경사 측정 사진',
  '점검망치 조사 사진',
];

const stations = [
  {
    siteId: 'Site-A', location: '측점 58m 비탈면 하부',
    reboundHardness: 45,
    wallStrength_MPa: 106.4,
    seepage: '완전건조',
    blockSize: '0.6m × 0.6m × 0.6m',
    sets: [
      { name: 'Set 1', type: '절리', orientation: '83/089', spacing: '0.2 ~ 0.6m',
        items: [
          { label: '1~3m 미만',    band: '1~2', score: 2 },
          { label: '0.1~1mm 미만', band: '3~4', score: 4 },
          { label: '약간 거침',     band: '3~4', score: 4 },
          { label: '연약< 5mm',     band: '5~6', score: 5 },
          { label: '보통 풍화',     band: '3~4', score: 4 } ] },
      { name: 'Set 2', type: '절리', orientation: '89/329', spacing: '0.2 ~ 0.6m',
        items: [
          { label: '1~3m 미만',    band: '1~2', score: 2 },
          { label: '0.1~1mm 미만', band: '3~4', score: 4 },
          { label: '약간 거침',     band: '3~4', score: 4 },
          { label: '연약< 5mm',     band: '5~6', score: 5 },
          { label: '보통 풍화',     band: '3~4', score: 4 } ] },
      { name: 'Set 3', type: '절리', orientation: '12/148', spacing: '0.2 ~ 0.6m',
        items: [
          { label: '1~3m 미만',    band: '1~2', score: 2 },
          { label: '0.1~1mm 미만', band: '3~4', score: 4 },
          { label: '약간 거침',     band: '3~4', score: 4 },
          { label: '연약< 5mm',     band: '5~6', score: 5 },
          { label: '보통 풍화',     band: '3~4', score: 4 } ] },
    ],
  },
  {
    siteId: 'Site-B', location: '측점 122m 비탈면 중단부',
    reboundHardness: 38,
    wallStrength_MPa: 74.2,
    seepage: '습함',
    blockSize: '0.4m × 0.6m × 1.2m',
    sets: [
      { name: 'Set 1', type: '절리', orientation: '75/275', spacing: '0.06 ~ 0.2m',
        items: [
          { label: '3~10m 미만',    band: '3~4', score: 3 },
          { label: '1~5mm 미만',    band: '5~6', score: 6 },
          { label: '거침',           band: '1~2', score: 2 },
          { label: '연약≥ 5mm',      band: '7~8', score: 8 },
          { label: '심한 풍화',      band: '5~6', score: 6 } ] },
      { name: 'Set 2', type: '층리', orientation: '20/095', spacing: '0.2 ~ 0.6m',
        items: [
          { label: '10~20m 미만',   band: '5~6', score: 5 },
          { label: '< 0.1mm',       band: '1~2', score: 1 },
          { label: '약간 거침',      band: '3~4', score: 3 },
          { label: '단단< 5mm',      band: '3~4', score: 3 },
          { label: '보통 풍화',      band: '3~4', score: 4 } ] },
    ],
  },
];

// ── 스타일 ──
const C = {
  headFill:  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } },
  labelFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } },
  scoreFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } },
  photoFill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFAFAFA' } },
};
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const CENTER = { horizontal: 'center', vertical: 'middle', wrapText: true };

function main() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DiscontinuityShot';
  const ws = wb.addWorksheet(facility.name, {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const maxSets = Math.max(...stations.map((s) => s.sets.length));
  const lastCol = 1 + maxSets * 3;

  ws.getColumn(1).width = 13;
  for (let i = 0; i < maxSets; i++) {
    ws.getColumn(2 + i * 3).width = 17;
    ws.getColumn(3 + i * 3).width = 8;
    ws.getColumn(4 + i * 3).width = 6;
  }

  let r = 1;
  for (const st of stations) r = renderStation(ws, r, st, lastCol) + 2;

  wb.xlsx.writeFile(OUT).then(() => console.log('written:', OUT));
}

function renderStation(ws, startRow, st, lastCol) {
  const nSets = st.sets.length;
  const firstCol = 2;
  const setCols = (i) => ({ l: firstCol + i * 3, m: firstCol + i * 3 + 1, r: firstCol + i * 3 + 2 });
  const colL = (n) => ws.getColumn(n).letter;
  const merge = (row, c1, c2) => { if (c2 > c1) ws.mergeCells(row, c1, row, c2); };
  const put = (row, col, val, o = {}) => {
    const cell = ws.getCell(row, col);
    cell.value = val;
    cell.border = BORDER;
    cell.alignment = o.alignment || CENTER;
    if (o.fill) cell.fill = o.fill;
    if (o.font) cell.font = o.font;
  };
  const rowBorders = (row, c2 = lastCol) => { for (let c = 1; c <= c2; c++) ws.getCell(row, c).border = BORDER; };

  let r = startRow;

  // 제목
  merge(r, 1, lastCol);
  put(r, 1, `불연속면 특성 (${st.siteId}) : ${st.location}`, { fill: C.headFill, font: { bold: true, size: 13 } });
  ws.getRow(r).height = 24; r++;

  // 부제
  merge(r, 1, lastCol);
  put(r, 1, `시설물: ${facility.name}    |    조사자: ${facility.surveyor}    |    조사일: ${facility.surveyDate}`,
    { font: { size: 9, color: { argb: 'FF666666' } } });
  r++;

  // 구성 / Set n
  put(r, 1, '구 성', { fill: C.headFill, font: { bold: true } });
  st.sets.forEach((s, i) => { const c = setCols(i); merge(r, c.l, c.r); put(r, c.l, s.name, { fill: C.headFill, font: { bold: true } }); });
  rowBorders(r); r++;

  // 종류 / 방향성 / 간격
  const simpleRow = (label, pick, opt) => {
    put(r, 1, label, { fill: C.headFill });
    st.sets.forEach((s, i) => { const c = setCols(i); merge(r, c.l, c.r); put(r, c.l, pick(s), opt); });
    rowBorders(r); r++;
  };
  simpleRow('종 류', (s) => s.type);
  simpleRow('방향성', (s) => s.orientation, { font: { color: { argb: 'FFFF0000' }, bold: true } });
  simpleRow('간 격', (s) => s.spacing);

  // ①~⑤
  const scoreStart = r;
  for (let k = 0; k < 5; k++) {
    put(r, 1, ITEM_NAMES[k], { fill: C.headFill, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
    st.sets.forEach((s, i) => {
      const c = setCols(i); const it = s.items[k];
      put(r, c.l, it.label, { fill: C.labelFill });
      put(r, c.m, it.band);
      put(r, c.r, it.score, { fill: C.scoreFill, font: { bold: true } });
    });
    rowBorders(r); r++;
  }
  const scoreEnd = r - 1;

  // 합계
  put(r, 1, '', { fill: C.headFill });
  st.sets.forEach((s, i) => {
    const c = setCols(i); merge(r, c.l, c.m);
    put(r, c.l, '합 계', { fill: C.headFill });
    put(r, c.r, { formula: `SUM(${colL(c.r)}${scoreStart}:${colL(c.r)}${scoreEnd})` }, { font: { bold: true } });
  });
  rowBorders(r); const sumRow = r; r++;

  // 산술평균
  put(r, 1, '', { fill: C.headFill });
  st.sets.forEach((s, i) => {
    const c = setCols(i); merge(r, c.l, c.m);
    put(r, c.l, '산술평균', { fill: C.headFill });
    put(r, c.r, { formula: `ROUND(${colL(c.r)}${sumRow}/5,1)` });
  });
  rowBorders(r); const meanRow = r; r++;

  // 절리상태점수
  put(r, 1, '절리상태점수', { fill: C.headFill, font: { bold: true } });
  st.sets.forEach((s, i) => {
    const c = setCols(i); merge(r, c.l, c.r);
    put(r, c.l, { formula: `${colL(c.r)}${sumRow}&"/5 = "&TEXT(${colL(c.r)}${meanRow},"0.0")&" → "&ROUND(${colL(c.r)}${meanRow},0)` },
      { font: { bold: true } });
  });
  rowBorders(r); r++;

  // 측점 공통: 반발경도 / 강도 / 누수 / 암괴크기
  const commonRow = (label, val) => {
    put(r, 1, label, { fill: C.headFill });
    merge(r, firstCol, lastCol);
    put(r, firstCol, val);
    rowBorders(r); r++;
  };
  commonRow('반발경도', `${st.reboundHardness}`);
  commonRow('강 도', `${st.wallStrength_MPa}  MPa`);
  commonRow('누 수', st.seepage);
  commonRow('암괴크기', st.blockSize);

  r++; // 여백

  // 조사 사진
  merge(r, 1, lastCol);
  put(r, 1, '조사 사진', { fill: C.headFill, font: { bold: true }, alignment: { horizontal: 'left', vertical: 'middle', indent: 1 } });
  r++;

  const mid = Math.floor(lastCol / 2);
  const spans = [[1, mid], [mid + 1, lastCol]];
  const rows = Math.ceil(PHOTO_CAPTIONS.length / 2);
  for (let rw = 0; rw < rows; rw++) {
    const boxTop = r;
    for (let i = 0; i < 4; i++) { ws.getRow(r).height = 16; r++; }
    const capRow = r; r++;
    for (let col = 0; col < 2; col++) {
      const idx = rw * 2 + col;
      if (idx >= PHOTO_CAPTIONS.length) continue;
      const [c1, c2] = spans[col];
      ws.mergeCells(boxTop, c1, boxTop + 3, c2);
      const b = ws.getCell(boxTop, c1);
      b.value = '［ 사진 첨부 영역 ］'; b.alignment = CENTER; b.fill = C.photoFill;
      for (let rr = boxTop; rr <= boxTop + 3; rr++) for (let cc = c1; cc <= c2; cc++) ws.getCell(rr, cc).border = BORDER;
      merge(capRow, c1, c2);
      put(capRow, c1, PHOTO_CAPTIONS[idx], { fill: C.headFill, font: { size: 9 } });
    }
  }
  return r;
}

main();
