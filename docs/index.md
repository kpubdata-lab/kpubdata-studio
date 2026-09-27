# KPubData Studio Documentation Index

KPubData Studio의 설계 철학, 아키텍처, 개발 방법을 안내하는 문서 목록입니다. 
(Documentation index for KPubData Studio design philosophy, architecture, and development methods.)

## 핵심 설계 (Core Design)

| 문서 | 설명 |
|---|---|
| [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata-studio/blob/main/ARCHITECTURE.md) | Studio 시스템 아키텍처 및 설계 원칙 (System architecture and design principles) |
| [STATE_MODEL.md](https://github.com/yeongseon/kpubdata-studio/blob/main/STATE_MODEL.md) | 빌드 상태 전이 및 UI 상태 관리 모델 (Build state transitions and UI state management) |
| [UI_SPEC.md](https://github.com/yeongseon/kpubdata-studio/blob/main/UI_SPEC.md) | 사용자 인터페이스 컴포넌트 및 디자인 규격 (UI component specification and design) |
| [USER_FLOWS.md](https://github.com/yeongseon/kpubdata-studio/blob/main/USER_FLOWS.md) | 주요 사용자 시나리오 및 화면 흐름도 (Key user scenarios and screen flows) |
| [INFORMATION_ARCHITECTURE.md](https://github.com/yeongseon/kpubdata-studio/blob/main/INFORMATION_ARCHITECTURE.md) | 메뉴 구조 및 데이터 계층 구조 (Menu structure and data hierarchy) |
| [API_CONTRACT.md](https://github.com/yeongseon/kpubdata-studio/blob/main/API_CONTRACT.md) | Builder API와의 통신 규약 및 데이터 모델 (Builder API contract and data models) |

## 개발 가이드 (Development Guide)

| 문서 | 설명 |
|---|---|
| [AGENTS.md](https://github.com/yeongseon/kpubdata-studio/blob/main/AGENTS.md) | AI 에이전트 협업 가이드 및 프롬프트 지침 (AI agent collaboration and prompting) |
| [CONTRIBUTING.md](https://github.com/yeongseon/kpubdata-studio/blob/main/CONTRIBUTING.md) | 프로젝트 기여 방법 및 개발 환경 설정 (How to contribute and set up dev environment) |

## 프로젝트 관리 (Project Management)

| 문서 | 설명 |
|---|---|
| [PRD.md](https://github.com/yeongseon/kpubdata-studio/blob/main/PRD.md) | 제품 요구사항 정의 및 목표 (Product requirements and goals) |
| [ROADMAP.md](https://github.com/yeongseon/kpubdata-studio/blob/main/ROADMAP.md) | 향후 개발 계획 및 마일스톤 (Development plan and milestones) |

## 상세 참고 (Detailed Reference)

| 문서 | 설명 |
|---|---|
| [docs/adrs/0001-studio-as-control-surface.md](./adrs/0001-studio-as-control-surface.md) | 결정 기록: Studio를 제어 인터페이스로 정의 (ADR: Studio as control surface) |
| [docs/troubleshooting.md](./troubleshooting.md) | Keycloak OIDC 인증, 오리진 정합, 일반적인 문제 해결 (Authentication, CORS, troubleshooting) |
| [제품군 전체 아키텍처](https://github.com/yeongseon/kpubdata/blob/main/docs/product-family-architecture.md) | **KPubData 3개 저장소의 전체 시스템 아키텍처** (KPubData product family architecture) |

## 관련 프로젝트 (Related Projects)

### KPubData Product Family

| 저장소 | 역할 | 문서 |
|---|---|---|
| [kpubdata](https://github.com/yeongseon/kpubdata) | 접근 + 파싱 + 정규화 | [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata/blob/main/ARCHITECTURE.md) |
| [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) | 데이터셋 조립 + 파이프라인 | [ARCHITECTURE.md](https://github.com/yeongseon/kpubdata-builder/blob/main/ARCHITECTURE.md) |
| [kpubdata-studio](https://github.com/yeongseon/kpubdata-studio) | 시각적 인터페이스 | [README.md](https://github.com/yeongseon/kpubdata-studio/blob/main/README.md) |
