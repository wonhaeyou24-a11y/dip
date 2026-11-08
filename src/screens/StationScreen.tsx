import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { MultiValueInput } from '../components/MultiValueInput';
import { compareOrientation, matchPriorRebound, matchPriorReboundSummary, matchPriorSet, priorDiscontinuityRecords, priorSetText, seepageFromText } from '../lib/prior';
import { PhotoGrid } from '../components/PhotoGrid';
import { StickyBar, flushAndRun } from '../components/StickyBar';
import { STATION_PHOTO_CATEGORIES } from '../db/db';
import {
  createSet,
  db,
  deleteSetCascade,
  setStationLocationPart,
  updateStation,
  type DiscontinuitySet,
  type Station,
} from '../db/db';
import { formatGps, getCurrentGps } from '../lib/geo';
import { useHeaderSubtitle } from '../lib/headerContext';
import { SITE_IDS, SLOPE_POSITIONS, type SlopePosition } from '../lib/labels';
import { formatDipDipDir } from '../lib/sensors/orientation';
import { SEEPAGE_CLASSES, SEEPAGE_LABELS, type SeepageClass } from '../lib/scoring/condition';

export function StationScreen() {
  const { fid = '', sid = '' } = useParams();
  const navigate = useNavigate();

  const station = useLiveQuery(() => db.stations.get(sid), [sid]);
  const facility = useLiveQuery(() => db.facilities.get(fid), [fid]);
  useHeaderSubtitle(facility?.name);
  const sets = useLiveQuery(
    () => db.sets.where('stationId').equals(sid).sortBy('order'),
    [sid],
    [] as DiscontinuitySet[],
  );
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const gpsTried = useRef(false);

  const save = (patch: Partial<Station>) => updateStation(sid, patch);

  const captureGps = async () => {
    setGpsBusy(true);
    setGpsErr(null);
    try {
      const gps = await getCurrentGps();
      await save({ gps });
    } catch (e) {
      setGpsErr(e instanceof Error ? e.message : '위치 실패');
    } finally {
      setGpsBusy(false);
    }
  };

  useEffect(() => {
    if (!station || gpsTried.current) return;
    gpsTried.current = true;
    if (!station.gps) void captureGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station]);

  if (station === undefined) return <p className="muted">불러오는 중…</p>;
  if (station === null) return <p className="muted">측점을 찾을 수 없습니다.</p>;
  const st: Station = station;
  const prRebound = matchPriorRebound(facility?.prior, st);
  const siteLetter = (st.siteId.match(/SITE[-\s]*([A-Z0-9]+)/i)?.[1] ?? '').toUpperCase();
  const prSite = priorDiscontinuityRecords(facility?.prior).find((r) => r.site.toUpperCase() === siteLetter);
  const prSeep = seepageFromText(prSite?.seepage);
  const prSum = matchPriorReboundSummary(facility?.prior, st);
  const rbOut = prSum && prSum.min !== undefined && prSum.max !== undefined ? (st.reboundValues ?? []).filter((v) => Number.isFinite(v) && (v < prSum.min! || v > prSum.max!)).length : 0;

  const num = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <>
      <p className="crumb">{st.siteId}</p>

      <div className="card">
        <h2>측점 정보</h2>
        <div className="rows">
          <div className="row">
            <span className="row-label">Site ID</span>
            <select value={st.siteId} onChange={(e) => save({ siteId: e.target.value })}>
              {SITE_IDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {!SITE_IDS.includes(st.siteId) && <option value={st.siteId}>{st.siteId}</option>}
            </select>
          </div>
          <div className="row">
            <span className="row-label">측점 거리</span>
            <span className="row-inline">
              <input
                className="w-sm"
                type="number"
                inputMode="decimal"
                placeholder="58"
                defaultValue={st.staValue ?? ''}
                onBlur={(e) => setStationLocationPart(sid, { staValue: num(e.target.value) })}
              />
              <span className="unit">m 비탈면</span>
            </span>
          </div>
          <div className="row">
            <span className="row-label">위치</span>
            <select
              value={st.slopePosition ?? ''}
              onChange={(e) =>
                setStationLocationPart(sid, {
                  slopePosition: (e.target.value || null) as SlopePosition | null,
                })
              }
            >
              <option value="">선택</option>
              {SLOPE_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {st.location && (
            <div className="row">
              <span className="row-label">위치설명</span>
              <span className="row-value muted">{st.location}</span>
            </div>
          )}
          <div className="row">
            <span className="row-label">조사자</span>
            <input defaultValue={st.surveyor} onBlur={(e) => save({ surveyor: e.target.value })} />
          </div>
          <div className="row">
            <span className="row-label">조사일</span>
            <input
              type="date"
              defaultValue={toDateInput(st.surveyedAt)}
              onBlur={(e) => save({ surveyedAt: fromDateInput(e.target.value, st.surveyedAt) })}
            />
          </div>
        </div>
      </div>

      <button
        className="primary"
        onClick={async () => {
          const id = await createSet(sid);
          navigate(`/f/${fid}/s/${sid}/set/${id}`);
        }}
      >
        ＋ 절리군(Set) 추가
      </button>

      <div className="card">
        <h2>절리군 ({sets.length})</h2>
        {sets.length === 0 && <p className="muted">절리군을 추가하세요.</p>}
        <div className="list">
          {sets.map((s) => (
            <div className="list-item" key={s.id}>
              <Link to={`/f/${fid}/s/${sid}/set/${s.id}`} className="list-main">
                <strong>
                  {s.name} · {s.dtype}
                </strong>
                <span className="muted">
                  {s.orientation ? formatDipDipDir(s.orientation) : '방향성 미측정'} ·{' '}
                  {s.condition.complete ? `절리상태 ${s.condition.score}` : '절리상태 미완'}
                  {facility?.prior && (() => {
                    const pr = matchPriorSet(facility.prior, st.siteId, s.name);
                    if (!pr) return <span className="tag-prior added">추가 조사</span>;
                    const c = compareOrientation(pr, s.orientation);
                    return (
                      <span className={`tag-prior ${c === 'changed' ? 'changed' : c === 'same' ? 'same' : ''}`}>
                        전차 {priorSetText(pr)}
                        {c === 'same' ? ' · 같음' : c === 'changed' ? ' · 변경' : ''}
                      </span>
                    );
                  })()}
                </span>
              </Link>
              <button
                className="link-danger"
                onClick={() => {
                  if (confirm(`"${s.name}" 삭제`)) void deleteSetCascade(s.id);
                }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>측점 공통</h2>
        <div className="rows">
          <div className="row">
            <span className="row-label">누수 상태</span>
            <select
              value={st.seepage ?? ''}
              onChange={(e) => save({ seepage: (e.target.value || null) as SeepageClass | null })}
            >
              <option value="">{prSeep ? `선택 (전차 ${SEEPAGE_LABELS[prSeep]})` : '선택'}</option>
              {SEEPAGE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {SEEPAGE_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="row">
            <span className="row-label">암괴크기 (m)</span>
            <span className="row-inline">
              {(['x', 'y', 'z'] as const).map((k) => (
                <input
                  key={`${k}-${st.blockSize?.[k] ?? ''}`}
                  className="w-xs"
                  type="number"
                  inputMode="decimal"
                  placeholder={prSite?.blockSize ? String(prSite.blockSize[k]) : k}
                  defaultValue={st.blockSize?.[k] ?? ''}
                  onBlur={(e) => {
                    const cur = st.blockSize ?? { x: 0, y: 0, z: 0 };
                    save({ blockSize: { ...cur, [k]: num(e.target.value) ?? 0 } });
                  }}
                />
              ))}
            </span>
          </div>
        </div>

        {prSite && (prSeep || prSite.blockSize) && (
          <p className="ori-prior">
            전차{prSeep ? ` 누수 ${SEEPAGE_LABELS[prSeep]}` : ''}
            {prSite.blockSize ? ` · 암괴크기 ${prSite.blockSize.x}×${prSite.blockSize.y}×${prSite.blockSize.z}m` : ''}
            <button
              className="ghost"
              style={{ marginLeft: 8, width: 'auto', padding: '6px 10px' }}
              onClick={() =>
                save({
                  ...(prSeep && !st.seepage ? { seepage: prSeep } : {}),
                  ...(prSite.blockSize && !(st.blockSize && (st.blockSize.x || st.blockSize.y || st.blockSize.z)) ? { blockSize: prSite.blockSize } : {}),
                })
              }
            >
              전차와 같음
            </button>
          </p>
        )}
        {prSite?.strength && <p className="ori-prior">전차 강도 {prSite.strength}</p>}
        <h3 className="subhead">반발경도 R (20개)</h3>
        {prSum && (
          <p className="muted" style={{ marginBottom: 6 }}>
            전차 {prSum.section} {prSum.label} · 반발경도 {prSum.min ?? '-'}~{prSum.max ?? '-'} (평균 {prSum.avg ?? '-'}){prSum.strength ? ` · 추정강도 ${prSum.strength}MPa` : ''}{prSum.cls ? ` · ${prSum.cls}` : ''}
            {rbOut ? ` — 전차 범위 밖 ${rbOut}개 확인` : ''}
          </p>
        )}
        {prRebound && (
          <p className="muted" style={{ marginBottom: 6 }}>
            전차 {prRebound.label} 반발경도 {prRebound.values.length}개 — 같은 값이면 그대로 두고, 달라진 칸만 고쳐 쓰세요.
          </p>
        )}
        <MultiValueInput
          priorValues={prRebound?.values}
          count={20}
          values={st.reboundValues ?? []}
          onChange={(v) => save({ reboundValues: v })}
        />
        <p className="hint">강도(MPa)는 결과보고에 빈칸으로 출력됩니다 (사무실 기입).</p>
      </div>

      <div className="card">
        <h2>조사 사진</h2>
        <PhotoGrid
          facilityId={fid}
          ownerType="station"
          ownerId={sid}
          categories={STATION_PHOTO_CATEGORIES}
        />
      </div>

      <div className="card">
        <h2>위치 (GPS)</h2>
        <p className="muted">{gpsBusy ? '측정 중…' : formatGps(st.gps)}</p>
        {gpsErr && <div className="warn">{gpsErr}</div>}
        <button className="ghost full" onClick={captureGps} disabled={gpsBusy} style={{ marginTop: 8 }}>
          {st.gps ? 'GPS 다시 측정' : 'GPS 측정'}
        </button>
      </div>

      <StickyBar>
        <button className="primary" onClick={() => flushAndRun(() => navigate(`/f/${fid}`))}>
          저장하고 측점 목록
        </button>
      </StickyBar>
    </>
  );
}

function toDateInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromDateInput(v: string, fallback: number): number {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : fallback;
}
