/**
 * 결과보고 Excel — 시설물 1개 = 파일 1개 = 시트 1개.
 *
 * 구성:
 *   1) 조사점 위치도 (시트 최상단)
 *   2) 측점별 "불연속면 특성" 표 (세로로 이어 정리) + 조사사진
 *   3) 토양경도 조사 표 (상세절리조사 다음)
 */

import type ExcelJSNS from 'exceljs';
import {
  SOIL_PHOTO_CATEGORIES,
  STATION_PHOTO_CATEGORIES,
  db,
  type DiscontinuitySet,
  type Facility,
  type Photo,
  type SoilPoint,
  type Station,
} from '../../db/db';
import { dataUrlExtension, dataUrlToUint8Array } from '../image';
import { markerLabel, valueStats } from '../labels';
import { captureMapImage } from '../leafletMap';
import type { MapPoint } from '../mapImage';
import type { Gps } from '../../db/db';
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
const bandText = (stage: Stage) => {
  const s = STAGE_SCORES[stage];
  return s.length === 1 ? String(s[0]) : `${s[0]}~${s[1]}`;
};

type StationFull = Station & { sets: DiscontinuitySet[]; photos: Photo[] };
type SoilFull = SoilPoint & { photos: Photo[] };

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
      photos: await db.photos.where('ownerId').equals(st.id).toArray(),
    })),
  );

  const soilRows = await db.soils.where('facilityId').equals(facilityId).sortBy('order');
  const soils: SoilFull[] = await Promise.all(
    soilRows.map(async (sp) => ({
      ...sp,
      photos: await db.photos.where('ownerId').equals(sp.id).toArray(),
    })),
  );

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

  const merge = (r: number, c1: number, c2: number) => {
    if (c2 > c1) ws.mergeCells(r, c1, r, c2);
  };
  const putCell = (
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
  const fillRow = (r: number) => {
    for (let c = 1; c <= lastCol; c++) if (!ws.getCell(r, c).border) ws.getCell(r, c).border = BORDER;
  };
  const cellRef = (col: number, row: number) => `${ws.getColumn(col).letter}${row}`;
  /** 셀 범위(c1,r1)~(c2,r2) 에 이미지 앵커 — 문자열 range 방식이 가장 안정적 */
  const addImg = (dataUrl: string, c1: number, r1: number, c2: number, r2: number) => {
    if (!dataUrl) return;
    try {
      const id = wb.addImage({
        buffer: dataUrlToUint8Array(dataUrl) as unknown as ExcelJSNS.Buffer,
        extension: dataUrlExtension(dataUrl),
      });
      ws.addImage(id, `${cellRef(c1, r1)}:${cellRef(c2, r2)}`);
    } catch {
      /* ignore */
    }
  };

  let r = 1;

  // ── 1) 조사점 위치도 ──
  const mapPoints: MapPoint[] = [
    ...stations
      .filter((s) => s.gps)
      .map((s) => ({
        id: s.id,
        label: markerLabel(s.siteId),
        lat: s.gps!.lat,
        lon: s.gps!.lon,
        kind: 'station' as const,
      })),
    ...soils
      .filter((s) => s.gps)
      .map((s) => ({
        id: s.id,
        label: markerLabel(s.pointId),
        lat: s.gps!.lat,
        lon: s.gps!.lon,
        kind: 'soil' as const,
      })),
  ];
  const mapUrl = await captureMapImage(mapPoints, 940, 580);
  if (mapUrl) {
    merge(r, 1, lastCol);
    putCell(r, 1, `${facility.name} — 조사점 위치도`, { fill: FILL_HEAD, bold: true });
    fillRow(r);
    r++;
    const mapTop = r;
    const mapRows = 24;
    for (let k = 0; k < mapRows; k++) {
      ws.getRow(r).height = 16;
      r++;
    }
    ws.mergeCells(mapTop, 1, mapTop + mapRows - 1, lastCol);
    for (let rr = mapTop; rr < mapTop + mapRows; rr++)
      for (let cc = 1; cc <= lastCol; cc++) ws.getCell(rr, cc).border = BORDER;
    addImg(mapUrl, 1, mapTop, lastCol, mapTop + mapRows - 1);
    r += 2;
  }

  const helpers: Helpers = { merge, putCell, fillRow, addImg };

  // ── 2) 측점별 불연속면 특성 ──
  for (const st of stations) {
    r = renderStation(ws, r, facility, st, lastCol, helpers) + 2;
  }

  // ── 3) 반발경도 조사 (토양경도 위) ──
  const withRebound = stations.filter(
    (s) => (s.reboundValues ?? []).filter((x) => Number.isFinite(x)).length > 0,
  );
  if (withRebound.length > 0) {
    merge(r, 1, lastCol);
    putCell(r, 1, '반발경도 조사', { fill: FILL_HEAD, bold: true, left: true });
    fillRow(r);
    r += 1;
    for (const st of withRebound) {
      r =
        renderValueBlock(
          r,
          `반발경도 (${st.siteId})${st.location ? ` : ${st.location}` : ''}`,
          st.gps,
          st.reboundValues ?? [],
          20,
          lastCol,
          helpers,
        ) + 1;
    }
    r += 1;
  }

  // ── 4) 토양경도 조사 ──
  if (soils.length > 0) {
    merge(r, 1, lastCol);
    putCell(r, 1, '토양경도 조사', { fill: FILL_HEAD, bold: true, left: true });
    fillRow(r);
    r += 1;
    for (const sp of soils) {
      r = renderSoil(ws, r, facility, sp, lastCol, helpers) + 2;
    }
  }

  if (stations.length === 0 && soils.length === 0) {
    ws.getCell(r, 1).value = '조사 데이터가 없습니다.';
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

interface Helpers {
  merge: (r: number, c1: number, c2: number) => void;
  putCell: (
    r: number,
    c: number,
    val: ExcelJSNS.CellValue,
    o?: { fill?: ExcelJSNS.FillPattern; bold?: boolean; color?: string; left?: boolean },
  ) => void;
  fillRow: (r: number) => void;
  addImg: (dataUrl: string, c1: number, r1: number, c2: number, r2: number) => void;
}

/** 측정값 목록 블록 (반발경도 20 / 토양경도 10 공용) */
function renderValueBlock(
  startRow: number,
  title: string,
  gps: Gps | undefined,
  values: number[],
  target: number,
  lastCol: number,
  h: Helpers,
): number {
  const { merge, putCell: put, fillRow } = h;
  let r = startRow;
  const stat = valueStats(values);
  const list = values.filter((x) => Number.isFinite(x)).join(', ');

  merge(r, 1, lastCol);
  put(r, 1, title, { fill: FILL_HEAD, bold: true });
  fillRow(r);
  r++;

  const rows: [string, string][] = [
    ['GPS', gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : '-'],
    ['측정값', list || '-'],
    [
      '통계',
      stat.n > 0
        ? `평균 ${stat.mean} · 최소 ${stat.min} · 최대 ${stat.max} (${stat.n}/${target})`
        : '-',
    ],
  ];
  for (const [label, val] of rows) {
    put(r, 1, label, { fill: FILL_HEAD });
    merge(r, 2, lastCol);
    put(r, 2, val, { left: true });
    fillRow(r);
    r++;
  }
  return r;
}

function renderStation(
  ws: ExcelJSNS.Worksheet,
  startRow: number,
  facility: Facility,
  st: StationFull,
  lastCol: number,
  h: Helpers,
): number {
  const first = 2;
  const setCols = (i: number) => ({ l: first + i * 3, m: first + i * 3 + 1, r: first + i * 3 + 2 });
  const colL = (n: number) => ws.getColumn(n).letter;
  const { merge, putCell: put, fillRow: rowBorders } = h;
  const sets = st.sets;
  let r = startRow;

  merge(r, 1, lastCol);
  put(r, 1, st.location ? `불연속면 특성 (${st.siteId}) : ${st.location}` : `불연속면 특성 (${st.siteId})`, {
    fill: FILL_HEAD,
    bold: true,
  });
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

  const rb = valueStats(st.reboundValues ?? []);
  const common: [string, string][] = [
    ['반발경도', rb.n > 0 ? `평균 ${rb.mean} (최소 ${rb.min} ~ 최대 ${rb.max}, ${rb.n}개)` : ''],
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

  r = renderPhotos(ws, r, st.photos, STATION_PHOTO_CATEGORIES, lastCol, h);
  return r;
}

function renderSoil(
  ws: ExcelJSNS.Worksheet,
  startRow: number,
  facility: Facility,
  sp: SoilFull,
  lastCol: number,
  h: Helpers,
): number {
  const { merge, putCell: put, fillRow } = h;
  let r = startRow;

  merge(r, 1, lastCol);
  put(r, 1, sp.location ? `토양경도 (${sp.pointId}) : ${sp.location}` : `토양경도 (${sp.pointId})`, {
    fill: FILL_HEAD,
    bold: true,
  });
  ws.getRow(r).height = 20;
  r++;

  merge(r, 1, lastCol);
  put(
    r,
    1,
    `시설물: ${facility.name}    |    조사자: ${sp.surveyor || '-'}    |    조사일: ${new Date(
      sp.surveyedAt,
    ).toLocaleDateString('ko-KR')}`,
  );
  r++;

  const st = valueStats(sp.hardnessValues ?? []);
  const vals = (sp.hardnessValues ?? []).filter((x) => Number.isFinite(x)).join(', ');
  const rows: [string, string][] = [
    ['GPS', sp.gps ? `${sp.gps.lat.toFixed(6)}, ${sp.gps.lon.toFixed(6)}` : '-'],
    ['측정값', vals || '-'],
    ['통계', st.n > 0 ? `평균 ${st.mean} · 최소 ${st.min} · 최대 ${st.max} (${st.n}/10)` : '-'],
  ];
  for (const [label, val] of rows) {
    put(r, 1, label, { fill: FILL_HEAD });
    merge(r, 2, lastCol);
    put(r, 2, val, { left: true });
    fillRow(r);
    r++;
  }

  r = renderPhotos(ws, r, sp.photos, SOIL_PHOTO_CATEGORIES, lastCol, h);
  return r;
}

function renderPhotos(
  ws: ExcelJSNS.Worksheet,
  startRow: number,
  photos: Photo[],
  categories: readonly string[],
  lastCol: number,
  h: Helpers,
): number {
  const { merge, putCell: put, addImg } = h;
  let r = startRow + 1;
  merge(r, 1, lastCol);
  put(r, 1, '조사 사진', { fill: FILL_HEAD, bold: true, left: true });
  r++;

  const byCat = new Map(photos.filter((p) => p.dataUrl).map((p) => [p.category, p]));
  const mid = Math.floor(lastCol / 2);
  const spans: [number, number][] = [
    [1, mid],
    [mid + 1, lastCol],
  ];
  const BOX_ROWS = 9;
  for (let rw = 0; rw < Math.ceil(categories.length / 2); rw++) {
    const boxTop = r;
    for (let k = 0; k < BOX_ROWS; k++) {
      ws.getRow(r).height = 18;
      r++;
    }
    const capRow = r;
    r++;
    for (let col = 0; col < 2; col++) {
      const idx = rw * 2 + col;
      if (idx >= categories.length) continue;
      const cat = categories[idx];
      const [c1, c2] = spans[col];
      ws.mergeCells(boxTop, c1, boxTop + BOX_ROWS - 1, c2);
      const box = ws.getCell(boxTop, c1);
      box.fill = FILL_PHOTO;
      box.alignment = CENTER;
      for (let rr = boxTop; rr <= boxTop + BOX_ROWS - 1; rr++)
        for (let cc = c1; cc <= c2; cc++) ws.getCell(rr, cc).border = BORDER;

      const photo = byCat.get(cat);
      if (photo?.dataUrl) addImg(photo.dataUrl, c1, boxTop, c2, boxTop + BOX_ROWS - 1);
      else box.value = '［ 사진 없음 ］';

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
