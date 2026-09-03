/**
 * 결과보고 Excel 생성 — 시설물 1개 = 파일 1개 = 시트 1개.
 * 시트에 측점별 "불연속면 특성" 표를 세로로 이어 정리 + 측점별 조사사진.
 *
 * 양식 근거: docs/보고서양식/ (사용자 제공 이미지 재현)
 */

import type ExcelJSNS from 'exceljs';
import {
  db,
  PHOTO_CATEGORIES,
  type DiscontinuitySet,
  type Facility,
  type Photo,
  type Station,
} from '../../db/db';
import {
  CONDITION_ITEMS,
  ITEM_LABELS,
  ITEM_NAMES,
  SEEPAGE_LABELS,
  SPACING_RANGE_TEXT,
  STAGE_SCORES,
  evaluateCondition,
  type ConditionItemKey,
} from '../scoring/condition';
import { formatDipDipDir } from '../sensors/orientation';

const solidFill = (argb: string): ExcelJSNS.FillPattern => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb },
});
const FILL_HEAD = solidFill('FFF2F2F2');
const FILL_LABEL = solidFill('FFDCE6F1');
const FILL_SCORE = solidFill('FFFFFF00');
const FILL_PHOTO = solidFill('FFFAFAFA');
const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
const BORDER: Partial<ExcelJSNS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
const CENTER: Partial<ExcelJSNS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };

type Stage = 1 | 2 | 3 | 4 | 5;
function bandText(stage: Stage): string {
  const s = STAGE_SCORES[stage];
  return s.length === 1 ? String(s[0]) : `${s[0]}~${s[1]}`;
}
function extFromType(type: string): 'jpeg' | 'png' | 'gif' {
  if (type.includes('png')) return 'png';
  if (type.includes('gif')) return 'gif';
  return 'jpeg';
}

type StationFull = Station & { sets: DiscontinuitySet[]; photos: Photo[] };
type PhotoImg = { buffer: ArrayBuffer; extension: 'jpeg' | 'png' | 'gif' };

export async function buildFacilityReport(facilityId: string): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');

  const facility = await db.facilities.get(facilityId);
  if (!facility) throw new Error('시설물을 찾을 수 없습니다.');
  const stationRows = await db.stations.where('facilityId').equals(facilityId).toArray();
  stationRows.sort((a, b) => a.createdAt - b.createdAt);

  const stations: StationFull[] = await Promise.all(
    stationRows.map(async (st) => ({
      ...st,
      sets: await db.sets.where('stationId').equals(st.id).sortBy('order'),
      photos: await db.photos.where('stationId').equals(st.id).toArray(),
    })),
  );

  // 사진 → ArrayBuffer 미리 변환 (addImage 는 동기)
  const photoImgs = new Map<string, PhotoImg>();
  for (const st of stations) {
    for (const p of st.photos) {
      const src = p.thumbnail ?? p.blob;
      try {
        photoImgs.set(p.id, { buffer: await src.arrayBuffer(), extension: extFromType(src.type) });
      } catch {
        /* 손상된 사진은 건너뜀 */
      }
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DiscontinuityShot';
  const ws = wb.addWorksheet(sanitizeSheetName(facility.name), {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const maxSets = Math.max(2, ...stations.map((s) => s.sets.length || 0));
  const lastCol = 1 + maxSets * 3;
  ws.getColumn(1).width = 13;
  for (let i = 0; i < maxSets; i++) {
    ws.getColumn(2 + i * 3).width = 17;
    ws.getColumn(3 + i * 3).width = 8;
    ws.getColumn(4 + i * 3).width = 6;
  }

  let row = 1;
  for (const st of stations) row = renderStation(wb, ws, row, facility, st, lastCol, photoImgs) + 2;
  if (stations.length === 0) ws.getCell(1, 1).value = '측점 데이터가 없습니다.';

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function renderStation(
  wb: ExcelJSNS.Workbook,
  ws: ExcelJSNS.Worksheet,
  startRow: number,
  facility: Facility,
  st: StationFull,
  lastCol: number,
  photoImgs: Map<string, PhotoImg>,
): number {
  const first = 2;
  const setCols = (i: number) => ({ l: first + i * 3, m: first + i * 3 + 1, r: first + i * 3 + 2 });
  const colL = (n: number) => ws.getColumn(n).letter;
  const merge = (rr: number, c1: number, c2: number) => {
    if (c2 > c1) ws.mergeCells(rr, c1, rr, c2);
  };
  const put = (
    rr: number,
    c: number,
    val: ExcelJSNS.CellValue,
    o: { fill?: ExcelJSNS.FillPattern; bold?: boolean; color?: string; left?: boolean } = {},
  ) => {
    const cell = ws.getCell(rr, c);
    cell.value = val;
    cell.border = BORDER;
    cell.alignment = o.left ? { ...CENTER, horizontal: 'left', indent: 1 } : CENTER;
    if (o.fill) cell.fill = o.fill;
    if (o.bold || o.color) cell.font = { bold: o.bold, color: o.color ? { argb: o.color } : undefined };
  };
  const rowBorders = (rr: number) => {
    for (let c = 1; c <= lastCol; c++) if (!ws.getCell(rr, c).border) ws.getCell(rr, c).border = BORDER;
  };

  const sets = st.sets;
  let r = startRow;

  merge(r, 1, lastCol);
  put(
    r,
    1,
    st.location ? `불연속면 특성 (${st.siteId}) : ${st.location}` : `불연속면 특성 (${st.siteId})`,
    { fill: FILL_HEAD, bold: true },
  );
  ws.getRow(r).height = 22;
  r++;

  merge(r, 1, lastCol);
  put(
    r,
    1,
    `시설물: ${facility.name}    |    조사자: ${st.surveyor || '-'}    |    조사일: ${new Date(
      st.surveyedAt,
    ).toLocaleDateString('ko-KR')}`,
  );
  r++;

  put(r, 1, '구 성', { fill: FILL_HEAD, bold: true });
  sets.forEach((s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.r);
    put(r, c.l, s.name, { fill: FILL_HEAD, bold: true });
  });
  rowBorders(r);
  r++;

  const simpleRow = (label: string, val: (s: DiscontinuitySet) => string, color?: string) => {
    put(r, 1, label, { fill: FILL_HEAD });
    sets.forEach((s, i) => {
      const c = setCols(i);
      merge(r, c.l, c.r);
      put(r, c.l, val(s), { color, bold: !!color });
    });
    rowBorders(r);
    r++;
  };
  simpleRow('종 류', (s) => s.dtype);
  simpleRow('방향성', (s) => (s.orientation ? formatDipDipDir(s.orientation) : '-'), 'FFFF0000');
  simpleRow('간 격', (s) => (s.spacing ? SPACING_RANGE_TEXT[s.spacing] : '-'));

  const scoreStart = r;
  CONDITION_ITEMS.forEach((key) => {
    put(r, 1, ITEM_NAMES[key], { fill: FILL_HEAD, left: true });
    sets.forEach((s, i) => {
      const c = setCols(i);
      const item = s.condition[key as ConditionItemKey];
      if (item) {
        put(r, c.l, ITEM_LABELS[key][item.stage - 1], { fill: FILL_LABEL });
        put(r, c.m, bandText(item.stage as Stage));
        put(r, c.r, item.score, { fill: FILL_SCORE, bold: true });
      } else {
        put(r, c.l, '-', { fill: FILL_LABEL });
        put(r, c.m, '');
        put(r, c.r, '', { fill: FILL_SCORE });
      }
    });
    rowBorders(r);
    r++;
  });
  const scoreEnd = r - 1;

  // 합계 / 산술평균 / 절리상태점수 — 계산된 값 + (Excel용) 수식
  const evals = sets.map((s) => evaluateCondition(s.condition));

  put(r, 1, '', { fill: FILL_HEAD });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.m);
    put(r, c.l, '합 계', { fill: FILL_HEAD });
    put(
      r,
      c.r,
      { formula: `SUM(${colL(c.r)}${scoreStart}:${colL(c.r)}${scoreEnd})`, result: evals[i].sum },
      { bold: true },
    );
  });
  rowBorders(r);
  const sumRow = r;
  r++;

  put(r, 1, '', { fill: FILL_HEAD });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.m);
    put(r, c.l, '산술평균', { fill: FILL_HEAD });
    put(r, c.r, { formula: `ROUND(${colL(c.r)}${sumRow}/5,1)`, result: evals[i].mean });
    ws.getCell(r, c.r).numFmt = '0.0';
  });
  rowBorders(r);
  r++;

  put(r, 1, '절리상태점수', { fill: FILL_HEAD, bold: true });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.r);
    put(r, c.l, `${evals[i].sum}/5 = ${evals[i].mean.toFixed(1)} → ${evals[i].score}`, { bold: true });
  });
  rowBorders(r);
  r++;

  const common: [string, string][] = [
    ['반발경도', ''],
    ['강 도', ''],
    ['누 수', st.seepage ? SEEPAGE_LABELS[st.seepage] : '-'],
    ['암괴크기', st.blockSize ? `${st.blockSize.x}m × ${st.blockSize.y}m × ${st.blockSize.z}m` : '-'],
  ];
  for (const [label, val] of common) {
    put(r, 1, label, { fill: FILL_HEAD });
    merge(r, first, lastCol);
    put(r, first, val);
    rowBorders(r);
    r++;
  }

  r++;
  merge(r, 1, lastCol);
  put(r, 1, '조사 사진', { fill: FILL_HEAD, bold: true, left: true });
  r++;

  const photoByCat = new Map(st.photos.map((p) => [p.category, p]));
  const mid = Math.floor(lastCol / 2);
  const spans: [number, number][] = [
    [1, mid],
    [mid + 1, lastCol],
  ];
  const BOX_ROWS = 9;
  for (let rw = 0; rw < Math.ceil(PHOTO_CATEGORIES.length / 2); rw++) {
    const boxTop = r;
    for (let k = 0; k < BOX_ROWS; k++) {
      ws.getRow(r).height = 18;
      r++;
    }
    const capRow = r;
    r++;
    for (let col = 0; col < 2; col++) {
      const idx = rw * 2 + col;
      if (idx >= PHOTO_CATEGORIES.length) continue;
      const cat = PHOTO_CATEGORIES[idx];
      const [c1, c2] = spans[col];
      ws.mergeCells(boxTop, c1, boxTop + BOX_ROWS - 1, c2);
      const box = ws.getCell(boxTop, c1);
      box.fill = FILL_PHOTO;
      box.alignment = CENTER;
      for (let rr = boxTop; rr <= boxTop + BOX_ROWS - 1; rr++)
        for (let cc = c1; cc <= c2; cc++) ws.getCell(rr, cc).border = BORDER;

      const photo = photoByCat.get(cat);
      const img = photo ? photoImgs.get(photo.id) : undefined;
      if (img) {
        try {
          const id = wb.addImage({ buffer: img.buffer, extension: img.extension });
          ws.addImage(id, {
            tl: { col: c1 - 1 + 0.15, row: boxTop - 1 + 0.15 } as ExcelJSNS.Anchor,
            ext: { width: 240, height: 150 },
            editAs: 'oneCell',
          });
        } catch {
          box.value = '［ 사진 삽입 실패 ］';
        }
      } else {
        box.value = '［ 사진 없음 ］';
      }

      ws.mergeCells(capRow, c1, capRow, c2);
      const cap = ws.getCell(capRow, c1);
      cap.value = cat;
      cap.fill = FILL_HEAD;
      cap.alignment = CENTER;
      cap.font = { size: 9 };
      cap.border = BORDER;
    }
  }

  return r;
}

function sanitizeSheetName(name: string): string {
  return (name || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
}
