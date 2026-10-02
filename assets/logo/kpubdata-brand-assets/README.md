# KPubData — Brand Assets (Brand v2)

이 문서는 Brand v2(#628) 문서 세 층 중 **자산 사용법** 층이다 — 어떤 파일을 어디에 쓰는가만 다룬다.

- 왜 이렇게 디자인했는가: [`docs/brand/DESIGN_CONCEPT.md`](https://github.com/kpubdata-lab/kpubdata-studio/blob/main/docs/brand/DESIGN_CONCEPT.md)
- 정확히 무엇을 쓰는가(HEX, token, 크기, 금지 사항): [`docs/brand/VISUAL_IDENTITY.md`](https://github.com/kpubdata-lab/kpubdata-studio/blob/main/docs/brand/VISUAL_IDENTITY.md)

심볼은 minimal geometric K다. 64×64 단위 grid 위에 손으로 정한 정수 좌표의 평면 다각형이며, grid와 좌표는
각 SVG 머리의 주석에 적혀 있다. 워드마크는 Pretendard 아웃라인(패스)이고 폰트 파일은 포함하지 않는다.
모든 SVG는 실제 vector path이며 배경 투명, gradient·filter·외부 의존성·래스터 임베드가 없다.
`viewBox`만 지정하고 width/height는 고정하지 않는다.

## 색상 (Brand v2)
HEX의 정본은 [`VISUAL_IDENTITY.md`](https://github.com/kpubdata-lab/kpubdata-studio/blob/main/docs/brand/VISUAL_IDENTITY.md)다. 이 자산들이 쓰는 값은 다음뿐이다.

| 이름 | HEX | 자산에서의 용도 |
| :-- | :-- | :-- |
| Brand Blue | `#2563EB` | K 세로 획, 단색 심볼(Blue) |
| Data Cyan | `#06B6D4` | K 위 사선 |
| Fresh Mint | `#14B8A6` | K 아래 사선 |
| Ink | `#172033` | 라이트 락업의 `KPubData`, 단색 심볼(Ink) |
| Slate | `#64748B` | 라이트 락업의 suffix `Studio` |
| Slate (dark surface) | `#94A3B8` | 다크 락업의 suffix `Studio` |
| White | `#FFFFFF` | 다크 락업의 `KPubData`, 단색 심볼(White), 앱 아이콘 타일 |

suffix(`Studio` / `Builder` / `Watch`)는 항상 `KPubData`보다 작고 중립색이다. Blue·Cyan·Mint를 쓰지 않는다
(`__tests__/brandLockupGate.test.ts`).

## SVG (svg/)
라이트 변형이 정본이다. 다크 변형은 다크 표면(다크 테마)에서만 쓴다.

| 파일 | 용도 |
| :-- | :-- |
| `horizontal_light.svg` | 가로 락업 — 라이트 표면(사이드바, 헤더, 로그인·회원가입, README) |
| `horizontal_dark.svg` | 가로 락업 — 다크 표면(다크 테마의 같은 자리) |
| `vertical_light.svg` | 세로 락업 — 라이트 표면 |
| `vertical_dark.svg` | 세로 락업 — 다크 표면 |
| `symbol_light.svg` | 심볼만, 사방 여백 8/64 — 라이트 표면 |
| `symbol_dark.svg` | 심볼만 — 다크 표면 (3색은 양쪽 표면에서 그대로 쓴다) |
| `sidebar_light.svg` | 심볼만, 여백 4/64로 좁게 자름 — 접힌 사이드바 등 32px 슬롯, 라이트 |
| `sidebar_dark.svg` | 위와 같음, 다크 |
| `favicon.svg` | 브라우저 파비콘 — 64 grid 전체라 16/32px에서 픽셀 정렬된다 |
| `symbol_mono_blue.svg` | 단색 심볼 — Brand Blue |
| `symbol_mono_ink.svg` | 단색 심볼 — Ink (인쇄, 흑백 문맥) |
| `symbol_mono_white.svg` | 단색 심볼 — White (Blue·사진 등 색 있는 배경 위) |

## PNG (png/) — 앱 아이콘 외 모두 투명 배경
| 파일 | 크기 | 용도 |
| :-- | :-- | :-- |
| `kpubdata-horizontal-light.png` | 1400×524 | 가로 락업(라이트), 여백 포함 |
| `kpubdata-horizontal-dark.png` | 1400×524 | 가로 락업(다크), 여백 포함 |
| `kpubdata-vertical-light.png` | 1024×1024 | 세로 락업(라이트), 여백 포함 |
| `kpubdata-vertical-dark.png` | 1024×1024 | 세로 락업(다크), 여백 포함 |
| `kpubdata-symbol-light-512.png` | 512×512 | 심볼(라이트) |
| `kpubdata-symbol-dark-512.png` | 512×512 | 심볼(다크) |
| `kpubdata-app-icon-1024.png` | 1024×1024 | 앱 아이콘(흰 타일 + 심볼, 심볼이 타일의 60%) |
| `favicon-32.png` | 32×32 | 파비콘 |
| `favicon-16.png` | 16×16 | 파비콘 |

`src/app/favicon.ico`(16/32/48, PNG-in-ICO)와 GitHub social preview
`assets/logo/social/github-social-preview.png`(1280×640, Canvas `#F7F8F3` 위 라이트 락업)도 같은 SVG에서 만든다.

## 어디에 무엇을
- 사이드바(펼침): 라이트 테마 `horizontal_light.svg`, 다크 테마 `horizontal_dark.svg`
- 사이드바(접힘): `sidebar_light.svg` / `sidebar_dark.svg`
- 헤더, 로그인·회원가입 브랜딩: 표면에 맞춰 `horizontal_light.svg` / `horizontal_dark.svg`
- README: `<picture>`로 라이트 `horizontal_light.svg`, `prefers-color-scheme: dark`에서 `horizontal_dark.svg`
- 브라우저 파비콘: `favicon.svg` (대체: `favicon-32.png`, `favicon-16.png`, `src/app/favicon.ico`)
- 앱 아이콘: `kpubdata-app-icon-1024.png`
- GitHub social preview: `assets/logo/social/github-social-preview.png` — 저장소 Settings → Social preview에
  올리는 것은 소유자 작업이다.
- 단색이 필요한 곳(인쇄, 한 가지 색만 허용되는 배경): `symbol_mono_*.svg`

제품군(KPubData / Builder / Studio / Watch)은 같은 심볼을 쓴다. 제품별 심볼을 만들지 않는다.

## 다시 만들기
PNG와 `favicon.ico`는 파생 파일이다: `node scripts/render-brand-png.mjs` (Playwright Chromium). SVG를 고치면
다시 실행해 함께 커밋한다.

## 규칙
- Brand v1의 "로고 재디자인 금지" 규칙은 Brand v2 결정(#628)으로 대체되었다. Brand v1 자산과 팔레트
  (Charcoal, Indigo, Light Indigo, 다크 네이비 UI 배경)는 더 이상 쓰지 않는다.
- Brand v2 geometry가 승인된 뒤에는 **승인된 geometry를 임의로(ad hoc) 바꾸지 않는다.** 바꿀 때는 이슈로
  결정하고 이 디렉터리의 SVG·PNG를 함께 다시 만든다.
- 금지 사항(gradient, glow, shadow, 3D, 회전, 심볼 안 추가 문자, 파비콘의 텍스트 등)의 정본은
  [`VISUAL_IDENTITY.md`](https://github.com/kpubdata-lab/kpubdata-studio/blob/main/docs/brand/VISUAL_IDENTITY.md)다.
