import { useLiveQuery } from 'dexie-react-hooks';
import { useParams } from 'react-router-dom';
import { ConditionForm } from '../components/ConditionForm';
import { OrientationField } from '../components/OrientationField';
import { db, updateSet, type DiscontinuityType, type SetOrientation } from '../db/db';
import {
  SPACING_CLASSES,
  SPACING_LABELS,
  spacingClassFromM,
  type Condition,
  type SpacingClass,
} from '../lib/scoring/condition';

const DTYPES: DiscontinuityType[] = ['절리', '층리', '단층', '편리·엽리', '기타'];

export function SetScreen() {
  const { setid = '' } = useParams();
  const set = useLiveQuery(() => db.sets.get(setid), [setid]);

  if (set === undefined) return <p className="muted">불러오는 중…</p>;
  if (set === null) return <p className="muted">절리군을 찾을 수 없습니다.</p>;

  const save = (patch: Parameters<typeof updateSet>[1]) => updateSet(setid, patch);

  return (
    <>
      <div className="card">
        <h2>절리군</h2>
        <div className="form-grid">
          <label>
            이름
            <input defaultValue={set.name} onBlur={(e) => save({ name: e.target.value.trim() || set.name })} />
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
      </div>

      <div className="card">
        <h2>방향성 (경사 / 경사방향)</h2>
        <OrientationField
          value={set.orientation}
          onChange={(o: SetOrientation) => save({ orientation: o })}
        />
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
    </>
  );
}
