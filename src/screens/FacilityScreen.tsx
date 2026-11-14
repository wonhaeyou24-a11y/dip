import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PointMap } from '../components/PointMap';
import { PriorPanel } from '../components/PriorPanel';
import { StickyBar } from '../components/StickyBar';
import { useGoParent } from '../lib/nav';
import { soilDone, stationSteps } from '../lib/progress';
import {
  createSoilPoint,
  createStation,
  db,
  deleteSoilCascade,
  deleteStationCascade,
  updateFacility,
  type DiscontinuitySet,
  type PriorData,
  type SoilPoint,
  type Station,
} from '../db/db';
import { exportBackup, importBackup } from '../lib/backup';
import { downloadBlob, safeFilename } from '../lib/download';
import { buildFacilityReport } from '../lib/excel/report';
import { useHeaderSubtitle } from '../lib/headerContext';
import { markerLabel } from '../lib/labels';
import { compareWithPrior, matchPriorSoil } from '../lib/prior';
import type { MapPoint } from '../lib/mapImage';

/** 토양경도 점의 전차 대비 상태 꼬리표 */
function priorTag(prior: PriorData, s: SoilPoint) {
  const pr = matchPriorSoil(prior, s);
  if (!pr) return <span className="tag-prior added">추가 조사</span>;
  const c = compareWithPrior(pr.values, s.hardnessValues);
  if (c.state === 'same') return <span className="tag-prior same">전차와 같음</span>;
  if (c.state === 'changed') return <span className="tag-prior changed">변경 {c.changed}</span>;
  if (c.state === 'partial') return <span className="tag-prior">일부 입력</span>;
  return <span className="tag-prior">전차 {pr.values.length}개 있음</span>;
}

export function FacilityScreen() {
  const { fid = '' } = useParams();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const facility = useLiveQuery(() => db.facilities.get(fid), [fid]);
  const goParent = useGoParent(facility?.projectId ? `/p/${facility.projectId}` : '/');
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

  // 측점별 사진 수 (사진 본문은 읽지 않고 개수만)
  const photoCounts = useLiveQuery(
    async () => {
      const m = new Map<string, number>();
      for (const st of stations) m.set(st.id, await db.photos.where('ownerId').equals(st.id).count());
      return m;
    },
    [stations],
    new Map<string, number>(),
  );

  useHeaderSubtitle(facility?.name);

  const setCountByStation = new Map<string, number>();
  for (const s of sets) setCountByStation.set(s.stationId, (setCountByStation.get(s.stationId) ?? 0) + 1);

  if (facility === undefined) return <p className="muted">불러오는 중…</p>;
  if (facility === null) return <p className="muted">시설물을 찾을 수 없습니다.</p>;

  const orderedStations = [...stations].sort((a, b) => a.createdAt - b.createdAt);
  const stProgress = orderedStations.map((st) => {
    const steps = stationSteps(st, sets.filter((x) => x.stationId === st.id), photoCounts.get(st.id) ?? 0);
    return { st, steps, next: steps.find((x) => !x.done), doneN: steps.filter((x) => x.done).length };
  });
  const stationsDone = stProgress.filter((x) => !x.next).length;
  const nextStation = stProgress.find((x) => x.next);
  const soilsDone = soils.filter((x) => soilDone(x).done).length;
  const hasData = orderedStations.length + soils.length > 0;
  // 금회 조사 항목을 고르면 그 항목의 입력 버튼만 보인다(고르기 전에는 모두 보임)
  const plan = facility.plan ?? [];
  const showStationBtn = plan.length === 0 || plan.includes('discontinuity') || plan.includes('rebound');
  const showSoilBtn = plan.length === 0 || plan.includes('soil');
  const counts = {
    discontinuity: sets.length,
    rebound: orderedStations.filter((s) => (s.reboundValues ?? []).some((v) => Number.isFinite(v))).length,
    soil: soils.length,
  };

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

      <div className="card progress-card">
        <h2>조사 진행</h2>
        <p>
          측점 <strong>{stationsDone}/{orderedStations.length}</strong> 완료
          {soils.length > 0 && (
            <>
              {' '}· 토양경도 <strong>{soilsDone}/{soils.length}</strong> 완료
            </>
          )}
        </p>
        {orderedStations.length === 0 ? (
          <p className="muted" style={{ marginTop: 6 }}>아래 [측점 추가]로 첫 측점을 시작하세요.</p>
        ) : nextStation ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
            <span>
              다음에 할 일 <strong style={{ color: '#1f5fd1' }}>{nextStation.st.siteId} · {nextStation.next!.n}. {nextStation.next!.label}</strong>
              <br />
              <span className="muted">{nextStation.next!.hint}</span>
            </span>
            <Link to={`/f/${fid}/s/${nextStation.st.id}`} className="primary" style={{ flex: 'none', padding: '10px 16px', borderRadius: 10, textDecoration: 'none', color: '#fff', background: '#3b6cf6' }}>
              가기
            </Link>
          </div>
        ) : (
          <p style={{ marginTop: 6 }}><strong style={{ color: '#0a7d3b' }}>모든 측점 조사를 마쳤습니다.</strong> 측점이 더 있으면 추가하세요.</p>
        )}
      </div>

      <PriorPanel facility={facility} counts={counts} />

      {showStationBtn && (
        <button
          className="primary"
          onClick={async () => {
            const id = await createStation(fid);
            navigate(`/f/${fid}/s/${id}`);
          }}
        >
          ＋ 측점 추가 (불연속면·암반 반발경도)
        </button>
      )}

      <div className="card">
        <h2>측점 ({orderedStations.length})</h2>
        {orderedStations.length === 0 && <p className="muted">측점을 추가하세요.</p>}
        <div className="list">
          {stProgress.map(({ st: s, steps, next, doneN }) => (
            <div className="list-item" key={s.id}>
              <Link to={`/f/${fid}/s/${s.id}`} className="list-main">
                <strong>
                  {s.siteId}
                  {s.location ? ` · ${s.location}` : ''}
                </strong>
                <span className="muted">
                  <strong style={{ color: next ? '#1f5fd1' : '#0a7d3b' }}>{next ? `▶ ${next.n}. ${next.label}` : '✓ 조사 완료'}</strong>
                  {' · '}단계 {doneN}/{steps.length} · 측정 {s.poles?.length ?? 0}개 · 절리군 {setCountByStation.get(s.id) ?? 0}개
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

      {showSoilBtn && (
        <button
          className="primary"
          onClick={async () => {
            const id = await createSoilPoint(fid);
            navigate(`/f/${fid}/soil/${id}`);
          }}
        >
          ＋ 토양경도 추가
        </button>
      )}

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
                  <strong style={{ color: soilDone(s).done ? '#0a7d3b' : '#1f5fd1' }}>{soilDone(s).done ? '✓ 완료' : '▶ 입력 중'}</strong>
                  {' · '}경도 {soilDone(s).n}/10 · GPS {s.gps ? '✓' : '없음'}
                  {facility?.prior && priorTag(facility.prior, s)}
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
        <button className="primary" onClick={goParent}>
          시설물 목록으로
        </button>
      </StickyBar>
    </>
  );
}
