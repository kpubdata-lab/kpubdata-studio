# 아키텍처 — KPubData Studio

## 1. 역할

Studio는 `kpubdata-builder` 위에 놓이는 표현 계층이자 워크플로 계층입니다.

```mermaid
graph TD
    Studio[KPubData Studio SPA] --> BuilderAPI[Builder API / Service]
    BuilderAPI --> KBuilder[KPubData Builder · kpubdata-builder]
    KBuilder --> KPubData[KPubData · kpubdata]
    KPubData --> PublicAPIs[Public Data APIs]
```

```text
kpubdata-studio
  -> builder API/service
  -> kpubdata-builder
  -> kpubdata
```

### "Studio가 뭔가요?" (초보자용 설명)
KPubData Studio는 복잡한 데이터 수집 과정을 누구나 쉽게 할 수 있도록 도와주는 **작업실**입니다.

- **비유**: "레스토랑 주문 시스템의 터치스크린 키오스크 같은 것입니다. 손님(사용자)이 메뉴(데이터셋)를 고르고, 옵션(파라미터)을 설정하고, 주문(빌드)하면, 주방(Builder)이 요리(아티팩트)를 만듭니다."
- **역할**: 개발자가 아닌 사람도 마우스 클릭 몇 번으로 공공데이터를 수집하고, 정제하고, 파일로 내려받을 수 있는 환경을 제공합니다.

---

## 2. SPA 아키텍처 개요

Studio는 **Vite + React + TypeScript + React Router** 기반의 단일 페이지 애플리케이션(SPA)입니다.

- **Vite**: 빠른 개발 서버와 프로덕션 빌드를 담당합니다.
- **React**: 화면을 컴포넌트 단위로 조립합니다.
- **React Router**: 브라우저 URL과 페이지 컴포넌트를 연결합니다.
- **TanStack Query**: `QueryClientProvider`가 마운트되어 준비(provisioned)되어 있습니다. 현재는 `useQuery`/`useMutation` 훅이 사용되지 않으며, 서버 상태 채택이 진행 중(in progress)입니다.
- **Zustand**: 편집기 임시 저장과 UI 세션 상태를 다루는 경량 스토어입니다.
- **TypeScript**: Builder API 계약과 UI 상태를 정적으로 검증합니다.

```mermaid
graph TD
    Main[src/main.tsx] --> App[src/app/App.tsx]
    App --> Router[src/app/router.tsx]
    Router --> Home[HomePage]
    Router --> Builds[BuildsPage]
    Router --> NewBuild[NewBuildPage]
    Home --> Features[src/features/*]
    Builds --> Features
    NewBuild --> Features
```

---

## 3. 아키텍처 원칙

Studio는 빌드 의미론을 소유하지 않습니다.
Studio는 설정, 미리보기, 상태, 결과물을 렌더링합니다.

핵심 원칙:
- 빌드 의미론은 Builder가 소유합니다.
- Studio는 입력, 상태 전이, 시각화, 검토 흐름을 담당합니다.
- 기능별 API 호출은 feature 경계 안에 둡니다.
- 공통 타입과 UI는 `shared/`, 핵심 도메인 표현은 `entities/`에 둡니다.

---

## 4. 프런트엔드 아키텍처 상세

```mermaid
graph LR
    Main[main.tsx] --> App[app/App.tsx]
    App --> Router[app/router.tsx]
    Router --> Pages[pages/*]
    Pages --> Features[features/*]
    Features --> Shared[shared/*]
    Features --> Entities[entities/*]
    Features --> BuilderAPI[Builder API]
```

### 디렉터리 구조 및 가이드

- **`src/main.tsx`**: 브라우저 `#root`에 앱을 마운트하는 진입점입니다.
- **`src/app/`**: 앱 셸과 라우터를 조립합니다.
  - `App.tsx`: `RouterProvider` 연결
  - `router.tsx`: 브라우저 라우트와 공통 셸 정의
- **`src/pages/`**: URL 단위 페이지 컴포넌트를 둡니다.
  - `HomePage.tsx`: `/`
  - `BuildsPage.tsx`: `/builds`
  - `NewBuildPage.tsx`: `/builds/new`
- **`src/features/`**: 기능 단위로 UI, API, 상태를 묶습니다.
  - `build-spec/`: 빌드 기획 입력
  - `preview/`: 미리보기
  - `validation/`: 검증 결과
  - `runs/`: 실행 추적
  - `artifacts/`: 결과물 조회
  - `publish/`: 출판 흐름
- **`src/shared/`**: 공통 config, hooks, lib, types, ui를 둡니다.
- **`src/entities/`**: `build`, `dataset`, `manifest`, `artifact` 등 핵심 도메인 모델을 위한 예약 디렉터리입니다. 현재 각 하위 폴더에는 `.gitkeep` 파일만 있으며 실제 도메인 타입은 `src/shared/lib/types.ts`에 위치합니다. (`entities/` 내 도메인 분리는 계획(planned)/미구현 상태입니다.)

### 기능 폴더 규약

기능 폴더는 아래 패턴을 기본으로 삼습니다.

```text
src/features/<feature>/
├── api/           # Builder API 호출 진입점
├── components/    # 기능 전용 UI
├── hooks/         # 기능 전용 상태/데이터 훅 (필요 시)
└── schemas/       # 입력 검증/매핑 스키마 (필요 시)
```

원칙:
- 기능별 HTTP 연동은 `features/*/api/index.ts`에서 시작합니다.
- 페이지는 여러 feature를 조립하지만 Builder API 세부 구현을 직접 소유하지 않습니다.
- feature 간 공통 코드는 `shared/`로 올리고, 개념적으로 독립된 핵심 데이터는 `entities/`에 둡니다.

---

## 5. Builder API와의 통신

Studio는 직접 데이터를 수집하지 않고, **Builder API**라는 중간 매개체를 통해 작업을 수행합니다.

```mermaid
sequenceDiagram
    participant User as 사용자
    participant Page as Page
    participant FeatureAPI as features/*/api/index.ts
    participant BAPI as KPubData Builder API

    User->>Page: 빌드 실행 요청
    Page->>FeatureAPI: runBuild(spec)
    FeatureAPI->>BAPI: POST /build
    Note over BAPI: 수집·검증·게시는 Builder 안에서 일어나며<br/>Studio 는 그 내부(KPubData 호출 포함)를 모른다
    BAPI-->>FeatureAPI: Result JSON (OpenAPI 계약)
    FeatureAPI-->>Page: UI용 데이터 반환
    Page-->>User: 결과 표시
```

### 데이터 흐름
`Studio (SPA)` → `KPubData Builder` HTTP/OpenAPI 계약. Builder 뒤의 KPubData 는 Builder 의 의존성이며 Studio 는 직접 참조하지 않습니다 (Studio → Builder → KPubData).

### API 클라이언트 위치

- Builder API 클라이언트는 Studio 내부의 **연동 표면**입니다.
- 페이지는 feature API를 호출하고, feature API는 Builder의 HTTP 계약을 캡슐화합니다.
- 필드명 변환, 응답 정규화, 에러 표준화는 feature API 또는 shared lib에서 담당합니다.

---

## 6. 주요 프런트엔드 영역

- 빌드 대시보드
- 소스 선택
- 빌드 스펙 편집기
- 미리보기 패널
- 검증 패널
- 실행/빌드 이력
- 아티팩트 뷰어
- 출판 폼

## 7. 백엔드 / 연동 표면

Studio에는 다음을 노출하는 안정적인 연동 계층이 필요합니다.
- 데이터셋 목록 조회
- 소스 미리보기 가져오기
- 스펙 검증
- 빌드 실행
- 빌드 상태 조회
- manifest 읽기
- 아티팩트 목록 조회
- 빌드 출판

## 8. 상태 소유권

```mermaid
graph LR
    subgraph StudioOwns [Studio가 관리하는 상태]
        direction TB
        Draft[Unsaved Drafts]
        Form[Form Input State]
        UIState[UI Filters/Selections]
    end

    subgraph BackendOwns [Builder/Backend가 관리하는 상태]
        direction TB
        Execution[Build Execution State]
        Manifest[Manifest Data]
        Files[Artifact Files]
        Semantics[Validation Rules]
    end

    StudioOwns -- Sync via API --> BackendOwns
```

### Studio가 소유하는 상태
- 저장되지 않은 폼/초안 상태
- 로컬 위저드 상태
- UI 필터, 선택 상태, 패널 상태

### 상태 소유권 규칙
- Zustand는 UI 상태와 초안 상태를 소유합니다.
- TanStack Query는 서버 상태와 캐싱을 소유하도록 채택이 진행 중(in progress)입니다. 현재는 `QueryClientProvider`만 마운트되어 있고 `useQuery`/`useMutation` 훅은 사용되지 않습니다.

### Builder/backend가 소유하는 상태
- 빌드 실행 상태
- manifest 데이터
- 아티팩트 파일 상태
- 검증 의미론

---

## 관련 문서

### 이 저장소 내 문서
| 문서 | 설명 |
| :--- | :--- |
| [STATE_MODEL.md](./STATE_MODEL.md) | 상태 관리 및 전이 모델 |
| [UI_SPEC.md](./UI_SPEC.md) | UI 컴포넌트 규격 |
| [USER_FLOWS.md](./USER_FLOWS.md) | 사용자 시나리오 및 흐름 |
| [INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md) | 정보 및 메뉴 구조 |
| [API_CONTRACT.md](./API_CONTRACT.md) | API 통신 규약 |

### KPubData Product Family
| 저장소 | 문서 | 설명 |
| :--- | :--- | :--- |
| **전체 제품군** | [product-family-architecture.md](https://github.com/yeongseon/kpubdata/blob/main/docs/product-family-architecture.md) | **3개 저장소 전체 시스템 아키텍처** |
| [kpubdata](https://github.com/yeongseon/kpubdata) | [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata/blob/main/ARCHITECTURE.md) | KPubData 아키텍처 |
| [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) | [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata-builder/blob/main/ARCHITECTURE.md) | Builder 아키텍처 |
