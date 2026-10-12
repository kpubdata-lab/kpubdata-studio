# 배포 리허설 기록

문서만 보고 Studio 와 Builder 를 함께 올려 본 기록이다(#900). 문서가 틀렸거나 단계가 빠졌거나 두
가지로 읽힌 곳은 "문서와 달랐던 곳" 에 적고, 고친 풀 리퀘스트를 함께 적는다. 다음 리허설은 이
파일 아래에 새 절로 더한다.

## 2026-10-12 — 로컬 Docker, 인증 서버 없음

### 무엇을 했고 무엇을 하지 않았나

- **한 것.** 개발용 Linux 호스트의 Docker 로, Builder 의 `docker-compose.prod.app.yml` 을
  `--profile caddy --profile studio` 로 올렸다. 따른 문서는 이 둘뿐이다.
  - Builder [`docs/deploy.md`](https://github.com/kpubdata-lab/kpubdata-builder/blob/main/docs/deploy.md)
    §12 "단일 VM 프로덕션 배포" 의 "VM 최초 준비" 와 "프로필과 기동 smoke", §7.1 의 `/readyz`, "응답 보안 헤더"
  - Studio `README.md` 의 "컨테이너 이미지로 배포"
- **하지 않은 것.** 깨끗한 VM, 도메인, 공인 인증서(TLS), Cloudflare 는 쓰지 않았다 — 쓸 수 있는 VM 과
  도메인이 없다. 인증 서버도 없다: 직접 운영할지 관리형 서비스를 쓸지가 아직 정해지지 않았다
  (kpubdata-builder#1124). 그래서 **로그인해서 Studio 로 Builder 를 쓰는 흐름은 확인하지 않았다.**
- **인증 방식.** Builder 는 문서가 내놓는 두 방식 중 서비스 키(`KPUBDATA_BUILDER_API_KEY`, 단일 사용자)로
  띄웠다. Studio 는 Builder 에 로그인 토큰(Bearer)만 보내므로 이 방식으로는 Builder 를 부를 수 없다.
  Studio 는 두 번 띄웠다: Builder 주소만 주고 OIDC 를 비운 경우(로그인 화면에서 멈춘다), 그리고 주소도
  비운 데모 모드.

### 환경과 커밋

| 항목 | 값 |
| :--- | :--- |
| 시각 | 2026-10-12 01:22–01:27 KST |
| 호스트 | Linux 5.15, Docker 29.2.1, Docker Compose v5.0.2 |
| Builder | `main` `4bb9a16` (kpubdata-builder#1272, `/readyz`) — 새로 `git clone` 한 디렉터리 |
| Studio 이미지 | compose 의 `STUDIO_REF` 기본값 `023f0c3` (#926) 에서 빌드. 그때 Studio `main` 은 `3d60c59` 로 7 커밋 앞서 있었다 |
| Builder 이미지 | GHCR pull 실패 → compose 가 checkout 에서 빌드 (아래 "문서와 달랐던 곳" 1) |

### 명령과 걸린 시간

`.env` 의 비밀값은 문서에 적힌 명령으로 만들었다
(`python -c "import secrets; ..."`, `python -c "import os,base64; ..."`). 아래에는 적지 않는다.

```bash
git clone https://github.com/kpubdata-lab/kpubdata-builder.git && cd kpubdata-builder
cp .env.app.example .env && chmod 600 .env
# .env 에 채운 값 (비밀값 제외)
#   KPUBDATA_BUILDER_ALLOWED_ORIGINS=http://localhost:8080
#   APP_DOMAIN=localhost
#   STUDIO_BUILDER_API_URL=https://localhost:8443
#   APP_NET_SUBNET=10.250.77.0/24  APP_NET_IP_RANGE=10.250.77.128/25
#   CADDY_IPV4=10.250.77.2  KPUBDATA_BUILDER_TRUSTED_PROXIES=10.250.77.2
docker compose -f docker-compose.prod.app.yml -f ../ports-override.yml \
  --profile caddy --profile studio up -d
```

`../ports-override.yml` 은 저장소 밖의 임시 파일이다(아래 3).

| 단계 | 걸린 시간 |
| :--- | :--- |
| `git clone` | 2초 |
| `up -d` (두 이미지 빌드 포함, 이 호스트의 레이어 캐시 사용) | 52초, 세 컨테이너 모두 `healthy` |
| 레이어 캐시 없이 다시 빌드 (`build --no-cache`, 기본 이미지는 받아 둔 상태) | Studio 47초, Builder 87초 |
| 데모 모드로 바꿔 Studio 만 다시 만들기 (`up -d`) | 3초 |
| `compose_profiles_smoke.py` (세 프로필) | 60초 |

캐시가 전혀 없는 VM 에서는 기본 이미지(`node:22-alpine`, `nginx-unprivileged`, `python:3.12-slim`,
`caddy:2.8-alpine`)를 받는 시간이 더해진다. 그 시간은 재지 않았다.

### 문서와 달랐던 곳

1. **GHCR 로그인 단계가 없었다.** "VM 최초 준비" 는 `cp .env.app.example .env` 로 시작하고 로그인을
   말하지 않는데, Builder 패키지는 비공개다. 로그인 없이 `up` 하면 compose 는 멈추지 않는다:

    ```text
    Image ghcr.io/kpubdata-lab/kpubdata-builder:latest Pulling
    Image ghcr.io/kpubdata-lab/kpubdata-builder:latest error from registry: unauthorized
    Image ghcr.io/kpubdata-lab/kpubdata-builder:latest Building
    Image ghcr.io/kpubdata-lab/kpubdata-builder:latest Built
    ```

    checkout 을 빌드해 GHCR 의 이름을 붙이므로, 스택은 뜨지만 게시된 이미지가 아니다. 이 리허설은
    그 상태로 진행했다(호스트의 Docker 자격 증명은 바꾸지 않았다). 같은 단계는 저장소를 어디서
    받는지도 적지 않았다. → kpubdata-builder#1273 이 `git clone` 과 `docker login ghcr.io` 를
    절차에 넣었다.
2. **네트워크 대역이 겹쳤다.** 호스트에 `172.28.0.0/16` 네트워크가 있어 기본 `172.28.250.0/24` 와
   겹쳤다. §12 와 `.env.app.example` 이 말하는 대로 네 값을 `.env` 에서 함께 바꿨다. 문서대로 됐다.
3. **호스트의 80 번 포트가 이미 쓰이고 있었다.** `caddy` 프로필은 80·443 을 고정으로 쓰고, 바꿀
   변수가 없다. 리허설 호스트의 사정이라 저장소 밖의 임시 파일로 Caddy 의 포트만
   `127.0.0.1:8081`·`127.0.0.1:8443` 로 바꿨다. VM 에서는 비어 있어야 하는 포트이므로 고칠 것은
   "80·443 이 비어 있어야 한다" 는 한 줄이다. → kpubdata-builder#1273.
4. **Studio 의 실 Builder 모드에 로그인 설정이 필요하다는 말이 없었다.** Studio README 는
   "`BUILDER_API_URL` 을 설정하면 실 Builder 모드가 켜진다" 고만 했다. OIDC 를 비우고 주소만 주면
   페이지는 200 으로 뜨지만 로그인 화면이 "인증 초기화에 실패했습니다" 에서 멈춘다(headless
   Chromium, 콘솔: `[auth] OIDC configuration error: config.oidc.issuerMissing`). 인증 서버가 없을 때
   쓸 수 있는 것은 데모 모드뿐이다. → 이 기록을 더한 풀 리퀘스트가 Studio README 에, kpubdata-builder#1273
   이 Builder 문서에 적었다.
5. **Studio README 에서 함께 올리는 묶음으로 가는 길이 없었다.** README 는 `docker run` 만 보여 주고,
   Builder compose 의 `studio` 프로필과 `.env` 에서 쓰는 `STUDIO_` 이름을 말하지 않았다. → 이 기록을
   더한 풀 리퀘스트가 README 에 절을 더했다.
6. **`STUDIO_REF` 기본값이 Studio 의 호스팅 기본값보다 오래됐다.** 기본 커밋 `023f0c3` 은 #933 보다
   앞서, 올라온 페이지의 `connect-src` 에 `https:` 가 있고 `/config.js` 에 `assistantEnabled` 가 없다.
   README 의 `ASSISTANT_ENABLED` 설명(호스팅 배포에서 기본 꺼짐)이 이 묶음에서는 맞지 않는다. compose 는
   `ACCOUNT_URL`·`ASSISTANT_*` 도 넘기지 않는다. 문서가 아니라 compose 의 일이라 따로 남겼다 →
   kpubdata-builder#1274.
7. compose 머리 주석과 `.env.app.example` 이 아직 제거된 deploy 워크플로가 이미지를 넣어 준다고 했다.
   → kpubdata-builder#1273.

### 확인한 것

Studio 에 Builder 주소(`https://localhost:8443`, Caddy 를 거친 주소)를 준 상태에서. `APP_DOMAIN=localhost`
라 Caddy 는 자기 로컬 인증기관의 인증서를 쓰므로 `curl -k` 로 불렀다.

```text
kpubdata-builder Up 26 seconds (healthy) 127.0.0.1:8000->8000/tcp
kpubdata-builder-caddy Up 19 seconds (healthy) 443/udp, 2019/tcp, 127.0.0.1:8081->80/tcp, 127.0.0.1:8443->443/tcp
kpubdata-studio Up 26 seconds (healthy) 127.0.0.1:8080->8080/tcp
== builder direct /healthz
200
== builder /readyz
{"status": "ready", "checks": {"state_store": "ok", "output_dir": "ok", "disk": "ok", "workers": "ok"}, "accepting_builds": true}
== /version without key
401
== /version with key
{"service": "kpubdata-builder", "api_version": "1.117.0", "version": "0.4.0", "publish_credential": "stored_or_server"}
== caddy :80 healthz
ok 200
== caddy https readyz
{"status": "ready", "checks": {"state_store": "ok", "output_dir": "ok", "disk": "ok", "workers": "ok"}, "accepting_builds": true} 200
== caddy https headers
content-security-policy: frame-ancestors 'none'
permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
referrer-policy: no-referrer
strict-transport-security: max-age=31536000
x-content-type-options: nosniff
x-frame-options: DENY
== metrics with key (first lines)
kpubdata_builder_build_workers 2
kpubdata_builder_accepting_builds 1
kpubdata_builder_ready 1
== studio page
200
== studio config.js
window.__KPUBDATA_CONFIG__ = {
  "builderApiUrl": "https://localhost:8443",
  "useRealBuilder": "true",
  "oidcIssuer": "",
  "oidcClientId": "",
  ...
};
== CORS preflight from studio origin
HTTP/2 204
access-control-allow-origin: http://localhost:8080
access-control-allow-headers: Content-Type, X-API-Key, Authorization, X-Provider-Key, X-Publish-Credential
== CORS from other origin
HTTP/2 204          (access-control-allow-origin 없음)
```

데모 모드(`STUDIO_BUILDER_API_URL` 비움)로 다시 만든 뒤: 컨테이너 로그
`kpubdata-studio: builder=<built-in> real=<built-in> oidc=<built-in>`, headless Chromium 에서 홈 화면과
"데모 모드" 배너, 콘솔 오류 없음.

### smoke 출력

§12 의 명령 그대로, 대역만 위 2 처럼 바꿔서 돌렸다.

```bash
docker build -t kpubdata-builder:ci .
APP_NET_SUBNET=10.250.77.0/24 APP_NET_IP_RANGE=10.250.77.128/25 CADDY_IPV4=10.250.77.2 \
  KPUBDATA_BUILDER_TRUSTED_PROXIES=10.250.77.2 \
  python3 scripts/compose_profiles_smoke.py --image kpubdata-builder:ci
```

```text
--- profile default
ok   [default] Builder /healthz answers 200
ok   [default] Builder /version answers 200 with the key
ok   [default] Builder /version answers 401 without it
ok   [default] Builder /readyz answers without the key
--- profile caddy
ok   [caddy] Builder /healthz answers 200
ok   [caddy] Builder /version answers 200 with the key
ok   [caddy] Builder /version answers 401 without it
ok   [caddy] Builder /readyz answers without the key
ok   [caddy] Caddy /healthz answers 200
ok   [caddy] /version through Caddy reaches Builder
ok   [caddy] /readyz through Caddy reaches Builder
--- profile studio
ok   [studio] Builder /healthz answers 200
ok   [studio] Builder /version answers 200 with the key
ok   [studio] Builder /version answers 401 without it
ok   [studio] Builder /readyz answers without the key
ok   [studio] Studio serves its page
ok   [studio] Studio's /config.js names the Builder address it was given
ok   [studio] the call the page makes to Builder answers 200 and CORS allows its origin
```

종료 코드 0. 리허설 스택은 `down -v` 로 내렸다.

### 남은 것

- 깨끗한 VM 에서, 도메인과 공인 인증서, Cloudflare 를 거쳐 같은 절차를 한 번 더 한다. Builder 문서의
  "배포 후 확인"(서로 다른 두 네트워크에서 스로틀)과 공인 인증서의 응답 헤더 확인도 그때 한다.
- 인증 서버가 정해지면(kpubdata-builder#1124) Studio 에 로그인해 Builder 를 부르는 흐름까지 확인한다.
- `STUDIO_REF` 를 올리고 Ask KPubData 설정을 넘기는 일(kpubdata-builder#1274).
