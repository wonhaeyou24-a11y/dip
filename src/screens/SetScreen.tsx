import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConditionForm } from '../components/ConditionForm';
import { OrientationField } from '../components/OrientationField';
import { StickyBar, flushAndRun } from '../components/StickyBar';
import {
  copyPreviousSet,
  createSet,
  db,
  updateSet,
  type DiscontinuityType,
  type SetOrientation,
} from '../db/db';
import { SET_NAMES } from '../lib/labels';
import {
  SPACING_CLASSES,
  SPACING_LABELS,
  spacingClassFromM,
  type Condition,
  type SpacingClass,
} from '../lib/scoring/condition';

const DTYPES: DiscontinuityType[] = ['절리', '층리', '단층', '편리·엽리', '기타'];

export function SetScreen() {
  const { fid = '', sid = '', setid = '' } = useParams();
  const navigate = useNavigate();
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const set = useLiveQuery(() => db.sets.get(setid), [setid]);
  const station = useLiveQuery(() => db.stations.get(sid), [sid]);
  const setCount = useLiveQuery(
    () => db.sets.where('stationId').equals(sid).count(),
    [sid],
    0,
  );

  if (set === undefined) return <p className="muted">불러오는 중…</p>;
  if (set === null) return <p className="muted">절리군을 찾을 수 없습니다.</p>;

  const save = (patch: Parameters<typeof updateSet>[1]) => updateSet(setid, patch);

  const goList = () => flushAndRun(() => navigate(`/f/${fid}/s/${sid}`));
  const saveAndNext = () =>
    flushAndRun(async () => {
      const id = await createSet(sid);
      navigate(`/f/${fid}/s/${sid}/set/${id}`);
    });

  return (
    <>
      <p className="crumb">
        {station?.siteId ?? ''} / {set.name}
      </p>

      <div className="card">
        <h2>절리군</h2>
        <div className="form-grid">
          <label>
            이름
            <select value={set.name} onChange={(e) => save({ name: e.target.value })}>
              {SET_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              {!SET_NAMES.includes(set.name) && <option value={set.name}>{set.name}</option>}
            </select>
          </label>
          <label>
            종류
            <select value={set.dtype} onChange={(e) => save({ dtype: e.target.value as DiscontinuityType })}>
              {DTYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="ghost"
          style={{ marginTop: 10, width: '100%' }}
          onClick={async () => {
            const ok = await copyPreviousSet(setid);
            setCopyMsg(ok ? '직전 절리군의 종류·간격·절리상태를 복사했습니다.' : '복사할 직전 절리군이 없습니다.');
          }}
        >
          직전 절리군 값 복사
        </button>
        {copyMsg && (
          <p className="muted" style={{ marginTop: 6 }}>
            {copyMsg}
          </p>
        )}
      </div>

      <div className="card">
        <h2>방향성 (경사 / 경사방향)</h2>
        <OrientationField value={set.orientation} onChange={(o: SetOrientation) => save({ orientation: o })} />
      </div>

      <div className="card">
        <h2>간격 (표 14.7)</h2>
        <div className="seg">
          {SPACING_CLASSES.map((c) => (
            <button
              key={c}
              className={`seg-btn${set.spacing === c ? ' on' : ''}`}
              onClick={() => save({ spacing: c })}
            >
              {SPACING_LABELS[c]}
            </button>
          ))}
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <label>실측 (최소/최대/최빈, m)</label>
          <span className="triple">
            {(['spacing_min_m', 'spacing_max_m', 'spacing_mode_m'] as const).map((k) => (
              <input
                key={k}
                type="number"
                inputMode="decimal"
                step="0.01"
                defaultValue={set[k] ?? ''}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  const patch: Record<string, number | SpacingClass> = {};
                  if (Number.isFinite(v)) {
                    patch[k] = v;
                    if (k === 'spacing_mode_m') patch.spacing = spacingClassFromM(v);
                  }
                  if (Object.keys(patch).length) save(patch);
                }}
              />
            ))}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>상세 절리상태 (①~⑤ 배점)</h2>
        <ConditionForm value={set.condition} onChange={(c: Condition) => save({ condition: c })} />
      </div>

      <StickyBar>
        <button className="ghost" onClick={goList}>
          저장하고 목록
        </button>
        <button className="primary" onClick={saveAndNext}>
          저장 후 다음 {SET_NAMES[setCount] ?? '절리군'}
        </button>
      </StickyBar>
    </>
  );
}
