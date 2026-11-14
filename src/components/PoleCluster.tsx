import { useEffect, useMemo, useRef, useState } from 'react';
import { useOverlay } from '../lib/nav';
import {
  createSet,
  db,
  updateFacility,
  updateSet,
  updateStation,
  type DiscontinuityType,
  type Facility,
  type PoleRecord,
  type Station,
} from '../db/db';
import { LEVEL_TEXT, kinematic3 } from '../lib/kinematic';
import { clusterPoles, recomputeSets, suggestK } from '../lib/setCluster';
import { stereoSvg } from '../lib/stereo';
import { MeasureSession } from './MeasureSession';

const TYPES: DiscontinuityType[] = ['절리', '층리', '단층', '편리·엽리', '기타'];
const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, '0');
const COLORS = ['#e4572e', '#2e86de', '#2fa84f', '#a64ac9', '#e0a100'];

export function PoleCluster({ station, facility }: { station: Station; facility?: Facility }) {
  const poles: PoleRecord[] = useMemo(() => station.poles ?? [], [station.poles]);
  const k = station.poleK ?? 3;
  const labels = useMemo(() => {
    const l = station.poleLabels ?? [];
    return poles.map((_, i) => (l[i] === undefined ? -1 : l[i]));
  }, [station.poleLabels, poles]);
  const sets = useMemo(() => recomputeSets(poles, labels, k), [poles, labels, k]);
  const [dip, setDip] = useState('');
  const [dir, setDir] = useState('');
  const [msg, setMsg] = useState('');
  const ov = useOverlay('measure');
  const session = ov.isOpen;
  const wasOpen = useRef(false);
  const [typeFilter, setTypeFilter] = useState<'전체' | DiscontinuityType>('전체');
  const an = facility?.analysis ?? {};
  const slopeDip = station.slope?.dip ?? an.slopeDip;
  const slopeDir = station.slope?.dipDir ?? an.slopeDipDir;
  const friction = an.friction;
  const sg = useMemo(() => suggestK(poles.filter((p) => typeFilter === '전체' || (p.type ?? '절리') === typeFilter)), [poles, typeFilter]);

  const saveStation = (patch: Partial<Station>) => updateStation(station.id, patch);
  const appendPole = async (rec: PoleRecord) => {
    const cur = await db.stations.get(station.id);
    const ps = cur?.poles ?? [];
    const ls = cur?.poleLabels ?? [];
    await updateStation(station.id, { poles: [...ps, rec], poleLabels: [...ps.map((_, i) => ls[i] ?? -1), -1] });
  };
  const undoPole = async () => {
    const cur = await db.stations.get(station.id);
    const ps = (cur?.poles ?? []).slice(0, -1);
    await updateStation(station.id, { poles: ps, poleLabels: (cur?.poleLabels ?? []).slice(0, ps.length) });
  };
  const addManual = () => {
    const d = parseFloat(dip);
    const dd = parseFloat(dir);
    if (!Number.isFinite(d) || !Number.isFinite(dd) || d < 0 || d > 90 || dd < 0 || dd > 360) {
      setMsg('경사 0~90, 경사방향 0~360 으로 입력하세요.');
      return;
    }
    setMsg('');
    void appendPole({ dip: d, dipDir: dd % 360, type: '절리' });
    setDip('');
    setDir('');
  };
  const auto = (kk = k) => {
    const idx = poles.map((_, i) => i).filter((i) => typeFilter === '전체' || (poles[i].type ?? '절리') === typeFilter);
    const r = clusterPoles(idx.map((i) => poles[i]), kk);
    const next = poles.map(() => -1);
    idx.forEach((i, j) => (next[i] = r.labels[j]));
    void saveStation({ poleK: kk, poleLabels: next });
  };
  const setLabel = (i: number, l: number) => {
    const next = labels.slice();
    next[i] = l;
    void saveStation({ poleLabels: next });
  };
  const editPole = (i: number, patch: Partial<PoleRecord>) => void saveStation({ poles: poles.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const confirmSets = async () => {
    const existing = await db.sets.where('stationId').equals(station.id).sortBy('order');
    const usedSets = sets.map((s, i) => ({ s, i })).filter((x) => x.s.count > 0);
    if (!usedSets.length) return;
    if (existing.length && !confirm(`이 측점의 절리군 ${existing.length}개 중 앞의 ${Math.min(existing.length, usedSets.length)}개의 방향을 덮어씁니다. 계속할까요?`)) return;
    for (let n = 0; n < usedSets.length; n++) {
      const id = existing[n]?.id ?? (await createSet(station.id));
      const d = Math.round(usedSets[n].s.dip);
      const dd = Math.round(usedSets[n].s.dipDir) % 360;
      await updateSet(id, {
        orientation: { dip: d, dipDirection: dd, strike: (dd + 270) % 360, method: 'manual', declinationApplied: 0, measuredAt: Date.now() },
      });
    }
    setMsg(`절리군 ${usedSets.length}개의 방향을 저장했습니다. 아래 목록에서 절리상태를 입력하세요.`);
  };
  const setAn = (key: keyof NonNullable<Facility['analysis']>, v: string) => {
    if (!facility) return;
    const n = parseFloat(v);
    void updateFacility(facility.id, { analysis: { ...an, [key]: Number.isFinite(n) ? n : undefined } });
  };

  useEffect(() => {
    if (wasOpen.current && !session && poles.length >= 2) auto();
    wasOpen.current = session;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const used = sets.map((s, i) => ({ s, i })).filter((x) => x.s.count > 0);
  const slopeOk = slopeDip !== undefined && slopeDir !== undefined && friction !== undefined;
  const plotSlope = slopeOk ? { dip: slopeDip!, dipDir: slopeDir!, friction: friction! } : null;
  const k3 = slopeOk && used.length ? kinematic3(poles, labels, used.map((x) => x.s), plotSlope!) : null;
  const plotSets = used.map((x) => ({ dip: x.s.dip, dipDir: x.s.dipDir, name: `J${x.i + 1}` }));
  const svgPlanar = poles.length ? stereoSvg({ poles, sets: plotSets, slope: plotSlope, kind: 'planar', size: 340, legend: false }) : '';
  const svgTop = poles.length && plotSlope ? stereoSvg({ poles, sets: [], slope: plotSlope, kind: 'toppling', size: 340, legend: false }) : '';

  return (
    <div className="card" id="step-3">
      <h2>③ 불연속면 측정 · 평사투영 ({poles.length}개)</h2>
      <p className="muted">현장에서는 Set 을 정하지 말고 면을 모두 재세요. 분류는 [자동 분류]가 합니다.</p>
      <button className="primary" onClick={ov.open}>
        측정 시작 (여러 면을 연속으로)
      </button>
      <div className="row-inline" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <input inputMode="decimal" placeholder="경사" value={dip} onChange={(e) => setDip(e.target.value)} style={{ width: 70 }} />
        <input inputMode="decimal" placeholder="경사방향" value={dir} onChange={(e) => setDir(e.target.value)} style={{ width: 90 }} />
        <button onClick={addManual}>직접 추가</button>
      </div>
      {session && (
        <MeasureSession
          title={`${station.siteId} 불연속면 측정`}
          mode="measure"
          poles={poles}
          sets={sets}
          onAdd={(d, dd, spread) => void appendPole({ dip: d, dipDir: dd, type: '절리', spread })}
          onUndo={() => void undoPole()}
          onClose={ov.close}
        />
      )}
      {msg && <p className="muted">{msg}</p>}

      {poles.length > 0 && (
        <>
          <div className="row-inline" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            <label>Set 개수</label>
            <select value={k} onChange={(e) => auto(parseInt(e.target.value, 10))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <label>분류 대상</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as '전체' | DiscontinuityType)}>
              <option value="전체">전체</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}만
                </option>
              ))}
            </select>
            <button className="primary" onClick={() => auto()}>
              자동 분류
            </button>
          </div>
          {sg && (
            <p className="muted" style={{ marginTop: 6 }}>
              추천 Set 개수: <strong>{sg.k}개</strong> (군집 품질 {sg.quality.toFixed(2)} — 0.5 이상이면 뚜렷)
              {sg.k !== k && (
                <>
                  {' '}
                  <button className="ghost" onClick={() => auto(sg.k)}>
                    {sg.k}개로 분류
                  </button>
                </>
              )}
            </p>
          )}
          <div dangerouslySetInnerHTML={{ __html: svgPlanar }} style={{ width: '100%', maxWidth: 360, margin: '8px auto' }} />
          {svgTop && <div dangerouslySetInnerHTML={{ __html: svgTop }} style={{ width: '100%', maxWidth: 360, margin: '0 auto' }} />}

          <div className="list">
            {sets.map((s, i) => (
              <div className="list-item" key={i}>
                <span className="list-main">
                  <strong style={{ color: COLORS[i % 5] }}>● SET{i + 1}</strong>
                  <span className="muted">
                    {s.count ? `${pad(s.dip, 2)}/${pad(s.dipDir, 3)} · ${s.count}개${s.fisherK ? ` · K=${s.fisherK.toFixed(0)}` : ''}${s.count < 3 ? ' · 자료 부족' : ''}` : '극점 없음'}
                  </span>
                </span>
              </div>
            ))}
            {labels.some((l) => l < 0) && <p className="muted">예외 극점 {labels.filter((l) => l < 0).length}개는 어느 Set 에도 넣지 않았습니다.</p>}
          </div>

          {k3 ? (
            <div className="list" style={{ marginTop: 8 }}>
              <strong>운동학적 검토 (참고)</strong>
              <div className="muted">
                평면파괴: <strong>{LEVEL_TEXT[k3.planar.level]}</strong>
                {k3.planar.critical.length ? ` — 위험 영역 극점 ${k3.planar.critical.map((i) => '#' + (i + 1)).join(', ')}` : ''}
              </div>
              <div className="muted">
                쐐기파괴: <strong>{LEVEL_TEXT[k3.wedge.level]}</strong>
                {k3.wedge.critical.length ? ` — 위험 교선 ${k3.wedge.critical.length}개 (서로 다른 Set 극점 ${k3.wedge.total}쌍 중)` : ''}
              </div>
              <div className="muted">
                전도파괴: <strong>{LEVEL_TEXT[k3.toppling.level]}</strong>
                {k3.toppling.critical.length ? ` — 위험 영역 극점 ${k3.toppling.critical.map((i) => '#' + (i + 1)).join(', ')}` : ''}
              </div>
              <p className="muted">허용 방향 편차 평면·전도 20° 기준. "국부적"은 Set 평균은 아니지만 개별 극점·교선이 기준에 들어간 경우입니다.</p>
            </div>
          ) : (
            <p className="muted">사면 방향(위)과 마찰각(아래 분석값)을 넣으면 평면·쐐기·전도파괴 가능성이 표시됩니다.</p>
          )}

          <button className="primary" style={{ marginTop: 8 }} onClick={() => void confirmSets()}>
            Set 방향을 절리군에 저장
          </button>
          <details style={{ marginTop: 8 }}>
            <summary>측정 목록 (번호·종류·Set·메모)</summary>
            {poles.map((p, i) => (
              <div className="list-item" key={i} style={{ flexWrap: 'wrap', gap: 4 }}>
                <span className="list-main">
                  #{i + 1} {pad(p.dip, 2)}/{pad(p.dipDir, 3)}
                  {p.spread !== undefined && p.spread > 8 ? <span className="tag-prior changed">센서 편차 {p.spread}°</span> : null}
                </span>
                <select value={p.type ?? '절리'} onChange={(e) => editPole(i, { type: e.target.value as DiscontinuityType })}>
                  {TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <select value={labels[i]} onChange={(e) => setLabel(i, parseInt(e.target.value, 10))}>
                  <option value={-1}>예외</option>
                  {Array.from({ length: k }, (_, n) => (
                    <option key={n} value={n}>
                      SET{n + 1}
                    </option>
                  ))}
                </select>
                <input placeholder="메모" defaultValue={p.note ?? ''} onBlur={(e) => editPole(i, { note: e.target.value })} style={{ width: 110 }} />
                <button
                  className="link-danger"
                  onClick={() => void saveStation({ poles: poles.filter((_, j) => j !== i), poleLabels: labels.filter((_, j) => j !== i) })}
                >
                  삭제
                </button>
              </div>
            ))}
            <button
              className="ghost"
              onClick={() => {
                if (confirm('측정을 모두 지울까요?')) void saveStation({ poles: [], poleLabels: [] });
              }}
            >
              전체 지우기
            </button>
          </details>
        </>
      )}
      {facility && (
        <details style={{ marginTop: 8 }} open={friction === undefined}>
          <summary>분석값 입력 (시설물 공통)</summary>
          <div className="rows">
            {(
              [
                ['friction', '마찰각 φ(°)'],
                ['slopeDip', '사면 경사(°)'],
                ['slopeDipDir', '사면 경사방향(°)'],
              ] as const
            ).map(([key, label]) => (
              <div className="row" key={key}>
                <span className="row-label">{label}</span>
                <input inputMode="decimal" defaultValue={an[key] ?? ''} onBlur={(e) => setAn(key, e.target.value)} />
              </div>
            ))}
          </div>
          <p className="muted">사면 경사·방향은 측점별 값이 없을 때만 씁니다. 평사투영 해석에는 점착력을 쓰지 않습니다.</p>
        </details>
      )}
    </div>
  );
}
