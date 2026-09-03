import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createFacility, db, deleteFacilityCascade, type Facility } from '../db/db';

export function FacilitiesScreen() {
  const facilities = useLiveQuery(
    () => db.facilities.orderBy('updatedAt').reverse().toArray(),
    [],
    [] as Facility[],
  );
  const [name, setName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    await createFacility(name);
    setName('');
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
