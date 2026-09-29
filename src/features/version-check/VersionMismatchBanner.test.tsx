/**
 * The Studio ↔ Builder release banner (#430): shown for a minor or major difference,
 * never for a patch difference or a Builder that does not say its version, and never
 * in place of the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { mswServer } from "../../../vitest.setup";
import { API_BASE } from "@/shared/config/env";
import packageJson from "../../../package.json";

import { VersionMismatchBanner } from "./VersionMismatchBanner";
import { STUDIO_VERSION, resetVersionCheck, useVersionCheckStore } from "./store";

const [major, minor, patch] = packageJson.version.split(".").map(Number);

function serveVersion(version: string | undefined) {
  mswServer.use(
    http.get(`${API_BASE}/version`, () =>
      HttpResponse.json({ service: "kpubdata-builder", api_version: "1.31.0", ...(version ? { version } : {}) }),
    ),
  );
}

function renderShell() {
  return render(
    <>
      <VersionMismatchBanner />
      <main>page content</main>
    </>,
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

    fireEvent.click(await screen.findByRole("button"));
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
        return HttpResponse.json({ service: "kpubdata-builder", api_version: "1.31.0", version: "9.9.9" });
      }),
    );
    renderShell();

    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(asked).toBe(false);
  });
});
