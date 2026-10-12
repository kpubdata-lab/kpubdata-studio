// @vitest-environment jsdom
/**
 * What Ask KPubData sends to the AI provider is the list in docs/assistant-egress.md (#798).
 *
 * The request is not described by hand here: the real evidence loader, prompt builder and
 * provider run against Builder's mock data, every optional part of the evidence filled in,
 * and the request that reaches `fetch` is taken apart into field paths. A field added to
 * the request without a row in the document fails this test, and so does a row for a
 * field that is no longer sent.
 *
 * It also holds the line the inventory draws: a stage's sample rows, which Builder returns
 * with the stage detail, never reach the request.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadAssistantEvidence } from "@/features/assistant/evidence";
import { buildAssistantMessages } from "@/features/assistant/prompt";
import { createProvider } from "@/features/assistant/provider";
import type { AssistantContext } from "@/features/assistant/types";
import { saveBuildSpec } from "@/features/build-spec/specStore";
import * as datasetsApi from "@/features/datasets/api";

const DOC = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "assistant-egress.md");

const ROW_CANARY = "ROW-CANARY-7f3e";
const PARAM_CANARY = "PARAM-VALUE-CANARY-51ac";
const METADATA_CANARY = "METADATA-VALUE-CANARY-90bd";

/** Leaf paths of a JSON value; arrays read `[]`, a provider-keyed record reads `*`. */
function leafPaths(value: unknown, prefix: string, out: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    if (value.length === 0) out.add(`${prefix}[]`);
    for (const item of value) leafPaths(item, `${prefix}[]`, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      leafPaths(child, `${prefix}.${prefix.endsWith(".datasetsByProvider") ? "*" : key}`, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

/** The paths the document lists: the first cell of each inventory row, in backticks. */
function documentedPaths(): Set<string> {
  const doc = readFileSync(DOC, "utf8");
  const start = doc.indexOf("<!-- inventory:start -->");
  const end = doc.indexOf("<!-- inventory:end -->");
  expect(start, "inventory markers in docs/assistant-egress.md").toBeGreaterThan(-1);
  return new Set([...doc.slice(start, end).matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]));
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the Ask KPubData request (#798)", () => {
  it("sends exactly the fields docs/assistant-egress.md lists, and no sample row", async () => {
    const runId = "apt-2026-08-14";
    saveBuildSpec(runId, {
      datasetId: "apt-trade",
      title: "air",
      description: "air quality",
      sources: [{ provider: "datago", dataset: "air", alias: "a", params: { region: PARAM_CANARY } }],
      exports: [{ format: "jsonl" }],
      metadata: { note: METADATA_CANARY },
    });
    vi.spyOn(datasetsApi, "getBuildQuality").mockResolvedValue({
      run_id: runId,
      availability: "available",
      evaluated_checks: 1,
      quality_results: {
        datago__trade: [
          {
            source_key: "datago__trade",
            category: "completeness",
            rule: "not_null",
            column: "pm10",
            status: "warn",
            actual: 0.9,
            threshold: 0.95,
            affected_rows: 4,
            evaluated_rows: 40,
            detail: "4 nulls",
          },
        ],
      },
      schema_drift: { datago__trade: [{ kind: "column_added", column: "pm25", detail: "new column" }] },
    });
    vi.spyOn(datasetsApi, "getBuildStageDetail").mockResolvedValue({
      run_id: runId,
      stage: "silver",
      source_key: "datago__trade",
      status: "completed",
      available: true,
      row_count: 40,
      schema: [{ name: "pm10", dtype: "Float64", nullable: true, unique_count: 30 }],
      statistics: null,
      validation: null,
      sample: [{ pm10: ROW_CANARY }],
    });

    const context: AssistantContext = {
      page: "dataset-detail",
      datasetId: "apt-trade",
      runId,
      stage: "silver",
      source: "datago__trade",
      provider: "datago",
      qualityResultIds: ["q"],
    };
    const { evidence, safeRunIds } = await loadAssistantEvidence(context);
    for (const part of ["dataset", "recentRuns", "stage", "quality", "catalog", "buildSpecSummary"] as const) {
      expect(evidence[part], `evidence.${part} is filled, so its fields are checked`).toBeDefined();
    }

    const fetchSpy = vi.fn(async (_url: string, _init: RequestInit) => new Response("data: [DONE]\n\n", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = createProvider({ apiKey: "sk-inventory", model: "m", baseUrl: "" });
    const built = buildAssistantMessages("question?", evidence);
    const evidenceAt = built.findIndex((message) => message.structuredContent !== undefined);
    for await (const _chunk of provider.stream(built, undefined, { safeRunIds })) {
      // drained
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    const sent = new Set<string>(["url"]);
    for (const name of Object.keys(init.headers as Record<string, string>)) sent.add(`header.${name}`);
    const { messages, ...rest } = body;
    leafPaths(rest, "body", sent);
    messages.forEach((message, index) => {
      sent.add(`body.messages[${index}].role`);
      sent.add(`body.messages[${index}].content`);
      // The evidence travels as JSON after the message's text (provider.ts prepareMessages).
      if (index === evidenceAt) leafPaths(JSON.parse(message.content.slice(message.content.indexOf("\n{") + 1)), "evidence", sent);
    });

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect([...sent].sort()).toEqual([...documentedPaths()].sort());

    const wire = `${url}\n${JSON.stringify(init)}`;
    for (const canary of [ROW_CANARY, PARAM_CANARY, METADATA_CANARY]) expect(wire).not.toContain(canary);
  });
});
