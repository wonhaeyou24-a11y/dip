import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConditionForm } from '../components/ConditionForm';
import { MeasureSession } from '../components/MeasureSession';
import { OrientationField } from '../components/OrientationField';
import { planeAngle } from '../lib/setCluster';
import { StickyBar, flushAndRun } from '../components/StickyBar';
import {
  copyPreviousSet,
  createSet,
  db,
  updateSet,
  type DiscontinuityType,
  type SetOrientation,
} from '../db/db';
import { useHeaderSubtitle } from '../lib/headerContext';
import { SET_NAMES } from '../lib/labels';
import { matchPriorSet, priorSetText, spacingFromText } from '../lib/prior';
import { fromScore } from '../components/ConditionForm';
import {
  SPACING_CLASSES,
  makeRatedItem,
  withScores,
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
  const [finding, setFinding] = useState(false);

  const set = useLiveQuery(() => db.sets.get(setid), [setid]);
  const station = useLiveQuery(() => db.stations.get(sid), [sid]);
  const facility = useLiveQuery(() => db.facilities.get(fid), [fid]);
  useHeaderSubtitle(facility?.name);
  const setCount = useLiveQuery(
    () => db.sets.where('stationId').equals(sid).count(),
    [sid],
    0,
  );

  if (set === undefined) return <p className="muted">불러오는 중…</p>;
  if (set === null) return <p className="muted">절리군을 찾을 수 없습니다.</p>;

  const priorSet = matchPriorSet(facility?.prior, station?.siteId ?? '', set.name);

  const save = (patch: Parameters<typeof updateSet>[1]) => updateSet(setid, patch);
  const priorSpacing = spacingFromText(priorSet?.spacing);

  /** 전차 값을 비어 있는 칸에만 채운다 (이미 쓴 값은 건드리지 않음) — 달라진 곳만 고치면 된다 */
  const fillFromPrior = () => {
    if (!priorSet) return;
    const patch: Parameters<typeof updateSet>[1] = {};
    if (!set.orientation && priorSet.dip !== undefined && priorSet.dipDir !== undefined) {
      patch.orientation = {
        dip: priorSet.dip,
        dipDirection: priorSet.dipDir,
        strike: Math.round((((priorSet.dipDir - 90) % 360) + 360) % 360 * 10) / 10,
        method: 'manual',
        declinationApplied: 0,
        measuredAt: Date.now(),
      };
    }
    if (!set.spacing && priorSpacing) {
      patch.spacing = priorSpacing.cls;
      patch.spacing_min_m = priorSpacing.min;
      patch.spacing_max_m = priorSpacing.max;
    }
    if (priorSet.items) {
      let c = set.condition;
      (['persistence', 'aperture', 'roughness', 'infilling', 'weathering'] as const).forEach((k) => {
        const p = priorSet.items![k];
        if (!c[k] && p && p.score !== undefined) {
          const sb = fromScore(p.score);
          c = { ...c, [k]: makeRatedItem(sb.stage, sb.bound) };
        }
      });
      patch.condition = withScores(c);
    }
    save(patch);
  };

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

      {priorSet && (
        <div className="prior-bar">
          <span>전차 {priorSetText(priorSet)}{priorSet.spacing ? ` · 간격 ${priorSet.spacing}` : ''}</span>
          <button className="primary" onClick={fillFromPrior}>
            전차와 같음으로 채우기
          </button>
        </div>
      )}

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
        {!priorSet && (
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
        )}
        {copyMsg && (
          <p className="muted" style={{ marginTop: 6 }}>
            {copyMsg}
          </p>
        )}
      </div>

      <div className="card">
        <h2>방향성 (경사 / 경사방향)</h2>
        <OrientationField
          value={set.orientation}
          onChange={(o: SetOrientation) => save({ orientation: o })}
          prior={priorSet && priorSet.dip !== undefined && priorSet.dipDir !== undefined ? { dip: priorSet.dip, dipDir: priorSet.dipDir } : undefined}
        />
        {set.orientation && (
          <>
            {(() => {
              // 이 Set 으로 묶인 측정 중 평균에 가장 가까운 것 = 절리상태를 조사할 대표면
              const n = /(\d+)$/.exec(set.name)?.[1];
              const poles = station?.poles ?? [];
              const labels = station?.poleLabels ?? [];
              const mem = n ? poles.map((p, i) => ({ p, i })).filter((x) => labels[x.i] === parseInt(n, 10) - 1) : [];
              const tgt = { dip: set.orientation.dip, dipDir: set.orientation.dipDirection };
              const rep = mem.slice().sort((a, b) => planeAngle(a.p, tgt) - planeAngle(b.p, tgt))[0];
              return rep ? (
                <p className="muted" style={{ marginTop: 8 }}>
                  조사할 면: 측정 <strong>#{rep.i + 1}</strong> ({String(Math.round(rep.p.dip)).padStart(2, '0')}/{String(Math.round(rep.p.dipDir)).padStart(3, '0')}) — 이 Set 으로 묶인 {mem.length}개 중 평균에 가장 가깝습니다. 측정 목록: {mem.map((x) => '#' + (x.i + 1)).join(', ')}
                </p>
              ) : null;
            })()}
            <button className="ghost" style={{ marginTop: 8, width: '100%' }} onClick={() => setFinding(true)}>
              이 절리군 찾기 — 폰을 면에 대 보세요
            </button>
          </>
        )}
        {finding && set.orientation && (
          <MeasureSession
            title={`${set.name} 찾기`}
            mode="find"
            target={{ dip: set.orientation.dip, dipDir: set.orientation.dipDirection }}
            targetLabel={set.name}
            onClose={() => setFinding(false)}
          />
        )}
      </div>

      <div className="card">
        <h2>간격 (표 14.7)</h2>
        <div className="seg">
          {SPACING_CLASSES.map((c) => (
            <button
              key={c}
              className={`seg-btn${set.spacing === c ? ' on' : ''}${priorSpacing?.cls === c ? ' prior' : ''}`}
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
        <ConditionForm value={set.condition} onChange={(c: Condition) => save({ condition: c })} prior={priorSet?.items} />
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
