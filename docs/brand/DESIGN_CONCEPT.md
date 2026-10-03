# 디자인 컨셉 (Design Concept)

> 이 문서는 KPubData 의 시각 정체성이 **왜** 이렇게 생겼는지를 적는다 (Brand v2, #628).
> 정확히 **무엇을** 쓰는지 — HEX · token · 크기 · 금지 목록 — 는
> [시각 정체성](VISUAL_IDENTITY.md) 이, **어떤 파일을 어디에** 쓰는지는
> [브랜드 자산 README](https://github.com/kpubdata-lab/kpubdata-studio/blob/main/assets/logo/kpubdata-brand-assets/README.md) 가 정한다.
> 이름과 용어는 kpubdata 의 [BRAND.md](https://github.com/kpubdata-lab/kpubdata/blob/main/docs/brand/BRAND.md) ·
> [TERMINOLOGY.md](https://github.com/kpubdata-lab/kpubdata/blob/main/docs/brand/TERMINOLOGY.md) 가 정한다.

## 문서 계층

Brand v2 문서는 세 층이다. 한 문서에 모두 넣으면 시간이 지나면서 "왜 이렇게 했지?" 와
"정확히 어떤 HEX 를 쓰지?" 가 다시 섞인다.

| 층 | 문서 | 답하는 질문 |
|---|---|---|
| 의도 | 이 문서 | 왜 이렇게 디자인하는가 |
| 규칙 | [VISUAL_IDENTITY.md](VISUAL_IDENTITY.md) | 정확히 무엇을 쓰는가 |
| 자산 사용법 | `assets/logo/kpubdata-brand-assets/README.md` | 어떤 파일을 어디에 쓰는가 |

규칙과 자산 문서는 의도를 다시 설명하지 않고 이 문서를 가리킨다. 의도가 바뀌면 이 문서를
먼저 고치고, 규칙은 그 결과로 바뀐다.

## 1. 한 문장

> **KPubData is a bright, focused data workspace for turning public data into usable data.**

KPubData 는 security console 이나 infrastructure control plane 이 아니다. 하는 일은

```text
public data → discover → organize → query → understand
```

이고, 화면은 그 일에 맞는 무게여야 한다.

## 2. 왜 바꾸는가 — Brand v1 의 문제

#425 의 Visual Identity(Brand v1)는 화면 사이의 일관성을 만들었다. 실제 제품에 입혀 보니
세 가지가 맞지 않았다.

**흔한 패턴이었다.** Indigo + dark navy sidebar + white content + dark 중심 브랜드 표현은 최근
developer tool · AI SaaS 에서 가장 흔한 조합이다. 깔끔하지만 KPubData 만의 인상이 남지 않는다.

**무거웠다.** Indigo 와 Navy 가 화면을 제품의 실제 성격보다 무겁게 만들었다. 공공데이터를
찾아 정리하고 질의하는 도구가 운영 콘솔처럼 보였다.

**심볼이 너무 많은 것을 설명했다.** K 에 data layer, diamond, 여러 도형을 겹쳐 하나의 mark 에
여러 의미를 실었다. 큰 크기에서는 읽히지만 favicon · 접힌 사이드바처럼 작은 곳에서는 무엇인지
알아보기 어려웠다.

## 3. Bright Data Workspace

Brand v2 의 컨셉은 **Bright Data Workspace** 다. 기본 화면은 밝고 개방적이며, 가장 먼저
보이는 것은 브랜드가 아니라 데이터다.

```text
┌─────────────────────────────────────────────────┐
│ KPubData Studio      Search...            ●     │
├────────────────┬────────────────────────────────┤
│ Home           │                                │
│                │  Tables                        │
│ DATA           │                                │
│ Catalog        │  ┌────────┐ ┌────────┐         │
│ Tables         │  │ 128    │ │ 2.4M   │         │
│                │  └────────┘ └────────┘         │
│ ANALYZE        │                                │
│ SQL Workspace  │  housing.apartment_trade       │
│ Saved Analyses │  weather.daily_observation     │
│                │                                │
│ OPERATE        │                                │
│ Quality        │                                │
│ Monitoring     │                                │
└────────────────┴────────────────────────────────┘
```

화면 대부분은 중립 표면이고, 브랜드색은 사용자가 무언가를 고르거나 누르거나 데이터를 강조할
때에만 나타난다.

## 4. 원칙

### 4.1 Bright by default

밝은 화면이 KPubData 를 대표한다. Dark mode 는 계속 지원하지만 브랜드의 얼굴이 아니다.

```text
Default      Light
Alternative  Dark
```

사이드바 하나만 밝게 바꾸는 일이 아니다. `dark sidebar + dark header + white content` 라는
구도 자체가 "어두운 틀 안에 데이터를 끼운" 인상을 만든다. 시각 위계를 처음부터 밝은 표면 위에
다시 세운다.

### 4.2 Data first, decoration second

색은 장식이 아니라 **신호**다 — 상호작용, 선택, 데이터 강조, 상태. 화면 전체를 Blue 나 Cyan 으로
칠하면 신호가 배경이 되고, 정작 무엇이 선택됐는지 알 수 없게 된다. 그래서 대부분의 표면은
중립색이어야 한다.

### 4.3 Flat over effects

gradient · glow · 3D · glassmorphism · 무거운 그림자 · neon 을 쓰지 않는다. 효과는 유행을 따라
낡고, 작은 크기에서 뭉개지며, 데이터보다 먼저 눈에 들어온다. 브랜드는 색의 효과가 아니라
**형태와 타이포그래피**가 만든다. 로고에 gradient 를 쓰지 않는 이유도 같다.

### 4.4 Professional, not enterprise-heavy

진지한 데이터 작업을 위한 도구처럼 보여야 하지만, 무거운 엔터프라이즈 제품처럼 보일 필요는
없다. 아래 예시와 반례(§9) 가 그 경계다.

### 4.5 Dense but calm

#425 가 정한 정보 밀도는 그대로다 — 20px 가 최대인 page title, 36px 행 높이의 compact table,
monospace 식별자, 촘촘한 카드와 절제된 여백. 바뀌는 것은 무게다. dark sidebar 의존, 강한 Indigo
강조, 과한 대비를 걷어낸다.

> **density 는 유지하고 visual weight 는 낮춘다.**

## 5. 성격

```text
Bright · Clear · Data-first · Professional · Human
```

| 성격 | 뜻 | 화면에서 |
|---|---|---|
| Bright | 열려 있고 가볍다 | 밝은 canvas, 중립 표면, 어두운 틀이 없다 |
| Clear | 무엇이 어디 있는지 바로 보인다 | 색은 선택과 상호작용에만, 상태는 색과 단어를 함께 |
| Data-first | 데이터가 장식보다 먼저 보인다 | 브랜드는 사이드바 로고 한 번, 나머지는 테이블과 SQL |
| Professional | 진지한 작업 도구다 | 정보 밀도, monospace 식별자, 마케팅 헤딩 없음 |
| Human | 차갑지 않다 | 약간 따뜻한 canvas, Mint 의 작은 디테일, 차분한 문구 |

목소리(정확 · 간결 · 차분 · 증거 기반)는 [BRAND.md](https://github.com/kpubdata-lab/kpubdata/blob/main/docs/brand/BRAND.md) 가 정한다. 시각 성격은 그 목소리와 같은 방향이어야 한다.

## 6. 브랜드 구조 — K 하나

제품군은 하나의 identity 를 쓴다.

```text
[K] KPubData
[K] KPubData Builder
[K] KPubData Studio
[K] KPubData Watch
```

BRAND.md 가 정한 대로 브랜드는 `KPubData` 하나이고 Builder · Studio · Watch 는 **접미사**다.
그래서 제품마다 심볼을 따로 만들지 않는다. 심볼이 여러 개면 사용자는 네 개의 제품을 기억해야
하고, 하나면 한 제품군을 기억한다.

접미사는 언제나 `KPubData` 보다 약하다 — 더 작고, 더 가볍고, 중립색이다. 접미사에 브랜드색을
쓰면 그 순간 접미사가 별도 브랜드처럼 읽힌다. #425 가 `Studio` 를 Indigo 에서 회색으로 바꾼
이유이고, Brand v2 에서도 그대로다.

## 7. 로고

### 7.1 설명하는 로고가 아니라 기억되는 로고

Brand v1 심볼은 "공공데이터를 쌓아 정리한다" 를 그림으로 설명하려 했다. 설명하는 로고는
설명할 공간이 있을 때만 작동한다. 16px favicon 에는 그 공간이 없다.

Brand v2 의 목표는 **기억되는 것**이다. 의미는 제품이 전달하고, 로고는 그 제품을 가리키기만
하면 된다.

> **The K should identify KPubData without needing to explain KPubData.**

### 7.2 왜 minimal geometric K 인가

```text
│╲
│ >
│╱
```

- **K 는 이미 이름이다.** 제품군 모든 이름이 K 로 시작하고, 별도 의미를 배울 필요가 없다.
- **단순한 기하는 크기를 가리지 않는다.** 직선 세 개는 512px 앱 아이콘에서도 16px favicon 에서도
  같은 형태로 읽힌다. 같은 geometry 를 모든 크기에 쓸 수 있다.
- **세 획은 세 가지 색 역할을 담는다.** 수직 획은 제품의 축(Brand Blue), 위 획은 데이터(Data Cyan),
  아래 획은 사람과 디테일(Fresh Mint). 그림을 덧붙이지 않고 색의 역할만으로 성격을 싣는다.
- **flat vector 는 오래 간다.** 효과가 없으면 유행에 덜 묶이고, 단색으로 바꿔도 형태가 남는다.

### 7.3 무엇을 넣지 않는가, 그리고 왜

| 넣지 않는 것 | 이유 |
|---|---|
| diamond · database cylinder · layer stack · literal table icon | "데이터" 를 그림으로 설명하는 순간 v1 의 문제로 돌아간다. 이런 도형은 다른 데이터 제품 로고와도 겹친다 |
| gradient · glow · shadow · 3D | 작은 크기에서 뭉개지고, 단색 변형에서 사라지며, 유행과 함께 낡는다 |
| K 안의 추가 문자 | 형태가 복잡해지고 16px 에서 읽히지 않는다 |

정확한 금지 목록과 크기 기준은 [VISUAL_IDENTITY](VISUAL_IDENTITY.md) §2.1 이 정한다.

## 8. 색

### 8.1 세 가지 역할

색은 세 개지만 역할이 겹치지 않는다. 역할이 겹치면 색이 무엇을 뜻하는지 아무도 모르게 된다.

| 색 | 역할 | 왜 |
|---|---|---|
| **Brand Blue** | 상호작용 — CTA, 선택된 내비게이션, 링크, focus | 파랑은 "누를 수 있다" 를 가장 빨리 전달한다. Indigo 보다 가볍고, 공공데이터의 신뢰감과도 맞는다 |
| **Data Cyan** | 데이터 — 차트 강조, 선택된 시리즈 | 상호작용과 데이터 강조를 다른 색으로 두어야 "이건 누르는 것" 과 "이건 보는 것" 이 섞이지 않는다. 그래서 CTA 대체 색으로 쓰지 않는다 |
| **Fresh Mint** | 디테일 — 심볼, 작은 일러스트, 보조 시리즈 | 화면에 약간의 온기(Human)를 준다. 아주 적게 쓸 때만 효과가 있다 |

나머지는 Ink · Slate · 약간 따뜻한 Canvas · White · 옅은 Border 다. Canvas 를 순백이나 차가운
회색이 아니라 살짝 따뜻한 off-white 로 두는 이유는, 하루 종일 표를 보는 화면이 병원처럼 차갑지
않게 하기 위해서다.

### 8.2 Mint 는 success 가 아니다

청록 계열은 흔히 "성공" 으로 읽힌다. 그래서 더욱 Mint 를 성공에 쓰지 않는다. #425 의 원칙 —
**브랜드색과 상태색은 다른 체계다** — 이 그대로 적용된다. 모든 성공을 브랜드색으로 칠하면
브랜드색이 "성공" 을 뜻하게 되고, 심볼의 Mint 획이 화면마다 "완료" 처럼 보이게 된다.
상태는 상태 토큰과 단어가 전달한다.

## 9. 예시와 반례

```text
Government portal     ❌
Generic AI SaaS       ❌
Dark dev console      ❌

Modern data workspace ✅
```

| | 어떻게 보이는가 | 왜 아닌가 / 왜 맞는가 |
|---|---|---|
| ❌ Government portal | 배너, 큰 제목, 메뉴가 많은 상단 바, 낡은 표 | 공공데이터를 다루지만 공공기관 사이트가 아니다. 데이터를 **쓸 수 있게** 만드는 도구다 |
| ❌ Generic AI SaaS | 보라·남색 gradient, glow, 큰 hero, 반짝이는 AI 버튼 | 어떤 제품인지 구분되지 않는다. AI 는 주인공이 아니다 (Ask KPubData 는 도우미다) |
| ❌ Dark dev console | 검은 배경, 남색 사이드바, neon 강조 | 운영 콘솔의 무게다. 데이터를 이해하는 일보다 시스템을 감시하는 일처럼 보인다 |
| ✅ Modern data workspace | 밝은 canvas, 중립 사이드바, 촘촘한 표, monospace 식별자, 선택한 곳에만 Blue | 데이터가 먼저 보이고, 오래 써도 피곤하지 않으며, 진지한 작업 도구로 보인다 |

## 10. Dark mode

Dark mode 는 없애지 않는다. 어두운 화면을 선호하는 사용자에게 필요하다. 다만

> **Brand identity ≠ Dark theme.**

Dark mode 는 사용자의 선택이지, KPubData 가 자신을 보여주는 방식이 아니다. 그래서 스크린샷,
README, 소셜 이미지, 시각 리뷰의 기준 화면은 light 다.

Dark mode 가 지켜야 할 것은 "같은 제품" 으로 보이는 것이다. 정보 위계, 색의 역할, 상태 체계가
light 와 같아야 하고, 순수한 검정이나 채도 높은 navy 로 가서 v1 의 dark console 인상으로 돌아가지
않아야 한다. 정확한 규칙은 [VISUAL_IDENTITY](VISUAL_IDENTITY.md) §3.4 에 있다.

## 11. Design statement

> **If the logo is hidden, the product should still feel like a bright, focused workspace built specifically for serious data work.**

그리고 로고가 나타났을 때는

> **The K should identify KPubData without needing to explain KPubData.**
