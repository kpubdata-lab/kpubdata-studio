# 정보 구조 — KPubData Studio

## 1. 최상위 섹션

사이드바는 빌드 콘솔(Discover · Add Data · Datasets · Builds · Provider)이 아니라
**데이터를 찾고, 테이블로 두고, 분석하고, 운영하는** 흐름으로 묶는다 (#423). 용어는
kpubdata 의 [TERMINOLOGY.md](https://github.com/kpubdata-lab/kpubdata/blob/main/docs/brand/TERMINOLOGY.md) 를 따른다.

```
KPubData
├── Home                       /
├── DATA
│   ├── Catalog                /discover   공공 API 소스 데이터셋
│   └── Tables                 /tables     소스로 만든 테이블
├── ANALYZE
│   ├── SQL Workspace          /sql        테이블 스냅샷 하나에 SQL
│   ├── 저장된 분석            /analyses   읽은 스냅샷과 함께 보관한 SQL
│   ├── Workspace              /workspace
│   └── Reports                /reports
├── OPERATE
│   ├── Refresh History        /refresh-jobs  테이블을 만들고 갱신한 실행 (화면 이름 "갱신 이력", `nav.builds`)
│   ├── Quality                /quality
│   ├── Monitoring             /monitoring
│   └── 관리 (관리자만)          /admin      정책 상태 · 전체 실행(메타데이터)
├── Connections                /connections
└── Settings                   /settings
```

전역: breadcrumb (topbar) · 명령 검색(CommandSearch) · Ask KPubData · Account · Builder 없이 돌 때의 데모 표시

메뉴 이름은 `src/shared/i18n/locales/*.json` 의 `nav.*`, 설명(툴팁)은 `navDescription.*` 이 기준이다.

- **옛 URL 은 새 URL 로 redirect 한다.** `/datasets → /tables`, `/builds → /refresh-jobs`,
  `/provider → /connections` — 나머지 경로·쿼리(`?run=`)·해시를 그대로 옮기고 `replace` 로
  히스토리에 남기지 않는다 (`src/app/legacyRedirect.tsx`). 저장해 둔 링크가 끊기지 않는다.
  `/refresh-jobs/new` 는 쿼리·해시를 가지고 `/add` 로 간다(`src/app/createTableRedirect.tsx`),
  그래서 `/builds/new` 는 두 번 이동해 `/add` 에 닿는다.
- **테이블 만들기는 메뉴가 아니라 동작이다.** 전역 `New Build` 버튼과 사이드바의
  `Add Data` 를 없앴다. Catalog · Tables 화면의 `Create Table` 이 `/add` 로, Table
  Detail 의 `Refresh` 가 선택한 run 의 스펙 편집(`/refresh-jobs/:id/edit`)으로 간다.
- **SQL Workspace 는 테이블 하나씩** — 웨어하우스가 있는 배포는 커밋된 테이블의 스냅샷
  (`현재` 는 질의 시작 시 고정)을, 없는 배포는 run 하나·stage 하나를 읽는다. 테이블 JOIN 은
  kpubdata-builder#704.
- **저장된 분석은 읽은 스냅샷 id 와 함께 보관된다** (kpubdata-builder#783) — 갱신 뒤 다시
  실행해도 같은 입력을 읽는다. 웨어하우스가 없는 배포에서는 저장할 곳이 없다고 말한다.
- **제품명은 한 번만** — 사이드바 로고. topbar 는 보고 있는 대상을 말한다
  (`갱신 작업 / run-1 / 스냅샷 파일`).

---

## 2. 내비게이션 흐름도

사용자가 Studio에서 정보를 찾아가는 흐름입니다.

```mermaid
graph TD
    Home[Home /] --> Catalog[Catalog /discover]
    Home --> Tables[Tables /tables]
    Catalog -->|Create Table| Add[테이블 만들기 /add]
    Tables -->|Create Table| Add
    Add -->|생성| Run[run 상세 /refresh-jobs/:id]
    Tables --> Detail[Table Detail /tables/:datasetId]
    Detail -->|Refresh| Edit[spec 수정 /refresh-jobs/:id/edit]
    Detail -->|Query| Sql[SQL Workspace /sql]
    Detail -->|Publish| Publish[출판 /refresh-jobs/:id/publish]
    Edit -->|실행| Run
    History[Refresh History /refresh-jobs] --> Run
    Run --> Artifacts[결과물 /refresh-jobs/:id/artifacts]
    Run --> Publish
    Run -->|실패·수정| Edit
    Sql -->|저장| Analyses[저장된 분석 /analyses]
```

---

## 3. URL 구조

각 화면에 해당하는 브라우저 주소(URL)입니다. 직관적인 구조로 설계되었습니다.

| 경로 | 화면 | 페이지 |
| :--- | :--- | :--- |
| `/` | 홈 | `src/pages/HomePage.tsx` |
| `/discover` | 카탈로그 | `src/pages/DiscoverPage.tsx` |
| `/add` | 테이블 만들기 (Add Data) | `src/pages/AddDataPage.tsx` |
| `/tables` · `/tables/:datasetId` | 테이블 목록 · 상세 | `DatasetCatalogPage` · `DatasetDetailPage` |
| `/refresh-jobs` · `/refresh-jobs/:buildId` | 갱신 이력 · run 상세 | `BuildsPage` |
| `/refresh-jobs/:buildId/edit` | 기존 run 의 spec 수정 후 다시 실행 | `NewBuildPage` |
| `/refresh-jobs/:buildId/run` · `/refresh-jobs/:buildId/artifacts` · `/refresh-jobs/:buildId/publish` | 실행 · 결과물 · 출판 | `BuildRunPage` · `BuildArtifactsPage` · `BuildPublishPage` |
| `/refresh-jobs/new` | `/add` 로 redirect (쿼리·해시 유지) | `src/app/createTableRedirect.tsx` |
| `/sql` | SQL Workspace | `src/pages/SqlWorkspacePage.tsx` |
| `/analyses` | 저장된 분석 | `src/pages/AnalysesPage.tsx` |
| `/workspace` | Workspace | `src/pages/WorkspacePage.tsx` |
| `/reports` · `/reports/:reportId` | 리포트 목록 · 편집 | `ReportsPage` · `ReportEditorPage` |
| `/quality` | 품질 | `src/pages/QualityPage.tsx` |
| `/monitoring` | 모니터링 | `src/pages/MonitoringPage.tsx` |
| `/assistant` | Ask KPubData | `src/pages/AssistantPage.tsx` |
| `/connections` | 연결 · 활용신청 안내 | `src/pages/ProviderPage.tsx` |
| `/admin` | 관리 — Builder 가 관리자로 답할 때만 메뉴에 보인다 | `src/pages/AdminPage.tsx` |
| `/settings` | 설정 | `src/pages/SettingsPage.tsx` |
| `/login` · `/signup` | 로그인 · 가입 (앱 셸 밖) | `LoginPage` · `SignupPage` |
| `/validate` · `/preview` · `/artifacts` | 레거시 진입점 (`/add` 나 run 선택으로 안내) | `ValidatePage` · `PreviewPage` · `ArtifactsPage` |
| `/datasets/*` · `/builds/*` · `/provider/*` | 옛 URL → 위 경로로 redirect | `src/app/legacyRedirect.tsx` |

없는 경로는 별도 404 라우트 없이 라우트 오류 화면(`RouteErrorBoundary`)이 받는다.

> URL 매핑은 파일 시스템이 아니라 `src/app/router.tsx`의 React Router 설정이 단일 기준입니다.

---

## 4. 객체 계층 구조

Studio 안에서 다루는 모든 정보는 다음과 같은 상하 관계를 가집니다.

```mermaid
graph TD
    Workspace[Workspace: 전체 작업 공간] --> Draft[Build Draft: 데이터 기획서]
    Draft --> SourceConfig[Source Config: 제공 기관 설정]
    Draft --> ExportConfig[Export Config: 출력 형식 설정]
    
    Draft --> BuildRun[Build Run: 실제 실행 기록]
    BuildRun --> Log[Log: 실행 상세 기록]
    BuildRun --> Artifact[Artifact: 최종 결과 파일]
    
    Artifact --> PublishTarget[Publish Target: Hugging Face]
```

- **Workspace (작업실)**: 사용자의 전체 작업 공간
  - **Build Draft (빌드 기획서)**: 데이터 수집 설정 (수정 가능)
    - **Source Config (소스 설정)**: 어떤 기관의 데이터를 가져올지 (기상청, 서울시 등)
    - **Export Config (출력 설정)**: 어떤 파일로 만들지 (Markdown, CSV 등)
  - **Build Run (실행 기록)**: 기획서를 바탕으로 실제로 실행한 결과 (수정 불가)
    - **Log (기록)**: 실행 과정에서 발생한 사건들
    - **Artifact (결과 파일)**: 최종적으로 생성된 데이터 뭉치
  - **Publish Target (출판지)**: 결과물이 최종적으로 도달할 곳. 지금은 Hugging Face 하나이며, 파일을 내 컴퓨터로 받는 것은 출판이 아니라 결과물 화면의 내려받기다

---

## 관련 문서

### 이 저장소 내 문서
| 문서 | 설명 |
| :--- | :--- |
| [UI_SPEC.md](./UI_SPEC.md) | UI 컴포넌트 및 화면 명세 |
| [USER_FLOWS.md](./USER_FLOWS.md) | 사용자 시나리오 및 흐름 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 시스템 아키텍처 설계 |
| [STATE_MODEL.md](./STATE_MODEL.md) | 상태 관리 모델 |

### KPubData Product Family
| 저장소 | 문서 | 설명 |
| :--- | :--- | :--- |
| [kpubdata](https://github.com/kpubdata-lab/kpubdata) | [ARCHITECTURE.md](https://github.com/kpubdata-lab/kpubdata/blob/main/ARCHITECTURE.md) | KPubData 아키텍처 |
| [kpubdata-builder](https://github.com/kpubdata-lab/kpubdata-builder) | [ARCHITECTURE.md](https://github.com/kpubdata-lab/kpubdata-builder/blob/main/ARCHITECTURE.md) | Builder 아키텍처 |
