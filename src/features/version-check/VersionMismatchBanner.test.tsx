/**
 * The Studio ↔ Builder release banner (#430): shown for a minor or major difference,
 * never for a patch difference or a Builder that does not say its version, and never
 * in place of the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useNavigate } from "react-router-dom";

import { mswServer } from "../../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import packageJson from "../../../package.json";

import { VersionMismatchBanner } from "./VersionMismatchBanner";
import { STUDIO_VERSION, resetVersionCheck, useVersionCheckStore } from "./store";

const [major, minor, patch] = packageJson.version.split(".").map(Number);

function serveVersion(version: string | undefined) {
  mswServer.use(
    http.get(`${API_BASE}/version`, () =>
      HttpResponse.json({ service: "kpubdata-builder", api_version: "1.77.0", ...(version ? { version } : {}) }),
    ),
  );
}

function GoElsewhere() {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate("/elsewhere")} type="button">
      go
    </button>
  );
}

function renderShell() {
  return render(
    <MemoryRouter>
      <VersionMismatchBanner />
      <main>page content</main>
      <GoElsewhere />
    </MemoryRouter>,
  );
}

async function settled() {
  await waitFor(() => expect(useVersionCheckStore.getState().comparison).not.toBeNull());
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  resetVersionCheck();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("VersionMismatchBanner (#430)", () => {
  it("is built with package.json's version", () => {
    expect(STUDIO_VERSION).toBe(packageJson.version);
  });

  it("shows one line when the minor differs, and the screen still renders", async () => {
    const builder = `${major}.${minor + 1}.0`;
    serveVersion(builder);
    renderShell();

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(builder);
    expect(banner).toHaveTextContent(packageJson.version);
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("can be dismissed", async () => {
    serveVersion(`${major + 1}.0.0`);
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "버전 안내 닫기" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays silent for a patch difference", async () => {
    serveVersion(`${major}.${minor}.${patch + 1}`);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    renderShell();

    await settled();
    expect(useVersionCheckStore.getState().comparison?.kind).toBe("patch");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it("stays silent when Builder does not report a version", async () => {
    serveVersion(undefined);
    renderShell();

    await settled();
    expect(useVersionCheckStore.getState().comparison?.kind).toBe("unknown");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("stays silent when /version fails", async () => {
    mswServer.use(http.get(`${API_BASE}/version`, () => new HttpResponse(null, { status: 500 })));
    renderShell();

    await waitFor(() => expect(screen.getByText("page content")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not ask in mock mode", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    let asked = false;
    mswServer.use(
      http.get(`${API_BASE}/version`, () => {
        asked = true;
        return HttpResponse.json({ service: "kpubdata-builder", api_version: "1.77.0", version: "9.9.9" });
      }),
    );
    renderShell();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(asked).toBe(false);
  });

  it("asks again after a failure instead of staying silent until reload (#480)", async () => {
    // The Builder is down when the page loads (the client's own retries included), then comes back.
    let engineUp = false;
    mswServer.use(
      http.get(`${API_BASE}/version`, () =>
        engineUp
          ? HttpResponse.json({ service: "kpubdata-builder", api_version: "1.77.0", version: `${major}.${minor + 1}.0` })
          : new HttpResponse(null, { status: 500 }),
      ),
    );
    renderShell();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    engineUp = true;
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(await screen.findByRole("status", {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it("does not ask again once it has an answer", async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${API_BASE}/version`, () => {
        calls += 1;
        return HttpResponse.json({ service: "kpubdata-builder", api_version: "1.77.0", version: packageJson.version });
      }),
    );
    renderShell();
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toBe(1);
  });
});

describe("a Builder below the minimum API contract (#725)", () => {
  function serveContract(apiVersion: string, version = packageJson.version) {
    mswServer.use(
      http.get(`${API_BASE}/version`, () =>
        HttpResponse.json({ service: "kpubdata-builder", api_version: apiVersion, version }),
      ),
    );
  }

  it("is said on the page as an alert that cannot be dismissed, and the screen still renders", async () => {
    serveContract("1.58.0");
    renderShell();
    await settled();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("1.58.0");
    expect(alert).toHaveTextContent("1.59.0");
    expect(alert.querySelector("button")).toBeNull();
    expect(screen.getByText("page content")).toBeInTheDocument();
  });

  it("is not said at the minimum or above", async () => {
    serveContract("1.59.0");
    renderShell();
    await settled();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("takes the place of the release notice, which says less", async () => {
    serveContract("1.58.0", `${major}.${minor + 1}.0`);
    renderShell();
    await settled();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is not shown in demo mode, which has no Builder", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    useVersionCheckStore.setState({ apiVersion: "1.0.0" });
    renderShell();

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
