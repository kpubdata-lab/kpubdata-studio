/**
 * A publish that ended `publish_state_unknown` can be settled from the page (#728).
 *
 * Builder blocks a retry while it does not know whether the publish went through. Studio
 * only said "do not retry"; the two ways out Builder offers — check the remote, or reset
 * the record — were not called from anywhere. Neither may ever run on its own, and the
 * reset needs a second, explicit click.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishRecoveryPanel } from "@/features/publish/PublishRecoveryPanel";
import { reconcilePublish, resetPublishReceipt } from "@/features/publish/api";
import { resetVersionCheck } from "@/features/version-check/store";
import { BuildPublishPage } from "@/pages/BuildPublishPage";

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), text: async () => JSON.stringify(body) } as unknown as Response;
}

const RECONCILED = { run_id: "run-1", state: "succeeded", reconciled: true, fingerprint: "f1" };
const ABSENT = { run_id: "run-1", state: "reset", reconciled: true, retry_allowed: true, fingerprint: "f1" };
const RESET = { run_id: "run-1", state: "reset", retry_allowed: true, fingerprint: "f1" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("publish recovery calls (#728)", () => {
  it("reconcile posts the target and destination and reads a confirmed publish", async () => {
    fetchMock.mockResolvedValue(response(200, RECONCILED));

    const outcome = await reconcilePublish("run-1", "owner/data", undefined, { HF_TOKEN: "hf_secret" });

    expect(outcome).toEqual({ kind: "confirmed" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/builds\/run-1\/publish\/reconcile$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ target: "huggingface", destination: "owner/data" });
    // The credential travels in the header, never in the body or the URL (#615).
    expect(init.headers["X-Publish-Credential"]).toBe("HF_TOKEN=hf_secret");
    expect(String(url)).not.toContain("hf_secret");
    expect(init.body).not.toContain("hf_secret");
  });

  it("reconcile reports a publish that never arrived as absent", async () => {
    fetchMock.mockResolvedValue(response(200, ABSENT));
    expect(await reconcilePublish("run-1", "owner/data")).toEqual({ kind: "absent" });
  });

  it("reset deletes the receipt named by target and destination", async () => {
    fetchMock.mockResolvedValue(response(200, RESET));

    expect(await resetPublishReceipt("run-1", "owner/data")).toEqual({ kind: "reset" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
    expect(new URL(String(url)).searchParams.get("target")).toBe("huggingface");
    expect(new URL(String(url)).searchParams.get("destination")).toBe("owner/data");
  });

  it.each([
    [404, { error: "publish receipt not found", code: "receipt_not_found" }, "nothing_to_settle"],
    [503, { error: "remote state could not be determined; nothing was changed", code: "reconcile_unavailable" }, "unavailable"],
  ])("reads %i as %s, without retrying", async (status, body, kind) => {
    fetchMock.mockResolvedValue(response(status as number, body));

    expect((await reconcilePublish("run-1", "owner/data")).kind).toBe(kind);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not trust a response for another run", async () => {
    fetchMock.mockResolvedValue(response(200, { ...RECONCILED, run_id: "someone-elses-run" }));
    expect((await reconcilePublish("run-1", "owner/data")).kind).toBe("failed");
  });

  it("never echoes Builder's own error text", async () => {
    fetchMock.mockResolvedValue(response(500, { error: "Traceback: /srv/secret/path" }));

    const outcome = await reconcilePublish("run-1", "owner/data");

    expect(outcome.kind).toBe("failed");
    expect(JSON.stringify(outcome)).not.toContain("/srv/secret/path");
  });
});

describe("PublishRecoveryPanel (#728)", () => {
  function renderPanel(overrides: Partial<Parameters<typeof PublishRecoveryPanel>[0]> = {}) {
    const onRetryAllowed = vi.fn();
    render(
      <PublishRecoveryPanel
        runId="run-1"
        destination="owner/data"
        needsCredential={false}
        onRetryAllowed={onRetryAllowed}
        {...overrides}
      />,
    );
    return { onRetryAllowed };
  }

  it("calls nothing until a button is pressed", () => {
    renderPanel();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "원격 확인" })).toBeInTheDocument();
  });

  it("a confirmed publish offers no second publish", async () => {
    fetchMock.mockResolvedValue(response(200, RECONCILED));
    const { onRetryAllowed } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));

    expect(await screen.findByText(/게시는 이루어졌습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 게시 준비" })).not.toBeInTheDocument();
    expect(onRetryAllowed).not.toHaveBeenCalled();
  });

  it("an absent publish can be prepared again, by the user's own click", async () => {
    fetchMock.mockResolvedValue(response(200, ABSENT));
    const { onRetryAllowed } = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));
    fireEvent.click(await screen.findByRole("button", { name: "다시 게시 준비" }));

    expect(onRetryAllowed).toHaveBeenCalledTimes(1);
  });

  it("reset needs a second, explicit click and says what it does not undo", async () => {
    fetchMock.mockResolvedValue(response(200, RESET));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "기록 초기화" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/이미 올라간 것이 있다면 지워지지 않고/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "초기화 확정" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(await screen.findByText(/원격에 이미 올라간 것은 그대로입니다/)).toBeInTheDocument();
  });

  it("an unreadable remote changes nothing and offers no publish", async () => {
    fetchMock.mockResolvedValue(response(503, { error: "x", code: "reconcile_unavailable" }));
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));

    expect(await screen.findByText(/아무것도 바뀌지 않았습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 게시 준비" })).not.toBeInTheDocument();
  });

  const TOKEN_FIELD = "원격 확인에 쓸 Hugging Face 토큰";

  it("asks for no token where the deployment holds the credential", () => {
    renderPanel();
    expect(screen.queryByLabelText(TOKEN_FIELD)).not.toBeInTheDocument();
  });

  it("does not check the remote without the token a request-credential deployment needs", () => {
    renderPanel({ needsCredential: true });

    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("게시 토큰이 필요합니다");
  });

  it("sends the token typed into its own field, for that one request, then drops it (#749)", async () => {
    fetchMock.mockResolvedValue(response(200, RECONCILED));
    renderPanel({ needsCredential: true });

    fireEvent.change(screen.getByLabelText(TOKEN_FIELD), { target: { value: "hf_once" } });
    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].headers["X-Publish-Credential"]).toBe("HF_TOKEN=hf_once");
    expect(await screen.findByRole("status")).toHaveAttribute("data-recovery-outcome", "confirmed");
    expect(screen.getByLabelText(TOKEN_FIELD)).toHaveValue("");
    // A second check has no token to send: it asks again instead of going out bare.
    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a token the header cannot carry, and sends nothing", () => {
    renderPanel({ needsCredential: true });

    fireEvent.change(screen.getByLabelText(TOKEN_FIELD), { target: { value: "not a token" } });

    expect(screen.getByRole("button", { name: "원격 확인" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a reset neither sends the token nor uses it up (#749)", async () => {
    fetchMock.mockResolvedValue(response(200, RESET));
    renderPanel({ needsCredential: true });

    fireEvent.change(screen.getByLabelText(TOKEN_FIELD), { target: { value: "hf_kept" } });
    fireEvent.click(screen.getByRole("button", { name: "기록 초기화" }));
    fireEvent.click(screen.getByRole("button", { name: "초기화 확정" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[0][1].headers["X-Publish-Credential"]).toBeUndefined();
    expect(screen.getByLabelText(TOKEN_FIELD)).toHaveValue("hf_kept");
  });
});

/**
 * The panel inside the publish page (#749). The page's own token field starts the publish
 * form over when it changes — that took the panel away from the user it had just told to
 * enter a token there, leaving only the blind reset.
 */
describe("publish recovery on the publish page (#749)", () => {
  const READY = { run_id: "run-7", target: "huggingface", ready: true, blockers: [], warnings: [] };

  function pageFetch() {
    return vi.fn().mockImplementation((url: string, init: RequestInit) => {
      const path = String(url);
      if (path.endsWith("/version")) {
        return Promise.resolve(response(200, { service: "kpubdata-builder", api_version: "1.81.0", publish_credential: "request" }));
      }
      if (path.endsWith("/publish/reconcile")) return Promise.resolve(response(200, { ...RECONCILED, run_id: "run-7" }));
      if (path.endsWith("/publish") && init.method === "POST") {
        return Promise.resolve(response(409, { error: "the outcome of the earlier publish is not known", code: "publish_state_unknown" }));
      }
      return Promise.resolve(response(200, READY));
    });
  }

  const calls = (mock: ReturnType<typeof vi.fn>, suffix: string) =>
    (mock.mock.calls as Array<[string, RequestInit]>).filter(([url]) => String(url).endsWith(suffix));

  beforeEach(() => resetVersionCheck());
  afterEach(() => resetVersionCheck());

  it("unknown outcome → enter the token in the panel → check the remote → outcome shown", async () => {
    const mock = pageFetch();
    vi.stubGlobal("fetch", mock);
    render(
      <MemoryRouter initialEntries={["/refresh-jobs/run-7/publish"]}>
        <Routes><Route path="/refresh-jobs/:buildId/publish" element={<BuildPublishPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByText("Builder 게시 준비 완료");

    // Publish with a token; Builder answers that it does not know what became of it.
    fireEvent.change(screen.getByLabelText("Hugging Face 토큰"), { target: { value: "hf_publish" } });
    fireEvent.click(screen.getByRole("button", { name: "이 토큰으로 확인" }));
    await screen.findByText("Builder 게시 준비 완료");
    fireEvent.change(screen.getByLabelText("Hugging Face 게시 위치"), { target: { value: "owner/dataset" } });
    fireEvent.click(screen.getByRole("button", { name: "최종 확인" }));
    fireEvent.click(screen.getByRole("button", { name: "게시 실행" }));
    const panel = (await screen.findByRole("heading", { name: "게시 결과를 알 수 없을 때" })).closest("[data-publish-recovery]") as HTMLElement;
    // The publish dropped the page's token (#615), so the check has nothing to send yet.
    expect(screen.getByLabelText("Hugging Face 토큰")).toHaveValue("");

    fireEvent.click(within(panel).getByRole("button", { name: "원격 확인" }));
    expect(within(panel).getByRole("alert")).toHaveTextContent("바로 위 칸에 토큰을 입력");
    expect(calls(mock, "/publish/reconcile")).toHaveLength(0);

    // Typing the token where the panel asks for it keeps the panel.
    fireEvent.change(within(panel).getByLabelText("원격 확인에 쓸 Hugging Face 토큰"), { target: { value: "hf_recover" } });
    expect(panel).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "게시 결과를 알 수 없을 때" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "원격 확인" }));

    expect(await within(panel).findByRole("status")).toHaveAttribute("data-recovery-outcome", "confirmed");
    const reconcile = calls(mock, "/publish/reconcile");
    expect(reconcile).toHaveLength(1);
    expect((reconcile[0][1].headers as Record<string, string>)["X-Publish-Credential"]).toBe("HF_TOKEN=hf_recover");
    expect(JSON.parse(String(reconcile[0][1].body))).toEqual({ target: "huggingface", destination: "owner/dataset" });
    // A confirmed publish is never offered a second time.
    expect(within(panel).queryByRole("button", { name: "다시 게시 준비" })).not.toBeInTheDocument();
    expect(JSON.stringify({ ...localStorage })).not.toContain("hf_recover");
    expect(JSON.stringify({ ...sessionStorage })).not.toContain("hf_recover");
  });
});
