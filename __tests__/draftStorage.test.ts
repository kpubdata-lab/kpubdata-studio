// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clearDraft,
  DRAFT_VERSION,
  hasDraft,
  loadDraft,
  saveDraft,
} from "@/features/build-spec/draftStorage";

const DRAFT_KEY = "kpubdata-studio:new-build-draft";

describe("draftStorage", () => {
  beforeEach(() => clearDraft());

  it("reports no draft initially", () => {
    expect(hasDraft()).toBe(false);
    expect(loadDraft()).toBeNull();
  });

  it("saves and loads a draft round-trip", () => {
    saveDraft({ datasetId: "kma-daily", title: "기상" });
    expect(hasDraft()).toBe(true);
    expect(loadDraft<{ datasetId: string; title: string }>()).toEqual({
      datasetId: "kma-daily",
      title: "기상",
    });
  });

  it("clears a saved draft", () => {
    saveDraft({ a: 1 });
    clearDraft();
    expect(hasDraft()).toBe(false);
  });

  it("returns null on corrupted data and clears it, like a version or schema mismatch (#589)", () => {
    localStorage.setItem(DRAFT_KEY, "{not json");
    expect(loadDraft()).toBeNull();
    expect(hasDraft()).toBe(false);
  });

  it("wraps the saved value in a versioned envelope (#84)", () => {
    saveDraft({ title: "기상" });
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
    expect(raw.version).toBe(DRAFT_VERSION);
    expect(raw.data).toEqual({ title: "기상" });
    expect(typeof raw.savedAt).toBe("string");
  });

  it("ignores and clears a draft saved under a different version (#84)", () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ version: DRAFT_VERSION + 1, data: { title: "old" }, savedAt: "x" }),
    );
    expect(loadDraft()).toBeNull();
    expect(hasDraft()).toBe(false);
  });

  it("ignores and clears a draft that fails schema validation (#84)", () => {
    const schema = z.object({ title: z.string() });
    saveDraft({ title: 123 }); // 잘못된 타입(스키마 위반)
    expect(loadDraft(schema)).toBeNull();
    expect(hasDraft()).toBe(false);
  });

  it("returns the data when it passes schema validation (#84)", () => {
    const schema = z.object({ title: z.string() });
    saveDraft({ title: "ok" });
    expect(loadDraft(schema)).toEqual({ title: "ok" });
  });

  describe("read-time sanitize + rewrite (S07 리뷰 §2)", () => {
    const schema = z.object({ title: z.string(), sourceParams: z.string() });
    const sanitize = (d: { title: string; sourceParams: string }) => ({
      ...d,
      sourceParams: d.sourceParams.replace(/secret-[a-z0-9]+/g, "[REDACTED]"),
    });

    it("과거 버전이 저장한 평문 secret 초안을 load 시 정리하고 즉시 rewrite한다", () => {
      // 과거 포맷: sanitize 없이 raw secret이 그대로 저장돼 있음.
      saveDraft({ title: "빌드", sourceParams: '{"serviceKey":"secret-abc123"}' });

      const loaded = loadDraft(schema, DRAFT_KEY, sanitize);
      // 반환값에 raw secret이 없다.
      expect(loaded).toEqual({ title: "빌드", sourceParams: '{"serviceKey":"[REDACTED]"}' });

      // localStorage도 즉시 sanitized 됐다.
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}");
      expect(raw.data.sourceParams).toBe('{"serviceKey":"[REDACTED]"}');
      expect(JSON.stringify(raw)).not.toContain("secret-abc123");
      expect(raw.data.title).toBe("빌드");
    });

    it("이미 정리된(=변화 없는) 초안은 불필요한 rewrite를 하지 않는다", () => {
      saveDraft({ title: "빌드", sourceParams: '{"region":"11"}' });
      const before = localStorage.getItem(DRAFT_KEY);

      const loaded = loadDraft(schema, DRAFT_KEY, sanitize);
      expect(loaded).toEqual({ title: "빌드", sourceParams: '{"region":"11"}' });
      // 바이트 단위로 동일 — savedAt 갱신조차 없다.
      expect(localStorage.getItem(DRAFT_KEY)).toBe(before);
    });
  });
});
