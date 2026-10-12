/**
 * The server-state policy, held on every screen (#902; ARCHITECTURE.md, "서버 상태 정책").
 *
 * `runsStatePolicy.test.tsx` holds it on the runs screens, which put the owner key in
 * their own effects. Every other screen is held by the boundary the layout draws around
 * the page, the command palette and the assistant: another account signing in (a new
 * issuer#subject owner key) remounts what is inside, so what a screen loaded is dropped
 * and what it still has in flight is aborted — without the screen knowing about accounts.
 * What Studio remembers outside a screen is forgotten in the same step.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState, type ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Layout } from "@/app/Layout";
import { resetAdminCheck, useAdminStore } from "@/features/admin/store";
import type { AssistantTurn } from "@/features/assistant/types";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import { OwnerScope } from "@/features/auth/OwnerScope";
import { useAuthStore } from "@/features/auth/store";
import { useAsync } from "@/features/runs/asyncState";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { ApiError, builderApi, resetAuthRenewalForTests } from "@/shared/lib/builderApi";
import { clearSessionRefusal } from "@/shared/lib/sessionRefusal";
import { clearSignupBlock, noteSignupBlock, useSignupStatusStore } from "@/shared/lib/signupStatus";

function signInAs(userId: string) {
  act(() => {
    useAuthStore.getState().setOidcIdentity({
      email: `${userId}@example.test`,
      name: userId,
      userId,
      issuer: "https://idp.example.test/realms/kpubdata",
    });
  });
}

/** A promise held open. */
function held<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** What a screen is asked for, in order, with the signal of each request. */
function recorder(answers: Array<string | Promise<string>>) {
  const signals: AbortSignal[] = [];
  const load = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    return answers[signals.length - 1];
  });
  return { load, signals };
}

/** A screen that knows nothing about accounts: it loads on mount and keeps what it typed. */
function Screen({ load }: { load: (signal: AbortSignal) => Promise<string> }) {
  const rows = useAsync(load, [load], "failed");
  const [draft, setDraft] = useState("");
  return (
    <section>
      <output data-testid="rows">{rows.status === "loaded" ? rows.data : rows.status}</output>
      <input aria-label="draft" onChange={(event) => setDraft(event.target.value)} value={draft} />
    </section>
  );
}

/** A screen with its own effect and controller, as most pages have. */
function HandRolledScreen({ load }: { load: (signal: AbortSignal) => Promise<string> }) {
  const [rows, setRows] = useState("loading");
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal).then((value) => {
      if (!controller.signal.aborted) setRows(value);
    });
    return () => controller.abort();
  }, [load]);
  return <output data-testid="rows">{rows}</output>;
}

function renderInLayout(page: ReactElement) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<Layout />} path="/">
          <Route element={page} index />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  act(() =>
    useUIStore.setState({
      theme: "light",
      isMobileSidebarOpen: false,
      isDesktopSidebarCollapsed: false,
      isAssistantDrawerOpen: false,
    }),
  );
  clearSessionRefusal();
  clearSignupBlock();
  resetAuthRenewalForTests();
  resetAdminCheck();
  useAssistantStore.getState().forgetSession();
});

afterEach(() => {
  act(() => useAuthStore.getState().clear());
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("another account signing in drops what any screen held", () => {
  it("the boundary: loaded again for the new owner, the earlier request aborted, a late answer dropped", async () => {
    signInAs("alice");
    const bobs = held<string>();
    const { load, signals } = recorder(["alice-rows", bobs.promise, "carol-rows"]);

    render(
      <OwnerScope>
        <Screen load={load} />
      </OwnerScope>,
    );
    expect(await screen.findByText("alice-rows")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "alice typed this" } });

    signInAs("bob");
    // Alice's rows and what she typed are gone before Bob's answer is in.
    expect(screen.queryByText("alice-rows")).not.toBeInTheDocument();
    expect(screen.getByLabelText("draft")).toHaveValue("");
    expect(load).toHaveBeenCalledTimes(2);

    signInAs("carol");
    expect(signals[1].aborted).toBe(true);
    expect(await screen.findByText("carol-rows")).toBeInTheDocument();

    await act(async () => bobs.resolve("bob-rows"));
    expect(screen.queryByText("bob-rows")).not.toBeInTheDocument();
    expect(screen.getByTestId("rows")).toHaveTextContent("carol-rows");
  });

  it("the same owner signing in again — a renewed token — keeps the screen", async () => {
    signInAs("alice");
    const { load } = recorder(["alice-rows", "asked-twice"]);
    render(
      <OwnerScope>
        <Screen load={load} />
      </OwnerScope>,
    );
    expect(await screen.findByText("alice-rows")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("draft"), { target: { value: "kept" } });

    signInAs("alice");

    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("draft")).toHaveValue("kept");
  });

  it("the layout draws the boundary around the page", async () => {
    signInAs("alice");
    const alices = held<string>();
    const { load, signals } = recorder([alices.promise, "bob-rows"]);
    renderInLayout(<HandRolledScreen load={load} />);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    signInAs("bob");

    expect(signals[0].aborted).toBe(true);
    expect(await screen.findByText("bob-rows")).toBeInTheDocument();
    await act(async () => alices.resolve("alice-rows"));
    expect(screen.queryByText("alice-rows")).not.toBeInTheDocument();
  });
});

describe("what Studio remembers outside a screen is forgotten with the account", () => {
  it("the administrator answer: forgotten, asked again, and a late answer for the earlier account dropped", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    const alices = held<never>();
    const probe = vi
      .spyOn(builderApi, "adminConfig")
      .mockImplementationOnce(() => alices.promise)
      .mockRejectedValue(new ApiError(403, "forbidden"));
    signInAs("alice");
    renderInLayout(<p>page</p>);
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(1));

    signInAs("bob");
    await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(useAdminStore.getState().status).toBe("not_admin"));

    // Alice was an administrator; her answer arrives after Bob signed in.
    await act(async () => alices.resolve(undefined as never));
    expect(useAdminStore.getState().status).toBe("not_admin");
  });

  it("an administrator's menu does not stay for the next account", async () => {
    vi.stubEnv("VITE_USE_REAL_BUILDER", "true");
    vi.spyOn(builderApi, "adminConfig")
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValue(new ApiError(403, "forbidden"));
    signInAs("alice");
    renderInLayout(<p>page</p>);
    await vi.waitFor(() => expect(useAdminStore.getState().status).toBe("admin"));

    signInAs("bob");

    await vi.waitFor(() => expect(useAdminStore.getState().status).toBe("not_admin"));
  });

  it("the assistant's conversation and a question waiting to be asked", () => {
    signInAs("alice");
    const turn = { id: "t1", question: "내 테이블 몇 행이야?", status: "ok" } as AssistantTurn;
    act(() => {
      useAssistantStore.getState().addTurn(turn);
      useAssistantStore.setState({ pendingSeed: "alice's question" });
    });

    signInAs("bob");

    expect(useAssistantStore.getState().turns).toEqual([]);
    expect(useAssistantStore.getState().pendingSeed).toBeNull();
  });

  it("a held-back sign-up was the earlier account's", () => {
    signInAs("alice");
    act(() => noteSignupBlock(403, { error: "pending", code: "signup_pending" }));
    expect(useSignupStatusStore.getState().block).toBe("pending");

    signInAs("bob");

    expect(useSignupStatusStore.getState().block).toBeNull();
  });

  it("signing out forgets them too", () => {
    signInAs("alice");
    act(() => useAssistantStore.getState().addTurn({ id: "t1", question: "q", status: "ok" } as AssistantTurn));

    act(() => useAuthStore.getState().clear());

    expect(useAssistantStore.getState().turns).toEqual([]);
  });
});
