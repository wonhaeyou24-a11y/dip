import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { exportBackup, importBackup } from '../lib/backup';
import { downloadBlob } from '../lib/download';
import { createFacility, db, deleteFacilityCascade, type Facility } from '../db/db';

export function FacilitiesScreen() {
  const facilities = useLiveQuery(
    () => db.facilities.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as Facility[],
  );
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const add = async () => {
    if (!name.trim()) return;
    await createFacility(name);
    setName('');
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
      setMsg(`복원 완료 · 시설물 ${r.facilities} · 측점 ${r.stations} · 절리군 ${r.sets} · 사진 ${r.photos}`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '복원 실패');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="card">
        <h2>새 시설물</h2>
        <div className="btn-row">
          <input
            type="text"
            style={{ flex: 1, width: 'auto', textAlign: 'left' }}
            placeholder="시설물명 (예: ○○터널 절취사면)"
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
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
      </div>

      <div className="card">
        <h2>시설물 ({facilities.length})</h2>
        {facilities.length === 0 && <p className="muted">등록된 시설물이 없습니다.</p>}
        <div className="list">
          {facilities.map((f) => (
            <div className="list-item" key={f.id}>
              <Link to={`/f/${f.id}`} className="list-main">
                <strong>{f.name}</strong>
                <span className="muted">{new Date(f.updatedAt).toLocaleDateString()}</span>
              </Link>
              <button
                className="link-danger"
                onClick={() => {
                  if (confirm(`"${f.name}" 및 하위 측점·절리군·사진을 모두 삭제합니다.`)) {
                    void deleteFacilityCascade(f.id);
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
