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

interface Props {
  value: Condition;
  onChange: (c: Condition) => void;
}

const STAGES: Stage[] = [1, 2, 3, 4, 5];

export function ConditionForm({ value, onChange }: Props) {
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

  return (
    <div className="cond">
      {CONDITION_ITEMS.map((key) => {
        const item = value[key];
        const labels = ITEM_LABELS[key];
        return (
          <div className="cond-item" key={key}>
            <div className="cond-head">
              <strong>{ITEM_NAMES[key]}</strong>
              {item && (
                <span className="pill">
                  {item.stage}단계 · {item.score}점
                </span>
              )}
            </div>

            <div className="seg">
              {STAGES.map((st) => (
                <button
                  key={st}
                  className={`seg-btn${item?.stage === st ? ' on' : ''}`}
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
                      className={`score-btn${item.bound === b ? ' on' : ''}`}
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
