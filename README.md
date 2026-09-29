# KPubData Studio

**KPubData Studio는 한국 공공데이터를 수집하고, 출처와 이용 조건을 유지한 스냅샷으로 관리하며, 표와 SQL 로 분석하는 작업공간입니다.**

> KPubData 제품군: [Core](https://github.com/yeongseon/kpubdata) (접근 계층) → [Engine](https://github.com/yeongseon/kpubdata-builder) (실행·웨어하우스) → **Studio** (시각적 작업공간)

> **이름 구분** — 화면에서 **KPubData Engine** 이라고 부르는 실행 엔진의 저장소·패키지 이름이
> `kpubdata-builder` 입니다. 이 문서의 명령어와 환경변수(`VITE_BUILDER_API_URL` 등)는 패키지
> 이름을 그대로 씁니다 ([BRAND.md](https://github.com/yeongseon/kpubdata/blob/main/docs/brand/BRAND.md)).

KPubData는 데이터셋을 설계·정규화하는 과정이 종종 복잡하고, YAML 편집 실수, 시각적 피드백 부재, 비개발자 접근 어려움 등의 진입장벽이 있습니다. Studio는 이러한 장벽을 제거하고, 코딩 경험이 없는 사용자도 공공데이터 처리 흐름을 직관적으로 구성하고 관리할 수 있도록 돕습니다.

## 이 프로젝트가 존재하지 않는 경우

- 빌드 설정 파일을 CLI나 Python 코드로 직접 작성하려는 경우 → [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) 사용
- 한국 공공데이터를 프로그래밍으로 접근만 하려는 경우 → [kpubdata](https://github.com/yeongseon/kpubdata) 사용

## 설치 및 개발 시작

### 사전 요구사항

**Node 22 이상**이 필요합니다. (테스트 도구가 Node 22 이상에서만 동작)

### 빠른 시작 (데모 모드)

```bash
git clone https://github.com/yeongseon/kpubdata-studio.git
cd kpubdata-studio
npm install
npm run dev
```

`npm run dev`를 실행하면 Vite 개발 서버가 **데모 모드**(mock 데이터 사용)로 시작됩니다. 브라우저에서 [http://localhost:5173](http://localhost:5173)에 접속하세요.

### Builder와 함께 실행 (실 데이터)

Builder API와 실제 연동하려면:

```bash
# 방법 1: 스크립트 사용
./scripts/dev-with-builder.sh --real

# 방법 2: 수동 설정
# 터미널 1: Builder
cd ../kpubdata-builder
KPUBDATA_BUILDER_DEV_MODE=true uv run kpubdata-builder serve

# 터미널 2: Studio
cd ../kpubdata-studio
cp .env.development.real .env.development.local
npm run dev
```

### 컨테이너 이미지로 배포

`Dockerfile` 로 이미지를 만듭니다 (#411). 이미지는
배포마다 같고, Builder 주소와 OIDC 설정은 **컨테이너를 띄울 때** 환경변수로 넣습니다.

```bash
docker build -t kpubdata-studio .
docker run -p 8080:8080 \
  -e BUILDER_API_URL=https://api.example.org \
  -e OIDC_ISSUER=https://sso.example.org/realms/kpubdata \
  -e OIDC_CLIENT_ID=kpubdata-studio \
  kpubdata-studio
```

| 변수 | 뜻 |
|---|---|
| `BUILDER_API_URL` | 브라우저가 부르는 Builder 주소. 설정하면 실 Builder 모드가 켜집니다 |
| `USE_REAL_BUILDER` | `false` 로 두면 주소가 있어도 데모 데이터를 씁니다 |
| `OIDC_ISSUER` · `OIDC_CLIENT_ID` | 공개 SPA 클라이언트 설정. 비밀값이 아닙니다 |

브라우저가 Builder 를 직접 부르므로, Builder 의 `KPUBDATA_BUILDER_ALLOWED_ORIGINS` 에 이
Studio 의 origin 을 넣어야 합니다. 값에 따옴표·공백·`<` 같은 문자가 있으면 컨테이너가
그 이유를 남기고 시작하지 않습니다.

## 주요 기능

- **빌드 기획서 작성**: 버튼과 입력만으로 데이터셋 빌드 규칙을 설정합니다.
- **실시간 미리보기**: 설정한 규칙에 따라 데이터가 어떻게 정리될지 즉시 확인합니다.
- **빌드 실행 및 모니터링**: Builder와 연동하여 실제 데이터 수집 과정을 실시간 추적합니다.
- **결과물 검사**: 생성된 데이터 파일의 구조와 내용을 시각적으로 확인합니다.

## 기술 스택

| 기술 | 설명 |
|---|---|
| **Vite** | 빠른 프런트엔드 빌드 도구 |
| **React** | UI 라이브러리 |
| **TypeScript** | 타입 안정성 |
| **TanStack Query** | 서버 상태 관리 및 데이터 페칭 |
| **Zustand** | 로컬 UI 상태 관리 |
| **Tailwind CSS** | 스타일링 |

## 개발 명령어

```bash
npm run dev        # 개발 서버 실행
npm run lint       # ESLint 검사
npm test           # Vitest 테스트
npm run build      # 프로덕션 빌드
npm run preview    # 빌드 결과 프리뷰
```

## 문서

| 문서 | 설명 |
|---|---|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 시스템 아키텍처 |
| [STATE_MODEL.md](./STATE_MODEL.md) | 상태 관리 모델 |
| [UI_SPEC.md](./UI_SPEC.md) | UI 명세 |
| [AGENTS.md](./AGENTS.md) | AI 에이전트 가이드 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 기여 가이드 |
| [PRD.md](./PRD.md) | 제품 요구사항 |

더 자세한 정보는 [docs/](./docs/) 디렉토리를 참고하세요. Keycloak 인증 설정 및 문제 해결은 [docs/troubleshooting.md](./docs/troubleshooting.md)를 확인하세요.

## 제품군

| 패키지 | 역할 |
|---|---|
| [kpubdata](https://github.com/yeongseon/kpubdata) | 접근 + 파싱 + 정규화 SDK |
| [kpubdata-builder](https://github.com/yeongseon/kpubdata-builder) | 데이터셋 조립 + 파이프라인 |
| **kpubdata-studio** | **시각적 인터페이스** |

---

**English:** See [README.en.md](./README.en.md)
