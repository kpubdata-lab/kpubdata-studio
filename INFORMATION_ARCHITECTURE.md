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
- **예전 화면 이름은 지운다** (2026-10-06 결정, kpubdata#812). `Discover`, `Add Data`,
  `Datasets`, `Builds`/`build`/`빌드`, `Provider` 를 사용자 문구에 새 이름과 함께 두지 않는다.
  `scripts/legacy-terms.mjs`(`npm run i18n:legacy`, CI 의 `Retired screen names`)가
  `ko.json` · `en.json` 의 값을 읽고, 하나라도 돌아오면 실패한다(기준선 0). 용어 목록과 허용
  예외, 예외마다의 사유는 그 스크립트에 있다. URL, 코드 식별자, Builder 계약의 필드 이름은
  대상이 아니다. `BuildSpec`(형식 이름), `소스 데이터셋`(제공자의 원천 데이터셋), `제공자`
  (데이터를 제공하는 기관)는 지금도 쓰는 말이라 그대로 둔다.
- **`작업대` 와 `갱신 이력` 은 메인테이너의 결정을 기다린다.** 2026-10-06 결정은 둘을 지울
  이름으로 적었다. 그런데 화면 용어집(`docs/ko-glossary.md`, #892, 2026-10-11)은 Workspace
  화면의 이름을 `작업대` 로 정했고, `갱신 이력` 은 2026-09-30 검토가 `nav.builds` 의 새
  문구로 정한 이름이며 결정에는 대신 쓸 이름이 없다. 두 이름은 사이드바에 있어 화면 기준
  이미지(`e2e/visual.spec.ts-snapshots/`)에도 찍혀 있다. 그래서 지금 쓰는 자리 12곳만 예외로
  두었고, 다른 자리에 새로 쓰면 검사가 실패한다.
- **`Datasets` 는 메뉴 둘이 아니라 낱말 둘로 나뉘었다.** #423 의 전환 표는 "Datasets 를
  Sources 와 Tables 로 분리"라고 적었지만, 같은 이슈의 기대 IA 와 2026-09-30 검토의 메뉴
  구성에는 `Sources` 항목이 없고 DATA 는 Catalog 와 Tables 다. 제공자의 원천 데이터셋은
  Catalog(`/discover`)에 `소스 데이터셋` 으로, 그것으로 만든 것은 Tables(`/tables`)에 `테이블`
  로 나온다. `Dataset` 을 단독으로 쓰지 않는다는 TERMINOLOGY.md 의 규칙과 같다. 별도의
  Sources 화면은 만들지 않았다.
- **Workspace 와 Reports 를 기본 메뉴에 둘지는 정해지지 않았다** (2026-09-30 검토). 두 기능은
  브라우저에만 저장된다. 지금은 ANALYZE 에 그대로 있다.

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
| `/validate` · `/preview` · `/artifacts` | 예전 단독 화면 → `/add` · `/add` · `/refresh-jobs` 로 redirect (쿼리·해시 유지, 3.1절) | `src/app/legacyRedirect.tsx` |
| `/datasets/*` · `/builds/*` · `/provider/*` | 옛 URL → 위 경로로 redirect | `src/app/legacyRedirect.tsx` |

없는 경로는 별도 404 라우트 없이 라우트 오류 화면(`RouteErrorBoundary`)이 받는다.

> URL 매핑은 파일 시스템이 아니라 `src/app/router.tsx`의 React Router 설정이 단일 기준입니다.

### 3.1 `/validate` · `/preview` · `/artifacts` 는 redirect 한다 (2026-10-11 결정, #423)

세 경로는 예전 빌드 콘솔에서 검증, 미리보기, 결과물을 따로 보여 주던 화면의 주소입니다.
#423 의 2026-10-07 검토는 "쓰는 곳과 딥링크, 기존 북마크를 조사한 뒤 폐기할지 redirect
할지 결정한다"를 남겼습니다. 조사 결과와 결정은 다음과 같습니다.

| 경로 | 조사한 내용 | 결정 |
| :--- | :--- | :--- |
| `/validate` | 화면에 "검증은 테이블 만들기 안에서 진행됩니다"라는 안내와 `/add` 로 가는 버튼, 그리고 Ask KPubData 대화창만 있었습니다. 검증은 `/add` 의 한 단계입니다(#534) | `/add` 로 redirect |
| `/preview` | 안내 문구와 `/add` 로 가는 버튼만 있었습니다. 미리보기는 `/add` 의 한 단계입니다(#534) | `/add` 로 redirect |
| `/artifacts` | "실행을 선택하세요"라는 안내와 `/refresh-jobs` 로 가는 버튼만 있었습니다. 파일은 실행마다 `/refresh-jobs/:buildId/artifacts` 에 있습니다 | `/refresh-jobs` 로 redirect |

- **앱 안에서 이 경로로 가는 링크는 없습니다.** `git grep` 으로 `src` · `e2e` · `__tests__` 를
  찾으면 `router.tsx` 의 라우트 선언, breadcrumb 표(`src/app/breadcrumb.ts`), Ask KPubData 의
  화면 이름 표(`src/features/assistant/context.ts`), 테스트, 문서용 캡처 스크립트만 나옵니다.
  사이드바, 명령 검색, 다른 화면의 버튼은 이 경로를 쓰지 않습니다. 남은 사용처는 사용자가
  저장해 둔 북마크와 바깥 문서의 링크뿐이고, 그것이 몇 개인지는 저장소에서 알 수 없습니다.
- **그래서 주소는 지우지 않고 redirect 합니다.** 지우면 저장해 둔 링크가 오류 화면으로
  갑니다. 그대로 두면 버튼 하나만 있는 화면이 남고, 그 화면의 이름이 예전 구조의 이름으로
  계속 보입니다. redirect 는 `/datasets` · `/builds` · `/provider` 와 같은 방식입니다
  (`src/app/legacyRedirect.tsx`, 쿼리와 해시 유지, `replace`). `/validate` 에 있던 Ask KPubData
  대화창은 topbar 의 Ask KPubData 버튼으로 어느 화면에서나 열립니다.
- **화면 컴포넌트는 아직 지우지 않았습니다.** `src/pages/ValidatePage.tsx` · `PreviewPage.tsx` ·
  `ArtifactsPage.tsx` 와 그 문구(`validatePage.*` · `previewPage.*` · `artifactsPage.*`)는
  이제 라우터가 쓰지 않지만 저장소에 남아 있습니다. 2026-10-06 결정은 레거시 페이지를
  어디까지 제거할지를 정하지 않았고, 2026-10-07 검토는 페이지를 삭제하기 전에 실제 Builder 에
  연결한 E2E 로 기존 사용자 여정을 확인하라고 했습니다. 삭제는 그 확인 뒤의 일입니다.
- 검사: `src/app/legacyRedirect.test.tsx` 가 세 경로의 목적지와 쿼리·해시 유지를,
  `__tests__/legacyDeepLinks.test.tsx` 가 실제 라우터에서 목적지 화면이 열리는 것을 확인합니다.

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
