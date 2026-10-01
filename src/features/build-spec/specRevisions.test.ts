/**
 * Spec revisions against Builder's revision endpoints (#649, kpubdata-builder#820).
 *
 * Every request is observed at the network boundary (MSW), so "no credential reaches
 * Builder" is checked on the bytes that would leave the browser, not on a helper's
 * return value.
 */
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";

import { mswServer } from "../../../vitest.setup";
import { toBuildSpec, toFormValues } from "@/features/build-spec/newBuildModel";
import { API_BASE } from "@/shared/config/env";
import type { DocumentRevision } from "@/shared/lib/builderApi";
import type { BuildSpec } from "@/shared/lib/types";

import {
  clearDemoRevisions,
  createIdempotencyKeys,
  demoRevisionApi,
  latestSpecRevision,
  revertSpecRevision,
  saveSpecRevision,
  specFromRevision,
  specRevisionContent,
  specRevisionDocId,
  specRevisionHistory,
} from "./specRevisions";

// An obviously fake, low-entropy value: every case below puts it under a credential-named
// key (serviceKey, token, secret, access_token), which redaction catches by name alone,
// so no realistic-looking key is needed and the secret scanner has nothing to flag.
const FIXTURE_VALUE = "fixture-value-649";

const SPEC: BuildSpec = {
  datasetId: "air-quality",
  title: "Air quality",
  description: "Hourly readings",
  sources: [{ provider: "datago", dataset: "air", params: { sidoName: "Seoul" } }],
  exports: [{ format: "jsonl" }],
  metadata: { outputPath: "artifacts/builds/air" },
};

const WITH_KEY: BuildSpec = {
  ...SPEC,
  sources: [{ provider: "datago", dataset: "air", params: { sidoName: "Seoul", serviceKey: FIXTURE_VALUE } }],
};

function revision(overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  return {
    kind: "spec",
    doc_id: "air-quality",
    revision: 4,
    note: null,
    author: "owner-1",
    created_at: "2026-10-01T00:00:00+00:00",
    reverted_from: null,
    ...overrides,
  };
}

/** Record every body sent to the revision endpoints, answering with `respond`. */
function recordRevisionRequests(respond: (body: Record<string, unknown>, attempt: number) => Response) {
  const bodies: Record<string, unknown>[] = [];
  const raw: string[] = [];
  mswServer.use(
    http.all(`${API_BASE}/revisions/*`, async ({ request }) => {
      const text = await request.text();
      raw.push(`${request.method} ${request.url} ${text}`);
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      bodies.push(body);
      return respond(body, bodies.length);
    }),
  );
  return { bodies, raw };
}

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
  clearDemoRevisions();
});

describe("specRevisionContent", () => {
  it("is the canonical BuildSpec YAML under `yaml`", () => {
    const prepared = specRevisionContent(SPEC);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const parsed = parse(prepared.content.yaml) as Record<string, unknown>;
    expect(parsed.dataset_id).toBe("air-quality");
    expect(Object.keys(prepared.content)).toEqual(["yaml"]);
  });

  it("refuses a spec the persistence redaction rule would change", () => {
    expect(specRevisionContent(WITH_KEY)).toEqual({ ok: false, reason: "credential" });
    // The same rule reaches metadata and the top-level extra (#616, #623).
    expect(specRevisionContent({ ...SPEC, metadata: { api_key: "x" } }).ok).toBe(false);
    expect(specRevisionContent({ ...SPEC, extra: { publish: { hf_token: "x" } } }).ok).toBe(false);
  });
});

describe("specRevisionDocId", () => {
  it("is the table id, and null when Builder would refuse it", () => {
    expect(specRevisionDocId(SPEC)).toBe("air-quality");
    expect(specRevisionDocId({ datasetId: "a/b" })).toBeNull();
    expect(specRevisionDocId({ datasetId: "x".repeat(201) })).toBeNull();
    expect(specRevisionDocId({ datasetId: " " })).toBeNull();
  });
});

describe("saveSpecRevision", () => {
  it("PUTs the content on top of the expected revision, with a key and no author or time", async () => {
    const { bodies, raw } = recordRevisionRequests(() => HttpResponse.json(revision({ revision: 5, note: "fix" })));
    const outcome = await saveSpecRevision({
      docId: "air-quality",
      spec: SPEC,
      expectedRevision: 4,
      note: " fix ",
      keys: createIdempotencyKeys(),
    });

    expect(outcome.status).toBe("saved");
    expect(raw[0]).toMatch(/^PUT .*\/revisions\/spec\/air-quality /);
    const body = bodies[0];
    expect(Object.keys(body).sort()).toEqual(["content", "expected_revision", "idempotency_key", "note"]);
    expect(body.expected_revision).toBe(4);
    expect(body.note).toBe("fix");
    expect(typeof body.idempotency_key).toBe("string");
    expect(body).not.toHaveProperty("author");
    expect(body).not.toHaveProperty("created_at");
  });

  it("never sends a credential: a spec carrying one makes no request at all", async () => {
    const { raw } = recordRevisionRequests(() => HttpResponse.json(revision()));
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const outcome = await saveSpecRevision({
      docId: "air-quality",
      spec: WITH_KEY,
      expectedRevision: 0,
      keys: createIdempotencyKeys(),
    });

    expect(outcome.status).toBe("credential");
    expect(raw).toEqual([]);
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[1]?.body ?? "")).not.toContain(FIXTURE_VALUE);
    }
    fetchSpy.mockRestore();
  });

  it("never sends a credential-like value anywhere in the spec, nor its marker", async () => {
    const { raw } = recordRevisionRequests(() => HttpResponse.json(revision()));
    const specs: BuildSpec[] = [
      { ...SPEC, metadata: { ...SPEC.metadata, access_token: FIXTURE_VALUE } },
      { ...SPEC, exports: [{ format: "huggingface", options: { token: FIXTURE_VALUE } }] },
      { ...SPEC, sources: [{ ...SPEC.sources[0], extra: { auth: { secret: FIXTURE_VALUE } } }] },
      {
        ...SPEC,
        sources: [{ kind: "url", endpoint: `https://example.com/api?serviceKey=${FIXTURE_VALUE}`, params: {} }],
      },
    ];
    for (const spec of specs) {
      const outcome = await saveSpecRevision({ docId: "air-quality", spec, expectedRevision: 0, keys: createIdempotencyKeys() });
      expect(outcome.status).toBe("credential");
    }
    expect(raw).toEqual([]);
  });

  it("shows a 409 revision_conflict with the current revision, and stores nothing", async () => {
    recordRevisionRequests(() =>
      HttpResponse.json(
        { error: "the document is at revision 7", code: "revision_conflict", current_revision: 7 },
        { status: 409 },
      ),
    );
    const outcome = await saveSpecRevision({
      docId: "air-quality",
      spec: SPEC,
      expectedRevision: 4,
      keys: createIdempotencyKeys(),
    });
    expect(outcome).toEqual({ status: "conflict", currentRevision: 7 });
  });

  it("passes on Builder's 400 credential_in_content message", async () => {
    recordRevisionRequests(() =>
      HttpResponse.json(
        {
          error: "credentials are never stored with a document; remove them from: content.yaml",
          code: "credential_in_content",
        },
        { status: 400 },
      ),
    );
    const outcome = await saveSpecRevision({
      docId: "air-quality",
      spec: SPEC,
      expectedRevision: 0,
      keys: createIdempotencyKeys(),
    });
    expect(outcome).toEqual({
      status: "credential",
      message: "credentials are never stored with a document; remove them from: content.yaml",
    });
  });

  it("keeps the idempotency key across an automatic retry after a 5xx", async () => {
    const { bodies } = recordRevisionRequests((_body, attempt) =>
      attempt === 1 ? HttpResponse.json({ error: "busy" }, { status: 503 }) : HttpResponse.json(revision({ revision: 5 })),
    );
    const outcome = await saveSpecRevision({
      docId: "air-quality",
      spec: SPEC,
      expectedRevision: 4,
      keys: createIdempotencyKeys(),
    });
    expect(outcome.status).toBe("saved");
    expect(bodies).toHaveLength(2);
    expect(bodies[1].idempotency_key).toBe(bodies[0].idempotency_key);
  });

  it("reuses the key when the person retries an undecided save, and not after a definite answer", async () => {
    let fail = true;
    const { bodies } = recordRevisionRequests(() =>
      fail ? HttpResponse.error() : HttpResponse.json(revision({ revision: 5 })),
    );
    const keys = createIdempotencyKeys();
    const input = { docId: "air-quality", spec: SPEC, expectedRevision: 4, keys };

    // Network failure on every automatic attempt: the outcome is unknown.
    expect((await saveSpecRevision(input)).status).toBe("error");
    fail = false;
    expect((await saveSpecRevision(input)).status).toBe("saved");
    const firstKey = bodies[0].idempotency_key;
    expect(bodies.at(-1)?.idempotency_key).toBe(firstKey);

    // Builder answered; the same content saved again is a new save.
    await saveSpecRevision(input);
    expect(bodies.at(-1)?.idempotency_key).not.toBe(firstKey);
  }, 15_000);

  it("uses a new key for a different save", async () => {
    const { bodies } = recordRevisionRequests(() => HttpResponse.json({ error: "x", code: "invalid_request" }, { status: 400 }));
    const keys = createIdempotencyKeys();
    await saveSpecRevision({ docId: "air-quality", spec: SPEC, expectedRevision: 4, keys });
    await saveSpecRevision({ docId: "air-quality", spec: { ...SPEC, title: "Changed" }, expectedRevision: 4, keys });
    expect(bodies[1].idempotency_key).not.toBe(bodies[0].idempotency_key);
  });
});

describe("revertSpecRevision", () => {
  it("POSTs exactly to_revision and expected_revision", async () => {
    const { bodies, raw } = recordRevisionRequests(() => HttpResponse.json(revision({ revision: 6, reverted_from: 2 })));
    const outcome = await revertSpecRevision("air-quality", 2, 5);
    expect(outcome.status).toBe("saved");
    expect(raw[0]).toMatch(/^POST .*\/revisions\/spec\/air-quality\/revert /);
    expect(bodies[0]).toEqual({ to_revision: 2, expected_revision: 5 });
  });

  it("reports a conflict", async () => {
    recordRevisionRequests(() =>
      HttpResponse.json({ error: "moved", code: "revision_conflict", current_revision: 9 }, { status: 409 }),
    );
    expect(await revertSpecRevision("air-quality", 2, 5)).toEqual({ status: "conflict", currentRevision: 9 });
  });
});

describe("reading revisions", () => {
  it("treats a document with no revision (404) as revision 0 and an empty history", async () => {
    recordRevisionRequests(() => HttpResponse.json({ error: "no such spec", code: "revision_not_found" }, { status: 404 }));
    expect(await latestSpecRevision("air-quality")).toBeNull();
    expect(await specRevisionHistory("air-quality")).toEqual({ revisions: [], audit: [] });
  });

  it("restores a revision through the redaction rule, so a credential in it fails closed", () => {
    const yaml = [
      "dataset_id: air-quality",
      "title: Air quality",
      "description: Hourly readings",
      "sources:",
      "  - provider: datago",
      "    dataset: air",
      "    params:",
      "      sidoName: Seoul",
      `      serviceKey: ${FIXTURE_VALUE}`,
      "exports:",
      "  - kind: jsonl",
      "    output_path: artifacts/builds/air/data.jsonl",
      "metadata: {}",
      "",
    ].join("\n");
    const restored = specFromRevision(revision({ content: { yaml } }));
    expect(restored).not.toBeNull();
    expect(JSON.stringify(restored)).not.toContain(FIXTURE_VALUE);
    // The marker left in its place keeps the form from submitting it (S07).
    const rebuilt = toBuildSpec(toFormValues(restored!), restored);
    expect(rebuilt.spec).toBeUndefined();
    expect(rebuilt.error).toBeTruthy();
  });

  it("restores a revision that holds a `[REDACTED]` marker as a spec that fails closed", () => {
    const yaml = [
      "dataset_id: air-quality",
      "title: Air quality",
      "description: Hourly readings",
      "sources:",
      "  - provider: datago",
      "    dataset: air",
      "    params: {sidoName: Seoul}",
      "exports:",
      "  - kind: jsonl",
      "    output_path: artifacts/builds/air/data.jsonl",
      "metadata: {checksum: '[REDACTED]'}",
      "",
    ].join("\n");
    const restored = specFromRevision(revision({ content: { yaml } }))!;
    expect(toBuildSpec(toFormValues(restored), restored).spec).toBeUndefined();
  });

  it("returns null for a revision without readable spec content", () => {
    expect(specFromRevision(revision())).toBeNull();
    expect(specFromRevision(revision({ content: { yaml: ": : :" } }))).toBeNull();
    expect(specFromRevision(revision({ content: ["x"] }))).toBeNull();
  });
});

describe("demo revisions", () => {
  it("behaves like Builder: conflicts, idempotent saves, reverts as new revisions", async () => {
    vi.unstubAllEnvs();
    const keys = createIdempotencyKeys();
    const first = await saveSpecRevision({ docId: "demo", spec: SPEC, expectedRevision: 0, keys, api: demoRevisionApi });
    expect(first.status === "saved" && first.revision.revision).toBe(1);

    const stale = await saveSpecRevision({ docId: "demo", spec: { ...SPEC, title: "B" }, expectedRevision: 0, keys, api: demoRevisionApi });
    expect(stale).toEqual({ status: "conflict", currentRevision: 1 });

    const second = await saveSpecRevision({ docId: "demo", spec: { ...SPEC, title: "B" }, expectedRevision: 1, keys, api: demoRevisionApi });
    expect(second.status === "saved" && second.revision.revision).toBe(2);

    const reverted = await revertSpecRevision("demo", 1, 2, demoRevisionApi);
    expect(reverted.status === "saved" && reverted.revision.reverted_from).toBe(1);
    const history = await specRevisionHistory("demo", demoRevisionApi);
    expect(history.revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(history.revisions.every((r) => r.content === undefined)).toBe(true);
    expect(history.audit.map((a) => a.action)).toEqual(["save", "save", "revert"]);
  });
});
