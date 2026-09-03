import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MultiValueInput } from '../components/MultiValueInput';
import { PhotoGrid } from '../components/PhotoGrid';
import { StickyBar, flushAndRun } from '../components/StickyBar';
import {
  SOIL_PHOTO_CATEGORIES,
  db,
  setSoilLocationPart,
  updateSoilPoint,
  type SoilPoint,
} from '../db/db';
import { formatGps, getCurrentGps } from '../lib/geo';
import { useHeaderSubtitle } from '../lib/headerContext';
import { SOIL_IDS, SOIL_SLOPE_POSITIONS, type SoilSlopePosition } from '../lib/labels';

export function SoilScreen() {
  const { fid = '', soilId = '' } = useParams();
  const navigate = useNavigate();

  const soil = useLiveQuery(() => db.soils.get(soilId), [soilId]);
  const facility = useLiveQuery(() => db.facilities.get(fid), [fid]);
  useHeaderSubtitle(facility?.name);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);
  const gpsTried = useRef(false);

  const save = (patch: Partial<SoilPoint>) => updateSoilPoint(soilId, patch);

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
    if (!soil || gpsTried.current) return;
    gpsTried.current = true;
    if (!soil.gps) void captureGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soil]);

  if (soil === undefined) return <p className="muted">불러오는 중…</p>;
  if (soil === null) return <p className="muted">토양경도 조사점을 찾을 수 없습니다.</p>;
  const sp: SoilPoint = soil;

  const num = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  return (
    <>
      <p className="crumb">{sp.pointId}</p>

      <div className="card">
        <h2>토양경도 정보</h2>
        <div className="rows">
          <div className="row">
            <span className="row-label">ID</span>
            <select value={sp.pointId} onChange={(e) => save({ pointId: e.target.value })}>
              {SOIL_IDS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              {!SOIL_IDS.includes(sp.pointId) && <option value={sp.pointId}>{sp.pointId}</option>}
            </select>
          </div>
          <div className="row">
            <span className="row-label">거리</span>
            <span className="row-inline">
              <input
                className="w-sm"
                type="number"
                inputMode="decimal"
                placeholder="30"
                defaultValue={sp.staValue ?? ''}
                onBlur={(e) => setSoilLocationPart(soilId, { staValue: num(e.target.value) })}
              />
              <span className="unit">m</span>
            </span>
          </div>
          <div className="row">
            <span className="row-label">위치</span>
            <select
              value={sp.slopePosition ?? ''}
              onChange={(e) =>
                setSoilLocationPart(soilId, {
                  slopePosition: (e.target.value || null) as SoilSlopePosition | null,
                })
              }
            >
              <option value="">선택</option>
              {SOIL_SLOPE_POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          {sp.location && (
            <div className="row">
              <span className="row-label">위치설명</span>
              <span className="row-value muted">{sp.location}</span>
            </div>
          )}
          <div className="row">
            <span className="row-label">조사자</span>
            <input defaultValue={sp.surveyor} onBlur={(e) => save({ surveyor: e.target.value })} />
          </div>
          <div className="row">
            <span className="row-label">조사일</span>
            <input
              type="date"
              defaultValue={toDateInput(sp.surveyedAt)}
              onBlur={(e) => save({ surveyedAt: fromDateInput(e.target.value, sp.surveyedAt) })}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>토양경도 (10개)</h2>
        <MultiValueInput
          count={10}
          values={sp.hardnessValues ?? []}
          onChange={(v) => save({ hardnessValues: v })}
        />
      </div>

      <div className="card">
        <h2>조사 사진</h2>
        <PhotoGrid
          facilityId={fid}
          ownerType="soil"
          ownerId={soilId}
          categories={SOIL_PHOTO_CATEGORIES}
        />
      </div>

      <div className="card">
        <h2>위치 (GPS)</h2>
        <p className="muted">{gpsBusy ? '측정 중…' : formatGps(sp.gps)}</p>
        {gpsErr && <div className="warn">{gpsErr}</div>}
        <button className="ghost full" onClick={captureGps} disabled={gpsBusy} style={{ marginTop: 8 }}>
          {sp.gps ? 'GPS 다시 측정' : 'GPS 측정'}
        </button>
      </div>

      <StickyBar>
        <button className="primary" onClick={() => flushAndRun(() => navigate(`/f/${fid}`))}>
          저장하고 목록
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
