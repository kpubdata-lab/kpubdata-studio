import { describe, expect, it } from "vitest";

import { compareAppVersion } from "./compareAppVersion";

describe("compareAppVersion (#430)", () => {
  it("same release is a match", () => {
    expect(compareAppVersion("0.4.0", "0.4.0")).toEqual({ kind: "match" });
  });

  it("a patch difference passes quietly", () => {
    expect(compareAppVersion("0.4.0", "0.4.1").kind).toBe("patch");
  });

  it("a minor or major difference is a mismatch", () => {
    expect(compareAppVersion("0.4.0", "0.5.0")).toEqual({ kind: "mismatch", studio: "0.4.0", builder: "0.5.0" });
    expect(compareAppVersion("0.4.0", "1.4.0").kind).toBe("mismatch");
  });

  it("reads Python and tag spellings of the same release", () => {
    expect(compareAppVersion("0.4.0", "0.4.0.dev0").kind).toBe("match");
    expect(compareAppVersion("0.4.0", "v0.4.0").kind).toBe("match");
  });

  it("does not warn when either side is unknown", () => {
    expect(compareAppVersion("0.4.0", undefined).kind).toBe("unknown");
    expect(compareAppVersion("", "0.5.0").kind).toBe("unknown");
    expect(compareAppVersion("0.4.0", "latest").kind).toBe("unknown");
  });
});
