import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BUILD_ID } from '../components/UpdatePrompt';
import { exportBackup, importBackup } from '../lib/backup';
import { downloadBlob } from '../lib/download';
import {
  adoptOrphanFacilities,
  createProject,
  db,
  deleteProjectCascade,
  ensurePersistentStorage,
  type Project,
  type StorageStatus,
} from '../db/db';

/** 첫 화면: 프로젝트(용역) 목록 */
export function ProjectsScreen() {
  const navigate = useNavigate();
  const projects = useLiveQuery(() => db.projects.orderBy('updatedAt').reverse().toArray(), [], [] as Project[]);
  const counts = useLiveQuery(async () => {
    const facs = await db.facilities.toArray();
    const m = new Map<string, number>();
    for (const f of facs) if (f.projectId) m.set(f.projectId, (m.get(f.projectId) ?? 0) + 1);
    return m;
  }, [], new Map<string, number>());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void ensurePersistentStorage().then(setStorage);
    void adoptOrphanFacilities(); // 프로젝트 없이 남은 시설물이 있으면 "기본 프로젝트"로 묶는다
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    const id = await createProject(name);
    setName('');
    navigate(`/p/${id}`);
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
      setMsg(`복원 완료 · 시설물 ${r.facilities} · 측점 ${r.stations} · 토양경도 ${r.soils} · 절리군 ${r.sets} · 사진 ${r.photos}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '복원 실패');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="card">
        <h2>새 프로젝트</h2>
        <div className="btn-row">
          <input
            type="text"
            className="text-field"
            placeholder="프로젝트명 (예: 2026년 비탈면 정밀안전점검)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="primary" style={{ width: 'auto', flex: '0 0 auto' }} onClick={add}>
            추가
          </button>
        </div>
      </div>

      <div className="card">
        <h2>프로젝트 ({projects.length})</h2>
        {projects.length === 0 && <p className="muted">등록된 프로젝트가 없습니다.</p>}
        <div className="list">
          {projects.map((p) => (
            <div className="list-item" key={p.id}>
              <Link to={`/p/${p.id}`} className="list-main">
                <strong>{p.name}</strong>
                <span className="muted">
                  시설물 {counts.get(p.id) ?? 0}개 · {new Date(p.updatedAt).toLocaleDateString()}
                </span>
              </Link>
              <button
                className="link-danger"
                onClick={() => {
                  if (confirm(`"${p.name}" 및 하위 시설물·측점·절리군·사진을 모두 삭제합니다.`)) {
                    void deleteProjectCascade(p.id);
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
        <h2>백업</h2>
        <div className="btn-row">
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

      <p className="build-line">
        빌드 {BUILD_ID}
        {storage
          ? storage.persisted
            ? ' · 저장소 보호됨 ✓'
            : ' · 저장소 보호 대기 (홈 화면에 추가 시 적용)'
          : ''}
      </p>
    </>
  );
}
