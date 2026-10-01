import { describe, expect, it } from "vitest";

import { credentialPrerequisiteNotice, flattenNotice } from "./credentialPrerequisite";

describe("credential prerequisite notice (#621)", () => {
  it("replaces every newline, not only the first", () => {
    expect(flattenNotice("a\nb\nc")).toBe("a b c");
    expect(flattenNotice("one\n\ntwo\n")).toBe("one  two ");
  });

  it("leaves a body without newlines unchanged", () => {
    expect(flattenNotice("plain")).toBe("plain");
  });

  it("joins the title and a multi-line body on one line", () => {
    const notice = credentialPrerequisiteNotice({ title: "T", body: "first\nsecond\nthird", cta: "C" });
    expect(notice).toBe("T — first second third");
    expect(notice).not.toContain("\n");
  });
});
