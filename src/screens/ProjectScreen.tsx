import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StickyBar } from '../components/StickyBar';
import { useGoParent } from '../lib/nav';
import {
  createFacility,
  db,
  deleteFacilityCascade,
  updateProject,
  type Facility,
} from '../db/db';
import { useHeaderSubtitle } from '../lib/headerContext';
import { importPriorFiles, kindOfCategory, type ImportLine } from '../lib/prior';

/** 프로젝트 화면: 시설물 등록 + 전차자료(사전조사) 가져오기 */
export function ProjectScreen() {
  const { pid = '' } = useParams();
  const goParent = useGoParent('/');
  const project = useLiveQuery(() => db.projects.get(pid), [pid]);
  const facilities = useLiveQuery(
    () => db.facilities.where('projectId').equals(pid).toArray(),
    [pid],
    [] as Facility[],
  );
  const stat = useLiveQuery(async () => {
    const [st, so] = await Promise.all([db.stations.toArray(), db.soils.toArray()]);
    const m = new Map<string, { st: number; so: number }>();
    for (const s of st) m.set(s.facilityId, { st: (m.get(s.facilityId)?.st ?? 0) + 1, so: m.get(s.facilityId)?.so ?? 0 });
    for (const s of so) m.set(s.facilityId, { st: m.get(s.facilityId)?.st ?? 0, so: (m.get(s.facilityId)?.so ?? 0) + 1 });
    return m;
  }, [], new Map<string, { st: number; so: number }>());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ImportLine[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useHeaderSubtitle(project?.name);

  if (project === undefined) return <p className="muted">불러오는 중…</p>;
  if (project === null) return <p className="muted">프로젝트를 찾을 수 없습니다.</p>;

  const sorted = [...facilities].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const add = async () => {
    if (!name.trim()) return;
    await createFacility(name, pid);
    setName('');
  };

  const doImport = async (files: File[]) => {
    setBusy(true);
    setLines(null);
    try {
      setLines(await importPriorFiles(pid, files));
      await updateProject(pid, {});
    } catch (e) {
      setLines([{ file: '', ok: false, reason: e instanceof Error ? e.message : '가져오기 실패' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>프로젝트명</h2>
        <input
          type="text"
          className="text-field"
          defaultValue={project.name}
          onBlur={(e) => updateProject(pid, { name: e.target.value.trim() || project.name })}
        />
      </div>

      <div className="card">
        <h2>시설물 등록</h2>
        <div className="btn-row">
          <input
            type="text"
            className="text-field"
            placeholder="시설물명 (예: ○○터널 절취사면)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button className="primary" style={{ width: 'auto', flex: '0 0 auto' }} onClick={add}>
            추가
          </button>
        </div>
        <button className="ghost full" style={{ marginTop: 10 }} onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? '가져오는 중…' : '전차자료(.json) 가져오기 — 시설물과 전차 시험 표를 채웁니다'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          multiple
          hidden
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) void doImport(fs);
            e.target.value = '';
          }}
        />
        <p className="muted" style={{ marginTop: 6 }}>
          전차자료정리 스킬이 만든 파일(시설물마다 하나)을 여러 개 골라도 됩니다. 시설물 번호나 이름이 같으면 그 시설물에 채우고, 없으면 새로 만듭니다.
        </p>
        {lines && (
          <div className="list" style={{ marginTop: 8 }}>
            {lines.map((l, i) => (
              <div key={i} className="muted">
                {l.ok
                  ? `✓ ${l.facilityName} — ${l.created ? '새 시설물' : '기존 시설물에 채움'} · 전차 시험 표 ${l.tests}건`
                  : `✗ ${l.file}: ${l.reason}`}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>시설물 ({sorted.length})</h2>
        {sorted.length === 0 && <p className="muted">시설물을 등록하거나 전차자료를 가져오세요.</p>}
        <div className="list">
          {sorted.map((f) => {
            const s = stat.get(f.id);
            const priorKinds = new Set((f.prior?.tests ?? []).map((t) => kindOfCategory(t.category)).filter(Boolean));
            return (
              <div className="list-item" key={f.id}>
                <Link to={`/f/${f.id}`} className="list-main">
                  <strong>{f.name}</strong>
                  <span className="muted">
                    {f.prior ? `전차 시험 ${f.prior.tests.length}건${priorKinds.size ? ' (입력 가능 ' + priorKinds.size + '종)' : ''}` : '전차자료 없음'} · 측점 {s?.st ?? 0} · 토양경도 {s?.so ?? 0}
                  </span>
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
            );
          })}
        </div>
      </div>

      <StickyBar>
        <button className="primary" onClick={goParent}>
          프로젝트 목록
        </button>
      </StickyBar>
    </>
  );
}
