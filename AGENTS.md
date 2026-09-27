# AGENTS.md — kpubdata-studio

> **프로젝트 관리·리뷰 정책의 정본은 [POLICY.md](https://github.com/yeongseon/kpubdata/blob/main/docs/governance/POLICY.md) 하나다.**
> Epic · Issue · Priority · Review Level · Verification · Release 규칙은 그 문서를 따른다.
> 이 문서에는 이 저장소 고유의 절차(빌드 명령, 디렉터리 규칙)만 남긴다.
> 충돌하면 POLICY.md 가 우선한다.

## 미션

`kpubdata-builder`를 위한 UI 셸이자 워크플로 인터페이스로 KPubData Studio를 구현합니다.

## 기본 원칙

- Studio는 builder 로직을 다시 구현하면 안 됩니다.
- UI 상태 전이는 명시적으로 유지합니다.
- 생성되는 스펙은 이식 가능해야 합니다.
- 검증 결과와 manifest를 명확히 드러냅니다.
- preview를 핵심 기능으로 다룹니다.

## 언어 정책

- **Documentation**: 기본적으로 한글로 작성합니다. 영어 확장은 향후 릴리스를 위해 계획되어 있습니다.
- **Code**: 코드(변수명, 함수명, 주석, docstring)는 한글 우선을 원칙으로 하되 필요 시 영어를 사용할 수 있습니다.
- **Commit messages**: 항상 영어로 작성합니다.
- **Issue / PR titles and descriptions**: 한글 사용이 가능하며, 영어도 괜찮습니다.

## 브랜치 규칙

- 기본 브랜치는 `main`입니다. **절대 `main`에 직접 push하지 마세요.**
- 항상 기능 브랜치에서 작업하고 PR을 엽니다.
- 브랜치 이름 규칙: `feat/issue-<number>-<short-description>`, `fix/issue-<number>-<short-description>`, `docs/<short-description>`
- `main`에 force-push하지 마세요. `main`을 삭제하지 마세요.
- 직접 만들지 않은 브랜치를 이름 변경하거나 삭제하지 마세요.
- git 작업이 확실하지 않다면 **추측하지 말고 먼저 물어보세요.**

## 우선순위

1. 정보 구조
2. 빌드 초안 상태
3. builder API 연동 계층
4. 미리보기 및 검증 화면
5. 아티팩트 뷰어
6. 출판 흐름

---

## 이 프로젝트 이해하기

KPubData Studio는 `kpubdata-builder` 출판사에서 만드는 **책(데이터셋)을 기획하고 미리보는 작업실**과 같습니다. 코딩 없이 버튼 몇 번으로 어떤 데이터를 가져올지 정하고, 결과가 어떻게 나올지 눈으로 확인하며 최종 출판까지 관리하는 웹 화면입니다.

### 핵심 개념 용어 사전

| 용어 | 설명 |
| :--- | :--- |
| **Draft** | 아직 저장되지 않은 임시 기획 상태 (편집 중) |
| **Build Run** | 실제로 빌드를 돌려 데이터를 가져오는 과정 |
| **Preview** | 빌드 결과물을 미리 눈으로 확인하는 화면 |
| **State Model** | 기획(Draft)부터 실행(Run), 출판(Publish)까지의 상태 흐름도 |
| **Studio Shell** | 전체 웹 화면을 구성하는 기본 틀과 내비게이션 |
| **UI Spec** | 화면의 각 요소가 어떻게 보이고 반응해야 하는지에 대한 약속 |

### 이 프로젝트의 코드가 실행되는 흐름 (Vite + React SPA)

```mermaid
graph TD
    Main[src/main.tsx] --> App[src/app/App.tsx]
    App --> Router[src/app/router.tsx]
    Router --> Pages[src/pages/*]
    Pages --> Features[src/features/*]
    Features --> Shared[src/shared/*]
    Features --> API[features/*/api/index.ts]
```

```text
[main.tsx] -> [App.tsx] -> [router.tsx] -> [pages/*] -> [features/*]
```


## AI 에이전트 코딩 가이드

### 좋은 프롬프트 예시
- "`src/pages/NewBuildPage.tsx`에 새 빌드 기획 시작 화면을 정리해줘."
- "`src/features/preview/api/index.ts`와 연결되는 미리보기 패널 UI를 추가해줘."

### 에이전트 금지 사항
- **빌더 로직 중복 금지**: 데이터 수집 로직은 직접 짜지 말고 `kpubdata-builder` API를 호출하세요.
- **상태 관리 누락 금지**: 페이지 이동 시 기획서의 임시 저장 상태(Draft)가 유지되도록 하세요.

### 에이전트 결과물 검증 체크리스트
- [ ] `npm run lint`를 통과했는가?
- [ ] 새로운 페이지가 Sidebar 내비게이션에 포함되었는가?
- [ ] 반응형 디자인이 모바일에서도 깨지지 않는가?

## 파일 구조 가이드

```mermaid
graph TD
    src[src/] --> main[main.tsx: Vite 엔트리]
    src --> app[app/: 앱 조립 및 라우터]
    src --> pages[pages/: 라우트 단위 화면]
    src --> features[features/: 기능별 모듈]
    src --> shared[shared/: 공통 유틸/타입/UI]
    src --> entities[entities/: 도메인 모델]
```

```text
src/
├── main.tsx         # Vite 엔트리 포인트
├── app/             # App 조립 및 React Router 설정
├── pages/           # URL 단위 페이지 컴포넌트
├── features/        # 기능별 UI/API/상태 모듈
├── shared/          # 공통 유틸리티, 타입, UI 조각
└── entities/        # build, dataset, manifest, artifact 모델
```

### 이 파일을 수정해야 할 때
- **새로운 화면(URL)을 만들고 싶을 때**: `src/pages/`에 페이지 컴포넌트를 추가하고 `src/app/router.tsx`에 경로를 연결합니다.
- **모든 화면에서 공유되는 셸을 바꿀 때**: `src/app/App.tsx` 또는 `src/app/router.tsx`의 App Shell을 수정합니다.
- **기능별 API/상태/UI를 바꿀 때**: 해당 `src/features/<feature>/` 아래에서 작업합니다.

## SPA 및 개발 가이드

### Vite + React Router 기초 (초보자용)
- `main.tsx`: 브라우저의 `#root`에 애플리케이션을 마운트하는 시작점입니다.
- `App.tsx`: 전체 앱을 감싸고 `RouterProvider`를 연결하는 파일입니다.
- `router.tsx`: 브라우저 경로와 페이지 컴포넌트를 연결하는 라우팅 설정 파일입니다.
- `src/pages/*.tsx`: 실제 화면 단위 페이지입니다.
- `src/features/*`: 특정 기능의 API, UI, 상태를 묶어 관리하는 폴더입니다.

### 새 페이지 추가하는 방법
1. `src/pages/` 아래에 새 페이지 컴포넌트를 만듭니다.
2. `src/app/router.tsx`에 해당 페이지를 경로와 함께 등록합니다.
3. 브라우저에서 `localhost:5173`의 해당 경로로 접속하여 확인합니다.

### State Model 설명
사용자가 작업을 시작하면 데이터는 다음 순서로 상태가 변합니다:

```mermaid
stateDiagram-v2
    [*] --> Draft: 수정 중
    Draft --> Build_Run: 실행 버튼 클릭
    Build_Run --> Published: 검증 및 전송 완료
    Build_Run --> Draft: 실패 시 수정
    Published --> [*]
```

- **Draft**: 사용자가 내용을 고치고 있는 상태입니다. (수정 중)
- **Build Run**: '실행' 버튼을 눌러 실제로 데이터를 모으는 중입니다.
- **Published**: 모든 검증을 마치고 결과물이 공유된 상태입니다.

---

## 관련 문서

### 이 저장소 내 문서
| 문서 | 설명 |
| :--- | :--- |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 기여 가이드 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 시스템 아키텍처 |
| [STATE_MODEL.md](./STATE_MODEL.md) | 상태 관리 모델 |
| [UI_SPEC.md](./UI_SPEC.md) | UI 디자인 규격 |
| [USER_FLOWS.md](./USER_FLOWS.md) | 사용자 흐름도 |
| [INFORMATION_ARCHITECTURE.md](./INFORMATION_ARCHITECTURE.md) | 정보 구조 설계 |
| [API_CONTRACT.md](./API_CONTRACT.md) | API 연동 규약 |
| [PRD.md](./PRD.md) | 제품 요구사항 |
| [ROADMAP.md](./ROADMAP.md) | 개발 로드맵 |

### KPubData Product Family
| 저장소 | 문서 | 설명 |
| :--- | :--- | :--- |
| [kpubdata](https://github.com/yeongseon/kpubdata) | [AGENTS.md](https://github.com/yeongseon/kpubdata/blob/main/AGENTS.md) | Core 에이전트 가이드 |
| [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) | [AGENTS.md](https://github.com/yeongseon/kpubdata-builder/blob/main/AGENTS.md) | Builder 에이전트 가이드 |
