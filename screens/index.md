# 화면 설계서 (Screen Specifications)

KPubData Studio의 **페이지(라우트) 단위 화면 설계서** 모음입니다. 각 문서는 하나의 화면을 대상으로 목적, 라우트, 진입·이탈 경로, 주요 UI 구성요소, 상태·상호작용, 데이터 소스, 접근성, 스크린샷을 정리합니다.

> **참고**
>
> - 전체 사용자 시나리오(화면 간 흐름)는 [사용자 흐름](../USER_FLOWS.md)을, 컴포넌트·디자인 규격은 [UI 규격](../UI_SPEC.md)을 참고하세요.
> - 스크린샷은 [화면 스크린샷](../screenshots.md)에서 라이트/다크 테마로 모아 볼 수 있으며, `npm run screenshots`로 재생성합니다.
> - 현재 Studio는 기본적으로 **MOCK 모드**로 동작하며, 화면에 표시되는 데이터는 데모 시드 데이터(`src/shared/lib/demoDatasets.ts`)에서 제공됩니다.

## 화면 목록

| 화면 | 라우트 | 컴포넌트 | 설명 |
| :--- | :--- | :--- | :--- |
| [대시보드](dashboard.md) | `/` | `HomePage` | 상태 요약·최근 빌드·빠른 시작 |
| [빌드 목록](builds.md) | `/builds` | `BuildsPage` | 전체 빌드 검색·정렬·조회 |
| [새 빌드 만들기](new-build.md) | `/builds/new` | `NewBuildPage` | 7단계 빌드 마법사 |
| [빌드 상세](build-detail.md) | `/builds/:buildId` | `BuildDetailPage` | 빌드 요약 및 하위 작업 진입 |
| [빌드 편집](build-edit.md) | `/builds/:buildId/edit` | `NewBuildPage` | 기존 빌드 스펙 수정(마법사 재사용) |
| [빌드 실행 추적](build-run.md) | `/builds/:buildId/run` | `BuildRunPage` | 실행 단계 스텝퍼·로그 |
| [빌드 결과물](build-artifacts.md) | `/builds/:buildId/artifacts` | `BuildArtifactsPage` | 매니페스트·파일 목록 |
| [빌드 게시](build-publish.md) | `/builds/:buildId/publish` | `BuildPublishPage` | 배포 대상 선택·게시 |
| [검증(레거시)](validate.md) | `/validate` | `ValidatePage` | `/add` 로 redirect 되는 예전 화면 |
| [미리보기(레거시)](preview.md) | `/preview` | `PreviewPage` | `/add` 로 redirect 되는 예전 화면 |
| [결과물 랜딩](artifacts.md) | `/artifacts` | `ArtifactsPage` | `/refresh-jobs` 로 redirect 되는 예전 화면 |
| [설정](settings.md) | `/settings` | `SettingsPage` | 워크스페이스·Builder API 설정 |

## 공통 셸(Shell)

모든 화면은 [애플리케이션 셸](layout-shell.md)(`Layout`) 안에서 렌더링됩니다. 좌측 사이드바 내비게이션, 상단 헤더(컨텍스트 CTA 포함), 테마 선택기가 공통으로 제공됩니다.
