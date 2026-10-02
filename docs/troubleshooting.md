# KPubData Studio Troubleshooting

## 오리진 정합 — Keycloak Client ↔ Builder CORS

실연동 모드에서 Studio가 Builder를 호출하려면 **같은 오리진 목록**을 양쪽에 등록해야 한다:

1. **Keycloak** → realm → Clients → `kpubdata-studio` → **Web Origins**(+ Valid Redirect URIs)
2. **Builder** → `KPUBDATA_BUILDER_ALLOWED_ORIGINS` 환경변수 (CORS default-deny)

두 값이 어긋나면 증상이 **CORS 오류**로 나타나 원인 추적이 어렵다. 로컬과 실배포 오리진을 모두 양쪽에 등록할 것.

| 환경 | Studio 오리진 | Keycloak Web Origins | Builder CORS env |
| :--- | :--- | :--- | :--- |
| 로컬 개발 | `http://localhost:5173` | ✅ 등록 | ✅ 등록 |
| 실배포 | `https://<studio-host>` | ✅ 등록 | ✅ 등록 |
| Pages 데모 | `https://kpubdata-lab.github.io` | ❌ (mock 모드, Builder 호출 안 함) | ❌ |

> Google 로그인은 Keycloak identity broker가 처리하므로, Google Cloud Console에 등록하는 redirect URI는 Studio 오리진이 아니라 **Keycloak의 broker endpoint**다 (`https://<keycloak-host>/realms/<realm>/broker/google/endpoint`).

> Pages 데모는 mock 모드(`VITE_USE_REAL_BUILDER` 미설정)라 Builder를 호출하지 않으므로 등록 대상이 아니다.

---

## Keycloak OIDC 인증 (실연동 Builder)

실연동 Builder 흐름은 self-hosted Keycloak realm을 통해 사람 사용자를 인증한다 — Authorization Code Flow + PKCE(S256). Studio는 public SPA이므로 프런트엔드에 **client secret이 없다**. 이메일/비밀번호 로그인, 이메일 인증, 비밀번호 재설정, 토큰 갱신, 로그아웃은 모두 Keycloak의 책임이며 Studio는 비밀번호를 보거나 저장하지 않는다.

실연동 `/login`에서는 두 가지 로그인 경로를 제공한다.

- **Google로 계속하기**: `keycloakLogin(returnTo, "google")`을 사용해 Keycloak의 Google Identity Broker를 통해 인증한다.
- **KPubData 계정으로 로그인**: `keycloakLogin(returnTo)`을 사용해 Keycloak이 제공하는 로그인 화면으로 이동한다.

두 경로 모두 Keycloak을 Authorization Server로 사용하며, Google 인증을 Studio가 직접 처리하거나 Google 토큰을 Builder에 직접 전달하지 않는다.
mock/demo 모드(`VITE_USE_REAL_BUILDER` 미설정)에서는 기존 이메일/비밀번호 폼을 그대로 쓴다.

### Studio 설정

```dotenv
# Studio .env.local (커밋 금지)
VITE_USE_REAL_BUILDER=true
VITE_BUILDER_API_URL=http://localhost:8000
VITE_OIDC_ISSUER=http://localhost:8080/realms/kpubdata
VITE_OIDC_CLIENT_ID=kpubdata-studio
```

Keycloak client(`kpubdata-studio`) 설정:
- Public client (client auth OFF)
- Standard Flow ON
- Direct Access Grants OFF
- PKCE `S256` 필수
- access-token audience `kpubdata-builder`
- Google를 Identity Provider로 연결

**Valid Redirect URIs / Web Origins (로컬 개발 기준):**

- Web Origins: `http://localhost:5173`
- Valid Redirect URIs에는 다음 두 가지가 모두 매칭돼야 한다:
  - **로그인 callback** — `keycloakLogin`이 `/login?returnTo=...`로 돌아온다.
  - **silent SSO callback** — `initKeycloak()`이 숨은 iframe으로 세션을 조용히 확인할 때 `redirect_uri`로 `/silent-check-sso.html`(앱 `BASE_URL` 하위)을 보낸다. 이 경로가 Valid Redirect URI에 없으면 최초 silent SSO 확인이 거부되어 Studio가 인증 오류 화면에 머문다.
- 로컬에서는 `http://localhost:5173/silent-check-sso.html`과 로그인 callback의 query string까지 허용하는 패턴(예: `http://localhost:5173/login*`)을 등록하거나, 개발 편의상 `http://localhost:5173/*` 하나로 둘 다 커버할 수 있다.
- **production에서는 넓은 wildcard(`https://<host>/*` 또는 `*`)를 기본값으로 쓰지 않는다.** production 배포 origin에 대해 실제로 사용하는 silent SSO callback과 로그인 callback만 허용하고, 로그인 callback에 필요한 경우 `/login*`처럼 가능한 좁은 범위의 패턴을 사용한다. sub-path 배포라면 `BASE_URL`도 포함한다.

- `VITE_OIDC_ISSUER`는 전체 issuer URL(`.../realms/<realm>`)이다. Studio가 여기서 Keycloak base URL과 realm을 파생한다. issuer/client id가 없거나 형식이 잘못되면 화면에 보이는 오류로 fail-closed된다 — Studio는 사용자가 인증됐다고 가정하지 않는다.
- access token은 `keycloak-js`의 메모리 세션에만 존재한다. Studio는 공유 Builder 요청 경계에서 `Authorization: Bearer <token>`을 붙이고 만료 임박 토큰을 그 자리에서 갱신한다. `localStorage`/`sessionStorage`나 로그에는 아무것도 쓰지 않는다.
- Builder의 기존 `X-API-Key` 경로는 영향받지 않는다.

### Builder 설정 (Real OIDC Verification)

Builder must be started **without `KPUBDATA_BUILDER_DEV_MODE`**. Builder's `authenticate()` handles dev mode first and returns a `dev` principal *before any Bearer JWT is inspected*, so a Builder running with `KPUBDATA_BUILDER_DEV_MODE=1` accepts every request and proves nothing about the OIDC path. Dev mode is only for the mock-token-free data-path E2E described below — never for authentication verification.

Builder reads these environment variables:

| Variable | Value (local example) | Notes |
| :--- | :--- | :--- |
| `OIDC_ISSUER` | `http://localhost:8080/realms/kpubdata` | Enables the Bearer path. Must equal `VITE_OIDC_ISSUER`. |
| `OIDC_AUDIENCE` | `kpubdata-builder` | Required once `OIDC_ISSUER` is set (fail-closed if missing). Must match the Studio client's access-token audience. |
| `OIDC_ALLOWED_EMAILS` | *(the Keycloak test user's email)* | Comma-separated allowlist. Use `OIDC_ALLOWED_SUBJECTS` instead to allowlist by `sub`. |
| `KPUBDATA_BUILDER_ALLOWED_ORIGINS` | `http://localhost:5173` | CORS is default-deny; must list the Studio dev origin. |

Builder needs the `auth` optional dependency (`pyjwt[crypto]>=2.9,<3`) for JWT verification:

```bash
# from PyPI
pip install "kpubdata-builder[auth]"
OIDC_ISSUER=http://localhost:8080/realms/kpubdata \
OIDC_AUDIENCE=kpubdata-builder \
OIDC_ALLOWED_EMAILS=<keycloak-test-user-email> \
KPUBDATA_BUILDER_ALLOWED_ORIGINS=http://localhost:5173 \
kpubdata-builder serve --host 127.0.0.1 --port 8000 --output-dir ./dist

# or from a local checkout (../kpubdata-builder)
OIDC_ISSUER=http://localhost:8080/realms/kpubdata \
OIDC_AUDIENCE=kpubdata-builder \
OIDC_ALLOWED_EMAILS=<keycloak-test-user-email> \
KPUBDATA_BUILDER_ALLOWED_ORIGINS=http://localhost:5173 \
uv run --project ../kpubdata-builder --extra auth \
  kpubdata-builder serve --host 127.0.0.1 --port 8000 --output-dir ./dist
```

### `email_verified` Precondition

Builder rejects any OIDC token whose payload does not carry `email_verified: true`. Before testing:

- The Keycloak **test user must have "Email verified" = ON** (Users → *user* → Details).
- The `kpubdata-studio` client must include the `email` client scope so the issued **access token** carries `email` and `email_verified` claims (Client scopes → `email` as Default).

### Local Real-Builder Data-Path E2E (Auth Bypassed)

`npm run test:e2e:real` exercises the Studio → Builder ingestion → manifest data path **without** a running Keycloak. It is **not** an authentication test: both sides bypass auth in dev mode.

The public-API scenario runs Builder in its own replay mode (kpubdata-builder#837): the runner starts `kpubdata-builder serve --replay`, which replays the fixtures Builder ships, so no network access or service key is needed. To use other recordings, pass `npm run test:e2e:real -- --replay-dir <dir>` or set `STUDIO_REPLAY_DIR`; the runner hands the directory to `serve --replay-dir`. Studio sets no kpubdata variable and does not look in another repository's checkout (#511, #541). A Builder checkout from before replay support skips the scenario.

```dotenv
# Studio .env.local (do not commit)
VITE_USE_REAL_BUILDER=true
VITE_BUILDER_API_URL=http://localhost:8000
VITE_DEV_BYPASS_AUTH=true
```

```bash
KPUBDATA_BUILDER_DEV_MODE=1
KPUBDATA_BUILDER_ALLOWED_ORIGINS=http://localhost:5173
uv run --with "pandas>=2.2,<3" kpubdata-builder serve --host 127.0.0.1 --port 8000 --output-dir ./dist
```

`VITE_DEV_BYPASS_AUTH` takes effect only in Vite development; a production build never bypasses the login gate.

### Keycloak → Builder OIDC Smoke Test (Manual)

Run this to confirm the real authentication path end to end. It requires a running Keycloak realm and Builder started with `OIDC_ISSUER` set and `KPUBDATA_BUILDER_DEV_MODE` unset.

**Preconditions**

1. Keycloak realm `kpubdata` on `http://localhost:8080` with `kpubdata-studio` public client and `kpubdata-builder` audience mapper.
2. A Keycloak test user with password **and "Email verified" = ON**.
3. Builder with `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_ALLOWED_EMAILS` (or `OIDC_ALLOWED_SUBJECTS`), `KPUBDATA_BUILDER_ALLOWED_ORIGINS`, and `auth` extra installed. **No `KPUBDATA_BUILDER_DEV_MODE`.**
4. Studio with `npm run dev` and `.env.local` containing `VITE_USE_REAL_BUILDER`, `VITE_BUILDER_API_URL`, `VITE_OIDC_ISSUER`, `VITE_OIDC_CLIENT_ID` — **`VITE_DEV_BYPASS_AUTH` unset**.

**Steps**

1. Open `http://localhost:5173` while logged out → Keycloak sign-in shown.
2. Sign in with test user.
3. Browser returns to Studio; app shell renders.
4. Trigger Builder call (e.g., load `/version` or run Preview) and inspect Network in DevTools.
5. In DevTools → Application, inspect `localStorage` and `sessionStorage`.
6. Call a protected Builder endpoint with no token and with a garbage token.
7. Go to Settings → Account → **Logout**.
8. Revisit a protected Studio route.

**Success Criteria**

- [ ] Logged-out Studio redirects into Keycloak login.
- [ ] After Keycloak login, app shell renders.
- [ ] Builder request carries `Authorization: Bearer <access token>` header.
- [ ] Builder accepts request without `KPUBDATA_BUILDER_DEV_MODE` (2xx).
- [ ] Request with missing/malformed token rejected (401/403).
- [ ] Builder logs show `oidc` principal (`kind="oidc"`).
- [ ] No raw tokens in `localStorage` or `sessionStorage`.
- [ ] Logout triggers Keycloak logout; protected routes re-prompt for login.
