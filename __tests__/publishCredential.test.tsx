/**
 * The request-scoped publish token (#615, kpubdata-builder#925, contract 1.67.0).
 *
 * In a multi-user deployment Builder publishes only with the requester's token sent in
 * `X-Publish-Credential`. Studio keeps that token in memory only — these tests fail if it
 * reaches storage, the URL, a request body, a log or an error message, if the header is
 * missing from readiness or publish, or if it is sent when nothing was entered.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { describePublishFailure, publishCredentialFor, validatePublishToken } from "@/features/publish/api";
import { ensureVersionChecked, resetVersionCheck, useVersionCheckStore } from "@/features/version-check/store";
import { BuildPublishPage } from "@/pages/BuildPublishPage";
import {
  ApiError,
  builderApi,
  PUBLISH_CREDENTIAL_HEADER,
  publishCredentialHeaders,
} from "@/shared/lib/builderApi";

const TOKEN = "hf_test_token";
const HEADER_VALUE = `HF_TOKEN=${TOKEN}`;

const READY = { run_id: "run-7", target: "huggingface" as const, ready: true, blockers: [], warnings: [] };
const NEEDS_TOKEN = {
  ...READY,
  ready: false,
  blockers: [{
    code: "credential_required",
    message: "target 'huggingface' requires the requester's own credential, sent with this request in the X-Publish-Credential header",
  }],
};
const SUCCESS = {
  run_id: "run-7",
  target: "huggingface" as const,
  publisher: "huggingface",
  destination: "owner/dataset",
  reference: "https://huggingface.co/datasets/owner/dataset",
  artifact_count: 3,
  status: "ok",
};

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

type Call = [string, RequestInit];

function headerOf(call: Call): string | undefined {
  return (call[1].headers as Record<string, string> | undefined)?.[PUBLISH_CREDENTIAL_HEADER];
}

/** The page also reads the run (`getBuild`); only publish readiness and publish count here. */
function publishCalls(fetchMock: ReturnType<typeof vi.fn>): Call[] {
  return (fetchMock.mock.calls as Call[]).filter(([url]) => String(url).includes("/publish"));
}

/** A multi-user Builder: credential_required until the header arrives, then ready. */
function multiUserFetch() {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const sent = (init.headers as Record<string, string>)[PUBLISH_CREDENTIAL_HEADER];
    if (init.method === "POST") return Promise.resolve(response(sent ? 200 : 409, sent ? SUCCESS : { error: "blocked", blockers: NEEDS_TOKEN.blockers }));
    return Promise.resolve(response(200, sent ? READY : NEEDS_TOKEN));
  });
}

function renderPublish() {
  return render(
    <MemoryRouter initialEntries={["/refresh-jobs/run-7/publish"]}>
      <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
    </MemoryRouter>,
  );
}

const consoleSpies: MockInstance[] = [];

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  localStorage.clear();
  sessionStorage.clear();
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    consoleSpies.push(vi.spyOn(console, method));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const spy of consoleSpies.splice(0)) spy.mockRestore();
});

/** The token is nowhere it could outlive the request (#410 rules, #615). */
function expectTokenNotPersisted(fetchMock?: ReturnType<typeof vi.fn>) {
  expect(JSON.stringify(localStorage)).not.toContain(TOKEN);
  expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
  expect(window.location.href).not.toContain(TOKEN);
  expect(document.cookie).not.toContain(TOKEN);
  for (const spy of consoleSpies) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
  for (const call of (fetchMock?.mock.calls ?? []) as Call[]) {
    expect(call[0]).not.toContain(TOKEN);
    expect(String(call[1].body ?? "")).not.toContain(TOKEN);
  }
}

describe("X-Publish-Credential header (builderApi)", () => {
  it("is HF_TOKEN=<token> when a token is given and absent when it is empty", () => {
    expect(publishCredentialHeaders({ HF_TOKEN: TOKEN })).toEqual({ "X-Publish-Credential": HEADER_VALUE });
    expect(publishCredentialHeaders({ HF_TOKEN: "  " })).toEqual({});
    expect(publishCredentialHeaders(undefined)).toEqual({});
  });

  it("is sent on readiness and publish, never in the URL or the body", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(response(200, init.method === "POST" ? SUCCESS : READY)));
    vi.stubGlobal("fetch", fetchMock);

    await builderApi.getPublishReadiness("run-7", "huggingface", undefined, { HF_TOKEN: TOKEN });
    await builderApi.publishBuild("run-7", { target: "huggingface", destination: "owner/dataset" }, undefined, { HF_TOKEN: TOKEN });

    const calls = fetchMock.mock.calls as Call[];
    expect(calls.map(headerOf)).toEqual([HEADER_VALUE, HEADER_VALUE]);
    expect(calls[0][0]).toContain("/publish/readiness");
    expect(calls[1][0]).toContain("/publish");
    expectTokenNotPersisted(fetchMock);
  });

  it("is not sent without a credential", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(response(200, init.method === "POST" ? SUCCESS : READY)));
    vi.stubGlobal("fetch", fetchMock);

    await builderApi.getPublishReadiness("run-7", "huggingface");
    await builderApi.publishBuild("run-7", { target: "huggingface", destination: "owner/dataset" });

    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, undefined]);
  });
});

describe("publish token validation", () => {
  it("refuses what the header cannot carry, without echoing it", () => {
    expect(validatePublishToken("")).toBeUndefined();
    expect(validatePublishToken(TOKEN)).toBeUndefined();
    for (const bad of ["hf_a,HF_TOKEN=hf_b", "hf test", "hf_토큰"]) {
      const message = validatePublishToken(bad);
      expect(message).toBeDefined();
      expect(message).not.toContain(bad);
      expect(publishCredentialFor(bad)).toBeUndefined();
    }
    expect(publishCredentialFor(` ${TOKEN} `)).toEqual({ HF_TOKEN: TOKEN });
    expect(publishCredentialFor("")).toBeUndefined();
  });

  it("describes Builder's 400 invalid_publish_credential as a user message", () => {
    const failure = describePublishFailure(new ApiError(400, "raw", {
      error: "X-Publish-Credential must be '<VARIABLE>=<value>'",
      code: "invalid_publish_credential",
    }));
    expect(failure.kind).toBe("invalid_publish_credential");
    expect(failure.message).toContain("게시 토큰 형식");
  });
});

describe("BuildPublishPage in a multi-user deployment (#615)", () => {
  it("asks for a token on credential_required and sends it on readiness and publish only", async () => {
    const fetchMock = multiUserFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();

    expect(await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고 다시 확인하세요/)).toBeInTheDocument();
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined]);

    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    expect(screen.getByLabelText("Hugging Face 토큰")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await screen.findByText("Builder 게시 준비 완료");
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, HEADER_VALUE]);

    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    await screen.findByText("Builder 게시 완료");

    const posts = publishCalls(fetchMock).filter(([, init]) => init.method === "POST");
    expect(posts.map(headerOf)).toEqual([HEADER_VALUE]);
    expectTokenNotPersisted(fetchMock);
  });

  it("requires a fresh check after the token changes", async () => {
    vi.stubGlobal("fetch", multiUserFetch());
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await screen.findByText("Builder 게시 준비 완료");
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: `${TOKEN}_2` } });
    expect(screen.getByRole("button", { name: "최종 확인" })).toBeDisabled();
    expect(screen.getByText("이 토큰으로 게시 준비 상태를 다시 확인하세요.")).toBeInTheDocument();
  });

  it("refuses a malformed token locally and never sends it", async () => {
    const fetchMock = multiUserFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);

    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: `${TOKEN},HF_TOKEN=x` } });
    expect(screen.getByRole("alert")).toHaveTextContent("게시 토큰 형식");
    expect(screen.getByRole("button", { name: "이 토큰으로 확인" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeDisabled();
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined]);
  });

  it("shows Builder's 400 invalid_publish_credential without the token", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve((init.headers as Record<string, string>)[PUBLISH_CREDENTIAL_HEADER]
        ? response(400, { error: "X-Publish-Credential must be '<VARIABLE>=<value>'", code: "invalid_publish_credential" })
        : response(200, NEEDS_TOKEN)));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);

    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("게시 토큰 형식을 KPubData Builder가 받지 않습니다");
    expect(document.body.textContent).not.toContain(TOKEN);
    // The field stays so the token can be corrected.
    expect(screen.getByLabelText("Hugging Face 토큰")).toBeInTheDocument();
    expectTokenNotPersisted(fetchMock);
  });

  it("says when a deployment still needs a stored credential after a token was sent", async () => {
    // A single-user Builder that refuses the server credential ignores the header.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(200, NEEDS_TOKEN)));
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    expect(await screen.findByText(/토큰을 보냈는데도 KPubData Builder가 자격 증명을 요구합니다/)).toBeInTheDocument();
  });

  it("forgets the token and stops sending it", async () => {
    const fetchMock = multiUserFetch();
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await screen.findByText("Builder 게시 준비 완료");

    fireEvent.click(screen.getByRole("button", { name: "토큰 지우기" }));
    expect(screen.getByLabelText("Hugging Face 토큰")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(publishCalls(fetchMock)).toHaveLength(3));
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, HEADER_VALUE, undefined]);
  });
});

describe("BuildPublishPage drops the token once a publish starts (#615 review)", () => {
  /** Ready with a token, destination filled and confirmed; returns the publish button. */
  async function readyToPublish() {
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await screen.findByText("Builder 게시 준비 완료");
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    return screen.getByRole("button", { name: "게시 실행" });
  }

  /** Readiness as a multi-user Builder answers it; the POST answers `post`. */
  function fetchWithPost(post: () => Promise<Response>) {
    return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      if (init.method === "POST") return post();
      const sent = (init.headers as Record<string, string>)[PUBLISH_CREDENTIAL_HEADER];
      return Promise.resolve(response(200, sent ? READY : NEEDS_TOKEN));
    });
  }

  function expectTokenGone(fetchMock: ReturnType<typeof vi.fn>) {
    expect(screen.getByLabelText("Hugging Face 토큰")).toHaveValue("");
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expectTokenNotPersisted(fetchMock);
    // It was sent with the publish, then dropped.
    expect(publishCalls(fetchMock).filter(([, init]) => init.method === "POST").map(headerOf)).toEqual([HEADER_VALUE]);
    // Publishing again needs the token re-entered and readiness re-checked.
    expect(screen.getByRole("button", { name: "게시 실행" })).toBeDisabled();
    expect(screen.getByText("이 토큰으로 게시 준비 상태를 다시 확인하세요.")).toBeInTheDocument();
  }

  it.each([
    ["502 publish_failed", () => Promise.resolve(response(502, { error: "publish failed", code: "publish_failed" }))],
    ["409 blocked", () => Promise.resolve(response(409, { error: "blocked", blockers: NEEDS_TOKEN.blockers }))],
    ["a network error", () => Promise.reject(new TypeError("Failed to fetch"))],
  ] as const)("clears the token after a publish that fails with %s", async (_label, post) => {
    const fetchMock = fetchWithPost(post);
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(await readyToPublish());

    const failure = await screen.findByText("게시 실패");
    expect(failure.closest("[role=alert]")?.textContent).not.toContain(TOKEN);
    expectTokenGone(fetchMock);
  });

  it("clears the token after a successful publish", async () => {
    const fetchMock = fetchWithPost(() => Promise.resolve(response(200, SUCCESS)));
    vi.stubGlobal("fetch", fetchMock);
    fireEvent.click(await readyToPublish());

    await screen.findByText("Builder 게시 완료");
    expectTokenGone(fetchMock);
  });
});

describe("BuildPublishPage in a single-user deployment", () => {
  it("shows no token field and sends no header when Builder is ready", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) =>
      Promise.resolve(response(200, init.method === "POST" ? SUCCESS : READY)));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");
    expect(screen.queryByLabelText("Hugging Face 토큰")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    await screen.findByText("Builder 게시 완료");
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, undefined]);
  });
});

/**
 * Builder 1.69.0 says where it takes publish credentials from (`GET /version`
 * `publish_credential`, kpubdata-builder#938); the page follows it instead of guessing
 * from a `credential_required` blocker (#637). Without the value it guesses as before.
 */
describe("BuildPublishPage follows Builder's publish credential source (#637)", () => {
  const STORED_BLOCKED = {
    ...READY,
    ready: false,
    blockers: [{ code: "credential_required", message: "target 'huggingface' requires a credential stored for this principal" }],
  };

  function versionBody(source?: string) {
    return { service: "kpubdata-builder", api_version: "1.69.0", ...(source ? { publish_credential: source } : {}) };
  }

  /** `/version` answers with `source`; readiness and publish answer from `answer`. */
  function builderFetch(source: string | undefined, answer: (sent: string | undefined, init: RequestInit) => Response) {
    return vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (String(url).endsWith("/version")) return Promise.resolve(response(200, versionBody(source)));
      return Promise.resolve(answer((init.headers as Record<string, string> | undefined)?.[PUBLISH_CREDENTIAL_HEADER], init));
    });
  }

  /** Every request the page made, with the header it carried. */
  function sentHeaders(fetchMock: ReturnType<typeof vi.fn>) {
    return (fetchMock.mock.calls as Call[]).map(headerOf);
  }

  beforeEach(() => resetVersionCheck());
  afterEach(() => resetVersionCheck());

  it("request: offers the field before any blocker and sends what is entered", async () => {
    // Ready without a token, so only the declared source can bring the field up.
    const fetchMock = builderFetch("request", (_sent, init) =>
      response(200, init.method === "POST" ? SUCCESS : READY));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");

    const field = screen.getByLabelText("Hugging Face 토큰");
    fireEvent.change(field, { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await waitFor(() => expect(publishCalls(fetchMock)).toHaveLength(2));
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, HEADER_VALUE]);
    await screen.findByText("Builder 게시 준비 완료");

    // Still memory-only and dropped once the publish starts (#615).
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    await screen.findByText("Builder 게시 완료");
    expect(screen.getByLabelText("Hugging Face 토큰")).toHaveValue("");
    expectTokenNotPersisted(fetchMock);
  });

  it("request: a token Builder still refuses is not answered with 'store it in Builder'", async () => {
    const fetchMock = builderFetch("request", () => response(200, NEEDS_TOKEN));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    expect(await screen.findByText(/게시 위치에 쓸 수 있는 Hugging Face 토큰인지 확인하고/)).toBeInTheDocument();
    expect(screen.queryByText(/KPubData Builder에 저장하세요/)).not.toBeInTheDocument();
  });

  it("stored: no field, and credential_required asks for a credential stored in Builder", async () => {
    vi.stubGlobal("fetch", builderFetch("stored", () => response(200, STORED_BLOCKED)));
    renderPublish();
    expect(await screen.findByText(/KPubData Builder에 본인 Hugging Face publish 자격 증명을 저장한 뒤/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Hugging Face 토큰")).not.toBeInTheDocument();
    expect(screen.queryByText(/아래에 본인 Hugging Face 토큰을 입력하고/)).not.toBeInTheDocument();
  });

  it("stored: never sends X-Publish-Credential, through readiness, re-checks and publish", async () => {
    // Blocked until the requester stores a credential in Builder, then ready.
    let stored = false;
    const fetchMock = builderFetch("stored", (_sent, init) =>
      response(200, init.method === "POST" ? SUCCESS : stored ? READY : STORED_BLOCKED));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/KPubData Builder에 본인 Hugging Face publish 자격 증명을 저장한 뒤/);

    // Whatever the page offers, try to hand it a value.
    const field = screen.queryByLabelText("Hugging Face 토큰");
    if (field) {
      fireEvent.change(field, { target: { value: TOKEN } });
      fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
      await waitFor(() => expect(publishCalls(fetchMock)).toHaveLength(2));
    }

    stored = true;
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await screen.findByText("Builder 게시 준비 완료");
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    await screen.findByText("Builder 게시 완료");

    expect(publishCalls(fetchMock).length).toBeGreaterThanOrEqual(3);
    expect(sentHeaders(fetchMock).every((value) => value === undefined)).toBe(true);
  });

  it("stored learned after a value was entered: the held value is not sent", async () => {
    // The first /version fails, so the page guesses from the blocker and offers the field;
    // a later check (another page's banner) then learns the deployment is `stored`.
    let versionKnown = false;
    const fetchMock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      if (String(url).endsWith("/version")) {
        return Promise.resolve(versionKnown ? response(200, versionBody("stored")) : response(503, { error: "unavailable" }));
      }
      return Promise.resolve(response(200, init.method === "POST" ? SUCCESS : STORED_BLOCKED));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    fireEvent.change(await screen.findByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });

    versionKnown = true;
    await act(async () => {
      resetVersionCheck();
      await ensureVersionChecked();
    });
    expect(useVersionCheckStore.getState().publishCredential).toBe("stored");
    expect(screen.queryByLabelText("Hugging Face 토큰")).not.toBeInTheDocument();
    const before = publishCalls(fetchMock).length;
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() => expect(publishCalls(fetchMock).length).toBe(before + 1));
    expect(sentHeaders(fetchMock).every((value) => value === undefined)).toBe(true);
  });

  it("stored_or_server: no field even on a credential_required blocker", async () => {
    const fetchMock = builderFetch("stored_or_server", () => response(200, STORED_BLOCKED));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/KPubData Builder에 본인 Hugging Face publish 자격 증명을 저장한 뒤/);
    expect(screen.queryByLabelText("Hugging Face 토큰")).not.toBeInTheDocument();
    expect(sentHeaders(fetchMock).every((value) => value === undefined)).toBe(true);
  });

  it("stored_or_server: a ready Builder publishes without a field or header, as before", async () => {
    const fetchMock = builderFetch("stored_or_server", (_sent, init) =>
      response(200, init.method === "POST" ? SUCCESS : READY));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");
    expect(screen.queryByLabelText("Hugging Face 토큰")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    await screen.findByText("Builder 게시 완료");
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, undefined]);
  });

  it.each([
    ["an older Builder that does not say", undefined],
    ["a value Studio does not know", "per_tenant"],
  ])("%s: the field follows credential_required, as in #615", async (_label, source) => {
    const fetchMock = builderFetch(source, (sent) => response(200, sent ? READY : NEEDS_TOKEN));
    vi.stubGlobal("fetch", fetchMock);
    renderPublish();
    await screen.findByText(/아래에 본인 Hugging Face 토큰을 입력하고/);
    expect(useVersionCheckStore.getState().apiVersion).toBe("1.69.0");
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await screen.findByText("Builder 게시 준비 완료");
    expect(publishCalls(fetchMock).map(headerOf)).toEqual([undefined, HEADER_VALUE]);
  });

  it("an older Builder that is ready shows no field", async () => {
    vi.stubGlobal("fetch", builderFetch(undefined, () => response(200, READY)));
    renderPublish();
    await screen.findByText("Builder 게시 준비 완료");
    expect(screen.queryByLabelText("Hugging Face 토큰")).not.toBeInTheDocument();
  });
});
