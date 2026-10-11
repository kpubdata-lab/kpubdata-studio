# Ask KPubData 가 외부 AI 제공자에게 보내는 것

Ask KPubData 는 사용자의 질문에 답하려고, 사용자가 넣은 LLM API 키(BYOK)로 외부 AI 제공자의
`/chat/completions` 에 요청을 한 번 보낸다(#798). 이 문서는 그 요청에 **무엇이 들어가는지**를
코드에서 옮긴 사실 목록이다.

- 법적 근거, 고지·동의 문구, 위탁·제3자 제공·국외 이전 분류는 이 문서가 정하지 않는다. 화면의
  안내 문구도 법률 검토 전까지 자리만 두었다(`assistant.egress.disclosurePendingReview`).
- 비밀 값 가리기(scrubber)를 통과했다는 것은 익명화도, 법적으로 보내도 된다는 뜻도 아니다.
  키 이름(`*key`, `*token`, `*secret`)과 길고 무작위해 보이는 문자열만 휴리스틱으로 가린다.
- 이 목록은 `__tests__/assistantEgressInventory.test.ts` 가 지킨다. 테스트는 실제 근거 수집기,
  프롬프트, provider 를 돌려 `fetch` 에 닿은 요청을 필드 경로로 나누고, 아래 표의 경로와 하나라도
  다르면 실패한다. 요청에 필드를 더하거나 빼는 변경은 이 표를 같은 PR 에서 고쳐야 한다.

## 배포에서 끄고 켜기

| 어디서 | 기본 | 켜는 방법 |
|---|---|---|
| 컨테이너 이미지(호스팅 배포) | **꺼짐.** 외부 AI 제공자로 아무것도 보내지 않는다 | `ASSISTANT_ENABLED=true` 와 `ASSISTANT_ALLOWED_ORIGINS`(허용할 https origin, 공백으로 구분) |
| `npm run dev`, GitHub Pages 데모 | 켜짐(사용자가 정한 https 주소) | — |

- 컨테이너는 시작할 때 `config.js` 에 `assistantEnabled`, `assistantAllowedOrigins` 를 쓴다
  (`docker/40-kpubdata-config.sh`). `ASSISTANT_ENABLED=true` 인데 허용 목록이 비어 있거나,
  목록에 https origin 이 아닌 값이 있으면 컨테이너는 이유를 남기고 시작하지 않는다.
- 꺼져 있으면 Ask 화면은 키를 묻지 않고 꺼져 있다는 안내만 보이며, 질문을 보내도 근거 수집과
  요청을 하지 않는다. 요청을 보내는 단 한 곳(`provider.ts` 의 transport)도 같은 스위치를 다시 본다.
  테이블 만들기와 SQL 은 영향을 받지 않는다.
- 켜져 있으면 사용자가 정한 base URL 의 origin 이 허용 목록에 있어야 한다. 없으면 설정 화면이
  이유를 보이고 요청을 보내지 않는다.
- 컨테이너가 보내는 CSP 의 `connect-src` 에는 `https:` 가 없다. Builder, OIDC 발급자, 허용한 AI
  origin 만 이름으로 들어간다. 그래서 브라우저도 그 밖의 https 호스트로의 연결을 막는다.
  `frame-src` 는 무음 SSO 때문에 아직 `https:` 를 둔다(CHANGELOG 의 kpubdata-builder#1107 항목).
- 어떤 제공자를 허용할지는 운영자의 결정이며, 이 저장소는 기본 허용 목록을 두지 않는다.

## 요청 필드 목록

"담길 수 있는 것" 열은 그 필드가 어디서 오는지에 따른 가능성이다. 개인정보·비밀·기밀인지의 판단은
아니다.

<!-- inventory:start -->

| 경로 | 내용 | 출처 | 담길 수 있는 것 |
|---|---|---|---|
| `url` | `<base URL>/chat/completions` | 사용자 설정 또는 기본값 `https://api.openai.com/v1` | 없음 |
| `header.Authorization` | `Bearer <사용자 LLM API 키>` | 사용자 입력 | **비밀 값**: 사용자 본인의 키. 제공자에게 그대로 간다 |
| `header.Content-Type` | `application/json` | 고정 | 없음 |
| `body.model` | 모델 이름 | 사용자 입력(기본 `gpt-4o-mini`) | 없음 |
| `body.stream` | `true` | 고정 | 없음 |
| `body.messages[0].role` | `system` | 고정 | 없음 |
| `body.messages[0].content` | 시스템 프롬프트 | 고정(`prompt.ts`) | 없음 |
| `body.messages[1].role` | `user` | 고정 | 없음 |
| `body.messages[1].content` | 화면 문맥 한 줄(`page`, `datasetId`, `runId`, `stage`, `source`, `provider`), 조회 실패 목록, 그 뒤에 아래 `evidence.*` 를 JSON 으로 | 화면 주소, Builder | 아래 `evidence.*` 와 같음 |
| `body.messages[2].role` | `user` | 고정 | 없음 |
| `body.messages[2].content` | 사용자 질문 | 사용자 입력 | **사용자가 쓴 그대로.** 개인정보나 기밀을 적으면 그대로 간다. 길고 무작위해 보이는 문자열만 가려진다 |
| `evidence.fetchedAt` | 근거 수집 시각 | Studio | 없음 |
| `evidence.partial` | 일부 조회 실패 여부 | Studio | 없음 |
| `evidence.unavailable[]` | 조회에 실패한 근거 종류 | Studio | 없음 |
| `evidence.context.page` | 화면 이름 | 화면 주소 | 없음 |
| `evidence.context.datasetId` | 테이블 id | 화면 주소 | 사용자가 지은 이름 |
| `evidence.context.runId` | 실행 id | 화면 주소 | 없음 |
| `evidence.context.stage` | `bronze`/`silver`/`gold` | 화면 주소 | 없음 |
| `evidence.context.source` | 소스 키 | 화면 주소 | 없음 |
| `evidence.context.provider` | 제공자 이름 | 화면 주소 | 없음 |
| `evidence.context.qualityResultIds[]` | 품질 결과 id | 화면 주소 | 컬럼 이름 |
| `evidence.dataset.datasetId` | 테이블 id | Builder | 사용자가 지은 이름 |
| `evidence.dataset.title` | 테이블 제목 | Builder | **사용자가 쓴 글** |
| `evidence.dataset.providers[]` | 제공자 이름 | Builder | 없음 |
| `evidence.dataset.sources[].provider` | 제공자 이름 | Builder | 없음 |
| `evidence.dataset.sources[].dataset` | 원천 데이터셋 이름 | Builder | 없음 |
| `evidence.dataset.latestRunId` | 최근 실행 id | Builder | 없음 |
| `evidence.dataset.status` | 테이블 상태 | Builder | 없음 |
| `evidence.dataset.updatedAt` | 갱신 시각 | Builder | 없음 |
| `evidence.dataset.totalRowCount` | 행 수 | Builder | 업무 규모(기업 기밀일 수 있음) |
| `evidence.recentRuns[].runId` | 최근 실행 id(최대 10) | Builder | 없음 |
| `evidence.recentRuns[].status` | 실행 상태 | Builder | 없음 |
| `evidence.recentRuns[].startedAt` | 시작 시각 | Builder | 작업 시각 |
| `evidence.recentRuns[].finishedAt` | 종료 시각 | Builder | 작업 시각 |
| `evidence.stage.refId` | 실행·소스·단계 id | Studio | 없음 |
| `evidence.stage.stage` | 단계 | Builder | 없음 |
| `evidence.stage.source` | 소스 키 | Builder | 없음 |
| `evidence.stage.status` | 단계 상태 | Builder | 없음 |
| `evidence.stage.available` | 결과 유무 | Builder | 없음 |
| `evidence.stage.rowCount` | 행 수 | Builder | 업무 규모 |
| `evidence.stage.columns[]` | 컬럼 이름 | Builder | **컬럼 이름.** 업로드 파일이면 사용자가 정한 이름이다 |
| `evidence.stage.schema[].name` | 컬럼 이름 | Builder | 위와 같음 |
| `evidence.stage.schema[].dtype` | 컬럼 형식 | Builder | 없음 |
| `evidence.quality.availability` | 품질 결과 유무 | Builder | 없음 |
| `evidence.quality.evaluatedChecks` | 평가한 규칙 수 | Builder | 없음 |
| `evidence.quality.results[].id` | 품질 결과 id | Studio | 컬럼 이름 |
| `evidence.quality.results[].source` | 소스 키 | Builder | 없음 |
| `evidence.quality.results[].category` | 규칙 분류 | Builder | 없음 |
| `evidence.quality.results[].rule` | 규칙 이름 | Builder | 없음 |
| `evidence.quality.results[].column` | 컬럼 이름 | Builder | 컬럼 이름 |
| `evidence.quality.results[].status` | `pass`/`warn`/`fail` | Builder | 없음 |
| `evidence.quality.results[].actual` | 측정값 | Builder | Builder 가 정하는 값. 데이터의 값을 인용하는지는 확인 못 함 |
| `evidence.quality.results[].threshold` | 기준값 | Builder | 위와 같음 |
| `evidence.quality.results[].detail` | 설명 문장 | Builder | 위와 같음 |
| `evidence.quality.schemaDrift[].kind` | 스키마 변화 종류 | Builder | 없음 |
| `evidence.quality.schemaDrift[].column` | 컬럼 이름 | Builder | 컬럼 이름 |
| `evidence.quality.schemaDrift[].detail` | 설명 문장 | Builder | 확인 못 함(위와 같음) |
| `evidence.catalog.providers[]` | 카탈로그 제공자 이름 | Builder | 없음 |
| `evidence.catalog.datasetsByProvider.*[]` | 제공자별 데이터셋 이름 | Builder | 없음 |
| `evidence.buildSpecSummary.title` | 이 브라우저에 저장된 BuildSpec 제목 | 브라우저 저장소 | **사용자가 쓴 글** |
| `evidence.buildSpecSummary.description` | BuildSpec 설명 | 브라우저 저장소 | **사용자가 쓴 글** |
| `evidence.buildSpecSummary.sources[].provider` | 제공자 이름 | 브라우저 저장소 | 없음 |
| `evidence.buildSpecSummary.sources[].dataset` | 원천 데이터셋 이름 | 브라우저 저장소 | 없음 |
| `evidence.buildSpecSummary.sources[].alias` | 소스 별칭 | 브라우저 저장소 | 사용자가 지은 이름 |
| `evidence.buildSpecSummary.sources[].paramKeys[]` | 요청 파라미터 **이름**(값은 보내지 않음) | 브라우저 저장소 | 없음 |
| `evidence.buildSpecSummary.exportFormats[]` | 내보내기 형식 | 브라우저 저장소 | 없음 |
| `evidence.buildSpecSummary.metadataKeys[]` | 메타데이터 **키**(값은 보내지 않음) | 브라우저 저장소 | 사용자가 지은 이름 |
| `evidence.deepLinks.datasetDetail` | Studio 안 주소 | Studio | 없음 |
| `evidence.deepLinks.qualityCenter` | Studio 안 주소 | Studio | 없음 |
| `evidence.deepLinks.buildDetail` | Studio 안 주소 | Studio | 없음 |

<!-- inventory:end -->

## 보내지 않는 것 (테스트가 확인)

- 단계의 **샘플 행.** Builder 가 단계 상세와 함께 돌려주지만 근거에 넣지 않는다. 테스트는 샘플 행에
  canary 값을 넣고 요청 어디에도 없음을 확인한다.
- BuildSpec 의 요청 파라미터 **값**과 메타데이터 **값**(이름만 간다). 테스트가 canary 로 확인한다.
- 꺼진 배포에서는 아무것도 보내지 않는다. `__tests__/assistantEgressCanary.test.tsx` 가 질문, 키,
  식별자에 canary 를 넣고 AI 호스트로의 `fetch` 가 0건임을 확인한다. 허용 목록에 없는 주소도 같다.

## 확인 못 한 것

- 품질 결과의 `actual`, `threshold`, `detail` 과 스키마 변화의 `detail` 이 데이터의 실제 값을
  인용하는지는 Builder 쪽 코드에 달려 있어 여기서 확인하지 못했다.
- 사용자 질문에는 아무것이나 들어갈 수 있다. 전송 전 확인 화면은 아직 없다.
