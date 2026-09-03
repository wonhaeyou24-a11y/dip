import { useState } from 'react';
import { randomValues, valueStats } from '../lib/labels';

interface Props {
  /** 목표 개수 (반발경도 20, 토양경도 10) */
  count: number;
  values: number[];
  onChange: (values: number[]) => void;
  unit?: string;
}

type Mode = 'range' | 'manual';

export function MultiValueInput({ count, values, onChange, unit = '' }: Props) {
  const [mode, setMode] = useState<Mode>('range');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const stats = valueStats(values);

  const generate = () => {
    const lo = parseFloat(min);
    const hi = parseFloat(max);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    onChange(randomValues(lo, hi, count));
  };

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
              key={i}
              type="number"
              inputMode="decimal"
              placeholder={`${i + 1}`}
              defaultValue={Number.isFinite(values[i]) ? values[i] : ''}
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
