# dip — 불연속면 조사 (DiscontinuityShot)

현장에서 스마트폰으로 **불연속면의 주향·경사를 측정**하고, **절리상태를 조사**하고,
사진·GPS와 함께 저장한 뒤 **Excel 결과보고**로 출력하는 현장조사 전용 PWA.

- 근거 기준: 「시설물의 안전 및 유지관리 실시 세부지침」제14장 절토사면 14.2
- 완전 오프라인 동작 (IndexedDB), 앱스토어 없이 설치형 웹앱

## 문서

| 문서 | 내용 |
|---|---|
| [docs/개발계획_v1.0.md](docs/개발계획_v1.0.md) | 전체 개발계획 STEP 1~7, 아키텍처, 측정 알고리즘, 위험요소 |
| [docs/절리상태_평가_설계.md](docs/절리상태_평가_설계.md) | 절리상태 조사 항목·배점표(①~⑤)·점수 계산·데이터 모델·Excel 양식 |
| [docs/보고서양식/](docs/보고서양식/) | 결과보고 Excel 샘플 + 생성 스크립트 |

## 개발

```bash
npm install
npm run dev        # http://localhost:5173  (센서는 HTTPS 또는 localhost 필요)
npm run test       # 주향·경사 계산 로직 테스트
npm run build      # dist/ 프로덕션 빌드 (PWA)
```

## 진행 상태

- [x] STEP 1 데이터 구조 설계 (`src/db/db.ts` — Facility→Station→Set→Condition)
- [~] **STEP 2 주향·경사 측정 엔진** — 계산 로직 + 센서 래퍼 + `OrientationField`. **실기기 검증 필요**
- [x] STEP 3 현장조사 UI (시설물/측점/절리군 화면, 절리상태 배점 폼, 사진)
- [x] STEP 4 오프라인 저장 (Dexie 자동저장, PWA 오프라인, JSON 백업/복원)
- [x] STEP 5 Excel 결과보고 출력 (`src/lib/excel/report.ts`, 시설물별 .xlsx + 사진)
- [ ] STEP 6 기본 분석 (검토 후)
- [ ] STEP 7 최종 보고서

## 배포

`main` 브랜치 push → GitHub Actions → GitHub Pages (`/dip/` 경로).
저장소 Settings → Pages → Source = "GitHub Actions" 로 설정 필요.

## 스택

React + Vite + TypeScript · vite-plugin-pwa · Dexie(IndexedDB) · ExcelJS
