import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PhotoGrid } from '../components/PhotoGrid';
import {
  createSet,
  db,
  deleteSetCascade,
  updateStation,
  type DiscontinuitySet,
  type Station,
} from '../db/db';
import { formatGps, getCurrentGps } from '../lib/geo';
import { formatDipDipDir } from '../lib/sensors/orientation';
import { SEEPAGE_CLASSES, SEEPAGE_LABELS, type SeepageClass } from '../lib/scoring/condition';

export function StationScreen() {
  const { fid = '', sid = '' } = useParams();
  const navigate = useNavigate();

  const station = useLiveQuery(() => db.stations.get(sid), [sid]);
  const sets = useLiveQuery(
    () => db.sets.where('stationId').equals(sid).sortBy('order'),
    [sid],
    [] as DiscontinuitySet[],
  );
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsErr, setGpsErr] = useState<string | null>(null);

  if (station === undefined) return <p className="muted">불러오는 중…</p>;
  if (station === null) return <p className="muted">측점을 찾을 수 없습니다.</p>;
  const st: Station = station;

  const save = (patch: Partial<Station>) => updateStation(sid, patch);
  const num = (v: string): number | undefined => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

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

  return (
    <>
      <div className="card">
        <h2>측점 정보</h2>
        <div className="form-grid">
          <label>
            Site ID
            <input defaultValue={st.siteId} onBlur={(e) => save({ siteId: e.target.value.trim() || st.siteId })} />
          </label>
          <label>
            위치 설명
            <input
              defaultValue={st.location}
              placeholder="예: 측점 58m 비탈면 하부"
              onBlur={(e) => save({ location: e.target.value })}
            />
          </label>
          <label>
            조사자
            <input defaultValue={st.surveyor} onBlur={(e) => save({ surveyor: e.target.value })} />
          </label>
          <label>
            조사일
            <input
              type="date"
              defaultValue={toDateInput(st.surveyedAt)}
              onBlur={(e) => save({ surveyedAt: fromDateInput(e.target.value, st.surveyedAt) })}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>위치 (GPS)</h2>
        <p className="muted">{formatGps(st.gps)}</p>
        {gpsErr && <div className="warn">{gpsErr}</div>}
        <button className="ghost" onClick={captureGps} disabled={gpsBusy} style={{ marginTop: 8, width: '100%' }}>
          {gpsBusy ? '측정 중…' : st.gps ? 'GPS 다시 측정' : 'GPS 측정'}
        </button>
      </div>

      <div className="card">
        <h2>측점 공통 (강도·누수·암괴크기)</h2>
        <div className="form-grid">
          <label>
            반발경도 R
            <input
              type="number"
              inputMode="decimal"
              defaultValue={st.reboundHardness ?? ''}
              onBlur={(e) => save({ reboundHardness: num(e.target.value) })}
            />
          </label>
          <label>
            강도 (MPa)
            <input
              type="number"
              inputMode="decimal"
              defaultValue={st.wallStrength_MPa ?? ''}
              onBlur={(e) => save({ wallStrength_MPa: num(e.target.value) })}
            />
          </label>
          <label>
            누수 상태
            <select
              value={st.seepage ?? ''}
              onChange={(e) => save({ seepage: (e.target.value || null) as SeepageClass | null })}
            >
              <option value="">선택</option>
              {SEEPAGE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {SEEPAGE_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label>
            암괴크기 (m, x×y×z)
            <span className="triple">
              {(['x', 'y', 'z'] as const).map((k) => (
                <input
                  key={k}
                  type="number"
                  inputMode="decimal"
                  placeholder={k}
                  defaultValue={st.blockSize?.[k] ?? ''}
                  onBlur={(e) => {
                    const cur = st.blockSize ?? { x: 0, y: 0, z: 0 };
                    save({ blockSize: { ...cur, [k]: num(e.target.value) ?? 0 } });
                  }}
                />
              ))}
            </span>
          </label>
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
        <h2>조사 사진</h2>
        <PhotoGrid facilityId={fid} stationId={sid} />
      </div>
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
