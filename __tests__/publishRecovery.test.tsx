/**
 * A publish that ended `publish_state_unknown` can be settled from the page (#728).
 *
 * Builder blocks a retry while it does not know whether the publish went through. Studio
 * only said "do not retry"; the two ways out Builder offers — check the remote, or reset
 * the record — were not called from anywhere. Neither may ever run on its own, and the
 * reset needs a second, explicit click.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublishRecoveryPanel } from "@/features/publish/PublishRecoveryPanel";
import { reconcilePublish, resetPublishReceipt } from "@/features/publish/api";

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
    const takeCredential = vi.fn(() => undefined);
    render(
      <PublishRecoveryPanel
        runId="run-1"
        destination="owner/data"
        needsCredential={false}
        takeCredential={takeCredential}
        onRetryAllowed={onRetryAllowed}
        {...overrides}
      />,
    );
    return { onRetryAllowed, takeCredential };
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

  it("does not check the remote without the token a request-credential deployment needs", () => {
    const { takeCredential } = renderPanel({ needsCredential: true });

    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));

    expect(takeCredential).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("게시 토큰이 필요합니다");
  });

  it("sends the token it was handed in the header, for that one request", async () => {
    fetchMock.mockResolvedValue(response(200, RECONCILED));
    renderPanel({ needsCredential: true, takeCredential: vi.fn(() => ({ HF_TOKEN: "hf_once" })) });

    fireEvent.click(screen.getByRole("button", { name: "원격 확인" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].headers["X-Publish-Credential"]).toBe("HF_TOKEN=hf_once");
  });
});
