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
const CENTER: Partial<ExcelJSNS.Alignment> = {
  horizontal: 'center',
  vertical: 'middle',
  wrapText: true,
};

function bandText(stage: 1 | 2 | 3 | 4 | 5): string {
  const s = STAGE_SCORES[stage];
  return s.length === 1 ? String(s[0]) : `${s[0]}~${s[1]}`;
}

function extFromType(type: string): 'jpeg' | 'png' | 'gif' {
  if (type.includes('png')) return 'png';
  if (type.includes('gif')) return 'gif';
  return 'jpeg';
}

export interface FacilityReportData {
  facility: Facility;
  stations: (Station & { sets: DiscontinuitySet[]; photos: Photo[] })[];
}

export async function loadFacilityReportData(facilityId: string): Promise<FacilityReportData> {
  const facility = await db.facilities.get(facilityId);
  if (!facility) throw new Error('시설물을 찾을 수 없습니다.');
  const stations = await db.stations.where('facilityId').equals(facilityId).toArray();
  stations.sort((a, b) => a.createdAt - b.createdAt);
  const withChildren = await Promise.all(
    stations.map(async (st) => ({
      ...st,
      sets: await db.sets.where('stationId').equals(st.id).sortBy('order'),
      photos: await db.photos.where('stationId').equals(st.id).toArray(),
    })),
  );
  return { facility, stations: withChildren };
}

export async function buildFacilityReport(facilityId: string): Promise<Blob> {
  const { default: ExcelJS } = await import('exceljs');
  const data = await loadFacilityReportData(facilityId);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DiscontinuityShot';
  const ws = wb.addWorksheet(sanitizeSheetName(data.facility.name), {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const maxSets = Math.max(2, ...data.stations.map((s) => s.sets.length || 0));
  const lastCol = 1 + maxSets * 3;

  ws.getColumn(1).width = 13;
  for (let i = 0; i < maxSets; i++) {
    ws.getColumn(2 + i * 3).width = 17;
    ws.getColumn(3 + i * 3).width = 8;
    ws.getColumn(4 + i * 3).width = 6;
  }

  let row = 1;
  for (const st of data.stations) {
    row = renderStation(ExcelJS, wb, ws, row, data.facility, st, lastCol) + 2;
  }
  if (data.stations.length === 0) {
    ws.getCell(1, 1).value = '측점 데이터가 없습니다.';
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function renderStation(
  ExcelJS: typeof ExcelJSNS,
  wb: ExcelJSNS.Workbook,
  ws: ExcelJSNS.Worksheet,
  startRow: number,
  facility: Facility,
  st: Station & { sets: DiscontinuitySet[]; photos: Photo[] },
  lastCol: number,
): number {
  const first = 2;
  const setCols = (i: number) => ({ l: first + i * 3, m: first + i * 3 + 1, r: first + i * 3 + 2 });
  const colL = (n: number) => ws.getColumn(n).letter;
  const merge = (r: number, c1: number, c2: number) => {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
  };
  const put = (
    r: number,
    c: number,
    val: ExcelJSNS.CellValue,
    o: { fill?: ExcelJSNS.FillPattern; bold?: boolean; color?: string; left?: boolean } = {},
  ) => {
    const cell = ws.getCell(r, c);
    cell.value = val;
    cell.border = BORDER;
    cell.alignment = o.left ? { ...CENTER, horizontal: 'left', indent: 1 } : CENTER;
    if (o.fill) cell.fill = o.fill;
    if (o.bold || o.color) cell.font = { bold: o.bold, color: o.color ? { argb: o.color } : undefined };
  };
  const rowBorders = (r: number) => {
    for (let c = 1; c <= lastCol; c++) if (!ws.getCell(r, c).border) ws.getCell(r, c).border = BORDER;
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
        put(r, c.m, bandText(item.stage));
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

  put(r, 1, '', { fill: FILL_HEAD });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.m);
    put(r, c.l, '합 계', { fill: FILL_HEAD });
    put(r, c.r, { formula: `SUM(${colL(c.r)}${scoreStart}:${colL(c.r)}${scoreEnd})` }, { bold: true });
  });
  rowBorders(r);
  const sumRow = r;
  r++;

  put(r, 1, '', { fill: FILL_HEAD });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.m);
    put(r, c.l, '산술평균', { fill: FILL_HEAD });
    put(r, c.r, { formula: `ROUND(${colL(c.r)}${sumRow}/5,1)` });
  });
  rowBorders(r);
  const meanRow = r;
  r++;

  put(r, 1, '절리상태점수', { fill: FILL_HEAD, bold: true });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    merge(r, c.l, c.r);
    put(
      r,
      c.l,
      {
        formula: `${colL(c.r)}${sumRow}&"/5 = "&TEXT(${colL(c.r)}${meanRow},"0.0")&" → "&ROUND(${colL(
          c.r,
        )}${meanRow},0)`,
      },
      { bold: true },
    );
  });
  rowBorders(r);
  r++;

  // 반발경도·강도는 현장 입력 안 함 → 결과보고에 빈칸으로 출력 (담당자가 사무실에서 기입)
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
  for (let rw = 0; rw < Math.ceil(PHOTO_CATEGORIES.length / 2); rw++) {
    const boxTop = r;
    for (let k = 0; k < 6; k++) {
      ws.getRow(r).height = 16;
      r++;
    }
    const capRow = r;
    r++;
    for (let col = 0; col < 2; col++) {
      const idx = rw * 2 + col;
      if (idx >= PHOTO_CATEGORIES.length) continue;
      const cat = PHOTO_CATEGORIES[idx];
      const [c1, c2] = spans[col];
      ws.mergeCells(boxTop, c1, boxTop + 5, c2);
      const box = ws.getCell(boxTop, c1);
      box.fill = FILL_PHOTO;
      for (let rr = boxTop; rr <= boxTop + 5; rr++)
        for (let cc = c1; cc <= c2; cc++) ws.getCell(rr, cc).border = BORDER;

      const photo = photoByCat.get(cat);
      if (photo) {
        // 원본이 크면 썸네일 사용
        const src = photo.blob.size <= 400_000 ? photo.blob : (photo.thumbnail ?? photo.blob);
        void embedPhoto(ExcelJS, wb, ws, src, boxTop, c1, c2 - c1 + 1);
      } else {
        box.value = '［ 사진 없음 ］';
        box.alignment = CENTER;
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

const photoBufferCache = new WeakMap<Blob, Promise<ArrayBuffer>>();

async function embedPhoto(
  _ExcelJS: typeof ExcelJSNS,
  wb: ExcelJSNS.Workbook,
  ws: ExcelJSNS.Worksheet,
  blob: Blob,
  topRow: number,
  leftCol: number,
  colSpan: number,
): Promise<void> {
  let bufP = photoBufferCache.get(blob);
  if (!bufP) {
    bufP = blob.arrayBuffer();
    photoBufferCache.set(blob, bufP);
  }
  const buffer = await bufP;
  const imageId = wb.addImage({ buffer, extension: extFromType(blob.type) });
  const width = Math.min(320, colSpan * 60);
  ws.addImage(imageId, {
    tl: { col: leftCol - 1 + 0.1, row: topRow - 1 + 0.1 },
    ext: { width, height: width * 0.7 },
  });
}

function sanitizeSheetName(name: string): string {
  return (name || 'Sheet1').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
}
