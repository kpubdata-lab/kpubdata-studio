/**
 * The publish page's redistribution gate (#639, #651, kpubdata-builder#688, contract
 * 1.65.0+): the verdict on the readiness card, the non-commercial confirmation, a
 * refused publish told apart from a readiness change, and the terms a publish went
 * out under.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describePublishFailure } from "@/features/publish/api";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import { ApiError } from "@/shared/lib/builderApi";
import {
  publishBlockedResponseSchema,
  publishHuggingFaceOptionsSchema,
  publishReadinessResponseSchema,
  publishRequestSchema,
  publishResponseSchema,
} from "@/shared/lib/builderApi.schema";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";

const NON_COMMERCIAL = {
  verdict: "non_commercial" as const,
  sources: [
    { source: "kosis__pop", verdict: "allowed" as const, reason: "KOGL type 1" },
    { source: "airkorea__pm", verdict: "non_commercial" as const, reason: "KOGL type 2 (no commercial use)" },
  ],
};

const UNCONFIRMED = { code: "non_commercial_unconfirmed", message: "the source terms allow non-commercial use only" };

const READINESS = {
  run_id: "run-7",
  target: "huggingface" as const,
  ready: false,
  blockers: [UNCONFIRMED],
  warnings: [],
  redistribution: NON_COMMERCIAL,
};

const SUCCESS = {
  run_id: "run-7",
  target: "huggingface" as const,
  publisher: "huggingface",
  destination: "owner/dataset",
  reference: "https://huggingface.co/datasets/owner/dataset",
  artifact_count: 3,
  status: "ok",
  redistribution: { ...NON_COMMERCIAL, kpubdata_version: "0.8.1", confirm_non_commercial: true },
};

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

function stubBuilder(readiness: unknown, publish: Response = response(200, SUCCESS)) {
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
    Promise.resolve(init.method === "POST" ? publish : response(200, readiness)),
  );
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

const confirmLabel = ko.publish.redistribution.confirmLabel;

beforeEach(() => vi.stubEnv("VITE_USE_REAL_BUILDER", "true"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("redistribution schemas (#639)", () => {
  it("parses the readiness verdict, null, and a Builder that does not send it", () => {
    expect(publishReadinessResponseSchema.parse(READINESS).redistribution).toEqual(NON_COMMERCIAL);
    expect(publishReadinessResponseSchema.parse({ ...READINESS, redistribution: null }).redistribution).toBeNull();
    const { redistribution: _r, ...older } = READINESS;
    expect(publishReadinessResponseSchema.parse(older).redistribution).toBeUndefined();
    expect(() => publishReadinessResponseSchema.parse({ ...READINESS, redistribution: { verdict: "maybe", sources: [] } })).toThrow();
  });

  it("parses the publish response's redistribution record", () => {
    expect(publishResponseSchema.parse(SUCCESS).redistribution).toEqual(SUCCESS.redistribution);
    expect(publishResponseSchema.parse({ ...SUCCESS, redistribution: { ...SUCCESS.redistribution, kpubdata_version: null } }).redistribution?.kpubdata_version).toBeNull();
    const { confirm_non_commercial: _c, ...withoutConfirm } = SUCCESS.redistribution;
    expect(() => publishResponseSchema.parse({ ...SUCCESS, redistribution: withoutConfirm })).toThrow();
  });

  it("parses a blocked 409's redistribution", () => {
    const body = { error: "not ready", blockers: [UNCONFIRMED], redistribution: NON_COMMERCIAL };
    expect(publishBlockedResponseSchema.parse(body).redistribution).toEqual(NON_COMMERCIAL);
  });

  it("sends confirm_non_commercial and still rejects any other option", () => {
    expect(publishHuggingFaceOptionsSchema.parse({ confirm_non_commercial: true })).toEqual({ private: true, confirm_non_commercial: true });
    expect(publishRequestSchema.parse({ target: "huggingface", destination: "o/d", options: { private: false, confirm_non_commercial: true } }).options).toEqual({ private: false, confirm_non_commercial: true });
    expect(() => publishHuggingFaceOptionsSchema.parse({ confirm_non_commercial: true, overwrite: true })).toThrow();
  });
});

describe("describePublishFailure tells a terms refusal from a readiness change (#639)", () => {
  it.each([
    "redistribution_forbidden",
    "redistribution_unknown",
    "non_commercial_unconfirmed",
    "non_commercial_marker_missing",
    "destination_public",
    "destination_visibility_unknown",
  ])("409 with %s is a redistribution refusal", (code) => {
    const blockers = [{ code, message: "raw" }];
    const failure = describePublishFailure(new ApiError(409, "raw", { error: "not ready", blockers, redistribution: NON_COMMERCIAL }));
    expect(failure).toEqual({ kind: "redistribution_blocked", message: ko.publish.errors.redistributionBlocked, blockers, redistribution: NON_COMMERCIAL });
  });

  it("409 whose blockers are not about the terms is a readiness change, though it carries the verdict", () => {
    const blockers = [{ code: "credential_unavailable", message: "raw" }];
    const failure = describePublishFailure(new ApiError(409, "raw", { error: "not ready", blockers, redistribution: { verdict: "allowed", sources: [] } }));
    expect(failure).toMatchObject({ kind: "readiness_changed", message: ko.publish.errors.readinessChanged, blockers });
  });

  it("409 without a parseable body is a readiness change", () => {
    expect(describePublishFailure(new ApiError(409, "raw", "<html>"))).toEqual({ kind: "readiness_changed", message: ko.publish.errors.readinessChanged });
  });
});

describe("BuildPublishPage redistribution (#639)", () => {
  it("shows the verdict and each source's reason on the readiness card", async () => {
    stubBuilder(READINESS);
    renderPublish();
    const summary = await screen.findByRole("region", { name: ko.publish.redistribution.title });
    expect(summary).toHaveTextContent(`판정: ${ko.publish.redistribution.values.non_commercial}`);
    expect(summary).toHaveTextContent(`airkorea__pm: ${ko.publish.redistribution.values.non_commercial} — KOGL type 2 (no commercial use)`);
    expect(summary).toHaveTextContent(`kosis__pop: ${ko.publish.redistribution.values.allowed} — KOGL type 1`);
  });

  it("offers the non-commercial confirmation and sends it, which clears the readiness blocker", async () => {
    const fetchMock = stubBuilder(READINESS);
    renderPublish();
    const checkbox = await screen.findByLabelText(confirmLabel);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(ko.publish.issues.non_commercial_unconfirmed.message)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeDisabled();

    fireEvent.click(checkbox);
    expect(screen.queryByText(ko.publish.issues.non_commercial_unconfirmed.message)).not.toBeInTheDocument();
    expect(screen.getByText("Builder 게시 준비 완료")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    expect(screen.getByLabelText("게시 최종 확인")).toHaveTextContent(ko.publish.redistribution.confirmed);
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));

    await screen.findByText("Builder 게시 완료");
    const post = fetchMock.mock.calls.find(([, init]) => init.method === "POST");
    expect(JSON.parse(post?.[1].body)).toEqual({
      target: "huggingface",
      destination: "owner/dataset",
      options: { private: true, confirm_non_commercial: true },
    });
    const success = screen.getByRole("status");
    expect(success).toHaveTextContent(ko.publish.redistribution.publishedUnder);
    expect(success).toHaveTextContent(`${ko.publish.redistribution.values.non_commercial} · ${ko.publish.redistribution.confirmed}`);
    expect(success).toHaveTextContent("0.8.1");
  });

  it.each([
    ["allowed", { verdict: "allowed", sources: [] }],
    ["unknown", { verdict: "unknown", sources: [] }],
    ["absent", undefined],
  ])("offers no confirmation for a %s verdict and sends none", async (_label, redistribution) => {
    const fetchMock = stubBuilder({ ...READINESS, ready: true, blockers: [], redistribution });
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");
    expect(screen.queryByLabelText(confirmLabel)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init.method === "POST")).toBe(true));
    const post = fetchMock.mock.calls.find(([, init]) => init.method === "POST");
    expect(JSON.parse(post?.[1].body).options).toEqual({ private: true });
  });

  it("does not offer a public publish when the terms are unknown", async () => {
    stubBuilder({ ...READINESS, ready: true, blockers: [], redistribution: { verdict: "unknown", sources: [] } });
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("비공개 Dataset"));
    expect(screen.getByText(ko.publish.redistribution.unknownPublicNote)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeDisabled();
  });

  it("shows a terms refusal with its blockers, not 'check readiness again'", async () => {
    const refused = response(409, {
      error: "not ready",
      blockers: [{ code: "destination_public", message: "the destination already exists and is public" }],
      redistribution: NON_COMMERCIAL,
    });
    stubBuilder(READINESS, refused);
    renderPublish();
    fireEvent.click(await screen.findByLabelText(confirmLabel));
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(ko.publish.errors.redistributionBlocked);
    expect(alert).not.toHaveTextContent(ko.publish.errors.readinessChanged);
    expect(alert).toHaveTextContent(ko.publish.issues.destination_public.message);
    expect(alert).toHaveTextContent(ko.publish.issues.destination_public.action);
    expect(within(alert).getByRole("region", { name: ko.publish.redistribution.title })).toHaveTextContent("airkorea__pm");
  });
});

describe("BuildPublishPage blocker messages (#644)", () => {
  it("shows Studio's sentence and next step with a link, and keeps Builder's detail", async () => {
    stubBuilder({ ...READINESS, blockers: [{ code: "license_missing", message: "BuildSpec.license must be declared" }], redistribution: null });
    renderPublish();
    const item = (await screen.findByText(ko.publish.issues.license_missing.message)).closest("li");
    expect(item).toHaveTextContent(ko.publish.issues.license_missing.action);
    expect(within(item as HTMLElement).getByRole("link", { name: ko.publish.issueLinks.editSpec })).toHaveAttribute("href", "/refresh-jobs/run-7/edit");
    expect(item).toHaveTextContent("BuildSpec.license must be declared");
  });

  it("shows an unknown code as a generic blocker naming the code", async () => {
    stubBuilder({ ...READINESS, blockers: [{ code: "source_key_path_collision", message: "two sources share a path" }], redistribution: null });
    renderPublish();
    expect(await screen.findByText(ko.publish.issues.unknown.message.replace("{{code}}", "source_key_path_collision"))).toBeInTheDocument();
    expect(screen.getByText("two sources share a path")).toBeInTheDocument();
  });

  it("has an English sentence for every code the Korean file has", () => {
    expect(Object.keys(en.publish.issues).sort()).toEqual(Object.keys(ko.publish.issues).sort());
  });
});
