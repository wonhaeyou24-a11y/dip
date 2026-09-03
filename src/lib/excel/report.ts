/**
 * 결과보고 Excel — 시설물 1개 = 파일 1개 = 시트 1개.
 *
 * 구성:
 *   1) 조사점 위치도 (시트 최상단, 실제 지도)
 *   2) 측점별 "불연속면 특성" 표 + 조사사진(원본 비율 유지)
 *   3) 반발경도 조사 (측정값 4행×5열)
 *   4) 토양경도 조사 (측정값 1행×10열)
 */

import type ExcelJSNS from 'exceljs';
import {
  SOIL_PHOTO_CATEGORIES,
  STATION_PHOTO_CATEGORIES,
  db,
  type DiscontinuitySet,
  type Facility,
  type Gps,
  type Photo,
  type SoilPoint,
  type Station,
} from '../../db/db';
import { dataUrlExtension, dataUrlToUint8Array, fitInside, imageSize } from '../image';
import { markerLabel, valueStats } from '../labels';
import { captureMapImage } from '../leafletMap';
import type { MapPoint } from '../mapImage';
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
type Ext = { width: number; height: number };

const PHOTO_BOX = { w: 300, h: 200 };
const MAP_BOX = { w: 780, h: 470 };
const ROW_PX = 18;

interface Ctx {
  ws: ExcelJSNS.Worksheet;
  wb: ExcelJSNS.Workbook;
  lastCol: number;
  photoExt: Map<string, Ext>;
}

function put(
  ctx: Ctx,
  r: number,
  c: number,
  val: ExcelJSNS.CellValue,
  o: { fill?: ExcelJSNS.FillPattern; bold?: boolean; color?: string; left?: boolean } = {},
) {
  const cell = ctx.ws.getCell(r, c);
  cell.value = val;
  cell.border = BORDER;
  cell.alignment = o.left ? { ...CENTER, horizontal: 'left', indent: 1 } : CENTER;
  if (o.fill) cell.fill = o.fill;
  if (o.bold || o.color) cell.font = { bold: o.bold, color: o.color ? { argb: o.color } : undefined };
}
function mergeRow(ctx: Ctx, r: number, c1: number, c2: number) {
  if (c2 > c1) ctx.ws.mergeCells(r, c1, r, c2);
}
function mergeRect(ctx: Ctx, r1: number, c1: number, r2: number, c2: number) {
  ctx.ws.mergeCells(r1, c1, r2, c2);
}
function fillRow(ctx: Ctx, r: number) {
  for (let c = 1; c <= ctx.lastCol; c++)
    if (!ctx.ws.getCell(r, c).border) ctx.ws.getCell(r, c).border = BORDER;
}
function bordersRect(ctx: Ctx, r1: number, c1: number, r2: number, c2: number) {
  for (let rr = r1; rr <= r2; rr++)
    for (let cc = c1; cc <= c2; cc++) ctx.ws.getCell(rr, cc).border = BORDER;
}
/** Excel 열 너비(문자단위) → 픽셀 근사 (Calibri 11 기준) */
const colPx = (w: number | undefined) => Math.round((w ?? 8.43) * 7 + 5);
/** 행 높이(pt) → 픽셀 */
const rowPx = (pt: number) => Math.round((pt * 4) / 3);

const EMU_PER_PX = 9525;

/** 시작 열(0-index)에서 px 오프셋 → { nativeCol, nativeColOff(EMU) } */
function nativeColAnchor(ctx: Ctx, startCol0: number, offsetPx: number) {
  let col = startCol0;
  let rem = Math.max(0, offsetPx);
  for (let i = 0; i < 64; i++) {
    const cw = colPx(ctx.ws.getColumn(col + 1).width);
    if (rem < cw || cw <= 0) return { nativeCol: col, nativeColOff: Math.round(rem * EMU_PER_PX) };
    rem -= cw;
    col++;
  }
  return { nativeCol: col, nativeColOff: 0 };
}

/**
 * 이미지를 (c1..c2 × rTop..rTop+rows-1) 박스 안에 비율 유지·가운데 정렬로 삽입.
 * 박스 행 높이는 모두 rowH(pt) 동일. ExcelJS 의 분수 col/row 앵커는 커스텀 열너비에서
 * 어긋나므로 native EMU 좌표를 직접 준다.
 */
function placeImage(
  ctx: Ctx,
  dataUrl: string,
  c1: number,
  c2: number,
  rTop: number,
  rows: number,
  rowH: number,
  ext: Ext,
) {
  if (!dataUrl) return;
  try {
    const id = ctx.wb.addImage({
      buffer: dataUrlToUint8Array(dataUrl) as unknown as ExcelJSNS.Buffer,
      extension: dataUrlExtension(dataUrl),
    });
    let boxW = 0;
    for (let c = c1; c <= c2; c++) boxW += colPx(ctx.ws.getColumn(c).width);
    const rH = rowPx(rowH);
    const boxH = rows * rH;
    const offX = Math.max(0, (boxW - ext.width) / 2);
    const offY = Math.max(0, (boxH - ext.height) / 2);
    const rowsDown = Math.floor(offY / rH);
    ctx.ws.addImage(id, {
      tl: {
        ...nativeColAnchor(ctx, c1 - 1, offX),
        nativeRow: rTop - 1 + rowsDown,
        nativeRowOff: Math.round((offY - rowsDown * rH) * EMU_PER_PX),
      } as ExcelJSNS.Anchor,
      ext,
      editAs: 'oneCell',
    });
  } catch {
    /* ignore */
  }
}
function sectionTitle(ctx: Ctx, r: number, text: string) {
  mergeRow(ctx, r, 1, ctx.lastCol);
  put(ctx, r, 1, text, { fill: FILL_HEAD, bold: true, left: true });
  fillRow(ctx, r);
}

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

  // 사진 실제 크기 → 박스에 비율 유지하며 맞춤
  const photoExt = new Map<string, Ext>();
  const allPhotos = [...stations.flatMap((s) => s.photos), ...soils.flatMap((s) => s.photos)].filter(
    (p) => p.dataUrl,
  );
  await Promise.all(
    allPhotos.map(async (p) => {
      const { w, h } = await imageSize(p.dataUrl);
      photoExt.set(p.id, fitInside(w, h, PHOTO_BOX.w, PHOTO_BOX.h));
    }),
  );

  const wb = new ExcelJS.Workbook();
  wb.creator = 'DiscontinuityShot';
  const ws = wb.addWorksheet(sanitizeSheetName(facility.name), {
    views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  const maxSets = Math.max(2, ...stations.map((s) => s.sets.length || 0));
  const lastCol = Math.max(11, 1 + maxSets * 3);
  ws.getColumn(1).width = 12;
  for (let c = 2; c <= lastCol; c++) ws.getColumn(c).width = 8.6;
  for (let i = 0; i < maxSets; i++) ws.getColumn(2 + i * 3).width = 13;

  const ctx: Ctx = { ws, wb, lastCol, photoExt };
  let r = 1;

  // ── 1) 조사점 위치도 ──
  const mapPoints: MapPoint[] = [
    ...stations
      .filter((s) => s.gps)
      .map((s) => ({ id: s.id, label: markerLabel(s.siteId), lat: s.gps!.lat, lon: s.gps!.lon, kind: 'station' as const })),
    ...soils
      .filter((s) => s.gps)
      .map((s) => ({ id: s.id, label: markerLabel(s.pointId), lat: s.gps!.lat, lon: s.gps!.lon, kind: 'soil' as const })),
  ];
  const mapUrl = await captureMapImage(mapPoints, 940, 580);
  if (mapUrl) {
    mergeRow(ctx, r, 1, lastCol);
    put(ctx, r, 1, `${facility.name} — 조사점 위치도`, { fill: FILL_HEAD, bold: true });
    fillRow(ctx, r);
    r++;
    const mapExt = fitInside(940, 580, MAP_BOX.w, MAP_BOX.h);
    const mapTop = r;
    const mapRowH = 16;
    const mapRows = Math.ceil(mapExt.height / rowPx(mapRowH)) + 1;
    for (let k = 0; k < mapRows; k++) ws.getRow(r++).height = mapRowH;
    mergeRect(ctx, mapTop, 1, mapTop + mapRows - 1, lastCol);
    bordersRect(ctx, mapTop, 1, mapTop + mapRows - 1, lastCol);
    placeImage(ctx, mapUrl, 1, lastCol, mapTop, mapRows, mapRowH, mapExt);
    r += 2;
  }

  // ── 2) 측점별 불연속면 특성 ──
  for (const st of stations) r = renderStation(ctx, r, facility, st) + 2;

  // ── 3) 반발경도 조사 (4행×5열) ──
  const withRebound = stations.filter(
    (s) => (s.reboundValues ?? []).filter((x) => Number.isFinite(x)).length > 0,
  );
  if (withRebound.length > 0) {
    sectionTitle(ctx, r++, '반발경도 조사');
    for (const st of withRebound) {
      r =
        renderValueGrid(
          ctx,
          r,
          `반발경도 (${st.siteId})${st.location ? ` : ${st.location}` : ''}`,
          st.gps,
          st.reboundValues ?? [],
          20,
          5,
        ) + 1;
    }
    r += 1;
  }

  // ── 4) 토양경도 조사 (1행×10열) ──
  if (soils.length > 0) {
    sectionTitle(ctx, r++, '토양경도 조사');
    for (const sp of soils) {
      mergeRow(ctx, r, 1, lastCol);
      put(
        ctx,
        r,
        1,
        sp.location ? `토양경도 (${sp.pointId}) : ${sp.location}` : `토양경도 (${sp.pointId})`,
        { fill: FILL_HEAD, bold: true },
      );
      ws.getRow(r).height = 18;
      r++;
      mergeRow(ctx, r, 1, lastCol);
      put(
        ctx,
        r,
        1,
        `시설물: ${facility.name}    |    조사자: ${sp.surveyor || '-'}    |    조사일: ${new Date(
          sp.surveyedAt,
        ).toLocaleDateString('ko-KR')}`,
      );
      r++;
      r = renderGridBody(ctx, r, sp.gps, sp.hardnessValues ?? [], 10, 10);
      r = renderPhotos(ctx, r, sp.photos, SOIL_PHOTO_CATEGORIES) + 2;
    }
  }

  if (stations.length === 0 && soils.length === 0) ws.getCell(r, 1).value = '조사 데이터가 없습니다.';

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** GPS 행 + 값 그리드 + 통계 행 */
function renderGridBody(
  ctx: Ctx,
  startRow: number,
  gps: Gps | undefined,
  values: number[],
  target: number,
  cols: number,
): number {
  let r = startRow;
  const stat = valueStats(values);

  put(ctx, r, 1, 'GPS', { fill: FILL_HEAD });
  mergeRow(ctx, r, 2, ctx.lastCol);
  put(ctx, r, 2, gps ? `${gps.lat.toFixed(6)}, ${gps.lon.toFixed(6)}` : '-', { left: true });
  fillRow(ctx, r);
  r++;

  const gridRows = Math.ceil(target / cols);
  const gridTop = r;
  for (let gr = 0; gr < gridRows; gr++) {
    for (let gc = 0; gc < cols; gc++) {
      const i = gr * cols + gc;
      const v = i < values.length && Number.isFinite(values[i]) ? values[i] : '';
      put(ctx, gridTop + gr, 2 + gc, v as ExcelJSNS.CellValue, { bold: true });
    }
    for (let c = 2 + cols; c <= ctx.lastCol; c++) put(ctx, gridTop + gr, c, '');
  }
  put(ctx, gridTop, 1, '측정값', { fill: FILL_HEAD });
  if (gridRows > 1) {
    for (let gr = 1; gr < gridRows; gr++) put(ctx, gridTop + gr, 1, '', { fill: FILL_HEAD });
    mergeRect(ctx, gridTop, 1, gridTop + gridRows - 1, 1);
    ctx.ws.getCell(gridTop, 1).alignment = CENTER;
  }
  r = gridTop + gridRows;

  put(ctx, r, 1, '통계', { fill: FILL_HEAD });
  mergeRow(ctx, r, 2, ctx.lastCol);
  put(
    ctx,
    r,
    2,
    stat.n > 0 ? `평균 ${stat.mean} · 최소 ${stat.min} · 최대 ${stat.max} (${stat.n}/${target})` : '-',
    { left: true },
  );
  fillRow(ctx, r);
  return r + 1;
}

function renderValueGrid(
  ctx: Ctx,
  startRow: number,
  title: string,
  gps: Gps | undefined,
  values: number[],
  target: number,
  cols: number,
): number {
  mergeRow(ctx, startRow, 1, ctx.lastCol);
  put(ctx, startRow, 1, title, { fill: FILL_HEAD, bold: true });
  fillRow(ctx, startRow);
  return renderGridBody(ctx, startRow + 1, gps, values, target, cols);
}

function renderStation(ctx: Ctx, startRow: number, facility: Facility, st: StationFull): number {
  const { ws, lastCol } = ctx;
  const first = 2;
  const setCols = (i: number) => ({ l: first + i * 3, m: first + i * 3 + 1, r: first + i * 3 + 2 });
  const colL = (n: number) => ws.getColumn(n).letter;
  const sets = st.sets;
  let r = startRow;

  mergeRow(ctx, r, 1, lastCol);
  put(
    ctx,
    r,
    1,
    st.location ? `불연속면 특성 (${st.siteId}) : ${st.location}` : `불연속면 특성 (${st.siteId})`,
    { fill: FILL_HEAD, bold: true },
  );
  ws.getRow(r).height = 22;
  r++;

  mergeRow(ctx, r, 1, lastCol);
  put(
    ctx,
    r,
    1,
    `시설물: ${facility.name}    |    조사자: ${st.surveyor || '-'}    |    조사일: ${new Date(
      st.surveyedAt,
    ).toLocaleDateString('ko-KR')}`,
  );
  r++;

  put(ctx, r, 1, '구 성', { fill: FILL_HEAD, bold: true });
  sets.forEach((s, i) => {
    const c = setCols(i);
    mergeRow(ctx, r, c.l, c.r);
    put(ctx, r, c.l, s.name, { fill: FILL_HEAD, bold: true });
  });
  fillRow(ctx, r);
  r++;

  const simpleRow = (label: string, val: (s: DiscontinuitySet) => string, color?: string) => {
    put(ctx, r, 1, label, { fill: FILL_HEAD });
    sets.forEach((s, i) => {
      const c = setCols(i);
      mergeRow(ctx, r, c.l, c.r);
      put(ctx, r, c.l, val(s), { color, bold: !!color });
    });
    fillRow(ctx, r);
    r++;
  };
  simpleRow('종 류', (s) => s.dtype);
  simpleRow('방향성', (s) => (s.orientation ? formatDipDipDir(s.orientation) : '-'), 'FFFF0000');
  simpleRow('간 격', (s) => (s.spacing ? SPACING_RANGE_TEXT[s.spacing] : '-'));

  const scoreStart = r;
  CONDITION_ITEMS.forEach((key) => {
    put(ctx, r, 1, ITEM_NAMES[key], { fill: FILL_HEAD, left: true });
    sets.forEach((s, i) => {
      const c = setCols(i);
      const item = s.condition[key as ConditionItemKey];
      if (item) {
        put(ctx, r, c.l, ITEM_LABELS[key][item.stage - 1], { fill: FILL_LABEL });
        put(ctx, r, c.m, bandText(item.stage as Stage));
        put(ctx, r, c.r, item.score, { fill: FILL_SCORE, bold: true });
      } else {
        put(ctx, r, c.l, '-', { fill: FILL_LABEL });
        put(ctx, r, c.m, '');
        put(ctx, r, c.r, '', { fill: FILL_SCORE });
      }
    });
    fillRow(ctx, r);
    r++;
  });
  const scoreEnd = r - 1;
  const evals = sets.map((s) => evaluateCondition(s.condition));

  put(ctx, r, 1, '', { fill: FILL_HEAD });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    mergeRow(ctx, r, c.l, c.m);
    put(ctx, r, c.l, '합 계', { fill: FILL_HEAD });
    put(
      ctx,
      r,
      c.r,
      { formula: `SUM(${colL(c.r)}${scoreStart}:${colL(c.r)}${scoreEnd})`, result: evals[i].sum },
      { bold: true },
    );
  });
  fillRow(ctx, r);
  const sumRow = r;
  r++;

  put(ctx, r, 1, '', { fill: FILL_HEAD });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    mergeRow(ctx, r, c.l, c.m);
    put(ctx, r, c.l, '산술평균', { fill: FILL_HEAD });
    put(ctx, r, c.r, { formula: `ROUND(${colL(c.r)}${sumRow}/5,1)`, result: evals[i].mean });
    ws.getCell(r, c.r).numFmt = '0.0';
  });
  fillRow(ctx, r);
  r++;

  put(ctx, r, 1, '절리상태점수', { fill: FILL_HEAD, bold: true });
  sets.forEach((_s, i) => {
    const c = setCols(i);
    mergeRow(ctx, r, c.l, c.r);
    put(ctx, r, c.l, `${evals[i].sum}/5 = ${evals[i].mean.toFixed(1)} → ${evals[i].score}`, { bold: true });
  });
  fillRow(ctx, r);
  r++;

  const rb = valueStats(st.reboundValues ?? []);
  const common: [string, string][] = [
    ['반발경도', rb.n > 0 ? `평균 ${rb.mean} (최소 ${rb.min} ~ 최대 ${rb.max}, ${rb.n}개)` : ''],
    ['강 도', ''],
    ['누 수', st.seepage ? SEEPAGE_LABELS[st.seepage] : '-'],
    ['암괴크기', st.blockSize ? `${st.blockSize.x}m × ${st.blockSize.y}m × ${st.blockSize.z}m` : '-'],
  ];
  for (const [label, val] of common) {
    put(ctx, r, 1, label, { fill: FILL_HEAD });
    mergeRow(ctx, r, first, lastCol);
    put(ctx, r, first, val);
    fillRow(ctx, r);
    r++;
  }

  return renderPhotos(ctx, r, st.photos, STATION_PHOTO_CATEGORIES);
}

function renderPhotos(ctx: Ctx, startRow: number, photos: Photo[], categories: readonly string[]): number {
  const { ws, lastCol, photoExt } = ctx;
  let r = startRow + 1;
  mergeRow(ctx, r, 1, lastCol);
  put(ctx, r, 1, '조사 사진', { fill: FILL_HEAD, bold: true, left: true });
  r++;

  const byCat = new Map(photos.filter((p) => p.dataUrl).map((p) => [p.category, p]));
  const mid = Math.floor(lastCol / 2);
  const spans: [number, number][] = [
    [1, mid],
    [mid + 1, lastCol],
  ];
  const BOX_ROWS = Math.ceil(PHOTO_BOX.h / ROW_PX) + 1;

  for (let rw = 0; rw < Math.ceil(categories.length / 2); rw++) {
    const boxTop = r;
    for (let k = 0; k < BOX_ROWS; k++) ws.getRow(r++).height = ROW_PX;
    const capRow = r;
    r++;
    for (let col = 0; col < 2; col++) {
      const idx = rw * 2 + col;
      if (idx >= categories.length) continue;
      const [c1, c2] = spans[col];
      mergeRect(ctx, boxTop, c1, boxTop + BOX_ROWS - 1, c2);
      bordersRect(ctx, boxTop, c1, boxTop + BOX_ROWS - 1, c2);
      const boxCell = ws.getCell(boxTop, c1);
      boxCell.fill = FILL_PHOTO;
      boxCell.alignment = CENTER;

      const photo = byCat.get(categories[idx]);
      const ext = photo ? photoExt.get(photo.id) : undefined;
      if (photo?.dataUrl && ext) placeImage(ctx, photo.dataUrl, c1, c2, boxTop, BOX_ROWS, ROW_PX, ext);
      else boxCell.value = '［ 사진 없음 ］';

      mergeRow(ctx, capRow, c1, c2);
      const cap = ws.getCell(capRow, c1);
      cap.value = categories[idx];
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
