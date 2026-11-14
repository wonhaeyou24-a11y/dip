import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGoParent, useOverlay } from '../lib/nav';
import { setSteps } from '../lib/progress';
import { ConditionForm } from '../components/ConditionForm';
import { MeasureSession } from '../components/MeasureSession';
import { PhotoGrid } from '../components/PhotoGrid';
import { OrientationField } from '../components/OrientationField';
import { planeAngle } from '../lib/setCluster';
import { StickyBar, flushAndRun } from '../components/StickyBar';
import {
  copyPreviousSet,
  SET_PHOTO_CATEGORIES,
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
  const photoCount = useLiveQuery(() => db.photos.where('ownerId').equals(setid).count(), [setid], 0);
  const find = useOverlay('find');
  const finding = find.isOpen;
  const goParent = useGoParent(`/f/${fid}/s/${sid}`);
  const siblings = useLiveQuery(() => db.sets.where('stationId').equals(sid).sortBy('order'), [sid], []);

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

  // 다음 미완료 절리군으로 (없으면 새 절리군). 형제 절리군끼리는 기록을 쌓지 않고 교체해서 ‹ 한 번에 측점 화면으로 돌아간다.
  const nextIncomplete = (siblings ?? []).find((s) => s.id !== setid && !s.condition?.complete);
  const saveAndNext = () =>
    flushAndRun(async () => {
      const id = nextIncomplete ? nextIncomplete.id : await createSet(sid);
      navigate(`/f/${fid}/s/${sid}/set/${id}`, { replace: true });
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

      {(() => {
        const steps = setSteps(set, photoCount);
        const next = steps.find((x) => !x.done);
        const go = (n: number) => document.getElementById(`step-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return (
          <div className="card progress-card">
            <h2>{set.name} 조사 진행 ({steps.filter((x) => x.done).length}/{steps.length})</h2>
            {next ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span>
                  다음에 할 일 <strong style={{ color: '#1f5fd1' }}>{next.n}. {next.label}</strong>
                  <br />
                  <span className="muted">{next.hint}</span>
                </span>
                <button className="primary" style={{ width: 'auto', padding: '10px 16px', flex: 'none' }} onClick={() => go(next.n)}>
                  가기
                </button>
              </div>
            ) : (
              <p style={{ marginBottom: 8 }}>
                <strong style={{ color: '#0a7d3b' }}>이 절리군 조사를 마쳤습니다. 아래 [다음] 버튼으로 이동하세요.</strong>
              </p>
            )}
            {steps.map((x) => (
              <div
                key={x.n}
                role="button"
                tabIndex={0}
                onClick={() => go(x.n)}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 2px', borderTop: '0.5px solid var(--sep, #ddd)', cursor: 'pointer', fontSize: 14 }}
              >
                <strong style={{ color: x.done ? '#0a7d3b' : next?.n === x.n ? '#1f5fd1' : undefined, fontWeight: 600 }}>
                  {x.done ? '✓' : next?.n === x.n ? '▶' : '○'} {x.n}. {x.label}
                </strong>
                <span className="muted" style={{ textAlign: 'right', fontSize: 12 }}>{x.done ? x.hint : ''}</span>
              </div>
            ))}
            <details style={{ marginTop: 8 }}>
              <summary className="muted">
                {set.name} · {set.dtype} — 이름·종류 바꾸기
              </summary>
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
            </details>
          </div>
        );
      })()}

      <div className="card" id="step-1">
        <h2>① 대표면 찾기{set.orientation ? ` · ${String(Math.round(set.orientation.dip)).padStart(2, '0')}/${String(Math.round(set.orientation.dipDirection)).padStart(3, '0')}` : ''}</h2>
        {!set.orientation && <p className="muted">이 절리군의 방향이 없습니다. 측점 화면 ③에서 자동 분류 후 저장하거나, 아래에서 직접 측정·입력하세요.</p>}
        {set.orientation && (
          <button className="primary" style={{ width: '100%' }} onClick={find.open}>
            이 절리군 찾기 — 폰을 면에 대 보세요
          </button>
        )}
        <details open={!set.orientation} style={{ marginTop: 8 }}>
          <summary className="muted">방향 다시 측정 · 직접 수정</summary>
        <OrientationField
          value={set.orientation}
          onChange={(o: SetOrientation) => save({ orientation: o })}
          prior={priorSet && priorSet.dip !== undefined && priorSet.dipDir !== undefined ? { dip: priorSet.dip, dipDir: priorSet.dipDir } : undefined}
        />
        </details>
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
          </>
        )}
        {finding && set.orientation && (
          <MeasureSession
            title={`${set.name} 찾기`}
            mode="find"
            target={{ dip: set.orientation.dip, dipDir: set.orientation.dipDirection }}
            targetLabel={set.name}
            onClose={find.close}
          />
        )}
      </div>

      <div className="card" id="step-2">
        <h2>② 대표면 조사 사진</h2>
        <p className="muted">절리상태를 조사한 대표면의 사진만 남기면 됩니다 (측정마다 찍을 필요 없음).</p>
        <PhotoGrid facilityId={fid} ownerType="set" ownerId={setid} categories={SET_PHOTO_CATEGORIES} />
      </div>

      <div className="card" id="step-3">
        <h2>③ 간격 (표 14.7)</h2>
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

      <div className="card" id="step-4">
        <h2>④ 상세 절리상태 (①~⑤ 배점)</h2>
        <ConditionForm value={set.condition} onChange={(c: Condition) => save({ condition: c })} prior={priorSet?.items} />
      </div>

      <StickyBar>
        <button className="ghost" onClick={goParent}>
          측점으로
        </button>
        <button className="primary" onClick={saveAndNext}>
          {nextIncomplete ? `다음 미완료: ${nextIncomplete.name}` : `새 절리군 ${SET_NAMES[setCount] ?? ''}`}
        </button>
      </StickyBar>
    </>
  );
}
