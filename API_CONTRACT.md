# API 규약 — KPubData Studio

## 1. 역할

Studio는 Builder HTTP API의 소비자입니다. HTTP wire 계약의 단일 소스는 Builder 저장소의 [contract/builder-api.yaml](https://github.com/kpubdata-lab/kpubdata-builder/blob/main/contract/builder-api.yaml)입니다.

이 문서는 endpoint와 response body를 다시 적지 않고, Studio가 Builder 계약을 소비할 때 필요한 클라이언트 경계만 기록합니다.

- Builder endpoint/status/schema 변경은 Builder OpenAPI SSOT에서 시작합니다.
- Studio는 `src/shared/lib/builderApi.ts`와 `src/shared/lib/builderApi.schema.ts`에서 OpenAPI wire shape를 런타임 검증합니다.
- `MIN_BUILDER_API_VERSION`(SemVer 호환성 판정의 기준)과 지원 operation 집합은 `__tests__/contractConformance.test.ts`가 고정합니다.
- 사용자 화면은 page에서 직접 HTTP를 호출하지 않고 feature API를 통해 Builder를 사용합니다.

## 2. Studio 클라이언트 계층

```mermaid
graph LR
    Page[pages/*] --> Feature[features/*/api]
    Feature --> Client[src/shared/lib/builderApi.ts]
    Client --> Schema[src/shared/lib/builderApi.schema.ts]
    Client --> Builder[Builder OpenAPI SSOT]
```

| 계층 | 파일 | 책임 |
| :--- | :--- | :--- |
| 저수준 HTTP 클라이언트 | `src/shared/lib/builderApi.ts` | Builder URL, 인증 헤더, timeout/retry, `ApiError`, 최소 버전/SemVer 호환성 |
| wire schema | `src/shared/lib/builderApi.schema.ts` | Builder JSON 응답 Zod parse |
| BuildSpec 매핑 | `src/features/build-spec/specMapping.ts` | Studio camelCase model ↔ Builder snake_case spec |
| Preview API | `src/features/preview/api/index.ts` | `/preview` 응답을 UI용 rows/schema/warnings로 변환 |
| Validation API | `src/features/validation/api/index.ts` | Builder validation 결과를 폼 오류로 변환 |
| Runs API | `src/features/runs/api/index.ts` | build 실행과 run history 변환 |
| Artifacts API | `src/features/artifacts/api/index.ts` | artifact/manifest 조회 결과 변환 |

## 3. 계약 버전과 정합성

Studio는 `GET /version` 응답의 `api_version`을 `MIN_BUILDER_API_VERSION`과 **SemVer 호환성**
규칙(Builder ADR 0013)으로 비교해 설정 화면에 경고를 표시합니다. exact-equality 비교가
아닙니다.

호환성 규칙 (`isBuilderApiCompatible`):

1. `server major == required major` (major가 다르면 breaking — 비호환).
2. `server >= required` (같은 major 안에서 minor/patch가 최소값 이상).
3. 더 높은 additive minor/patch는 호환으로 간주합니다 (예: 최소값 1.96.0에 대해 Builder
   1.105.0은 호환).
4. 파싱 불가/형식 오류인 버전 문자열은 fail-closed로 비호환 처리합니다.

### 애플리케이션 버전 — 짝 판정 (#430)

`api_version` 과 **별개로**, `GET /version` 이 `version`(애플리케이션 릴리스)을 주면
Studio 는 자기 빌드 버전(`package.json` → `import.meta.env.VITE_APP_VERSION`)과 비교합니다.
Builder 와 Studio 는 같은 버전으로 나가므로(kpubdata ADR 0004) 표 없이 한 번의 비교로 끝납니다.

| 차이 | 동작 |
|---|---|
| 같음 | 없음 |
| patch 만 다름 | 조용히 통과, `console.info` 한 줄 |
| minor·major 다름 | 앱 셸 상단 배너 한 줄 — 막지 않는다 |
| `version` 없음·해석 불가·요청 실패 | 없음 — 모르는 것은 다른 것이 아니다 |

계약 버전은 Studio 가 **무엇을 기대해도 되는지**, 애플리케이션 버전은 **같은 릴리스에서
나왔는지** 말합니다. 전자는 기능 판정, 후자는 짝 판정입니다.

`MIN_BUILDER_API_VERSION`(현재 **1.96.0**)은 기억한 값이 아니라 **측정한 값**입니다
(#725, #790). `npm run contract:floor -- --builder-root ../kpubdata-builder` 는 Builder
체크아웃의 `contract/builder-api.yaml` 이력에 있는 계약 버전마다 Studio 의 드리프트 테스트
(`src/shared/lib/contractDrift.test.ts`)를 최신부터 돌리고, 통과하는 가장 오래된 버전을
하한으로 보고합니다. 상수가 하한보다 낮으면 exit 1 입니다. 드리프트 테스트는 두 가지를
봅니다: `builderApi` 가 부르는 모든 method·path 가 그 계약에 선언돼 있는지, 그리고 그
계약이 허용하는 모든 응답을 Studio 스키마가 읽는지.

**필수 — 없으면 화면이 동작하지 않는 것.** 하한을 정하는 것은 라우트입니다. 1.59.0 뒤에
생긴 라우트와 처음 선언된 계약 버전(2026-10-07, Builder `main` 1.105.0 이력에서 측정):

| client 함수 | operation | 최초 계약 |
|---|---|---|
| `getRevision` · `saveRevision` · `getRevisionHistory` · `revertRevision` | `/revisions/{kind}/{doc_id}` … | 1.59.0 |
| `downloadArtifactFile` | `GET /artifacts/{run_id}/{path}` | 1.65.0 |
| `resetPublishReceipt` · `reconcilePublish` | `DELETE /builds/{run_id}/publish/receipt` · `POST …/publish/reconcile` | 1.81.0 |
| `probeProviderKey` | `POST /providers/{provider}/probe` | 1.87.0 |
| `listUploads` | `GET /uploads` | **1.96.0** |

**선택 — 더 오래된 Builder 에서도 화면이 동작하는 것.** 아래는 하한보다 새 계약이 처음
보낸 필드나 처음 선언한 헤더지만, 없을 때의 동작이 정해져 있어 하한을 올리지 않습니다.
여기 넣을 때는 "없을 때" 칸을 코드와 테스트로 확인합니다.

| 기능 | 최초 계약 | 없을 때 |
|---|---|---|
| `GET /providers` 의 `key_provider` (`providerKeys.ts`) | 1.98.0 | 어느 provider 의 키를 쓰는지 모르므로, 필요한 것만 고르지 않고 가진 키를 모두 보낸다 (#770 의 폴백). 요청은 실패하지 않는다 |
| 그 밖에 스키마 주석이 "absent from an older Builder" 로 적은 응답 필드 | 각 주석 | 스키마가 optional 로 받고 화면이 생략한다 |

하한보다 오래된 operation 을 위한 분기(`RUN_LOOKUP_API_VERSION` 1.31.0, #482)는 지원하는
Builder 에서는 더 이상 걸리지 않습니다.

**판정 결과와 안내** (`builderApiCompatibility`) — 해결 방법이 다르므로 이유를 나눕니다.

| 이유 | 조건 | 배너 (`data-version-check`) | 안내 |
|---|---|---|---|
| `too_old` | 같은 major, 하한 미만 | `contract-too-old` | Builder 를 업데이트 |
| `unsupported_major` (Builder 가 더 새 major) | major 가 다름 | `contract-major` | 이 Builder 와 같은 릴리스의 Studio 로 업데이트 |
| `unsupported_major` (Builder 가 더 옛 major) | major 가 다름 | `contract-major` | Builder 를 업데이트 |
| `unreadable` | 버전 없음·`major.minor.patch` 아님 | `contract-unreadable` | Builder 를 업데이트 — fail-closed |

Settings 는 같은 이유로 연결 옆에 한 줄을 보여 줍니다.

정합성 규칙:

1. `MIN_BUILDER_API_VERSION`은 Studio가 실제로 호출·검토한 operation이 요구하는 최소
   버전만 가리킵니다.
2. Builder operation이 추가/삭제되면 Studio 클라이언트 구현과
   `contractConformance.test.ts`를 함께 갱신합니다.
3. 문서만 바꿔서 계약 drift를 덮지 않습니다.

## 4. BuildSpec 매핑 원칙

Studio UI model은 편집 편의상 camelCase를 사용하고, Builder는 YAML/snake_case BuildSpec을 받습니다.

| Studio 관심사 | Builder 관심사 | 원칙 |
| :--- | :--- | :--- |
| `datasetId` | `dataset_id` | 직렬화 경계에서만 변환 |
| `sources[].params` | JSON-compatible params | 문자열로 축소하지 않고 JSON 값을 보존 |
| `sources[].schema` | source schema contract | 편집 왕복에서 손실하지 않음 |
| `exports[].format` | exporter `kind` | Builder catalog/contract 밖의 open kind도 보존 |
| output path | `output_path` / metadata | 명시 경로 우선, 파생 경로는 충돌 없이 생성 |

Builder 데이터 수집/정규화 로직은 Studio에 재구현하지 않습니다. Studio는 기획서 작성, 검증 결과 표시, preview/render 상태 관리만 담당합니다.

## 5. Mock 모드

`VITE_USE_REAL_BUILDER=true`가 아니면 Studio feature API는 결정적 mock 결과를 반환합니다.

mock 정책:

- 화면 개발과 회귀 테스트가 Builder 서버 없이 동작해야 합니다.
- mock은 Builder 로직을 재구현하지 않고 UI 상태를 검증할 만큼의 고정 데이터만 제공합니다.
- 실연동 전용 wire shape는 Zod schema와 API tests로 고정합니다.
- mock/real 분기는 feature API 내부에 머물러야 하며 page 컴포넌트가 직접 환경변수를 해석하지 않습니다.

## 6. 오류 표시 원칙

Studio는 HTTP 실패와 정상 응답 안의 source-level 실패를 구분합니다.

| 상황 | Studio 처리 |
| :--- | :--- |
| 네트워크/인증/비정상 HTTP 실패 | `ApiError` 기반 오류 상태 표시 |
| `/preview` 전체 source 실패 | source key와 error를 포함한 preview 오류 표시 |
| `/preview` 일부 source 실패 | 성공 preview rows/schema와 함께 source warning 표시 |
| 정상 0-row preview | 빈 데이터 안내 표시 |
| `/build` source 실패 | `outcomes[]` 실패 이유를 사용자에게 표시 |

정상 0-row와 source/fetch 실패를 같은 empty state로 합치지 않습니다.

## 7. 관련 문서

| 문서 | 역할 |
| :--- | :--- |
| [Builder OpenAPI SSOT](https://github.com/kpubdata-lab/kpubdata-builder/blob/main/contract/builder-api.yaml) | HTTP wire 계약 단일 소스 |
| [Builder API_CONTRACT.md](https://github.com/kpubdata-lab/kpubdata-builder/blob/main/API_CONTRACT.md) | Builder 운영/정책 가이드 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Studio 구조 |
| [STATE_MODEL.md](./STATE_MODEL.md) | UI 상태 흐름 |
| [USER_FLOWS.md](./USER_FLOWS.md) | 사용자 흐름 |
