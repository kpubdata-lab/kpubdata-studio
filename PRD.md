# PRD — KPubData Studio

## 1. Product Summary

KPubData Studio is a workspace for collecting Korean public data, keeping it as snapshots that carry their source and terms of use, and analysing it with tables and SQL.

> **제품 정의 (정본)** — 한국 공공데이터를 수집하고, 출처와 이용 조건을 유지한 스냅샷으로 관리하며, 표와 SQL 로 분석하는 작업공간.
> 이 문장은 `README.md`, `README.en.md`, `ROADMAP.md` 와 kpubdata `docs/brand/BRAND.md` 가 함께 쓴다.
> `__tests__/productDefinition.test.ts` 가 이 저장소의 사본이 어긋나면 실패한다 (#498).

Collection, validation and publishing run in KPubData Builder (`kpubdata-builder`); Studio
is where a person picks what to collect, watches it run, keeps the resulting snapshots with
their provenance and licence, and analyses them.

Implementation status is not tracked here. Direction lives in [ROADMAP.md](./ROADMAP.md);
issue status, priority and target release live in the GitHub Project (POLICY 2.1).

## 2. Problem

The builder pipeline is powerful but configuration-first.
Many users need a safer and more discoverable way to:
- choose sources
- inspect schemas
- configure exports
- validate before publishing
- review build history and outputs

## 3. Goals

### Primary goals
- Make collection (build spec authoring) visual and inspectable
- Expose Builder validation and preview in the UI
- Keep every snapshot's source, collection time and terms of use visible next to its data
- Analyse snapshots with tables, SQL and saved analyses
- Show outputs before publication

### Non-goals
- Replacing the Builder's execution, validation or publishing logic
- Reimplementing provider adapters
- Replacing a general-purpose notebook or BI tool — table, SQL and chart analysis of
  snapshots **is** in scope; arbitrary code, dashboards over non-KPubData sources and
  report authoring for their own sake are not
- Semantic analytics across all public datasets

## 4. Users

### 4.1 OSS maintainer
Wants a faster and safer way to author dataset build specs.

### 4.2 Data curator
Wants previews, validation feedback, and publishing flows in UI.

### 4.3 Developer
Wants to inspect generated artifacts and copy/export config.

## 5. Product Principles

- UI is a control surface, not the source of truth for build semantics
- Generated specs must remain portable
- Preview first
- Validation must be visible and understandable
- Outputs must be inspectable before publish
- Build history must be easy to review

## 6. Frontend Tech Stack

- **Vite**: 개발 서버 및 프로덕션 빌드
- **React**: 화면 구성과 상태 기반 렌더링
- **React Router**: 클라이언트 사이드 라우팅
- **TypeScript**: Builder API 계약과 UI 상태 타입 안정성 확보
- **Tailwind CSS**: 빠른 화면 스타일링

## 7. Core User Flows

### Flow A — Create a new dataset build
1. Start new build
2. Select one or more sources
3. Configure source params
4. Preview rows/schema
5. Configure metadata and exports
6. Validate
7. Run build
8. Review outputs
9. Save/export spec

### Flow B — Edit existing build
1. Open existing spec
2. Modify source/export settings
3. Revalidate
4. Rerun preview
5. Build again

### Flow C — Publish artifact
1. Open successful build
2. Review generated outputs
3. Configure publication target
4. Confirm publish
5. View publish result

---

## 관련 문서

### 이 저장소 내 문서
| 문서 | 설명 |
| :--- | :--- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 시스템 아키텍처 설계 |
| [ROADMAP.md](./ROADMAP.md) | 개발 로드맵 |

### KPubData Product Family
| 저장소 | 문서 | 설명 |
| :--- | :--- | :--- |
| [kpubdata](https://github.com/kpubdata-lab/kpubdata) | [PRD.md](https://github.com/kpubdata-lab/kpubdata/blob/main/PRD.md) | KPubData 제품 요구사항 |
| [kpubdata-builder](https://github.com/kpubdata-lab/kpubdata-builder) | [PRD.md](https://github.com/kpubdata-lab/kpubdata-builder/blob/main/PRD.md) | Builder 제품 요구사항 |
