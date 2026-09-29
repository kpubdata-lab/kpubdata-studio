# 로드맵 — kpubdata-studio

> **이 문서는 작업 진행상태의 정본이 아니다.** 방향(NOW / NEXT / LATER)만 적는다.
> Issue 의 Status · Priority · Epic · Target Release 는 GitHub Project 에서 관리한다 — [POLICY.md](https://github.com/yeongseon/kpubdata/blob/main/docs/governance/POLICY.md) 2.1절.
> 데이터셋 지원 상태는 이 저장소가 소유하지 않는다 — [kpubdata 의 생성 문서](https://github.com/yeongseon/kpubdata/blob/main/SUPPORTED_DATA.md)가 기준이다(POLICY 3절).

> 한국 공공데이터를 수집하고, 출처와 이용 조건을 유지한 스냅샷으로 관리하며, 표와 SQL 로 분석하는 작업공간.

## v0.1 ✅ 완료

- ✅ Vite + React SPA 셸
- ✅ React Router 주요 경로
- ✅ feature-based 폴더 구조
- ✅ Builder API 클라이언트 (apiFetch, 재시도, 타임아웃)
- ✅ 도메인 타입 정의
- ✅ 주요 페이지 골격

## v0.2 ✅ 완료

- ✅ 아티팩트 미리보기
- ✅ 데이터셋 검증 화면
- ✅ 빌드 결과물 뷰어

## v0.3 ✅ 완료

- ✅ Build Detail (manifest 요약, 파일 목록)
- ✅ Build Edit 마법사 (Stepper, RHF)
- ✅ Build Run / Publish 페이지
- ✅ Spec 매핑 계층

## v0.4 ✅ 완료

- ✅ 인증 S1-S10 (apiFetch → Google GIS → 토큰 → 게이트 → 에러)
- ✅ BuildSpec 어시스턴트 ST-A1-A10 (BYOK → 스크러빙 → 채팅 → 생성 → 테스트)
- ✅ MSW E2E 테스트 하네스
- ✅ zod 런타임 검증
- ✅ API 1.2.0 동기화

## v0.5 ✅ 완료 — UI vNext (#246)

- ✅ 신규 IA 전면 구현 — Home/Discover/Add Data/Workspace/Auth/LoginGate(#248-#250, #263, #289, #294)
- ✅ Builds/Runs master-detail + Event Timeline(#255, #286)
- ✅ Monitoring — 실제 Builder wire 계약 정합 후 모듈화(#264, #302, #303)
- ✅ Provider Connection/Credential(#259, #300) + Settings 통합(#301)
- ✅ Dataset Detail publish 흐름(#270, #296) — 계약 1.17.0 pin
- ✅ 사용자별 로컬 저장 격리(#293), Evidence 기반 Reports(#258)
- ✅ Playwright E2E 34개(route smoke·happy path·실패 빌드·Assistant·viewport/a11y, #268)

## v1.0 기준

- ✅ 전체 빌드 워크플로우 UI
- ✅ Builder API 모든 오퍼레이션 클라이언트
- ✅ 인증 (Google OIDC BYOK)
- ✅ BuildSpec 어시스턴트 (설명 + 생성)
- 🔲 Studio↔Builder 실 HTTP E2E CI (실배포 환경) — 러너는 PR #310으로 마련,
  cross-repo CI 자동화는 kpubdata#282(워크플로 권한 필요)
- 🔲 Keycloak provider(ADR 0015 전환) — builder #515 후속
