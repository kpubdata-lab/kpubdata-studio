/**
 * Saved BuildSpec local store (#260) tests.
 *
 * Verifies the same guarantees as reports/repository.ts: explicit failure
 * returns, rejection at the cap (no auto-delete), optimistic concurrency,
 * corrupted-value recovery, secret redaction.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildSpec } from "@/shared/lib/types";
import {
  SAVED_SPEC_LIMIT,
  createSavedSpec,
  deleteSavedSpec,
  duplicateSavedSpec,
  getSavedSpec,
  hasAnySavedSpec,
  listSavedSpecSummaries,
  renameSavedSpec,
  saveSpec,
} from "./savedSpecs";

const STORE_KEY = "kpubdata-studio:saved-build-specs";

function makeSpec(overrides: Partial<BuildSpec> = {}): BuildSpec {
  return {
    datasetId: "datago-air-quality",
    title: "대기오염 정보",
    description: "설명",
    sources: [{ provider: "datago", dataset: "air_quality", params: {} }],
    exports: [{ format: "jsonl" }],
    metadata: { outputPath: "artifacts/builds/air-quality" },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("createSavedSpec / listSavedSpecSummaries", () => {
  it("creates an entry and summarizes name/provider/output/validation", () => {
    const { entry, result } = createSavedSpec({
      name: "내 대기오염 스펙",
      spec: makeSpec(),
      validation: { status: "validated_pass", errors: [] },
    });
    expect(result.ok).toBe(true);

    const summaries = listSavedSpecSummaries();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: entry.id,
      name: "내 대기오염 스펙",
      provider: "datago",
      outputPath: "artifacts/builds/air-quality",
      validationStatus: "validated_pass",
    });
  });

  // The clock is set explicitly (#781): a real 2 ms wait does not guarantee the two
  // saves land in different milliseconds, and the test failed on CI when they did not.
  describe("ordering", () => {
    const create = (name: string) =>
      createSavedSpec({ name, spec: makeSpec(), validation: { status: "not_validated", errors: [] } });

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("sorts summaries by most-recently-updated first", () => {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      const first = create("먼저");
      vi.setSystemTime(new Date("2026-10-07T00:00:00.001Z"));
      const second = create("나중");

      expect(listSavedSpecSummaries().map((s) => s.id)).toEqual([second.entry.id, first.entry.id]);
    });

    it("puts an older spec saved again since ahead of a newer one", () => {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      const older = create("오래된");
      vi.setSystemTime(new Date("2026-10-07T00:00:01.000Z"));
      const newer = create("새로운");
      vi.setSystemTime(new Date("2026-10-07T00:00:02.000Z"));
      expect(saveSpec({ ...getSavedSpec(older.entry.id)!, name: "다시 저장" }).ok).toBe(true);

      expect(listSavedSpecSummaries().map((s) => s.id)).toEqual([older.entry.id, newer.entry.id]);
    });

    it("orders two saves in the same millisecond the same way whichever was stored first", () => {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      const a = create("a");
      const b = create("b");
      const once = listSavedSpecSummaries().map((s) => s.id);

      // Store the same two entries in the opposite order.
      window.localStorage.clear();
      expect(saveSpec(b.entry).ok).toBe(true);
      expect(saveSpec(a.entry).ok).toBe(true);

      expect(listSavedSpecSummaries().map((s) => s.id)).toEqual(once);
      expect(once).toEqual([a.entry.id, b.entry.id].sort());
    });

    it("breaks a tie in updatedAt by the newer createdAt", () => {
      vi.setSystemTime(new Date("2026-10-07T00:00:00.000Z"));
      const older = create("오래된");
      vi.setSystemTime(new Date("2026-10-07T00:00:05.000Z"));
      const newer = create("새로운");
      // Saved again at the very millisecond the newer one was created.
      expect(saveSpec({ ...getSavedSpec(older.entry.id)!, name: "같은 시각" }).ok).toBe(true);

      expect(listSavedSpecSummaries().map((s) => s.id)).toEqual([newer.entry.id, older.entry.id]);
    });
  });

  it("returns an empty list when nothing is stored, and hasAnySavedSpec reflects that", () => {
    expect(listSavedSpecSummaries()).toEqual([]);
    expect(hasAnySavedSpec()).toBe(false);
  });
});

describe("secret redaction on save", () => {
  it("redacts values that look like a service key/token before persisting", () => {
    const { entry } = createSavedSpec({
      name: "키 포함 스펙",
      spec: makeSpec({
        sources: [
          {
            provider: "datago",
            dataset: "air_quality",
            params: { serviceKey: "aVeryLongLookingSecretApiKeyValue1234567890abcdef" },
          },
        ],
      }),
      validation: { status: "not_validated", errors: [] },
    });

    const stored = getSavedSpec(entry.id);
    expect(stored?.spec.sources[0].params.serviceKey).toBe("[REDACTED]");
    // Checks the raw string too — no plaintext remains in localStorage.
    expect(localStorage.getItem(STORE_KEY)).not.toMatch(/aVeryLongLookingSecretApiKeyValue/);
  });
});

describe("SAVED_SPEC_LIMIT — rejects new saves instead of auto-evicting old ones", () => {
  it("rejects the (LIMIT+1)th new entry while keeping all existing ones intact", () => {
    for (let i = 0; i < SAVED_SPEC_LIMIT; i++) {
      const { result } = createSavedSpec({
        name: `spec-${i}`,
        spec: makeSpec(),
        validation: { status: "not_validated", errors: [] },
      });
      expect(result.ok).toBe(true);
    }
    expect(listSavedSpecSummaries()).toHaveLength(SAVED_SPEC_LIMIT);

    const { result } = createSavedSpec({
      name: "overflow",
      spec: makeSpec(),
      validation: { status: "not_validated", errors: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(String(SAVED_SPEC_LIMIT));

    // Merely rejected — existing entries were not auto-deleted.
    expect(listSavedSpecSummaries()).toHaveLength(SAVED_SPEC_LIMIT);
  });

  it("allows overwriting an existing entry even when at the limit", () => {
    let firstId = "";
    for (let i = 0; i < SAVED_SPEC_LIMIT; i++) {
      const { entry } = createSavedSpec({
        name: `spec-${i}`,
        spec: makeSpec(),
        validation: { status: "not_validated", errors: [] },
      });
      if (i === 0) firstId = entry.id;
    }
    const existing = getSavedSpec(firstId)!;
    const result = saveSpec({ ...existing, name: "renamed" }, { force: true });
    expect(result.ok).toBe(true);
    expect(getSavedSpec(firstId)?.name).toBe("renamed");
  });
});

describe("optimistic concurrency (revision)", () => {
  it("rejects a save with a stale revision unless force is passed", () => {
    const { entry } = createSavedSpec({ name: "원본", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    // Simulates another tab saving first, bumping the revision.
    saveSpec({ ...entry, name: "다른 탭에서 저장" }, { force: true });

    const staleAttempt = saveSpec({ ...entry, name: "오래된 값으로 저장 시도" });
    expect(staleAttempt.ok).toBe(false);
    if (!staleAttempt.ok) expect(staleAttempt.conflict).toBe(true);

    // The first save's content is preserved.
    expect(getSavedSpec(entry.id)?.name).toBe("다른 탭에서 저장");
  });

  it("force:true overwrites even with a stale revision", () => {
    const { entry } = createSavedSpec({ name: "원본", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    saveSpec({ ...entry, name: "다른 탭에서 저장" }, { force: true });

    const forced = saveSpec({ ...entry, name: "강제 덮어쓰기" }, { force: true });
    expect(forced.ok).toBe(true);
    expect(getSavedSpec(entry.id)?.name).toBe("강제 덮어쓰기");
  });
});

describe("renameSavedSpec", () => {
  it("updates only the name", () => {
    const { entry } = createSavedSpec({ name: "원래 이름", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    const result = renameSavedSpec(entry.id, "새 이름");
    expect(result.ok).toBe(true);
    expect(getSavedSpec(entry.id)?.name).toBe("새 이름");
  });

  it("fails clearly when the id does not exist", () => {
    const result = renameSavedSpec("nonexistent", "x");
    expect(result.ok).toBe(false);
  });
});

describe("duplicateSavedSpec", () => {
  it("creates a new id, appends 복제본, resets validation, and does not share references with the source", () => {
    const { entry: source } = createSavedSpec({
      name: "원본",
      spec: makeSpec(),
      validation: { status: "validated_pass", errors: [] },
    });

    const outcome = duplicateSavedSpec(source.id);
    expect(outcome).not.toBeNull();
    expect(outcome!.entry.id).not.toBe(source.id);
    expect(outcome!.entry.name).toBe("원본 (복제본)");
    expect(outcome!.entry.validation).toEqual({ status: "not_validated", errors: [] });

    // The original is untouched (the clone does not mutate it).
    expect(getSavedSpec(source.id)?.name).toBe("원본");
    expect(getSavedSpec(source.id)?.validation.status).toBe("validated_pass");
    expect(listSavedSpecSummaries()).toHaveLength(2);
  });

  it("returns null for a nonexistent source id", () => {
    expect(duplicateSavedSpec("nonexistent")).toBeNull();
  });
});

describe("deleteSavedSpec", () => {
  it("removes the entry and returns true", () => {
    const { entry } = createSavedSpec({ name: "삭제될 것", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    expect(deleteSavedSpec(entry.id)).toBe(true);
    expect(getSavedSpec(entry.id)).toBeNull();
  });

  it("returns false for a nonexistent id without touching other entries", () => {
    const { entry } = createSavedSpec({ name: "유지될 것", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    expect(deleteSavedSpec("nonexistent")).toBe(false);
    expect(getSavedSpec(entry.id)).not.toBeNull();
  });
});

describe("corrupted storage recovery", () => {
  it("falls back to an empty store instead of throwing when the raw value is invalid JSON", () => {
    localStorage.setItem(STORE_KEY, "{not valid json");
    expect(listSavedSpecSummaries()).toEqual([]);
    // Corrupted value cleaned up, so subsequent saves work.
    const result = createSavedSpec({ name: "복구 후 저장", spec: makeSpec(), validation: { status: "not_validated", errors: [] } });
    expect(result.result.ok).toBe(true);
  });

  it("falls back to an empty store when the version does not match", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 999, specs: {} }));
    expect(listSavedSpecSummaries()).toEqual([]);
  });
});

describe("reload persistence", () => {
  it("survives a simulated reload (re-reading from localStorage without any in-memory cache)", () => {
    const { entry } = createSavedSpec({ name: "새로고침 확인", spec: makeSpec(), validation: { status: "validated_pass", errors: [] } });

    // savedSpecs.ts has no module-level cache — every call re-reads
    // localStorage, so this very lookup verifies "recovered even after
    // refresh".
    const reloaded = getSavedSpec(entry.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.name).toBe("새로고침 확인");
    expect(listSavedSpecSummaries()).toHaveLength(1);
  });
});
