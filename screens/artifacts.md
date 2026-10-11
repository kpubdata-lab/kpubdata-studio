# 화면 설계서 — 결과물 랜딩 (Artifacts)

> **이 화면은 더 이상 열리지 않습니다.** `/artifacts` 는 `/refresh-jobs` 로 redirect 됩니다(#423). 이유는 [정보 구조 3.1절](../INFORMATION_ARCHITECTURE.md)에 있습니다. 아래는 redirect 이전 화면의 기록입니다.

## 화면 개요

특정 빌드가 지정되지 않은 전역 결과물 진입점입니다. 결과물은 빌드 단위로 조회되므로, 이 화면은 사용자에게 먼저 빌드를 선택하도록 안내합니다. 실제 결과물은 [빌드 결과물](build-artifacts.md) 화면에서 확인합니다.

## 라우트 및 진입·이탈

| 항목 | 내용 |
| :--- | :--- |
| 라우트 | `/artifacts` |
| 컴포넌트 | `src/pages/ArtifactsPage.tsx` |
| 진입점 | 사이드바 "결과물" |
| 이탈점 | [빌드 목록](builds.md) → 빌드 선택 → [빌드 결과물](build-artifacts.md) |

## 주요 UI 구성요소

- `EmptyState`: "빌드를 선택하세요" 안내와 [빌드 목록](builds.md)으로 이동하는 링크.

## 상태 및 상호작용

- 항상 안내용 `EmptyState`를 표시합니다.
- 빌드 목록으로 이동해 특정 빌드의 결과물 화면으로 진입하도록 유도합니다.

## 데이터 소스

- 없음(정적 안내 화면). 결과물 데이터는 [빌드 결과물](build-artifacts.md)의 `getBuildManifest(buildId)`에서 제공됩니다.

## 접근성

- 안내 문구와 이동 링크로 다음 행동을 명확히 제시합니다.

## 스크린샷

=== "라이트 테마 (Light)"
    ![결과물 - 라이트 테마](../assets/screenshots/artifacts-light.png)

=== "다크 테마 (Dark)"
    ![결과물 - 다크 테마](../assets/screenshots/artifacts-dark.png)

## 관련 문서

- [빌드 결과물](build-artifacts.md)
- [빌드 목록](builds.md)
