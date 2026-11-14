# 04-1 샘플로 극점 Set 자동 분류(퍼지 K-means, 축 자료) 검증 — 사이트별 3 Set → 샘플 J 값과 비교
import json, math, itertools, sys
import numpy as np
D = json.load(open(sys.argv[1], encoding='utf-8'))
def vec(dip, dd):
    pl = math.radians(90 - dip); tr = math.radians((dd + 180) % 360)
    return np.array([math.cos(pl)*math.sin(tr), math.cos(pl)*math.cos(tr), math.sin(pl)])
def to_dd(v):
    if v[2] < 0: v = -v
    pl = math.degrees(math.asin(max(-1, min(1, v[2])))); tr = math.degrees(math.atan2(v[0], v[1])) % 360
    return 90 - pl, (tr + 180) % 360
def fkm(X, k, m=2.0, iters=100, seeds=30, rng=np.random.default_rng(1)):
    best = None
    for s in range(seeds):
        idx = rng.choice(len(X), k, replace=False); C = X[idx].copy()
        for _ in range(iters):
            d2 = np.maximum(1 - (X @ C.T) ** 2, 1e-9)
            u = (1 / d2) ** (1 / (m - 1)); u /= u.sum(1, keepdims=True)
            Cn = []
            for j in range(k):
                T = (X * (u[:, j] ** m)[:, None]).T @ X
                w, V = np.linalg.eigh(T); Cn.append(V[:, -1])
            Cn = np.array(Cn)
            if np.allclose(np.abs((Cn * C).sum(1)), 1, atol=1e-8): C = Cn; break
            C = Cn
        d2 = np.maximum(1 - (X @ C.T) ** 2, 1e-9)
        u = (1 / d2) ** (1 / (m - 1)); u /= u.sum(1, keepdims=True)
        J = ((u ** m) * d2).sum()
        if best is None or J < best[0]: best = (J, C, u)
    return best
def ang(a, b):
    return math.degrees(math.acos(min(1, abs(float(vec(*a[:2]) @ vec(*b[:2]))))))
for sh, d in D.items():
    refs = []
    for k, v in d['J'].items():
        for t in v:
            dp, dd = t.split('/')
            if float(dp) <= 90: refs.append((float(dp), float(dd), k.split('@')[0]))
    print('==', sh, d['title'][:30], 'J값', len(refs))
    for site, pts in d['sites'].items():
        X = np.array([vec(*p) for p in pts])
        J, C, u = fkm(X, 3)
        res = []
        for c in C:
            dp, dd = to_dd(c); lab = np.argmax(u, 1)
            near = min(refs, key=lambda r: ang((dp, dd), r)) if refs else None
            res.append('%02d/%03d(%s %.0f°)' % (round(dp), round(dd), near[2] if near else '-', ang((dp, dd), near) if near else 0))
        sizes = sorted(np.bincount(np.argmax(u, 1), minlength=3).tolist(), reverse=True)
        print('  ', site, len(pts), '개 →', ' '.join(sorted(res)), '크기', sizes)
