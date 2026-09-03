import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  createStation,
  db,
  deleteStationCascade,
  updateFacility,
  type DiscontinuitySet,
  type Station,
} from '../db/db';
import { downloadBlob, safeFilename } from '../lib/download';
import { buildFacilityReport } from '../lib/excel/report';

export function FacilityScreen() {
  const { fid = '' } = useParams();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const facility = useLiveQuery(() => db.facilities.get(fid), [fid]);
  const stations = useLiveQuery(
    () => db.stations.where('facilityId').equals(fid).toArray(),
    [fid],
    [] as Station[],
  );
  const sets = useLiveQuery(
    () => db.sets.where('facilityId').equals(fid).toArray(),
    [fid],
    [] as DiscontinuitySet[],
  );

  const setCountByStation = new Map<string, number>();
  for (const s of sets) setCountByStation.set(s.stationId, (setCountByStation.get(s.stationId) ?? 0) + 1);

  if (facility === undefined) return <p className="muted">불러오는 중…</p>;
  if (facility === null) return <p className="muted">시설물을 찾을 수 없습니다.</p>;

  const ordered = [...stations].sort((a, b) => a.createdAt - b.createdAt);

  const exportExcel = async () => {
    setExporting(true);
    setExportErr(null);
    try {
      const blob = await buildFacilityReport(fid);
      downloadBlob(blob, `${safeFilename(facility.name)}_불연속면조사.xlsx`);
    } catch (e) {
      setExportErr(e instanceof Error ? e.message : 'Excel 생성 실패');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>시설물명</h2>
        <input
          type="text"
          style={{ width: '100%', textAlign: 'left' }}
          defaultValue={facility.name}
          onBlur={(e) => updateFacility(fid, { name: e.target.value.trim() || facility.name })}
        />
      </div>

      <button
        className="primary"
        onClick={async () => {
          const id = await createStation(fid);
          navigate(`/f/${fid}/s/${id}`);
        }}
      >
        ＋ 측점 추가
      </button>

      <div className="card">
        <h2>결과보고</h2>
        <button className="ghost" style={{ width: '100%' }} onClick={exportExcel} disabled={exporting || ordered.length === 0}>
          {exporting ? 'Excel 생성 중…' : 'Excel 내보내기'}
        </button>
        {exportErr && <div className="warn" style={{ marginTop: 8 }}>{exportErr}</div>}
        {ordered.length === 0 && <p className="muted" style={{ marginTop: 8 }}>측점을 먼저 추가하세요.</p>}
      </div>

      <div className="card">
        <h2>측점 ({ordered.length})</h2>
        {ordered.length === 0 && <p className="muted">측점을 추가하세요.</p>}
        <div className="list">
          {ordered.map((s) => (
            <div className="list-item" key={s.id}>
              <Link to={`/f/${fid}/s/${s.id}`} className="list-main">
                <strong>
                  {s.siteId}
                  {s.location ? ` · ${s.location}` : ''}
                </strong>
                <span className="muted">
                  절리군 {setCountByStation.get(s.id) ?? 0}개
                  {s.gps ? ' · GPS ✓' : ''}
                </span>
              </Link>
              <button
                className="link-danger"
                onClick={() => {
                  if (confirm(`측점 "${s.siteId}" 및 하위 절리군·사진을 삭제합니다.`)) {
                    void deleteStationCascade(s.id);
                  }
                }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
