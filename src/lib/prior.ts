/**
 * 전차(사전조사) 자료 가져오기.
 * 전차자료정리 스킬이 만든 organized.json 을 읽어, 프로젝트 안에 시설물을 만들거나(이미 있으면 갱신) 전차 시험 표를 붙인다.
 *  - 값은 원문 그대로 보관한다(읽기 전용). 금회 입력과 섞지 않는다.
 *  - 전차 표는 field_tests (시험·측량 결과 표, 셀 구조 그대로) 에서 가져온다.
 */
import {
  createFacility,
  createSet,
  createStation,
  db,
  uid,
  updateFacility,
  type Facility,
  type PriorData,
  type PriorTest,
  type TestKind,
} from '../db/db';
import { spacingClassFromM, type SeepageClass, type SpacingClass } from './scoring/condition';
import { composeSoilLocation, nextSoilId } from './labels';

export const TEST_KIND_LABEL: Record<TestKind, string> = {
  discontinuity: '불연속면·절리상태',
  rebound: '암반 반발경도',
  soil: '토양경도',
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const norm = (s: string): string => s.toLowerCase().replace(/[\s_\-.,()·]/g, '');

/** 전차 시험 종류(분류 이름) → 이 앱에서 입력할 수 있는 조사 항목. 입력할 수 없으면 null(데스크에서 입력) */
export function kindOfCategory(category: string): TestKind | null {
  const c = category || '';
  if (/토양경도|토질|연경도|표준관입/.test(c)) return 'soil';
  if (/불연속면|절리/.test(c)) return 'discontinuity';
  if (/반발경도|슈미트|암반/.test(c)) return 'rebound';
  return null;
}

/** 절토사면이면 true (옹벽 시험은 이 앱이 아니라 데스크에서 입력한다) */
export function isSlopeFacility(f: Pick<Facility, 'name' | 'prior'>): boolean {
  const kind = str((f.prior?.ledger as Record<string, unknown> | undefined)?.['시설물종류']);
  if (/옹벽/.test(kind) || (!kind && /옹벽/.test(f.name))) return false;
  return true;
}

export interface ParsedPrior {
  ok: true;
  name: string;
  facilityNo: string;
  prior: PriorData;
}

export function parsePriorJson(text: string, fileName: string): ParsedPrior | { ok: false; reason: string } {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'JSON 파일을 읽지 못했습니다.' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: '전차자료정리 결과(JSON 객체)가 아닙니다.' };
  const ledger = (obj.ledger && typeof obj.ledger === 'object' ? obj.ledger : {}) as Record<string, unknown>;
  const name = str(ledger['시설물명']) || str(obj.facility);
  if (!name) return { ok: false, reason: '시설물명을 찾을 수 없습니다(ledger.시설물명 / facility 없음).' };
  const facilityNo = str(ledger['시설물번호']);
  const rawTables = Array.isArray(obj.raw_tables) ? (obj.raw_tables as Record<string, unknown>[]).filter((r) => str(r['분류']) === '시험·측량') : [];
  const raw = Array.isArray(obj.field_tests) ? (obj.field_tests as Record<string, unknown>[]) : rawTables;
  const tests: PriorTest[] = raw
    .filter((r) => r && Array.isArray(r.grid))
    .map((r, i) => {
      const table = str(r['table']) || String(i + 1);
      const category = refineCategory(str(r['분류']) || '기타', str(r['제목(표 앞 문단)']), (r.grid as unknown[][]).slice(0, 3).map((x) => (Array.isArray(x) ? x.join(' ') : '')).join(' '));
      return {
        id: `ft-${table}`,
        category,
        title: str(r['제목(표 앞 문단)']) || `${category} (표 ${table})`,
        section: str(r['절']) || undefined,
        before: Array.isArray(r['표 앞 문단']) ? (r['표 앞 문단'] as unknown[]).map(str).filter(Boolean) : undefined,
        after: Array.isArray(r['표 뒤 문단(주석 등)']) ? (r['표 뒤 문단(주석 등)'] as unknown[]).map(str).filter(Boolean) : undefined,
        grid: (r.grid as unknown[][]).map((row) => (Array.isArray(row) ? row.map(str) : [])),
        source: str(r['출처']) || undefined,
      };
    });
  return { ok: true, name, facilityNo, prior: { source: fileName, importedAt: Date.now(), facilityNo: facilityNo || undefined, ledger, tests } };
}

export interface ImportLine {
  file: string;
  ok: boolean;
  reason?: string;
  facilityName?: string;
  created?: boolean;
  tests?: number;
}

/** 프로젝트에 전차자료 파일들을 가져온다: 시설물번호 → 시설물명 순으로 기존 시설물을 찾고, 없으면 새로 만든다. */
export async function importPriorFiles(projectId: string, files: File[]): Promise<ImportLine[]> {
  const out: ImportLine[] = [];
  for (const file of files) {
    const parsed = parsePriorJson(await file.text(), file.name);
    if (!parsed.ok) {
      out.push({ file: file.name, ok: false, reason: parsed.reason });
      continue;
    }
    const facs = await db.facilities.where('projectId').equals(projectId).toArray();
    let target =
      (parsed.facilityNo ? facs.find((f) => f.prior?.facilityNo === parsed.facilityNo) : undefined) ??
      facs.find((f) => norm(f.name) === norm(parsed.name));
    let created = false;
    if (!target) {
      const id = await createFacility(parsed.name, projectId);
      target = (await db.facilities.get(id))!;
      created = true;
    }
    // 금회 조사 항목은 전차에 있는 시험 종류로 미리 골라 둔다(이미 사용자가 고른 것이 있으면 유지). 옹벽은 이 앱에서 입력할 항목이 없다.
    const slope = isSlopeFacility({ name: target.name, prior: parsed.prior });
    const kinds = Array.from(new Set(parsed.prior.tests.map((t) => kindOfCategory(t.category)).filter((k): k is TestKind => !!k)));
    await updateFacility(target.id, { prior: parsed.prior, plan: target.plan ?? (slope ? kinds : []) });
    // 전차에 측정 기록이 있던 자리는 금회 조사점·측점으로 미리 만들어 둔다 (값은 전차 값이 연하게 보임). 이미 있는 자리는 건너뜀.
    if (slope) {
      await createSoilPointsFromPrior(target.id);
      await createStationsFromPrior(target.id);
      await createSetsFromPrior(target.id);
    }
    out.push({ file: file.name, ok: true, facilityName: target.name, created, tests: parsed.prior.tests.length });
  }
  return out;
}

export interface PriorSoilPos {
  id: string;
  pos: number;
  soil: string;
}

/** 전차 토양경도 표에서 측정 위치(m)를 읽는다: 머리글에 "측정위치" 칸이 있고 첫 칸이 SH-n 인 행. 읽지 못하면 빈 목록. */
export function priorSoilPositions(prior: PriorData | undefined): PriorSoilPos[] {
  const out: PriorSoilPos[] = [];
  for (const t of prior?.tests ?? []) {
    if (kindOfCategory(t.category) !== 'soil') continue;
    const head = t.grid.findIndex((r) => r.some((c) => /측정\s*위치/.test(c)));
    if (head < 0) continue;
    const col = t.grid[head].findIndex((c) => /측정\s*위치/.test(c));
    const soilCol = t.grid[head].findIndex((c) => /지반\s*종류/.test(c));
    for (const row of t.grid.slice(head + 1)) {
      if (!/^SH-?\s*\d+/i.test(row[0] ?? '')) continue;
      const pos = parseFloat((row[col] ?? '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(pos)) continue;
      out.push({ id: row[0], pos, soil: soilCol >= 0 ? row[soilCol] ?? '' : '' });
    }
    if (out.length) break;
  }
  return out;
}

/** 전차 반발경도 측점마다 금회 측점을 만든다(같은 거리의 측점이 이미 있으면 건너뜀). 만든 개수를 돌려준다. */
export async function createStationsFromPrior(facilityId: string): Promise<number> {
  const f = await db.facilities.get(facilityId);
  const recs = [
    ...priorReboundRecords(f?.prior).filter((r) => r.pos !== undefined).map((r) => ({ pos: r.pos as number })),
    ...priorReboundSummaries(f?.prior).filter((r) => r.pos !== undefined).map((r) => ({ pos: r.pos as number })),
  ].filter((r, i, a) => a.findIndex((x) => x.pos === r.pos) === i);
  const existing = await db.stations.where('facilityId').equals(facilityId).toArray();
  let made = 0;
  for (const r of recs) {
    if (existing.some((s) => s.staValue === r.pos)) continue;
    const id = await createStation(facilityId);
    await db.stations.update(id, { staValue: r.pos, location: `${r.pos}m` });
    made++;
  }
  return made;
}

/** 전차 위치마다 금회 토양경도 조사점을 만든다(같은 거리의 점이 이미 있으면 건너뜀). 만든 개수를 돌려준다. */
export async function createSoilPointsFromPrior(facilityId: string): Promise<number> {
  const f = await db.facilities.get(facilityId);
  const positions = priorSoilPositions(f?.prior);
  if (!positions.length) return createSoilPointsFromGroups(facilityId);
  const existing = await db.soils.where('facilityId').equals(facilityId).toArray();
  let count = existing.length;
  let made = 0;
  const now = Date.now();
  for (const p of positions) {
    if (existing.some((s) => s.staValue === p.pos)) continue;
    await db.soils.add({
      id: uid(),
      facilityId,
      pointId: nextSoilId(count),
      order: count,
      staValue: p.pos,
      location: composeSoilLocation(p.pos, null),
      surveyor: '',
      surveyedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    count++;
    made++;
  }
  return made;
}

// ───────────── 전차 측정값 구조화 (금회 입력칸에 연하게 보여 주기 위함) ─────────────
export interface PriorSoilRecord {
  id: string;
  pos: number;
  soil: string;
  values: number[];
  avg: string;
  cls: string;
}

const numOf = (c: string): number => {
  const t = (c ?? '').replace(/,/g, '').trim();
  return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
};

/** 전차 토양경도 표 → 점별 기록(위치·지반종류·측정값·평균·분류). 머리글의 "측정위치"와 "측정치"~"평균" 사이 칸을 측정값으로 읽는다. */
export function priorSoilRecords(prior: PriorData | undefined): PriorSoilRecord[] {
  const out: PriorSoilRecord[] = [];
  for (const t of prior?.tests ?? []) {
    if (kindOfCategory(t.category) !== 'soil') continue;
    const head = t.grid.findIndex((r) => r.some((c) => /측정\s*위치/.test(c)));
    if (head < 0) continue;
    const h = t.grid[head];
    const posCol = h.findIndex((c) => /측정\s*위치/.test(c));
    const soilCol = h.findIndex((c) => /지반\s*종류/.test(c));
    const avgCol = h.findIndex((c) => /평균/.test(c));
    const clsCol = h.findIndex((c) => /분류/.test(c));
    const from = h.findIndex((c, i) => i > posCol && /측정치|측정값|경도/.test(c));
    const start = from >= 0 ? from : posCol + 1;
    const end = avgCol > start ? avgCol : h.length;
    for (const row of t.grid.slice(head + 1)) {
      if (!/^SH-?\s*\d+/i.test(row[0] ?? '')) continue;
      const pos = parseFloat((row[posCol] ?? '').replace(/[^0-9.\-]/g, ''));
      if (!Number.isFinite(pos)) continue;
      const values = row.slice(start, end).map(numOf).filter((v) => Number.isFinite(v));
      out.push({ id: row[0], pos, soil: soilCol >= 0 ? row[soilCol] ?? '' : '', values, avg: avgCol >= 0 ? row[avgCol] ?? '' : '', cls: clsCol >= 0 ? row[clsCol] ?? '' : '' });
    }
    if (out.length) break;
  }
  return out;
}

/** 금회 토양경도 점에 대응하는 전차 기록: 거리(m)가 같으면(0.5m 이내) 그 점, 없으면 ID(SH-n)가 같은 점 */
export function matchPriorSoil(prior: PriorData | undefined, sp: { staValue?: number; pointId: string }): PriorSoilRecord | undefined {
  const recs = priorSoilRecords(prior);
  if (sp.staValue !== undefined) {
    const hit = recs.find((r) => Math.abs(r.pos - sp.staValue!) < 0.5);
    if (hit) return hit;
  }
  const norm = (x: string) => x.replace(/[\s\-]/g, '').toUpperCase();
  return recs.find((r) => norm(r.id) === norm(sp.pointId));
}

export interface PriorRebound {
  label: string;
  pos?: number;
  values: number[];
}

/** 전차 반발경도 표 → 측점별 R 값. 머리글에 위치/측점 칸이 있고, 같은 줄에 숫자가 5개 이상이면 측정값으로 본다(읽지 못하면 빈 목록 — 원문 표를 보세요). */
export function priorReboundRecords(prior: PriorData | undefined): PriorRebound[] {
  const out: PriorRebound[] = [];
  for (const t of prior?.tests ?? []) {
    if (kindOfCategory(t.category) !== 'rebound') continue;
    const head = t.grid.findIndex((r) => r.some((c) => /측정\s*위치|측점|위치/.test(c)));
    if (head < 0) continue;
    const posCol = t.grid[head].findIndex((c) => /측정\s*위치|측점|위치/.test(c));
    for (const row of t.grid.slice(head + 1)) {
      const label = (row[posCol] ?? '').trim();
      if (!label) continue;
      const values = row.filter((_, i) => i !== posCol).map(numOf).filter((v) => Number.isFinite(v));
      if (values.length < 5) continue;
      const m = label.match(/(\d+(?:\.\d+)?)\s*m?$/i);
      out.push({ label, pos: m ? parseFloat(m[1]) : undefined, values });
    }
  }
  return out;
}

export function matchPriorRebound(prior: PriorData | undefined, st: { staValue?: number }): PriorRebound | undefined {
  if (st.staValue === undefined) return undefined;
  return priorReboundRecords(prior).find((r) => r.pos !== undefined && Math.abs(r.pos - st.staValue!) < 0.5);
}

export type CompareState = 'same' | 'changed' | 'partial' | 'empty';
export interface CompareResult {
  state: CompareState;
  changed: number;
  filled: number;
}

/** 금회 값과 전차 값 비교: 같은 자리마다 같으면 same, 하나라도 다르면 changed, 일부만 입력이면 partial, 없으면 empty */
export function compareWithPrior(prior: number[], cur: number[] | undefined): CompareResult {
  const c = cur ?? [];
  const filled = c.filter((v) => Number.isFinite(v)).length;
  if (!filled) return { state: 'empty', changed: 0, filled: 0 };
  let changed = 0;
  c.forEach((v, i) => {
    if (Number.isFinite(v) && !(Number.isFinite(prior[i]) && prior[i] === v)) changed++;
  });
  if (changed) return { state: 'changed', changed, filled };
  return { state: filled < prior.length ? 'partial' : 'same', changed: 0, filled };
}

// ───────────── 전차 불연속면(절리군) 기록 ─────────────
export interface PriorSetItem {
  label: string;
  score?: number;
}

export interface PriorSet {
  /** 측점 구분 (Site-A → 'A') */
  site: string;
  /** 표에 적힌 측점 위치(m), 예: "측점 128m" */
  sitePos?: number;
  /** 종류·간격 원문 */
  dtype?: string;
  spacing?: string;
  /** 측점 공통(표에는 첫 칸에만 적혀 있어도 같은 측점의 모든 Set 에 채운다) */
  seepage?: string;
  blockSize?: { x: number; y: number; z: number };
  strength?: string;
  /** ①연장성 ②틈새 ③거칠기 ④충진물질 ⑤풍화도 — 상태값 원문과 점수 */
  items?: Record<'persistence' | 'aperture' | 'roughness' | 'infilling' | 'weathering', PriorSetItem>;
  setNo: number;
  dip?: number;
  dipDir?: number;
  /** 전차 절리상태 점수 */
  score?: number;
}

const SET_RE = /^(?:set|j|절리군|절리)[\s\-_.]*(\d+)$/i;
const SITE_RE = /(?:site|사이트)[\s\-_.]*([A-Za-z]|\d+)/i;
const ORI_RE = /(\d{1,2}(?:\.\d+)?)\s*[/˚°]\s*(\d{1,3}(?:\.\d+)?)/;

const siteKey = (s: string): string => {
  const t = s.trim();
  return /^\d+$/.test(t) ? String.fromCharCode(64 + Math.min(26, parseInt(t, 10))) : t.toUpperCase();
};

/**
 * 전차 불연속면 표 → 절리군 기록. 두 가지 모양을 읽는다.
 *  ① 세로형(전차자료정리 결과의 "불연속면의 특성조사 (Site-A)" 표): 머리글 줄에 Set 1 · Set 2 · … 가 나란히 있고,
 *     아래로 종류·방향성(79/248)·간격·①연장성~⑤풍화도(상태값 + 점수)·절리상태점수(16/5 = 3.2 -> 3점)
 *  ② 가로형: 한 줄이 절리군 하나 (Set 칸 + 경사/경사방향 칸 + 점수 칸)
 * 방향은 "경사/경사방향" 순서(샘플 보고서의 "60/308" 표기). 읽지 못하면 빈 목록 — 원문 표는 그대로 볼 수 있다.
 */
export function priorDiscontinuityRecords(prior: PriorData | undefined): PriorSet[] {
  const out: PriorSet[] = [];
  const ITEM_KEYS = ['persistence', 'aperture', 'roughness', 'infilling', 'weathering'] as const;
  const CIRC = ['①', '②', '③', '④', '⑤'];
  for (const t of prior?.tests ?? []) {
    if (kindOfCategory(t.category) !== 'discontinuity') continue;
    if (/평사투영/.test(t.title)) continue; // 같은 Set 의 방향을 다시 보여 주는 해석 표 — 건너뜀
    // 측점(Site)과 위치: 제목·첫 줄의 "Site-A : 측점 128m"
    const headText = `${t.title} ${(t.grid[0] ?? []).join(' ')}`;
    let site = 'A';
    const sm = headText.match(SITE_RE);
    if (sm) site = siteKey(sm[1]);
    else {
      const sec = `${t.section ?? ''} ${t.title}`.match(/(\d+)\s*구간/);
      if (sec) site = siteKey(sec[1]);
    }
    const pm = headText.match(/측점\s*(\d+(?:\.\d+)?)\s*m/);
    const sitePos = pm ? parseFloat(pm[1]) : undefined;
    let scoreCol = -1;
    let setCols: { col: number; no: number }[] = [];
    const seen: Record<string, PriorSet> = {};
    const put = (no: number, patch: Partial<PriorSet>) => {
      const key = `${site}#${no}`;
      const rec = seen[key] ?? (seen[key] = { site, setNo: no, sitePos });
      Object.assign(rec, patch);
      if (!out.includes(rec)) out.push(rec);
    };
    for (const row of t.grid) {
      const cells = row.map((c) => (c ?? '').trim());
      const sc = cells.map((c, col) => ({ col, m: c.match(SET_RE) })).filter((x) => x.m).map((x) => ({ col: x.col, no: parseInt(x.m![1], 10) }));
      if (sc.length >= 2) {
        setCols = sc;
        continue;
      }
      if (setCols.length) {
        const label = cells[0] ?? '';
        for (const sc2 of setCols) {
          const v = cells[sc2.col] ?? '';
          const nxt = cells[sc2.col + 1] ?? '';
          if (/방향성|주향|경사/.test(label)) {
            const m = v.match(ORI_RE);
            if (m) put(sc2.no, { dip: parseFloat(m[1]), dipDir: parseFloat(m[2]) });
          } else if (/^종\s*류/.test(label)) {
            if (v) put(sc2.no, { dtype: v });
          } else if (/^간\s*격/.test(label)) {
            if (v) put(sc2.no, { spacing: v });
          } else if (/^누\s*수/.test(label)) {
            if (v) put(sc2.no, { seepage: v });
          } else if (/^암괴\s*크기/.test(label)) {
            const nums = v.match(/\d+(?:\.\d+)?/g);
            if (nums && nums.length >= 3 && sc2 === setCols[0]) put(sc2.no, { blockSize: { x: parseFloat(nums[0]), y: parseFloat(nums[1]), z: parseFloat(nums[2]) } });
          } else if (/^강\s*도/.test(label)) {
            if (v && sc2 === setCols[0]) put(sc2.no, { strength: v });
          } else if (CIRC.some((c) => label.startsWith(c))) {
            const idx = CIRC.findIndex((c) => label.startsWith(c));
            const sv = parseFloat(nxt);
            const rec = seen[`${site}#${sc2.no}`];
            const items = { ...(rec?.items ?? {}) } as NonNullable<PriorSet['items']>;
            items[ITEM_KEYS[idx]] = { label: v, score: Number.isFinite(sv) ? sv : undefined };
            put(sc2.no, { items });
          } else if (/절리\s*상태/.test(label) || (!label && /->/.test(v))) {
            const arrow = v.match(/->\s*(\d+(?:\.\d+)?)/);
            const mean = v.match(/=\s*(\d+(?:\.\d+)?)/);
            const val = arrow ? parseFloat(arrow[1]) : mean ? Math.round(parseFloat(mean[1])) : parseFloat(v);
            if (Number.isFinite(val)) put(sc2.no, { score: Math.round(val) });
          }
        }
        continue;
      }
      // 가로형 머리글(점수 칸 위치)과 데이터 줄
      if (cells.some((c) => /절리\s*상태|상태\s*점수|점수/.test(c)) && !cells.some((c) => ORI_RE.test(c))) {
        scoreCol = cells.findIndex((c) => /절리\s*상태|상태\s*점수|점수/.test(c));
      }
      for (const c of cells) {
        const m = c.match(SITE_RE);
        if (m) {
          site = siteKey(m[1]);
          break;
        }
      }
      const setCell = cells.map((c) => c.match(SET_RE)).find((m) => m);
      if (!setCell) continue;
      const no = parseInt(setCell[1], 10);
      const ori = cells.map((c) => c.match(ORI_RE)).find((m) => m);
      const patch: Partial<PriorSet> = {};
      if (ori) {
        patch.dip = parseFloat(ori[1]);
        patch.dipDir = parseFloat(ori[2]);
      }
      if (scoreCol >= 0) {
        const v = parseFloat((cells[scoreCol] ?? '').replace(/[^0-9.]/g, ''));
        if (Number.isFinite(v)) patch.score = Math.round(v);
      }
      put(no, patch);
    }
  }
  // 측점 공통 값(누수·암괴크기·강도): 표에 첫 칸에만 있어도 같은 측점의 모든 Set 에 채운다
  const bySite: Record<string, PriorSet[]> = {};
  out.forEach((r) => (bySite[r.site] = bySite[r.site] ?? []).push(r));
  Object.values(bySite).forEach((list) => {
    const pick = <K extends 'seepage' | 'blockSize' | 'strength'>(k: K) => list.find((r) => r[k] !== undefined)?.[k];
    const sp = pick('seepage');
    const bs = pick('blockSize');
    const st = pick('strength');
    list.forEach((r) => {
      if (r.seepage === undefined && sp !== undefined) r.seepage = sp;
      if (r.blockSize === undefined && bs !== undefined) r.blockSize = bs;
      if (r.strength === undefined && st !== undefined) r.strength = st;
    });
  });
  return out;
}

/** "완전건조" · "dry" · "습함" … → 누수 상태 분류 */
export function seepageFromText(t: string | undefined): SeepageClass | null {
  const s = (t ?? '').toLowerCase().replace(/\s/g, '');
  if (!s) return null;
  if (/건조|dry/.test(s)) return 'g_dry';
  if (/습|damp|moist/.test(s)) return 'g_damp';
  if (/젖|wet/.test(s)) return 'g_wet';
  if (/떨어|drip/.test(s)) return 'g_dropping';
  if (/흐|flow/.test(s)) return 'g_flowing';
  return null;
}

/** "0.2 ~ 0.6" · "0.2~0.6m" → 최소·최대(m)와 간격 분류(중간값 기준) */
export function spacingFromText(t: string | undefined): { min: number; max: number; cls: SpacingClass } | null {
  const nums = (t ?? '').match(/\d+(?:\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const a = parseFloat(nums[0]);
  const b = nums.length > 1 ? parseFloat(nums[1]) : a;
  return { min: Math.min(a, b), max: Math.max(a, b), cls: spacingClassFromM((a + b) / 2) };
}

export function matchPriorSet(prior: PriorData | undefined, siteId: string, setName: string): PriorSet | undefined {
  const site = (siteId.match(/SITE[-\s]*([A-Z0-9]+)/i)?.[1] ?? siteId).toUpperCase();
  const no = parseInt(setName.replace(/[^0-9]/g, ''), 10);
  return priorDiscontinuityRecords(prior).find((r) => r.site.toUpperCase() === site && r.setNo === no);
}

const angDiff = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** 전차 방향과 금회 방향 비교: 경사·경사방향이 각각 10˚ 이내면 같은 절리군으로 본다 */
export function compareOrientation(pr: PriorSet, cur: { dip: number; dipDirection: number } | null | undefined): 'none' | 'same' | 'changed' {
  if (!cur || pr.dip === undefined || pr.dipDir === undefined) return 'none';
  return Math.abs(pr.dip - cur.dip) <= 10 && angDiff(pr.dipDir, cur.dipDirection) <= 10 ? 'same' : 'changed';
}

export const priorSetText = (p: PriorSet): string =>
  [p.dip !== undefined && p.dipDir !== undefined ? `${p.dip}/${String(Math.round(p.dipDir)).padStart(3, '0')}` : '', p.score !== undefined ? `절리상태 ${p.score}` : ''].filter(Boolean).join(' · ') || '기록 없음';

/** 전차 측점(Site)·절리군(Set)마다 금회 측점과 절리군을 만들어 둔다. 이미 있으면 건너뜀. 만든 절리군 수를 돌려준다. */
export async function createSetsFromPrior(facilityId: string): Promise<number> {
  const f = await db.facilities.get(facilityId);
  const recs = priorDiscontinuityRecords(f?.prior);
  let made = 0;
  for (const rec of recs) {
    const siteId = `SITE-${rec.site.toUpperCase()}`;
    const idx = siteId.length === 6 ? siteId.charCodeAt(5) - 65 : -1;
    if (idx < 0 || idx > 25) continue;
    let st = (await db.stations.where('facilityId').equals(facilityId).toArray()).find((s) => s.siteId === siteId);
    while (!st) {
      await createStation(facilityId);
      st = (await db.stations.where('facilityId').equals(facilityId).toArray()).find((s) => s.siteId === siteId);
      if (st && rec.sitePos !== undefined && st.staValue === undefined) {
        await db.stations.update(st.id, { staValue: rec.sitePos, location: `${rec.sitePos}m` });
        st = await db.stations.get(st.id);
      }
      if ((await db.stations.where('facilityId').equals(facilityId).count()) > idx + 1) break;
    }
    if (!st) continue;
    const name = `Set ${rec.setNo}`;
    const have = (await db.sets.where('stationId').equals(st.id).toArray()).some((x) => x.name === name);
    if (have) continue;
    const id = await createSet(st.id);
    await db.sets.update(id, { name });
    made++;
  }
  return made;
}

// ───────────── 전차자료정리 결과(raw_tables) 대응 ─────────────
/** 표 제목·머리글로 시험 종류 이름을 정한다 (분류가 "시험·측량" 하나로 뭉쳐 오는 자료 대응) */
export function refineCategory(category: string, title: string, head: string): string {
  const t = `${title} ${head}`;
  if (/평사투영/.test(t)) return '평사투영해석';
  if (/불연속면.*특성|(?:site|사이트)[\s\-_.]*[A-Za-z]/i.test(t) && /Set\s*\d/i.test(t)) return '불연속면 특성조사';
  if (/토양경도/.test(title) && /시험\s*결과/.test(title)) return '토양경도';
  if (/반발경도|절리면\s*압축강도|슈미트/.test(title) && /결과|강도/.test(title)) return '암반 반발경도';
  return category;
}

export interface PriorSoilGroup {
  section: string;
  from?: number;
  to?: number;
  count: number;
  min?: number;
  max?: number;
  avg?: number;
  soil: string;
  cls: string;
}

/** 요약형 전차 토양경도 표: "3구간 | 344m~407m (3개소) | 최소 | 최대 | 평균 | 지반종류 | 분류" */
export function priorSoilGroups(prior: PriorData | undefined): PriorSoilGroup[] {
  const out: PriorSoilGroup[] = [];
  for (const t of prior?.tests ?? []) {
    if (kindOfCategory(t.category) !== 'soil') continue;
    for (const row of t.grid) {
      if (!/^\d+\s*구간/.test((row[0] ?? '').trim())) continue;
      const rng = (row[1] ?? '').match(/(\d+(?:\.\d+)?)\s*m?\s*[~∼-]\s*(\d+(?:\.\d+)?)\s*m/);
      const cnt = (row[1] ?? '').match(/(\d+)\s*개소/);
      const n = (c: string) => {
        const v = parseFloat((c ?? '').replace(/,/g, ''));
        return Number.isFinite(v) ? v : undefined;
      };
      out.push({
        section: row[0].trim(),
        from: rng ? parseFloat(rng[1]) : undefined,
        to: rng ? parseFloat(rng[2]) : undefined,
        count: cnt ? parseInt(cnt[1], 10) : 1,
        min: n(row[2]),
        max: n(row[3]),
        avg: n(row[4]),
        soil: (row[5] ?? '').trim(),
        cls: (row[6] ?? '').trim(),
      });
    }
    if (out.length) break;
  }
  return out;
}

export interface PriorReboundSummary {
  section: string;
  label: string;
  pos?: number;
  min?: number;
  max?: number;
  avg?: number;
  strength: string;
  cls: string;
}

/** 요약형 전차 암반 반발경도 표: "1구간 | 128m 비탈면 상단 | 47~61 (54.7) | 126.8 | 보통암" */
export function priorReboundSummaries(prior: PriorData | undefined): PriorReboundSummary[] {
  const out: PriorReboundSummary[] = [];
  for (const t of prior?.tests ?? []) {
    if (kindOfCategory(t.category) !== 'rebound') continue;
    for (const row of t.grid) {
      if (!/^\d+\s*구간/.test((row[0] ?? '').trim())) continue;
      const pos = (row[1] ?? '').match(/(\d+(?:\.\d+)?)\s*m/);
      const r = (row[2] ?? '').match(/(\d+(?:\.\d+)?)\s*[~∼-]\s*(\d+(?:\.\d+)?)(?:\s*\((\d+(?:\.\d+)?)\))?/);
      out.push({
        section: row[0].trim(),
        label: (row[1] ?? '').trim(),
        pos: pos ? parseFloat(pos[1]) : undefined,
        min: r ? parseFloat(r[1]) : undefined,
        max: r ? parseFloat(r[2]) : undefined,
        avg: r && r[3] ? parseFloat(r[3]) : undefined,
        strength: (row[3] ?? '').trim(),
        cls: (row[4] ?? '').trim(),
      });
    }
  }
  return out;
}

export function matchPriorReboundSummary(prior: PriorData | undefined, st: { staValue?: number }): PriorReboundSummary | undefined {
  if (st.staValue === undefined) return undefined;
  return priorReboundSummaries(prior).find((r) => r.pos !== undefined && Math.abs(r.pos - st.staValue!) < 0.5);
}

/** 금회 토양경도 점에 대응하는 전차 구간 요약: 거리가 구간 범위 안이거나 위치 글자에 구간 이름이 있을 때 */
export function matchPriorSoilGroup(prior: PriorData | undefined, sp: { staValue?: number; location?: string }): PriorSoilGroup | undefined {
  const gs = priorSoilGroups(prior);
  return (
    gs.find((g) => sp.staValue !== undefined && g.from !== undefined && g.to !== undefined && sp.staValue >= Math.min(g.from, g.to) - 0.5 && sp.staValue <= Math.max(g.from, g.to) + 0.5) ??
    gs.find((g) => !!sp.location && sp.location.includes(g.section))
  );
}

/** 요약형 표로 토양경도 조사점 만들기: 구간마다 "시험개소" 수만큼 (위치는 구간 범위 글자로만 적고 거리는 지어내지 않는다) */
export async function createSoilPointsFromGroups(facilityId: string): Promise<number> {
  const f = await db.facilities.get(facilityId);
  const groups = priorSoilGroups(f?.prior);
  const existing = await db.soils.where('facilityId').equals(facilityId).toArray();
  let count = existing.length;
  let made = 0;
  const now = Date.now();
  for (const g of groups) {
    const tag = g.from !== undefined && g.to !== undefined ? `${g.section} ${g.from}~${g.to}m` : g.section;
    const have = existing.filter((s) => s.location.startsWith(g.section)).length;
    for (let k = have; k < g.count; k++) {
      await db.soils.add({
        id: uid(),
        facilityId,
        pointId: nextSoilId(count),
        order: count,
        location: `${tag} (${k + 1}/${g.count})`,
        surveyor: '',
        surveyedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      count++;
      made++;
    }
  }
  return made;
}
