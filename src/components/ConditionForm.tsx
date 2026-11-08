import {
  apertureStageFromMm,
  CONDITION_ITEMS,
  ITEM_LABELS,
  ITEM_NAMES,
  makeRatedItem,
  persistenceStageFromM,
  STAGE_SCORES,
  withScores,
  type Bound,
  type Condition,
  type ConditionItemKey,
  type RatedItem,
  type Stage,
} from '../lib/scoring/condition';

export type PriorItems = Partial<Record<ConditionItemKey, { label: string; score?: number }>>;

interface Props {
  value: Condition;
  onChange: (c: Condition) => void;
  /** 전차 항목별 상태값·점수: 선택 버튼에 연하게 표시되고, [전차와 같음]으로 한 번에 채울 수 있다 */
  prior?: PriorItems;
}

/** 점수 → 단계·점수구간 (0:1단계, 1~2:2단계, 3~4:3단계, 5~6:4단계, 7~8:5단계) */
export function fromScore(score: number): { stage: Stage; bound: Bound } {
  if (score <= 0) return { stage: 1, bound: 'lower' };
  const stage = (Math.ceil(score / 2) + 1) as Stage;
  return { stage: Math.min(5, stage) as Stage, bound: score % 2 === 1 ? 'lower' : 'upper' };
}

const STAGES: Stage[] = [1, 2, 3, 4, 5];

const ITEM_ACCENTS: Record<ConditionItemKey, string> = {
  persistence: '#007aff',
  aperture: '#5856d6',
  roughness: '#34c759',
  infilling: '#ff9500',
  weathering: '#ff375f',
};

/** "① 연장성" → ["①", "연장성"] — 표시용으로만 분리 (Excel 출력은 ITEM_NAMES 원문 그대로 사용) */
function splitItemName(name: string): [string, string] {
  const i = name.indexOf(' ');
  return i === -1 ? ['', name] : [name.slice(0, i), name.slice(i + 1)];
}

export function ConditionForm({ value, onChange, prior }: Props) {
  const patch = (p: Partial<Condition>) => onChange(withScores({ ...value, ...p }));

  const setItem = (key: ConditionItemKey, item: RatedItem | null) => patch({ [key]: item });

  const pickStage = (key: ConditionItemKey, stage: Stage) => {
    const prev = value[key];
    const bound: Bound = stage === 1 ? 'lower' : (prev?.bound ?? 'lower');
    setItem(key, makeRatedItem(stage, bound));
  };

  const pickBound = (key: ConditionItemKey, bound: Bound) => {
    const prev = value[key];
    if (!prev) return;
    setItem(key, makeRatedItem(prev.stage, bound));
  };

  const priorOf = (key: ConditionItemKey) => {
    const p = prior?.[key];
    return p && p.score !== undefined && Number.isFinite(p.score) ? { ...p, ...fromScore(p.score) } : null;
  };

  return (
    <div className="cond">
      {CONDITION_ITEMS.map((key) => {
        const item = value[key];
        const pr = priorOf(key);
        const labels = ITEM_LABELS[key];
        const [num, title] = splitItemName(ITEM_NAMES[key]);
        const accent = ITEM_ACCENTS[key];
        return (
          <div className="cond-item" key={key} style={{ '--accent': accent } as React.CSSProperties}>
            <div className="cond-head">
              <span className="cond-title">
                <span className="cond-num">{num}</span>
                {title}
              </span>
              {item ? (
                <span className="pill">
                  {item.stage}단계 · {item.score}점{pr && item.score !== pr.score ? ' · 변경' : ''}
                </span>
              ) : (
                pr && (
                  <span className="ghost-hint">
                    전차 {pr.label} · {pr.score}점
                  </span>
                )
              )}
            </div>

            <div className="seg">
              {STAGES.map((st) => (
                <button
                  key={st}
                  className={`seg-btn${item?.stage === st ? ' on' : ''}${pr?.stage === st ? ' prior' : ''}`}
                  onClick={() => pickStage(key, st)}
                >
                  {labels[st - 1]}
                </button>
              ))}
            </div>

            {item && item.stage !== 1 && (
              <div className="bound-row">
                <span className="muted">점수구간</span>
                {(STAGE_SCORES[item.stage] as readonly number[]).map((sc, i) => {
                  const b: Bound = i === 0 ? 'lower' : 'upper';
                  return (
                    <button
                      key={sc}
                      className={`score-btn${item.bound === b ? ' on' : ''}${pr && pr.stage === item.stage && pr.score === sc ? ' prior' : ''}`}
                      onClick={() => pickBound(key, b)}
                    >
                      {sc}
                    </button>
                  );
                })}
              </div>
            )}

            {key === 'persistence' && (
              <MeasureInput
                label="실측 길이"
                unit="m"
                onValue={(v) => setItem('persistence', makeRatedItem(persistenceStageFromM(v), item?.bound ?? 'lower'))}
              />
            )}
            {key === 'aperture' && (
              <MeasureInput
                label="실측 틈새"
                unit="mm"
                onValue={(v) => setItem('aperture', makeRatedItem(apertureStageFromMm(v), item?.bound ?? 'lower'))}
              />
            )}
            {key === 'infilling' && (
              <div className="field" style={{ marginTop: 8 }}>
                <label>충전물 재료명</label>
                <input
                  type="text"
                  className="mat-input"
                  placeholder="예: 점토, 방해석"
                  value={value.infillingMaterial ?? ''}
                  onChange={(e) => patch({ infillingMaterial: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}

      <div className="cond-note">
        <label>특이사항</label>
        <textarea
          rows={2}
          placeholder="특이사항 입력"
          value={value.freeText}
          onChange={(e) => patch({ freeText: e.target.value })}
        />
      </div>

      <div className="cond-score">
        <div>
          Σ <strong>{value.sum}</strong>
        </div>
        <div>
          산술평균 <strong>{value.mean.toFixed(1)}</strong>
        </div>
        <div>
          절리상태 점수 <strong className="big">{value.complete ? value.score : '–'}</strong>
        </div>
      </div>
      {!value.complete && <p className="muted">5개 항목을 모두 선택하면 절리상태 점수가 산출됩니다.</p>}
    </div>
  );
}

function MeasureInput({
  label,
  unit,
  onValue,
}: {
  label: string;
  unit: string;
  onValue: (v: number) => void;
}) {
  return (
    <div className="field" style={{ marginTop: 8 }}>
      <label>
        {label} ({unit})
      </label>
      <input
        type="number"
        inputMode="decimal"
        step="0.01"
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onValue(v);
        }}
      />
    </div>
  );
}
