# 시각 정체성 (Visual Identity)

> 이 문서는 KPubData Studio 화면이 따르는 시각 규칙이다 (#425). 이름과 용어는
> kpubdata 의 [BRAND.md](https://github.com/yeongseon/kpubdata/blob/main/docs/brand/BRAND.md) ·
> [TERMINOLOGY.md](https://github.com/yeongseon/kpubdata/blob/main/docs/brand/TERMINOLOGY.md) 가 정하고,
> 여기서는 **어떻게 보이는가**만 정한다. 토큰의 실제 값은
> [`docs/prototype/warehouse/tokens.css`](../prototype/warehouse/tokens.css) 에 있다.

## 1. 목표

**전문 데이터 도구처럼 보인다.** 상용 SaaS 랜딩도, 빌드 콘솔도 아니다. 판단 기준은 이슈의
검증 질문 여섯 가지이고, [프로토타입](#6-프로토타입) 이 그 질문에 답하는 시안이다.

## 2. Wordmark 와 lockup

| 규칙 | 내용 |
|---|---|
| Primary wordmark | **`KPubData`** — 제품군 이름이 주인공이다 |
| Suffix lockup | `Studio` 는 **작고 약하게** (굵기·크기·색 모두 한 단계 아래). `Studio` 가 `KPubData` 보다 강해 보이면 안 된다 |
| Dark / Light | 사이드바(다크 표면)는 흰 `KPubData` + `#94A3B8` `Studio`. 라이트 표면은 Charcoal `KPubData` + `#71717A` `Studio` |
| Minimum size | 심볼 16px, 가로 lockup 높이 20px. 그보다 작으면 심볼만 쓴다 |
| Clear space | 심볼 높이의 ½ 을 네 방향에 비운다 |
| 제품명 반복 금지 | 한 화면에 제품명은 **사이드바 로고 한 번**. topbar 는 현재 위치(breadcrumb) 를 쓴다 (#423) |

**현재 자산과의 차이 — 디자이너 작업이 필요하다.** `assets/logo/kpubdata-brand-assets` 의
승인 워드마크는 `Studio` 를 Indigo 로 강조한다. 이 규칙과 반대이지만, 그 README 가 로고
재디자인을 금지하므로 **자산을 여기서 고치지 않았다.** 프로토타입은 승인 **심볼**
(`symbol_dark.svg`) 옆에 텍스트로 lockup 을 조합해 규칙을 보여줄 뿐이다. 새 wordmark 벡터와
favicon · GitHub social preview · docs logo · app icon · README header 는 이 규칙으로 디자이너가
만든다.

## 3. 색

### 3.1 역할

| 역할 | 토큰 | 값 (light) | 쓰는 곳 |
|---|---|---|---|
| Brand primary | `--brand-primary` | `#5B5BD6` (Indigo) | 주요 버튼 · 선택된 탭 · 링크 강조 · SQL 키워드 |
| Brand ink | `--brand-ink` | `#18181B` (Charcoal) | wordmark |
| Data accent | `--data-accent` | `#818CF8` (Light Indigo) | 데이터 자체의 강조 — 막대 · 포커스된 컬럼 |
| Neutral surfaces | `--surface-*` · `--text-*` · `--border` | zinc 계열 | 바탕 · 카드 · 표 |

값은 승인 자산 README 의 공식 색에서 가져왔다. **다른 Indigo 나 Emerald 계열을 쓰지 않는다**
(같은 README).

### 3.2 상태 색 — 브랜드와 섞지 않는다

| 상태 | 토큰 | light | 의미 |
|---|---|---|---|
| Success | `--status-success` | `#15803D` | 성공 · Healthy · Complete · Available |
| Warning | `--status-warning` | `#B45309` | 주의 · Degraded · Key/Application required |
| Stale | `--status-stale` | = warning | 갱신 주기 초과 |
| Partial | `--status-partial` | = warning | 일부 지역·기간 누락 |
| Failure | `--status-failure` | `#B91C1C` | 실패 · Retired |
| Unknown | `--status-unknown` | `#52525B` | 모른다 — 0 도 실패도 아니다 |

- **모든 성공을 브랜드색으로 칠하지 않는다.** 그러면 Indigo 가 "성공" 을 뜻하게 된다. 상태
  토큰의 값은 브랜드 토큰의 값과 **달라야 한다** — `__tests__/visualTokensGate.test.ts` 가 검사한다.
- **Warning · Stale · Partial 은 같은 amber 여도 label 로 구분한다.** 배지는 항상 축과 단어를
  함께 쓴다(`Health Stale`, `Completeness Partial`). 색만으로 의미를 싣지 않는다.
- **상태 축은 합치지 않는다** (TERMINOLOGY 상태 어휘). Health · Completeness · Refresh · Access ·
  Maturity 는 각각 배지 하나다. Maturity 는 상태가 아니라서 중립색이다.
- **Dark mode 는 같은 의미 체계를 유지한다.** 값만 밝게 바뀌고 역할과 대응은 같다
  (`:root[data-theme="dark"]`).

## 4. 타이포그래피

| 용도 | 토큰 | 값 |
|---|---|---|
| Wordmark | — | Pretendard 700 |
| Page title | `--text-page-title` | 600 20/28 |
| Section title | `--text-section-title` | 600 14/20 |
| Body | `--text-body` | 400 14/20 |
| Table | `--text-table` | 400 13/18, 숫자는 `tabular-nums` · 오른쪽 정렬 |
| Metadata | `--text-meta` | 400 12/16 |
| Code / SQL | `--text-code` | 400 13/18 monospace |

**SQL 과 식별자는 언제나 monospace 다** — 테이블 이름, 컬럼, 스냅샷, run id:

```
housing.apartment_trade_monthly
region_id
snap_019
```

**큰 마케팅 헤딩을 쓰지 않는다.** 가장 큰 글자가 page title 20px 이다. 정보 밀도가 우선이다.

## 5. 밀도

- 표 행 높이 36px, 카드 간격 12px, 모서리 8px.
- 숫자를 모르면 `0` 이 아니라 `—` 로 쓴다. Partial 을 Complete 처럼 보이게 하지 않는다.
- 390px 폭에서 가로 스크롤이 없어야 한다. 넓은 표는 카드 안에서만 스크롤한다.

## 6. 프로토타입

코드를 전면 수정하기 전에 화면 다섯 개를 먼저 만들었다 (백로그 §27). 정적 HTML 이고
데이터는 예시다. 최종 브랜드 이름(`KPubData` · 카탈로그 · 테이블 · SQL Workspace · Ask KPubData)을 쓴다.

| 화면 | 파일 | 데스크톱 | 390px |
|---|---|---|---|
| Warehouse Home | [index.html](../prototype/warehouse/index.html) | ![](../prototype/warehouse/screens/index-desktop.png) | ![](../prototype/warehouse/screens/index-mobile.png) |
| Catalog | [catalog.html](../prototype/warehouse/catalog.html) | ![](../prototype/warehouse/screens/catalog-desktop.png) | ![](../prototype/warehouse/screens/catalog-mobile.png) |
| Tables | [tables.html](../prototype/warehouse/tables.html) | ![](../prototype/warehouse/screens/tables-desktop.png) | ![](../prototype/warehouse/screens/tables-mobile.png) |
| Table Detail | [table.html](../prototype/warehouse/table.html) | ![](../prototype/warehouse/screens/table-desktop.png) | ![](../prototype/warehouse/screens/table-mobile.png) |
| SQL Workspace | [sql.html](../prototype/warehouse/sql.html) | ![](../prototype/warehouse/screens/sql-desktop.png) | ![](../prototype/warehouse/screens/sql-mobile.png) |

### 6.1 검증 질문 — 리뷰에서 답한다

시안을 만든 쪽이 스스로 통과시키지 않는다. 아래 여섯 질문은 **프로토타입 리뷰(Required
Verification)** 에서 사람이 답하고, 답을 이 표에 적는다.

| 질문 | 시안이 의도한 것 | 리뷰 |
|---|---|---|
| 로고를 가려도 DW 제품처럼 보이는가 | 사이드바가 DATA · ANALYZE · OPERATE, 첫 화면이 테이블 상태 | ☐ |
| build console 처럼 보이지 않는가 | Build · Artifact 어휘 없음, run 은 테이블의 갱신 이력으로만 | ☐ |
| Table 과 SQL 이 핵심으로 보이는가 | Home 의 주 동작이 "새 SQL 쿼리", 테이블 상세의 주 동작이 "쿼리" | ☐ |
| AI 가 주인공처럼 보이지 않는가 | Ask KPubData 는 topbar 버튼과 "Ask about this table" 뿐, SQL 은 사용자가 실행 | ☐ |
| 한국 공공데이터 특화성이 보이는가 | 기관명(국토교통부 · 기상청 · 한국환경공단 · 통계청), 공공누리, 법정동 코드, 활용신청(Application required) | ☐ |
| 상용 SaaS 가 아니라 전문 data tool 처럼 보이는가 | 20px 가 최대 글자, 36px 행, monospace 식별자, 마케팅 헤딩 없음 | ☐ |

### 6.2 앱과 다른 점

프로토타입이 먼저다. 앱에 옮기는 것은 리뷰를 통과한 뒤의 일이고, 그때 할 것:

- `src/globals.css` 에 상태 토큰(`--status-*`)을 추가하고 `amber-*` · `emerald-*` 직접 사용을
  토큰으로 바꾼다
- 배지를 "축 + 단어" 형태로 통일한다
- 새 wordmark 자산이 나오면 사이드바 로고를 교체한다
- 그 뒤 `npm run screenshots` 로 스크린샷 baseline 을 다시 만든다 — **앱 화면이 바뀌지 않은
  지금 다시 찍을 이유가 없어서 이번에는 하지 않았다.**
