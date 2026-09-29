# 상태 모델 — KPubData Studio

## "상태(State)란 무엇인가요?" (초보자용 설명)

상태는 애플리케이션 안의 데이터가 현재 처해 있는 **상황**입니다.

- **비유**: "식당에서 주문하는 과정과 비슷합니다. 메뉴판을 보며 고르는 중(**Draft**) → 주문을 넣음(**Build Run**) → 음식이 서빙됨(**Publish**)"
- 사용자의 행동(클릭, 입력)에 따라 상태가 변하고, 상태가 변하면 화면에 보이는 내용도 달라집니다.

---

## 1. Draft 상태 (편집 중인 상태)

사용자가 빌드 설정을 만들거나 수정하고 있는 임시 저장 단계입니다. 아직 실제로 데이터를 가져오지는 않습니다.

### 상태 목록
- `new`: 방금 새로 만든 깨끗한 상태
- `dirty`: 내용이 수정되었지만 아직 검증되지 않은 상태
- `validated`: 모든 설정값이 올바른지 확인(검증)을 마친 상태
- `invalid`: 설정값에 오류가 있어 수정이 필요한 상태

### 상태 전이 흐름

```mermaid
stateDiagram-v2
    [*] --> new
    new --> dirty: 내용 수정
    dirty --> validated: 검증 성공
    dirty --> invalid: 검증 실패 (오류 발견)
    invalid --> dirty: 내용 수정
    validated --> dirty: 다시 수정
    validated --> [*]
```

### 사용자의 행동과 UI 반응
- **수정 중일 때**: "저장" 버튼이 활성화됩니다.
- **검증 완료 시**: "빌드 실행" 버튼이 활성화됩니다.
- **오류 발생 시**: 화면 상단에 붉은색 에러 메시지가 표시됩니다.

---

## 2. Build Run 상태 (빌드 실행 중인 상태)

'빌드 실행' 버튼을 눌러 실제로 데이터를 수집하고 파일을 만드는 과정의 상태입니다.

### 상태 목록
- `queued`: 대기열에서 차례를 기다리는 중
- `running`: 실제로 데이터를 수집하고 처리하는 중
- `succeeded`: 모든 데이터 처리가 성공적으로 완료됨
- `failed`: 작업 도중 오류가 발생하여 중단됨
- `cancelled`: 사용자가 수동으로 작업을 멈춤

### 상태 전이 흐름

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> running: 빌드 실행 시작
    running --> succeeded: 처리 성공
    running --> failed: 처리 중 오류
    running --> cancelled: 사용자 취소
    succeeded --> [*]
    failed --> queued: 재시도
    cancelled --> [*]
```

### 사용자의 행동과 UI 반응
- **실행 중**: 실시간 로그 화면이 보이며, "취소" 버튼을 누를 수 있습니다.
- **성공 시**: 결과 파일 목록이 보이고, "미리보기"가 가능해집니다.
- **실패 시**: 어떤 단계에서 오류가 났는지 로그를 확인할 수 있습니다.

---

## 3. Publish 상태 (출판/공유 상태)

빌드 완료된 결과물을 다른 사람에게 공유하거나 외부 저장소(예: HuggingFace)로 보내는 단계입니다.

### 상태 목록
- `not_started`: 출판 준비 전
- `ready`: 출판 가능한 상태 (빌드 성공 후)
- `publishing`: 데이터를 외부로 전송 중
- `published`: 전송이 완료되어 공개된 상태
- `publish_failed`: 전송 도중 오류 발생

### 상태 전이 흐름

```mermaid
stateDiagram-v2
    [*] --> not_started
    not_started --> ready: 빌드 성공
    ready --> publishing: 출판 버튼 클릭
    publishing --> published: 전송 완료
    publishing --> publish_failed: 전송 오류
    publish_failed --> ready: 재시도
    published --> [*]
```

---

## 4. 전체 생명주기

Draft부터 시작하여 Build Run을 거쳐 Publish까지 이르는 전체 흐름입니다.

```mermaid
stateDiagram-v2
    state "Draft Phase" as Draft {
        [*] --> Edit: 수정 중
        Edit --> Validated: 검증 완료
    }

    state "Build Phase" as Build {
        [*] --> Queued: 빌드 대기
        Queued --> Running: 실행 중
        Running --> Succeeded: 성공
    }

    state "Publish Phase" as Publish {
        [*] --> Ready: 출판 준비
        Ready --> Publishing: 전송 중
        Publishing --> Published: 공개 완료
    }

    [*] --> Draft
    Draft --> Build: 빌드 실행 클릭
    Build --> Publish: 결과 확인 완료
    Publish --> [*]
    
    Build --> Draft: 실패 시 수정
```

---

## 5. 상태 분리 원칙 (Form / Server / UI / Draft)

Studio는 한 화면에서 여러 종류의 상태를 동시에 다룹니다. 서로 다른 책임을 섞지 않기 위해 아래처럼 분리합니다.

| 상태 종류 | 소유 위치 | 예시 | 원칙 |
| :--- | :--- | :--- | :--- |
| **Form State** | 페이지/기능 폼 | 입력 중인 provider, dataset, params | 사용자가 타이핑하는 즉시 변하는 값 |
| **Draft State** | Studio 로컬 초안 | 아직 저장되지 않은 빌드 기획 전체 | 여러 Form State를 모아 편집 세션으로 유지 |
| **Server State** | Builder API 응답 | preview 결과, 빌드 outcomes, manifest, artifacts 목록 | 네트워크로부터 동기화되며 서버가 기준 |
| **UI State** | 화면 제어 상태 | 선택된 탭, 필터, 모달 열림 여부, 정렬 기준 | 표현 방식만 결정하며 도메인 의미를 소유하지 않음 |

```mermaid
graph TD
    Form[Form State] --> Draft[Draft State]
    Draft --> Validation[Validation Request]
    Validation --> Server[Server State]
    UI[UI State] --> Form
    UI --> Server
```

### 분리 규칙
- Form State는 입력 컴포넌트와 가장 가깝게 둡니다.
- Draft State는 페이지 이동이나 단계 전환에도 유지되어야 하는 편집 세션입니다.
- Server State는 Builder API 결과를 캐시/표시하는 데 사용합니다.
- UI State는 탭, 필터, 펼침 상태처럼 화면 표현 전용 값만 담습니다.
- UI/draft 상태는 Zustand로 관리합니다.
- TanStack Query는 `QueryClientProvider`가 마운트되어 준비(provisioned)되어 있으나, 현재 `useQuery`/`useMutation` 훅은 사용되지 않습니다. 서버 상태(Builder API 응답) 채택은 진행 중(in progress)입니다.

### 왜 분리하나요?
- 검증 실패가 곧바로 사용자의 입력값 자체를 덮어쓰지 않게 하기 위해
- 서버 응답 지연이 로컬 편집 경험을 망치지 않게 하기 위해
- 같은 Draft를 여러 화면 패널이 공유하되, 각 패널의 UI 상태는 독립적으로 유지하기 위해

---

## 6. "상태와 UI의 관계" 요약

상태는 사용자가 지금 무엇을 해야 하는지, 무엇을 할 수 있는지를 결정하는 **지침**이 됩니다.

| 현재 상태 | UI에서 보여줄 모습 | 가능한 주요 버튼 |
| :--- | :--- | :--- |
| `dirty` | "저장되지 않은 변경사항이 있습니다." | [저장], [검증] |
| `invalid` | 오류 목록 표시 (붉은색) | [수정 필요] |
| `running` | 진행률 표시바 (Progress Bar) | [취소] |
| `succeeded` | "빌드가 완료되었습니다!" | [미리보기], [출판] |
| `published` | 공유 링크 (URL) 표시 | [링크 복사] |

---

## 관련 문서

### 이 저장소 내 문서
| 문서 | 설명 |
| :--- | :--- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 시스템 아키텍처 설계 |
| [UI_SPEC.md](./UI_SPEC.md) | UI 컴포넌트 규격 |
| [USER_FLOWS.md](./USER_FLOWS.md) | 사용자 시나리오 및 흐름 |
| [API_CONTRACT.md](./API_CONTRACT.md) | API 통신 규약 |

### KPubData Product Family
| 저장소 | 문서 | 설명 |
| :--- | :--- | :--- |
| [kpubdata](https://github.com/yeongseon/kpubdata) | [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata/blob/main/ARCHITECTURE.md) | KPubData 아키텍처 |
| [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) | [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata-builder/blob/main/ARCHITECTURE.md) | Builder 아키텍처 |
