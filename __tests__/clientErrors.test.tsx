/**
 * Error ids and the support contact on every error fallback (#839).
 *
 * A caught error used to end in `console.error` alone. Each fallback now shows an id
 * that the console line also carries, and the deployment's support contact.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary, FeatureErrorBoundary, RouteErrorBoundary } from "@/app/ErrorBoundary";
import { newErrorId, reportHref, resolveSupportContact } from "@/shared/lib/clientErrors";

const ID = /E-\d{8}-[0-9A-F]{6}/;

function Boom(): never {
  throw new Error("boom");
}

function shownId(): string {
  const code = screen.getByRole("alert").querySelector("code");
  expect(code).not.toBeNull();
  return code?.textContent ?? "";
}

function loggedIds(spy: ReturnType<typeof vi.spyOn>): string[] {
  return spy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .map((line: string) => line.match(/^\[(E-[^\]]+)\]/)?.[1])
    .filter((id: string | undefined): id is string => Boolean(id));
}

describe("resolveSupportContact", () => {
  it("makes a bare address a mail link", () => {
    expect(resolveSupportContact(" help@kpubdata.org ")).toEqual({
      href: "mailto:help@kpubdata.org",
      label: "help@kpubdata.org",
    });
  });

  it("keeps an https page and labels it by host", () => {
    expect(resolveSupportContact("https://kpubdata.org/support")).toEqual({
      href: "https://kpubdata.org/support",
      label: "kpubdata.org",
    });
  });

  it("keeps a mailto URL", () => {
    expect(resolveSupportContact("mailto:help@kpubdata.org")?.label).toBe("help@kpubdata.org");
  });

  it.each([
    undefined,
    "",
    "   ",
    "javascript:alert(1)",
    "http://kpubdata.org/support",
    "/support",
    "data:text/html,hi",
    "mailto:not-an-address",
    "call us",
  ])("gives no link for %j", (value) => {
    expect(resolveSupportContact(value)).toBeNull();
  });
});

describe("reportHref", () => {
  it("puts the id in a mail link's subject", () => {
    const contact = { href: "mailto:help@kpubdata.org", label: "help@kpubdata.org" };
    expect(reportHref(contact, "E-20261008-ABCDEF")).toBe(
      "mailto:help@kpubdata.org?subject=KPubData%20Studio%20error%20E-20261008-ABCDEF",
    );
  });

  it("leaves a page link and a mail link with its own query as they are", () => {
    const page = { href: "https://kpubdata.org/support", label: "kpubdata.org" };
    const mail = { href: "mailto:help@kpubdata.org?cc=ops@kpubdata.org", label: "x" };
    expect(reportHref(page, "E-1")).toBe(page.href);
    expect(reportHref(mail, "E-1")).toBe(mail.href);
  });
});

describe("newErrorId", () => {
  it("is the UTC date and six hex digits, different each time", () => {
    const at = new Date("2026-10-08T23:30:00Z");
    const ids = new Set(Array.from({ length: 50 }, () => newErrorId(at)));
    for (const id of ids) expect(id).toMatch(/^E-20261008-[0-9A-F]{6}$/);
    expect(ids.size).toBeGreaterThan(45);
  });
});

describe("error fallbacks (#839)", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("shows the id the console line carries, with the support link", () => {
    vi.stubEnv("VITE_SUPPORT_CONTACT", "help@kpubdata.org");

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    const id = shownId();
    expect(id).toMatch(ID);
    expect(loggedIds(consoleError)).toContain(id);
    const link = screen.getByRole("link", { name: "help@kpubdata.org로 문의하기" });
    expect(link).toHaveAttribute("href", expect.stringContaining(encodeURIComponent(id)));
    expect(link).toHaveAttribute("href", expect.stringMatching(/^mailto:help@kpubdata\.org\?/));
  });

  it("asks for the administrator when no contact is configured", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(shownId()).toMatch(ID);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("관리자에게 이 오류 ID를 알려 주세요");
  });

  it("never links an unsafe contact", () => {
    vi.stubEnv("VITE_SUPPORT_CONTACT", "javascript:alert(1)");

    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("gives a route error an id too", () => {
    const router = createMemoryRouter(
      [{ path: "/", element: <Boom />, errorElement: <RouteErrorBoundary /> }],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);

    const id = shownId();
    expect(id).toMatch(ID);
    expect(loggedIds(consoleError)).toContain(id);
  });

  it("gives a feature error its own id, and a new one after a retry fails again", () => {
    render(
      <FeatureErrorBoundary feature="미리보기">
        <Boom />
      </FeatureErrorBoundary>,
    );
    const first = shownId();
    expect(loggedIds(consoleError)).toContain(first);

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    const second = shownId();
    expect(second).toMatch(ID);
    expect(second).not.toBe(first);
    expect(loggedIds(consoleError)).toContain(second);
  });
});
