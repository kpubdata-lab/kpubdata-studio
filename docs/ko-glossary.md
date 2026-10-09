# 화면 용어집

한국어 화면에서 쓰는 낱말을 정해 둔 표입니다 (#843). 한국어 문장 안에 영어 낱말이 섞이면 읽는 사람이 내부 용어를 알아야 뜻을 짐작할 수 있습니다. 아래 표에 있는 낱말은 한국어 문자열에서 영어로 쓰지 않습니다.

표의 정본은 `scripts/ko-mixed-terms.mjs` 의 `KO_GLOSSARY` 입니다. 낱말을 더하거나 바꿀 때는 그 표와 이 문서를 함께 고칩니다. `__tests__/koMixedTerms.test.ts` 가 둘이 같은지 확인합니다.

## 한국어로 쓰는 낱말

| 영어 | 한국어 화면 |
|---|---|
| run | 실행 |
| provider | 제공자 |
| source | 소스 |
| stage | 단계 |
| credential | 자격 증명 |
| quality | 품질 |
| preview | 미리보기 |
| evidence | 근거 |
| event | 이벤트 |
| timeline | 타임라인 |
| snapshot | 스냅샷 |
| schema | 스키마 |
| query | 쿼리 |
| catalog | 카탈로그 |
| manifest | 매니페스트 |
| destination | 게시 위치 |

## 영어 그대로 쓰는 낱말

- 제품과 형식의 이름: KPubData, Builder, Studio, BuildSpec, Ask KPubData
- 널리 쓰는 약어: API, ID, SQL, URL, JSON, YAML, LLM, AI, HTTPS, OIDC
- 데이터 단계의 이름: Bronze, Silver, Gold

## 코드는 라벨로 보여 줍니다

Builder 가 돌려주는 상태와 이벤트 코드(`not_run`, `run_submitted`, `ok`)는 화면에 그대로 내보내지 않습니다. `src/shared/i18n/codeLabels.ts` 가 계약에 있는 코드를 `codes.*` 라벨로 바꾸고, 계약에 없는 새 코드는 Builder 가 보낸 그대로 보여 줍니다. Studio 가 본 적 없는 값에 낱말을 지어내지 않기 위해서입니다.

## 검사

`npm run i18n:terms` 가 두 가지를 봅니다.

1. 위 표의 낱말을 영어로 쓴 한국어 문자열: 경고입니다. CI 는 `::warning::` 으로 표시하고 실패시키지 않습니다. 필드 이름을 인용하는 경우처럼 일부러 영어로 둔 곳이 있을 수 있기 때문입니다.
2. 사용자 문자열 안의 이슈 번호(`(#488)`): 실패입니다. 기준선은 0 입니다. 사용자는 #488 이 무엇인지 알 수 없습니다.

`{{변수}}`, `` `코드` ``, `<태그>`, URL 은 읽지 않습니다. `_`, `.`, `/`, `[`, `-` 에 붙은 낱말(`run_id`, `sources[0]`)은 코드나 경로의 일부로 보고 세지 않습니다.
