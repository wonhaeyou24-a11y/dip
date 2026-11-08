import { useState } from 'react';
import { randomValues, valueStats } from '../lib/labels';

interface Props {
  /** 목표 개수 (반발경도 20, 토양경도 10) */
  count: number;
  values: number[];
  onChange: (values: number[]) => void;
  unit?: string;
  /** 전차 값: 입력칸에 연한 글씨로 보이고, 금회 값이 다르면 칸이 강조된다 */
  priorValues?: number[];
}

type Mode = 'range' | 'manual';

export function MultiValueInput({ count, values, onChange, unit = '', priorValues }: Props) {
  const hasPrior = !!priorValues && priorValues.some((v) => Number.isFinite(v));
  const [mode, setMode] = useState<Mode>(hasPrior ? 'manual' : 'range');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const stats = valueStats(values);

  const generate = () => {
    const lo = parseFloat(min);
    const hi = parseFloat(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    onChange(randomValues(lo, hi, count));
  };

  const copyPrior = () => onChange(Array.from({ length: count }, (_, i) => (priorValues && Number.isFinite(priorValues[i]) ? priorValues[i] : NaN)));

  const setAt = (i: number, raw: string) => {
    const next = values.slice();
    while (next.length < count) next.push(NaN);
    const v = parseFloat(raw);
    next[i] = Number.isFinite(v) ? v : NaN;
    onChange(next);
  };

  return (
    <div className="mvi">
      <div className="mvi-tabs">
        <button className={`mvi-tab${mode === 'range' ? ' on' : ''}`} onClick={() => setMode('range')}>
          범위 랜덤
        </button>
        <button className={`mvi-tab${mode === 'manual' ? ' on' : ''}`} onClick={() => setMode('manual')}>
          개별 입력
        </button>
      </div>

      {hasPrior && (
        <p className="muted prior-line">
          전차 {priorValues!.filter((v) => Number.isFinite(v)).join(', ')}
          <button className="ghost" style={{ marginLeft: 8 }} onClick={copyPrior}>
            전차와 같음
          </button>
        </p>
      )}
      {mode === 'range' ? (
        <div className="mvi-range">
          <input
            type="number"
            inputMode="decimal"
            placeholder="최소"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
          <span className="unit">~</span>
          <input
            type="number"
            inputMode="decimal"
            placeholder="최대"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
          <button className="ghost" onClick={generate}>
            {count}개 생성
          </button>
        </div>
      ) : (
        <div className="mvi-grid">
          {Array.from({ length: count }, (_, i) => (
            <input
              type="number"
              inputMode="decimal"
              className={Number.isFinite(values[i]) && priorValues && Number.isFinite(priorValues[i]) && priorValues[i] !== values[i] ? 'chg' : ''}
              placeholder={priorValues && Number.isFinite(priorValues[i]) ? String(priorValues[i]) : `${i + 1}`}
              defaultValue={Number.isFinite(values[i]) ? values[i] : ''}
              key={`${i}-${values[i]}`}
              onBlur={(e) => setAt(i, e.target.value)}
            />
          ))}
        </div>
      )}

      {stats.n > 0 && (
        <p className="muted mvi-stats">
          {stats.n}개 · 최소 {stats.min} · 최대 {stats.max} · 평균 {stats.mean}
          {unit}
          {mode === 'range' && (
            <button className="link-danger" style={{ marginLeft: 8 }} onClick={() => onChange([])}>
              지우기
            </button>
          )}
        </p>
      )}
      {stats.n > 0 && stats.n < count && (
        <p className="warn">{count}개 중 {stats.n}개 입력됨</p>
      )}
    </div>
  );
}
