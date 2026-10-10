/**
 * A deployment's privacy policy, terms, support contact and account page are linked
 * where a user needs them (#838).
 *
 * Studio handles a user's e-mail and name and linked no policy, no terms and no contact:
 * "contact your administrator" named nobody. The deployment sets the four values (the
 * container's `PRIVACY_URL`, `TERMS_URL`, `SUPPORT_CONTACT`, `ACCOUNT_URL`), and each
 * screen shows the ones that are set and nothing for the ones that are not.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/app/AccountMenu";
import { useAuthStore } from "@/features/auth/store";
import { SessionRefusedNotice } from "@/features/onboarding/SessionRefusedNotice";
import { SignupStatusNotice } from "@/features/onboarding/SignupStatusNotice";
import { LoginPage } from "@/pages/LoginPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { SignupPage } from "@/pages/SignupPage";
import { getPolicyLinks, resolvePolicyLink } from "@/shared/config/policyLinks";
import type { RuntimeConfig } from "@/shared/config/runtime";
import { i18n } from "@/shared/i18n";
import { PolicyLinks } from "@/shared/ui";

const DEPLOYMENT: RuntimeConfig = {
  privacyUrl: "https://example.org/privacy",
  termsUrl: "https://example.org/terms",
  supportContact: "help@example.org",
};

function configure(config: RuntimeConfig) {
  window.__KPUBDATA_CONFIG__ = config;
}

function inRouter(node: React.ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

const link = (name: string) => screen.queryByRole("link", { name });
const privacy = () => i18n.t("policy.privacy");
const terms = () => i18n.t("policy.terms");
const support = () => i18n.t("policy.support");

beforeEach(() => {
  window.__KPUBDATA_CONFIG__ = {};
  useAuthStore.getState().clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete window.__KPUBDATA_CONFIG__;
  useAuthStore.getState().clear();
});

describe("resolvePolicyLink", () => {
  it("keeps an https page", () => {
    expect(resolvePolicyLink(" https://example.org/privacy ")).toBe("https://example.org/privacy");
  });

  it("keeps http only on this machine", () => {
    expect(resolvePolicyLink("http://localhost:8080/realms/kpubdata/account")).toBe(
      "http://localhost:8080/realms/kpubdata/account",
    );
    expect(resolvePolicyLink("http://example.org/privacy")).toBeNull();
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "/privacy", "privacy", "", undefined])(
    "gives no link for %s",
    (value) => {
      expect(resolvePolicyLink(value)).toBeNull();
    },
  );
});

describe("getPolicyLinks", () => {
  it("reads the container's values before the build's", () => {
    vi.stubEnv("VITE_PRIVACY_URL", "https://build.example.org/privacy");
    vi.stubEnv("VITE_TERMS_URL", "https://build.example.org/terms");
    configure({ privacyUrl: "https://example.org/privacy" });

    expect(getPolicyLinks()).toMatchObject({
      privacy: "https://example.org/privacy",
      terms: "https://build.example.org/terms",
    });
  });

  it("takes the account page from the Keycloak issuer unless one is set", () => {
    configure({
      useRealBuilder: "true",
      oidcIssuer: "https://sso.example.org/realms/kpubdata",
      oidcClientId: "kpubdata-studio",
    });
    expect(getPolicyLinks().account).toBe("https://sso.example.org/realms/kpubdata/account");

    configure({ ...window.__KPUBDATA_CONFIG__, accountUrl: "https://id.example.org/me" });
    expect(getPolicyLinks().account).toBe("https://id.example.org/me");
  });

  it("has no account page without a sign-in service", () => {
    expect(getPolicyLinks().account).toBeNull();
  });
});

describe("PolicyLinks", () => {
  it("renders nothing when the deployment set none", () => {
    const { container } = render(<PolicyLinks />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links what is set and leaves out what is not", () => {
    configure({ privacyUrl: DEPLOYMENT.privacyUrl, supportContact: DEPLOYMENT.supportContact });
    render(<PolicyLinks />);

    expect(link(privacy())).toHaveAttribute("href", "https://example.org/privacy");
    expect(link(support())).toHaveAttribute("href", "mailto:help@example.org");
    expect(link(terms())).toBeNull();
  });

  it("does not link a value that is not a web page", () => {
    configure({ privacyUrl: "javascript:alert(1)", termsUrl: DEPLOYMENT.termsUrl });
    render(<PolicyLinks />);

    expect(link(privacy())).toBeNull();
    expect(link(terms())).toHaveAttribute("href", "https://example.org/terms");
  });
});

describe("where the links are shown", () => {
  it.each([
    ["the login page", <LoginPage key="login" />],
    ["the sign-up page", <SignupPage key="signup" />],
  ])("%s links the policy, the terms and the contact", (_name, page) => {
    configure(DEPLOYMENT);
    inRouter(page);

    expect(link(privacy())).toHaveAttribute("href", "https://example.org/privacy");
    expect(link(terms())).toHaveAttribute("href", "https://example.org/terms");
    expect(link(support())).toHaveAttribute("href", "mailto:help@example.org");
  });

  it("the login page shows none of them when none is set", () => {
    inRouter(<LoginPage />);

    expect(link(privacy())).toBeNull();
    expect(link(terms())).toBeNull();
    expect(link(support())).toBeNull();
  });

  it("the account menu lists them", () => {
    configure(DEPLOYMENT);
    inRouter(<AccountMenu />);
    fireEvent.click(screen.getByRole("button", { name: i18n.t("layout.account.open") }));

    const menu = within(screen.getByRole("dialog"));
    expect(menu.getByRole("link", { name: privacy() })).toHaveAttribute("href", "https://example.org/privacy");
    expect(menu.getByRole("link", { name: terms() })).toHaveAttribute("href", "https://example.org/terms");
    expect(menu.getByRole("link", { name: support() })).toHaveAttribute("href", "mailto:help@example.org");
  });

  it.each([
    ["a sign-up waiting for approval", <SignupStatusNotice block="pending" key="pending" />],
    ["a refused sign-up", <SignupStatusNotice block="rejected" key="rejected" />],
    [
      "a session Builder refuses",
      <SessionRefusedNotice key="refused" onSignOut={() => undefined} refusal={{ code: null, reason: null }} />,
    ],
  ])("%s names the contact", (_name, notice) => {
    configure(DEPLOYMENT);
    render(notice);

    expect(screen.getByRole("link", { name: "help@example.org" })).toHaveAttribute("href", "mailto:help@example.org");
  });

  it("a notice says nothing more when no contact is set", () => {
    const { container } = render(<SignupStatusNotice block="pending" />);

    expect(container.querySelector("[data-support-line]")).toBeNull();
  });
});

describe("the account page link in Settings", () => {
  const manage = () => i18n.t("settings.account.manage");

  it("is shown to a signed-in user of a real deployment", () => {
    configure({
      useRealBuilder: "true",
      oidcIssuer: "https://sso.example.org/realms/kpubdata",
      oidcClientId: "kpubdata-studio",
    });
    useAuthStore.setState({ email: "user@example.org" });
    inRouter(<SettingsPage />);

    const card = within(screen.getByTestId("settings-account"));
    expect(card.getByRole("link", { name: manage() })).toHaveAttribute(
      "href",
      "https://sso.example.org/realms/kpubdata/account",
    );
  });

  it("is not shown in the demo, which has no account to manage", () => {
    useAuthStore.setState({ email: "user@example.org" });
    inRouter(<SettingsPage />);

    expect(within(screen.getByTestId("settings-account")).queryByRole("link", { name: manage() })).toBeNull();
  });
});
