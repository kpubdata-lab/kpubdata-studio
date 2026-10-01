/**
 * The data card preview on the publish page (#646, kpubdata-builder#906/#955, contract
 * 1.75.0): the card Builder wrote as `gold/<key>/card.json` (`DatasetCard`) is read through
 * the artifact routes and rendered section by section; a licence that differs from
 * kpubdata's declaration is flagged; an explicit "no transformation" is told apart from an
 * empty section.
 *
 * A 1.75.0 card says both facts in fields (`license_mismatch`, `processing_declared`), and
 * those win over the sentences. The 1.75.0 cases below word the sentences differently from
 * what the fields say — the contract warns the wording may change — so reading the
 * sentences instead of the fields fails them. Cards written before 1.75.0 (`SINGLE_CARD`,
 * `JOINED_CARD`) lack the fields and go through the sentence fallback.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cardLicence, cardPaths, cardProcessing, classifyProcessingStep, splitCardLicence } from "@/features/publish/card";
import { datasetCardSchema } from "@/shared/lib/builderApi.schema";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";

const READINESS = { run_id: "run-7", target: "huggingface", ready: true, blockers: [], warnings: [] };

/** A card as Builder wrote it before contract 1.75.0 (kpubdata-builder#906): no structured fields. */
const SINGLE_CARD = {
  card_version: 1,
  title: "Air quality",
  provenance: [
    {
      source: "airkorea.pm",
      institution: "Korea Environment Corporation",
      url: "https://www.data.go.kr/data/15073861/openapi.do",
      license: "cc-by-4.0; the provider declares: KOGL type 1",
      collected_at: "2026-09-30 12:00 UTC",
    },
  ],
  processing: ["No transformation declared: values are as the source gave them."],
  personal_information:
    "No column was declared personal information. Values were not scanned for personal information (no pii policy).",
};

const JOINED_CARD = {
  card_version: 1,
  title: "Joined",
  provenance: [
    { source: "left", institution: "A", url: "https://a.example", license: "KOGL type 1", collected_at: "2026-09-30 12:00 UTC" },
    { source: "right", institution: "B", url: "uploaded file", license: "KOGL type 1", collected_at: "" },
  ],
  processing: [
    "left: Renamed SIDO to sido",
    "right: No transformation declared: values are as the source gave them.",
    "Joined left and right (inner join)",
  ],
  personal_information: "",
};

/** 1.75.0: a mismatch the fields state, worded unlike the pre-1.75.0 sentence. */
const FIELD_MISMATCH_CARD = {
  card_version: 1,
  title: "Air quality",
  provenance: [
    {
      source: "airkorea.pm",
      institution: "Korea Environment Corporation",
      url: "https://www.data.go.kr/data/15073861/openapi.do",
      license: "CC-BY-4.0 (the provider says KOGL-1)",
      collected_at: "2026-09-30 12:00 UTC",
      license_declared: "CC-BY-4.0",
      license_provider: "KOGL-1",
      license_mismatch: true,
    },
  ],
  processing: ["Renamed v to value"],
  processing_declared: true,
  personal_information: "No column was declared personal information.",
};

/** 1.75.0: no mismatch and no processing, whatever the sentences look like. */
const FIELD_PLAIN_CARD = {
  card_version: 1,
  title: "Survey",
  provenance: [
    {
      source: "survey",
      institution: "Example Institute",
      url: "uploaded file",
      license: "CC-BY-4.0; the provider declares: CC-BY-4.0 international",
      collected_at: "2026-09-30 12:00 UTC",
      license_declared: "CC-BY-4.0",
      license_provider: "CC-BY-4.0 international",
      license_mismatch: false,
    },
  ],
  processing: ["Nothing was declared; values are kept."],
  processing_declared: false,
  personal_information: "No column was declared personal information.",
};

/** 1.75.0: a composed output — two provenance entries, ending with its join. */
const FIELD_JOINED_CARD = {
  card_version: 1,
  title: "Joined",
  provenance: [
    { source: "left", institution: "A", url: "https://a.example", license: "KOGL-1", collected_at: "2026-09-30 12:00 UTC", license_declared: "KOGL-1", license_provider: null, license_mismatch: false },
    { source: "right", institution: "B", url: "https://b.example", license: "KOGL-1", collected_at: "2026-09-30 12:00 UTC", license_declared: "KOGL-1", license_provider: null, license_mismatch: false },
  ],
  processing: ["left: Renamed SIDO to sido", "Combined left with right on sido (inner)"],
  processing_declared: true,
  personal_information: "No column was declared personal information.",
};

function json(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function file(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    blob: async () => new Blob([JSON.stringify(body)], { type: "application/octet-stream" }),
  } as unknown as Response;
}

function stubBuilder(files: string[], cards: Record<string, unknown>) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    const path = new URL(url, "http://localhost").pathname;
    if (path.endsWith("/artifacts/run-7")) return Promise.resolve(json(200, { run_id: "run-7", files }));
    const card = Object.entries(cards).find(([name]) => path.endsWith(`/artifacts/run-7/${name}`));
    if (card) return Promise.resolve(file(card[1]));
    return Promise.resolve(json(200, READINESS));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPublish() {
  return render(
    <MemoryRouter initialEntries={["/refresh-jobs/run-7/publish"]}>
      <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("card.json reading (#646)", () => {
  it("finds each Gold output's own card, not the copies in export layouts", () => {
    expect(
      cardPaths([
        "manifest.json",
        "gold/airkorea.pm/card.json",
        "gold/airkorea.pm/README.md",
        "gold/airkorea.pm/hf/card.json",
        "silver/airkorea.pm/card.json",
        "gold/joined/card.json",
      ]),
    ).toEqual([
      { key: "airkorea.pm", path: "gold/airkorea.pm/card.json" },
      { key: "joined", path: "gold/joined/card.json" },
    ]);
  });

  it("splits a licence that differs from the provider's declaration", () => {
    expect(splitCardLicence("cc-by-4.0; the provider declares: KOGL type 1")).toEqual({ declared: "cc-by-4.0", provider: "KOGL type 1", mismatch: true });
    expect(splitCardLicence("KOGL type 1")).toEqual({ declared: "KOGL type 1", provider: null, mismatch: false });
  });

  it("recognizes the explicit no-processing step, prefixed or not, and a join step", () => {
    expect(classifyProcessingStep("No transformation declared: values are as the source gave them.").kind).toBe("none");
    expect(classifyProcessingStep("right: No transformation declared: values are as the source gave them.")).toMatchObject({ kind: "none", source: "right" });
    expect(classifyProcessingStep("Joined left and right (inner join)")).toEqual({ kind: "join", text: "Joined left and right (inner join)" });
    expect(classifyProcessingStep("Renamed SIDO to sido").kind).toBe("step");
  });
});

describe("card fields (contract 1.75.0)", () => {
  it("parses a card with and without the 1.75.0 fields, and refuses one missing a required section", () => {
    expect(datasetCardSchema.parse(FIELD_MISMATCH_CARD).processing_declared).toBe(true);
    expect(datasetCardSchema.parse(SINGLE_CARD).processing_declared).toBeUndefined();
    expect(datasetCardSchema.parse(FIELD_JOINED_CARD).provenance[0].license_provider).toBeNull();
    const { processing: _p, ...noProcessing } = SINGLE_CARD;
    expect(datasetCardSchema.safeParse(noProcessing).success).toBe(false);
  });

  it("reads the licence from the fields when they are there, from the sentence otherwise", () => {
    const fields = datasetCardSchema.parse(FIELD_MISMATCH_CARD).provenance[0];
    expect(cardLicence(fields)).toEqual({ declared: "CC-BY-4.0", provider: "KOGL-1", mismatch: true });
    const plain = datasetCardSchema.parse(FIELD_PLAIN_CARD).provenance[0];
    expect(cardLicence(plain)?.mismatch).toBe(false);
    const older = datasetCardSchema.parse(SINGLE_CARD).provenance[0];
    expect(cardLicence(older)).toEqual({ declared: "cc-by-4.0", provider: "KOGL type 1", mismatch: true });
  });

  it("reads no processing and the join from the fields when they are there", () => {
    expect(cardProcessing(datasetCardSchema.parse(FIELD_PLAIN_CARD))).toEqual({
      kind: "steps",
      steps: [{ kind: "none", source: null, text: "Nothing was declared; values are kept." }],
    });
    const joined = cardProcessing(datasetCardSchema.parse(FIELD_JOINED_CARD));
    expect(joined.kind === "steps" && joined.steps.map((step) => step.kind)).toEqual(["step", "join"]);
    expect(cardProcessing({ ...datasetCardSchema.parse(FIELD_PLAIN_CARD), processing: [] })).toEqual({ kind: "empty" });
  });
});

describe("publish page card preview, 1.75.0 fields (#646)", () => {
  it("flags the mismatch license_mismatch states, with license_declared and license_provider", async () => {
    stubBuilder(["gold/airkorea.pm/card.json"], { "gold/airkorea.pm/card.json": FIELD_MISMATCH_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    const licence = output.querySelector('[data-card-field="licence"]') as HTMLElement;
    expect(within(licence).getByText("CC-BY-4.0")).toBeInTheDocument();
    const badge = within(licence).getByText(ko.publish.card.licenceMismatch).closest("[data-status]");
    expect(badge).toHaveAttribute("data-status", "actionable");
    expect(badge).toHaveAttribute("data-tone", "warning");
    expect(within(licence).getByText("KPubData 카탈로그 선언: KOGL-1")).toBeInTheDocument();
    expect(output.querySelector('[data-processing="none"]')).toBeNull();
  });

  it("does not flag a licence whose license_mismatch is false, whatever its sentence", async () => {
    stubBuilder(["gold/survey/card.json"], { "gold/survey/card.json": FIELD_PLAIN_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 survey" });
    expect(output.querySelector("[data-licence-mismatch]")).toBeNull();
    expect(within(output).queryByText(ko.publish.card.licenceMismatch)).not.toBeInTheDocument();
  });

  it("says no processing when processing_declared is false, apart from an empty section", async () => {
    stubBuilder(["gold/survey/card.json", "gold/empty/card.json"], {
      "gold/survey/card.json": FIELD_PLAIN_CARD,
      "gold/empty/card.json": { ...FIELD_PLAIN_CARD, processing: [] },
    });
    renderPublish();

    const none = await screen.findByRole("region", { name: "Gold 출력 survey" });
    const step = none.querySelector('[data-processing="none"]') as HTMLElement;
    expect(step).not.toBeNull();
    expect(within(step).getByText(ko.publish.card.noProcessing)).toHaveAttribute("data-status", "normal");
    expect(within(step).getByText("Nothing was declared; values are kept.")).toBeInTheDocument();
    expect(within(none).queryByText(ko.publish.card.empty)).not.toBeInTheDocument();

    const empty = await screen.findByRole("region", { name: "Gold 출력 empty" });
    expect(empty.querySelector('[data-processing="none"]')).toBeNull();
    expect(within(empty).getByText(ko.publish.card.empty).closest("[data-status]")).toHaveAttribute("data-tone", "failure");
  });

  it("labels a composed output's last step as its join", async () => {
    stubBuilder(["gold/joined/card.json"], { "gold/joined/card.json": FIELD_JOINED_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 joined" });
    const join = output.querySelector('[data-processing="join"]') as HTMLElement;
    expect(within(join).getByText(ko.publish.card.joinLabel)).toBeInTheDocument();
    expect(within(join).getByText("Combined left with right on sido (inner)")).toBeInTheDocument();
    expect(output.querySelectorAll('[data-processing="join"]')).toHaveLength(1);
    expect(within(output).getByText("left: Renamed SIDO to sido").closest("li")).toHaveAttribute("data-processing", "step");
  });
});

describe("publish page card preview, pre-1.75.0 sentence fallback (#646)", () => {
  it("renders the real card response section by section", async () => {
    const fetchMock = stubBuilder(["manifest.json", "gold/airkorea.pm/card.json"], { "gold/airkorea.pm/card.json": SINGLE_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/artifacts/run-7/gold/airkorea.pm/card.json"))).toBe(true);
    for (const label of [ko.publish.card.sections.provenance, ko.publish.card.sections.processing, ko.publish.card.sections.personalInformation]) {
      expect(within(output).getByText(label)).toBeInTheDocument();
    }
    expect(within(output).getByText("Korea Environment Corporation")).toBeInTheDocument();
    expect(within(output).getByRole("link", { name: "https://www.data.go.kr/data/15073861/openapi.do" })).toBeInTheDocument();
    expect(within(output).getByText("2026-09-30 12:00 UTC")).toBeInTheDocument();
    expect(within(output).getByText(/No column was declared personal information/)).toBeInTheDocument();
  });

  it("flags a licence that differs from the KPubData catalogue's declaration", async () => {
    stubBuilder(["gold/airkorea.pm/card.json"], { "gold/airkorea.pm/card.json": SINGLE_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    const licence = output.querySelector('[data-card-field="licence"]') as HTMLElement;
    expect(within(licence).getByText("cc-by-4.0")).toBeInTheDocument();
    const badge = within(licence).getByText(ko.publish.card.licenceMismatch).closest("[data-status]");
    expect(badge).toHaveAttribute("data-status", "actionable");
    expect(badge).toHaveAttribute("data-tone", "warning");
    expect(within(licence).getByText("KPubData 카탈로그 선언: KOGL type 1")).toBeInTheDocument();
  });

  it("does not flag a licence that matches", async () => {
    stubBuilder(["gold/joined/card.json"], { "gold/joined/card.json": JOINED_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 joined" });
    expect(output.querySelector("[data-licence-mismatch]")).toBeNull();
    expect(within(output).queryByText(ko.publish.card.licenceMismatch)).not.toBeInTheDocument();
  });

  it("says no processing explicitly, apart from an empty section", async () => {
    stubBuilder(["gold/airkorea.pm/card.json", "gold/joined/card.json"], {
      "gold/airkorea.pm/card.json": SINGLE_CARD,
      "gold/joined/card.json": { ...JOINED_CARD, processing: [] },
    });
    renderPublish();

    const none = await screen.findByRole("region", { name: "Gold 출력 airkorea.pm" });
    const step = none.querySelector('[data-processing="none"]') as HTMLElement;
    expect(step).not.toBeNull();
    expect(within(step).getByText(ko.publish.card.noProcessing)).toHaveAttribute("data-status", "normal");
    expect(within(none).queryByText(ko.publish.card.empty)).not.toBeInTheDocument();

    const empty = await screen.findByRole("region", { name: "Gold 출력 joined" });
    expect(empty.querySelector('[data-card-section="processing"]')).toBeNull();
    expect(empty.querySelector('[data-processing="none"]')).toBeNull();
    const blanks = within(empty).getAllByText(ko.publish.card.empty);
    expect(blanks.every((badge) => badge.closest("[data-status]")?.getAttribute("data-tone") === "failure")).toBe(true);
  });

  it("shows a composed Gold's join step and each side's explicit no-processing", async () => {
    stubBuilder(["gold/joined/card.json"], { "gold/joined/card.json": JOINED_CARD });
    renderPublish();

    const output = await screen.findByRole("region", { name: "Gold 출력 joined" });
    const join = output.querySelector('[data-processing="join"]') as HTMLElement;
    expect(within(join).getByText(ko.publish.card.joinLabel)).toBeInTheDocument();
    expect(within(join).getByText("Joined left and right (inner join)")).toBeInTheDocument();
    expect(within(output).getByText("right: 처리 없음")).toBeInTheDocument();
    expect(within(output).getByText("left: Renamed SIDO to sido")).toBeInTheDocument();
    // Empty collected date and personal information block publishing, so they are marked, not blank.
    expect(within(output).getAllByText(ko.publish.card.empty)).toHaveLength(2);
    expect(within(output).getByText("uploaded file")).toBeInTheDocument();
  });

  it("says a run has no card when its Gold outputs carry none", async () => {
    stubBuilder(["manifest.json", "gold/airkorea.pm/table.parquet"], {});
    renderPublish();

    expect(await screen.findByText(ko.publish.card.none.title)).toBeInTheDocument();
  });

  it("explains a card Builder withholds by policy, and never echoes an error body", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/artifacts/run-7")) return Promise.resolve(json(200, { run_id: "run-7", files: ["gold/a/card.json", "gold/b/card.json"] }));
      if (path.endsWith("/artifacts/run-7/gold/a/card.json")) {
        return Promise.resolve(json(403, { error: "forbidden", code: "redistribution_forbidden", redistribution: { verdict: "forbidden", sources: [] } }));
      }
      if (path.endsWith("/artifacts/run-7/gold/b/card.json")) return Promise.resolve(json(500, { error: "<b>raw secret html</b>" }));
      return Promise.resolve(json(200, READINESS));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();

    const refused = await screen.findByRole("region", { name: "Gold 출력 a" });
    expect(await within(refused).findByText(ko.publish.card.refused.redistribution_forbidden)).toBeInTheDocument();
    const failed = screen.getByRole("region", { name: "Gold 출력 b" });
    expect(within(failed).getByText(/이 카드를 읽지 못했습니다\. \(HTTP 상태 500\)/)).toBeInTheDocument();
    expect(screen.queryByText(/raw secret html/)).not.toBeInTheDocument();
  });

  it("shows nothing invented in demo mode", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "false");
    renderPublish();

    expect(await screen.findByText(ko.publish.card.demo)).toHaveAttribute("data-status", "not-evaluated");
  });
});

describe("card preview labels (#646)", () => {
  it("has every card section label in both languages", () => {
    const keys = ["title", "sections", "fields", "licenceMismatch", "noProcessing", "joinLabel", "empty", "none"] as const;
    for (const key of keys) {
      expect(ko.publish.card[key]).toBeTruthy();
      expect(en.publish.card[key]).toBeTruthy();
    }
    expect(Object.keys(ko.publish.card.sections)).toEqual(Object.keys(en.publish.card.sections));
    expect(Object.keys(ko.publish.card.fields)).toEqual(Object.keys(en.publish.card.fields));
    expect(Object.keys(ko.publish.card.refused).sort()).toEqual(["declared_pii_withheld", "pii_declaration_unavailable", "redistribution_forbidden"]);
  });
});
