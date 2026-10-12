/**
 * Build the test realm of the Keycloak e2e (#903) through Keycloak's admin API.
 *
 * The realm is made when the suite starts, not imported from a committed export: whether
 * a deployment keeps a realm export is still open (#903), and these few calls say which
 * settings Studio and Builder actually rely on. They are the ones Builder's
 * `docs/deploy.md` names for a Keycloak realm:
 *
 * - user registration on, sign-in with the e-mail address, and **Verify email** on, with
 *   the realm's mail sent to a mail catcher the suite reads;
 * - a public `kpubdata-studio` client (Authorization Code + PKCE S256) for Studio's origin;
 * - an audience mapper that puts Builder's audience into the access token — without it a
 *   Keycloak access token says `aud: account` and Builder refuses it;
 * - the `email` scope, which a new client has by default, for `email` and
 *   `email_verified`.
 *
 * And one administrator, made here with a verified address, whose subject Builder is
 * started with as `KPUBDATA_BUILDER_ADMIN_SUBJECTS`.
 */

/**
 * @param {string} baseUrl Keycloak's address, e.g. `http://localhost:8180`.
 * @param {{ username: string, password: string }} bootstrap The master realm's admin.
 * @returns {Promise<string>} An access token for the admin API.
 */
async function adminToken(baseUrl, bootstrap) {
  const answer = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: bootstrap.username,
      password: bootstrap.password,
    }),
  });
  if (!answer.ok) throw new Error(`Keycloak refused the bootstrap admin: ${answer.status}`);
  return (await answer.json()).access_token;
}

/**
 * @param {{
 *   baseUrl: string,
 *   bootstrap: { username: string, password: string },
 *   realm: string,
 *   clientId: string,
 *   audience: string,
 *   studioOrigin: string,
 *   smtp: { host: string, port: number, from: string },
 *   administrator: { email: string, password: string, firstName: string, lastName: string },
 * }} options
 * @returns {Promise<{ issuer: string, administratorId: string }>}
 */
export async function setUpRealm(options) {
  const { baseUrl, bootstrap, realm, clientId, audience, studioOrigin, smtp, administrator } = options;
  const token = await adminToken(baseUrl, bootstrap);
  const call = async (method, path, body) => {
    const answer = await fetch(`${baseUrl}/admin/realms${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!answer.ok) {
      throw new Error(`Keycloak admin API ${method} ${path}: ${answer.status} ${await answer.text()}`);
    }
    return answer;
  };

  await call("POST", "", {
    realm,
    enabled: true,
    registrationAllowed: true,
    registrationEmailAsUsername: true,
    loginWithEmailAllowed: true,
    verifyEmail: true,
    // The suite runs over plain HTTP on localhost.
    sslRequired: "none",
    smtpServer: { host: smtp.host, port: String(smtp.port), from: smtp.from, fromDisplayName: "KPubData e2e" },
  });

  await call("POST", `/${realm}/clients`, {
    clientId,
    enabled: true,
    publicClient: true,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    implicitFlowEnabled: false,
    redirectUris: [`${studioOrigin}/*`],
    webOrigins: [studioOrigin],
    attributes: {
      "pkce.code.challenge.method": "S256",
      "post.logout.redirect.uris": `${studioOrigin}/*`,
    },
    protocolMappers: [
      {
        name: "builder-audience",
        protocol: "openid-connect",
        protocolMapper: "oidc-audience-mapper",
        config: {
          "included.custom.audience": audience,
          "access.token.claim": "true",
          "id.token.claim": "false",
        },
      },
    ],
  });

  const created = await call("POST", `/${realm}/users`, {
    username: administrator.email,
    email: administrator.email,
    emailVerified: true,
    enabled: true,
    firstName: administrator.firstName,
    lastName: administrator.lastName,
    credentials: [{ type: "password", value: administrator.password, temporary: false }],
  });
  const location = created.headers.get("location") ?? "";
  const administratorId = location.slice(location.lastIndexOf("/") + 1);
  if (!administratorId) throw new Error("Keycloak did not say where the administrator was created");

  return { issuer: `${baseUrl}/realms/${realm}`, administratorId };
}
