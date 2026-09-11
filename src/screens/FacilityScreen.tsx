import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PointMap } from '../components/PointMap';
import { StickyBar, flushAndRun } from '../components/StickyBar';
import {
  createSoilPoint,
  createStation,
  db,
  deleteSoilCascade,
  deleteStationCascade,
  updateFacility,
  type DiscontinuitySet,
  type SoilPoint,
  type Station,
} from '../db/db';
import { exportBackup, importBackup } from '../lib/backup';
import { downloadBlob, safeFilename } from '../lib/download';
import { buildFacilityReport } from '../lib/excel/report';
import { useHeaderSubtitle } from '../lib/headerContext';
import { markerLabel } from '../lib/labels';
import type { MapPoint } from '../lib/mapImage';

export function FacilityScreen() {
  const { fid = '' } = useParams();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const facility = useLiveQuery(() => db.facilities.get(fid), [fid]);
  const stations = useLiveQuery(
    () => db.stations.where('facilityId').equals(fid).toArray(),
    [fid],
    [] as Station[],
  );
  const soils = useLiveQuery(
    () => db.soils.where('facilityId').equals(fid).sortBy('order'),
    [fid],
    [] as SoilPoint[],
  );
  const sets = useLiveQuery(
    () => db.sets.where('facilityId').equals(fid).toArray(),
    [fid],
    [] as DiscontinuitySet[],
  );

  useHeaderSubtitle(facility?.name);

  const setCountByStation = new Map<string, number>();
  for (const s of sets) setCountByStation.set(s.stationId, (setCountByStation.get(s.stationId) ?? 0) + 1);

  if (facility === undefined) return <p className="muted">불러오는 중…</p>;
  if (facility === null) return <p className="muted">시설물을 찾을 수 없습니다.</p>;

  const orderedStations = [...stations].sort((a, b) => a.createdAt - b.createdAt);
  const hasData = orderedStations.length + soils.length > 0;

  const mapPoints: MapPoint[] = [
    ...orderedStations
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

  const doExport = async () => {
    setBusy('export');
    setMsg(null);
    try {
      const blob = await exportBackup();
      downloadBlob(blob, `dip_백업_${new Date().toISOString().slice(0, 10)}.json`);
      setMsg(`백업 완료 (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '백업 실패');
    } finally {
      setBusy(null);
    }
  };

  const doImport = async (file: File) => {
    setBusy('import');
    setMsg(null);
    try {
      const r = await importBackup(file);
      setMsg(`복원 완료 · 측점 ${r.stations} · 토양경도 ${r.soils ?? 0} · 절리군 ${r.sets} · 사진 ${r.photos}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '복원 실패');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="card">
        <h2>시설물명</h2>
        <input
          type="text"
          className="text-field"
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
        <h2>측점 ({orderedStations.length})</h2>
        {orderedStations.length === 0 && <p className="muted">측점을 추가하세요.</p>}
        <div className="list">
          {orderedStations.map((s) => (
            <div className="list-item" key={s.id}>
              <Link to={`/f/${fid}/s/${s.id}`} className="list-main">
                <strong>
                  {s.siteId}
                  {s.location ? ` · ${s.location}` : ''}
                </strong>
                <span className="muted">
                  절리군 {setCountByStation.get(s.id) ?? 0}개 · GPS {s.gps ? '✓' : '없음'}
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

      <button
        className="primary"
        onClick={async () => {
          const id = await createSoilPoint(fid);
          navigate(`/f/${fid}/soil/${id}`);
        }}
      >
        ＋ 토양경도 추가
      </button>

      <div className="card">
        <h2>토양경도 ({soils.length})</h2>
        {soils.length === 0 && <p className="muted">토양경도 조사점을 추가하세요.</p>}
        <div className="list">
          {soils.map((s) => (
            <div className="list-item" key={s.id}>
              <Link to={`/f/${fid}/soil/${s.id}`} className="list-main">
                <strong>
                  {s.pointId}
                  {s.location ? ` · ${s.location}` : ''}
                </strong>
                <span className="muted">
                  경도 {s.hardnessValues?.filter((x) => Number.isFinite(x)).length ?? 0}/10 · GPS{' '}
                  {s.gps ? '✓' : '없음'}
                </span>
              </Link>
              <button
                className="link-danger"
                onClick={() => {
                  if (confirm(`토양경도 "${s.pointId}" 및 사진을 삭제합니다.`)) {
                    void deleteSoilCascade(s.id);
                  }
                }}
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>조사점 위치도</h2>
        <PointMap
          points={mapPoints}
          linkFor={(p) =>
            p.kind === 'station' ? `/f/${fid}/s/${p.id}` : `/f/${fid}/soil/${p.id}`
          }
        />
        <p className="muted" style={{ marginTop: 6 }}>
          <span className="lg station" /> 측점 &nbsp; <span className="lg soil" /> 토양경도 &nbsp;{' '}
          <span className="lg me" /> 내 위치
        </p>
      </div>

      <div className="card">
        <h2>결과보고 / 백업</h2>
        <button className="ghost full" onClick={exportExcel} disabled={exporting || !hasData}>
          {exporting ? 'Excel 생성 중…' : 'Excel 결과보고 내보내기'}
        </button>
        {exportErr && <div className="warn">{exportErr}</div>}
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="ghost" onClick={doExport} disabled={busy !== null}>
            {busy === 'export' ? '내보내는 중…' : 'JSON 백업'}
          </button>
          <button className="ghost" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
            {busy === 'import' ? '복원 중…' : '백업 복원'}
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
        />
        {msg && (
          <p className="muted" style={{ marginTop: 8 }}>
            {msg}
          </p>
        )}
      </div>

      <StickyBar>
        <button className="primary" onClick={() => flushAndRun(() => navigate('/'))}>
          저장하고 시설물 목록
        </button>
      </StickyBar>
    </>
  );
}
