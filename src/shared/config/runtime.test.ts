import { afterEach, describe, expect, it, vi } from "vitest";

import { isRealBuilderEnabled } from "@/shared/lib/builderApi";

import { runtimeOr } from "./runtime";

afterEach(() => {
  delete window.__KPUBDATA_CONFIG__;
  vi.unstubAllEnvs();
});

describe("runtime config (#411)", () => {
  it("prefers the value the container wrote", () => {
    window.__KPUBDATA_CONFIG__ = { builderApiUrl: "https://api.example.org" };
    expect(runtimeOr("builderApiUrl", "http://built-in")).toBe("https://api.example.org");
  });

  it("falls back to the build-time value when config.js is empty", () => {
    window.__KPUBDATA_CONFIG__ = {};
    expect(runtimeOr("builderApiUrl", "http://built-in")).toBe("http://built-in");
  });

  it("treats an empty or blank runtime value as unset", () => {
    window.__KPUBDATA_CONFIG__ = { builderApiUrl: "", oidcIssuer: "  " };
    expect(runtimeOr("builderApiUrl", "http://built-in")).toBe("http://built-in");
    expect(runtimeOr("oidcIssuer", undefined)).toBeUndefined();
  });

  it("falls back when config.js did not load at all", () => {
    expect(runtimeOr("builderApiUrl", "http://built-in")).toBe("http://built-in");
  });

  it("lets the container switch real Builder mode on and off", () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    window.__KPUBDATA_CONFIG__ = { useRealBuilder: "true" };
    expect(isRealBuilderEnabled()).toBe(true);

    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    window.__KPUBDATA_CONFIG__ = { useRealBuilder: "false" };
    expect(isRealBuilderEnabled()).toBe(false);
  });
});
