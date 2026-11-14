import { useMemo, useState } from 'react';
import { createSet, db, updateFacility, updateSet, updateStation, type Facility, type Station } from '../db/db';
import { clusterPoles, poleVec, recomputeSets, type Pole } from '../lib/setCluster';
import { MeasureSession } from './MeasureSession';
import { kinematic } from '../lib/kinematic';

const COLORS = ['#e4572e', '#2e86de', '#2fa84f', '#a64ac9', '#e0a100'];
const RAD = Math.PI / 180;
const pad = (n: number, w: number) => String(Math.round(n)).padStart(w, '0');

/** 등면적(슈미트) 하반구 투영: 극점 → 원 안 좌표(반지름 1) */
function proj(v: [number, number, number]): [number, number] {
  let [x, y, z] = v;
  if (z < 0) [x, y, z] = [-x, -y, -z];
  const th = Math.acos(Math.min(1, z)); // 연직에서 떨어진 각
  const r = Math.SQRT2 * Math.sin(th / 2);
  const h = Math.hypot(x, y) || 1;
  return [(x / h) * r, -(y / h) * r];
}
/** 평면의 대원(큰 원) 점들 */
function greatCircle(dip: number, dipDir: number): string {
  const strike = dipDir - 90;
  const pts: string[] = [];
  for (let a = 0; a <= 180; a += 3) {
    const pl = Math.atan(Math.tan(dip * RAD) * Math.sin(a * RAD));
    const tr = (strike + a) * RAD;
    const [px, py] = proj([Math.cos(pl) * Math.sin(tr), Math.cos(pl) * Math.cos(tr), Math.sin(pl)]);
    pts.push(`${px.toFixed(4)},${py.toFixed(4)}`);
  }
  return pts.join(' ');
}

export function PoleCluster({ station, facility }: { station: Station; facility?: Facility }) {
  const poles: Pole[] = useMemo(() => station.poles ?? [], [station.poles]);
  const k = station.poleK ?? 3;
  const labels = useMemo(() => {
    const l = station.poleLabels ?? [];
    return poles.map((_, i) => (l[i] === undefined ? -1 : l[i]));
  }, [station.poleLabels, poles]);
  const sets = useMemo(() => recomputeSets(poles, labels, k), [poles, labels, k]);
  const [dip, setDip] = useState('');
  const [dir, setDir] = useState('');
  const [msg, setMsg] = useState('');
  const [session, setSession] = useState(false);
  const an = facility?.analysis ?? {};

  const saveStation = (patch: Partial<Station>) => updateStation(station.id, patch);
  const addPole = (d: number, dd: number) => {
    if (!Number.isFinite(d) || !Number.isFinite(dd) || d < 0 || d > 90 || dd < 0 || dd > 360) {
      setMsg('경사 0~90, 경사방향 0~360 으로 입력하세요.');
      return false;
    }
    setMsg('');
    void saveStation({ poles: [...poles, { dip: d, dipDir: dd % 360 }], poleLabels: [...labels, -1] });
    return true;
  };
  const appendPole = async (d: number, dd: number) => {
    const cur = await db.stations.get(station.id);
    const ps = cur?.poles ?? [];
    const ls = cur?.poleLabels ?? [];
    await updateStation(station.id, { poles: [...ps, { dip: d, dipDir: dd % 360 }], poleLabels: [...ps.map((_, i) => ls[i] ?? -1), -1] });
  };
  const undoPole = async () => {
    const cur = await db.stations.get(station.id);
    const ps = (cur?.poles ?? []).slice(0, -1);
    await updateStation(station.id, { poles: ps, poleLabels: (cur?.poleLabels ?? []).slice(0, ps.length) });
  };
  const auto = (kk = k) => {
    const r = clusterPoles(poles, kk);
    void saveStation({ poleK: kk, poleLabels: r.labels });
  };
  const cycle = (i: number) => {
    const next = labels.slice();
    next[i] = next[i] >= k - 1 ? -1 : next[i] + 1;
    void saveStation({ poleLabels: next });
  };
  const confirmSets = async () => {
    const existing = await db.sets.where('stationId').equals(station.id).sortBy('order');
    const used = sets.filter((s) => s.count > 0);
    if (!used.length) return;
    if (
      existing.length &&
      !confirm(`이 측점의 절리군 ${existing.length}개 중 앞의 ${Math.min(existing.length, used.length)}개의 방향을 덮어씁니다. 계속할까요?`)
    )
      return;
    for (let i = 0; i < used.length; i++) {
      const id = existing[i]?.id ?? (await createSet(station.id));
      const d = Math.round(used[i].dip);
      const dd = Math.round(used[i].dipDir) % 360;
      await updateSet(id, {
        orientation: { dip: d, dipDirection: dd, strike: (dd + 270) % 360, method: 'manual', declinationApplied: 0, measuredAt: Date.now() },
      });
    }
    setMsg(`절리군 ${used.length}개의 방향을 저장했습니다. 아래 목록에서 절리상태를 입력하세요.`);
  };
  const setAn = (key: keyof NonNullable<Facility['analysis']>, v: string) => {
    if (!facility) return;
    const n = parseFloat(v);
    void updateFacility(facility.id, { analysis: { ...an, [key]: Number.isFinite(n) ? n : undefined } });
  };
  const used = sets.map((s, i) => ({ s, i })).filter((x) => x.s.count > 0);
  const kin =
    an.slopeDip !== undefined && an.slopeDipDir !== undefined && an.friction !== undefined && used.length
      ? (() => {
          const r = kinematic(used.map((x) => x.s), { dip: an.slopeDip, dipDir: an.slopeDipDir, friction: an.friction });
          // 결과의 set/a/b 는 used 배열 순번 → 실제 Set 번호로 바꾼다
          return {
            planar: r.planar.map((x) => ({ ...x, set: used[x.set].i })),
            toppling: r.toppling.map((x) => ({ ...x, set: used[x.set].i })),
            wedge: r.wedge.map((x) => ({ ...x, a: used[x.a].i, b: used[x.b].i })),
          };
        })()
      : null;
  const planar = (s: { dip: number; dipDir: number }) => {
    if (an.slopeDip === undefined || an.slopeDipDir === undefined) return '';
    const dd = Math.abs(((s.dipDir - an.slopeDipDir + 540) % 360) - 180);
    const ok = dd <= 20 && s.dip < an.slopeDip && (an.friction === undefined || s.dip > an.friction);
    return ok ? '가능' : '낮음';
  };

  return (
    <div className="card">
      <h2>불연속면 측정 · 평사투영 ({poles.length}개)</h2>
      <p className="muted">사이트에서 잰 불연속면을 모두 넣고 [자동 분류]를 누르세요. 점을 누르면 다른 Set 으로 옮길 수 있습니다.</p>
      <div className="row-inline" style={{ gap: 6, flexWrap: 'wrap' }}>
        <input inputMode="decimal" placeholder="경사" value={dip} onChange={(e) => setDip(e.target.value)} style={{ width: 70 }} />
        <input inputMode="decimal" placeholder="경사방향" value={dir} onChange={(e) => setDir(e.target.value)} style={{ width: 90 }} />
        <button
          onClick={() => {
            if (addPole(parseFloat(dip), parseFloat(dir))) {
              setDip('');
              setDir('');
            }
          }}
        >
          추가
        </button>
      </div>
      <button className="primary" style={{ marginTop: 8 }} onClick={() => setSession(true)}>
        측정 시작 (여러 면을 연속으로)
      </button>
      {session && (
        <MeasureSession
          title={`${station.siteId} 불연속면 측정`}
          mode="measure"
          poles={poles}
          sets={sets}
          onAdd={(d, dd) => void appendPole(d, dd)}
          onUndo={() => void undoPole()}
          onClose={() => {
            setSession(false);
            if ((station.poles ?? []).length >= 2) auto();
          }}
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
            <button className="primary" onClick={() => auto()}>
              자동 분류
            </button>
            <button
              onClick={() => {
                if (confirm('측정을 모두 지울까요?')) void saveStation({ poles: [], poleLabels: [] });
              }}
            >
              전체 지우기
            </button>
          </div>
          <svg viewBox="-1.1 -1.1 2.2 2.2" style={{ width: '100%', maxWidth: 340, display: 'block', margin: '8px auto' }}>
            <circle r="1" fill="none" stroke="currentColor" strokeWidth="0.01" />
            <line x1="-1" x2="1" y1="0" y2="0" stroke="currentColor" strokeWidth="0.004" opacity="0.4" />
            <line x1="0" x2="0" y1="-1" y2="1" stroke="currentColor" strokeWidth="0.004" opacity="0.4" />
            <text x="0" y="-1.03" fontSize="0.08" textAnchor="middle" fill="currentColor">
              N
            </text>
            {sets.map((s, i) =>
              s.count > 0 ? <polyline key={i} points={greatCircle(s.dip, s.dipDir)} fill="none" stroke={COLORS[i % 5]} strokeWidth="0.012" opacity="0.7" /> : null,
            )}
            {poles.map((p, i) => {
              const [x, y] = proj(poleVec(p));
              const c = labels[i] >= 0 ? COLORS[labels[i] % 5] : '#888';
              return (
                <g key={i} onClick={() => cycle(i)} style={{ cursor: 'pointer' }}>
                  <circle cx={x} cy={y} r="0.045" fill={c} stroke="#fff" strokeWidth="0.008" />
                  <text x={x} y={y + 0.018} fontSize="0.05" textAnchor="middle" fill="#fff">{i + 1}</text>
                </g>
              );
            })}
          </svg>
          <div className="list">
            {sets.map((s, i) => (
              <div className="list-item" key={i}>
                <span className="list-main">
                  <strong style={{ color: COLORS[i % 5] }}>● SET{i + 1}</strong>
                  <span className="muted">
                    {s.count
                      ? `${pad(s.dip, 2)}/${pad(s.dipDir, 3)} · ${s.count}개${s.fisherK ? ` · K=${s.fisherK.toFixed(0)}` : ''}${planar(s) ? ` · 평면파괴 ${planar(s)}(참고)` : ''}`
                      : '극점 없음'}
                  </span>
                </span>
              </div>
            ))}
            {labels.some((l) => l < 0) && <p className="muted">회색 점 {labels.filter((l) => l < 0).length}개는 어느 Set 에도 넣지 않은 예외 극점입니다.</p>}
          </div>
          {kin && (
            <div className="list" style={{ marginTop: 8 }}>
              <strong>운동학적 검토 (참고)</strong>
              {kin.planar.map((r) => (
                <div key={'p' + r.set} className="muted">평면파괴 SET{r.set + 1}: <strong>{r.ok ? '가능' : '낮음'}</strong> — {r.reason}</div>
              ))}
              {kin.wedge.map((r) => (
                <div key={'w' + r.a + r.b} className="muted">쐐기파괴 SET{r.a + 1}×SET{r.b + 1}: <strong>{r.ok ? '가능' : '낮음'}</strong> — {r.reason}</div>
              ))}
              {kin.toppling.map((r) => (
                <div key={'t' + r.set} className="muted">전도파괴 SET{r.set + 1}: <strong>{r.ok ? '가능' : '낮음'}</strong> — {r.reason}</div>
              ))}
            </div>
          )}
          <button className="primary" onClick={() => void confirmSets()}>
            Set 방향을 절리군에 저장
          </button>
          <details style={{ marginTop: 8 }}>
            <summary>측정 목록</summary>
            {poles.map((p, i) => (
              <div className="list-item" key={i}>
                <span className="list-main">
                  {pad(p.dip, 2)}/{pad(p.dipDir, 3)} {labels[i] >= 0 ? `SET${labels[i] + 1}` : '예외'}
                </span>
                <button
                  className="link-danger"
                  onClick={() => void saveStation({ poles: poles.filter((_, j) => j !== i), poleLabels: labels.filter((_, j) => j !== i) })}
                >
                  삭제
                </button>
              </div>
            ))}
          </details>
        </>
      )}
      {facility && (
        <details style={{ marginTop: 8 }}>
          <summary>분석값 입력 (시설물 공통)</summary>
          <div className="rows">
            {(
              [
                ['slopeDip', '사면 경사(°)'],
                ['slopeDipDir', '사면 경사방향(°)'],
                ['friction', '마찰각 φ(°)'],
              ] as const
            ).map(([key, label]) => (
              <div className="row" key={key}>
                <span className="row-label">{label}</span>
                <input inputMode="decimal" defaultValue={an[key] ?? ''} onBlur={(e) => setAn(key, e.target.value)} />
              </div>
            ))}
          </div>
          <p className="muted">사면 경사·경사방향과 마찰각을 넣으면 평면·쐐기·전도파괴 가능성이 표시됩니다. (평사투영 해석에는 점착력을 쓰지 않습니다)</p>
        </details>
      )}
    </div>
  );
}
