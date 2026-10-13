/**
 * Applying Ask KPubData's table draft over one still waiting in the draft slot (#992).
 *
 * The slot holds one draft. Applying used to overwrite a waiting, unopened draft without a
 * word; now it asks first, cancelling keeps the waiting draft, and nothing is asked when the
 * slot is empty. A save the browser refused is reported, not shown as saved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AssistantDrawer } from "@/features/assistant/AssistantDrawer";
import { useAssistantSession, useAssistantStore } from "@/features/assistant/useAssistantSession";
import type { AssistantContext, AssistantTurn } from "@/features/assistant/types";
import { loadDraft, saveDraft } from "@/features/build-spec/draftStorage";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";
import { buildFormValuesSchema } from "@/shared/lib/schemas";

const ASK_KEY = "kpubdata-studio:new-build-draft";

const WAITING = {
  datasetId: "waiting_draft",
  title: "Waiting draft",
  description: "A draft nobody opened yet",
  provider: "datago",
  sourceDataset: "air_quality",
  sourceParams: "{}",
  outputPath: "artifacts/builds/waiting_draft",
  exportFormats: ["jsonl"],
};

function draftTurn(context: AssistantContext, approved = false): AssistantTurn {
  return {
    id: "turn-draft",
    question: "Make a table draft for apartment trades",
    context,
    createdAt: "2026-10-01T00:00:00.000Z",
    status: "ok",
    query: { status: "idle" },
    actionStates: approved ? { 0: { status: "approved" } } : {},
    response: {
      answer: "Here is a draft.",
      evidenceRefs: [],
      generatedSql: null,
      suggestedActions: [
        {
          type: "CREATE_BUILD_DRAFT",
          values: {
            datasetId: "apt_ask",
            title: "Ask apartment trades",
            description: "Draft from Ask KPubData",
            provider: "datago",
            sourceDataset: "apt_trade",
          },
          reason: "Requested dataset",
        },
      ],
    },
  };
}

const tr = (key: string) => i18n.t(key);
const storedDatasetId = () => loadDraft(buildFormValuesSchema)?.datasetId;

function renderDrawer() {
  return render(
    <MemoryRouter initialEntries={["/tables"]}>
      <Routes>
        <Route path="/tables" element={<p>tables</p>} />
        <Route path="/add" element={<p>add page</p>} />
      </Routes>
      <AssistantDrawer />
    </MemoryRouter>,
  );
}

async function approve() {
  fireEvent.click(await screen.findByRole("button", { name: tr("assistant.action.approve") }));
}

const applyButton = () => screen.findByRole("button", { name: tr("assistant.action.apply") });

beforeEach(() => {
  localStorage.clear();
  useAssistantStore.setState({ turns: [draftTurn({ page: "dataset-catalog" })], onboarded: true });
  useUIStore.setState({ isAssistantDrawerOpen: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  useAssistantStore.setState({ turns: [] });
  useUIStore.setState({ isAssistantDrawerOpen: false });
});

describe("Ask KPubData table draft over a waiting draft (#992)", () => {
  it("applies without asking when no draft is waiting", async () => {
    const confirm = vi.spyOn(window, "confirm");
    renderDrawer();
    await approve();
    expect(screen.queryByText(tr("assistant.action.replacesDraft"))).toBeNull();

    fireEvent.click(await applyButton());

    expect(await screen.findByText(tr("assistant.session.draftSaved"))).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(storedDatasetId()).toBe("apt_ask");
    expect(await screen.findByText("add page")).toBeInTheDocument();
  });

  it("warns before Apply and keeps the waiting draft when the replacement is cancelled", async () => {
    saveDraft(WAITING);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDrawer();
    await approve();
    expect(await screen.findByText(tr("assistant.action.replacesDraft"))).toBeInTheDocument();

    fireEvent.click(await applyButton());

    expect(confirm).toHaveBeenCalledWith(tr("assistant.session.replaceDraftConfirm"));
    expect(storedDatasetId()).toBe("waiting_draft");
    // Still on the same screen, and the action can still be applied later.
    expect(screen.getByText("tables")).toBeInTheDocument();
    expect(screen.queryByText(tr("assistant.session.draftSaved"))).toBeNull();
    expect(useAssistantStore.getState().turns[0].actionStates[0]).toEqual({ status: "approved" });
    expect(await applyButton()).toBeEnabled();
  });

  it("replaces the waiting draft once the replacement is confirmed", async () => {
    saveDraft(WAITING);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDrawer();
    await approve();

    fireEvent.click(await applyButton());

    expect(await screen.findByText(tr("assistant.session.draftSaved"))).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(storedDatasetId()).toBe("apt_ask");
  });

  it("reports a save the browser refused and keeps the waiting draft", async () => {
    saveDraft(WAITING);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key.includes(ASK_KEY)) throw new DOMException("quota", "QuotaExceededError");
      setItem.call(this, key, value);
    });
    renderDrawer();
    await approve();

    fireEvent.click(await applyButton());

    expect(await screen.findByText(tr("assistant.actions.draftNotSaved"))).toBeInTheDocument();
    expect(screen.queryByText(tr("assistant.session.draftSaved"))).toBeNull();
    expect(storedDatasetId()).toBe("waiting_draft");
    expect(screen.getByText("tables")).toBeInTheDocument();
  });

  it("neither asks nor writes for an action from a previous screen", async () => {
    saveDraft(WAITING);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    // Approved on the Add data screen; the person has since moved to the table list.
    useAssistantStore.setState({ turns: [draftTurn({ page: "add-data" }, true)] });
    const { result } = renderHook(() => useAssistantSession(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={["/tables"]}>{children}</MemoryRouter>
      ),
    });

    await act(async () => {
      await result.current.confirmApprovedAction("turn-draft", 0);
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(result.current.turns[0].actionStates[0]).toEqual({
      status: "error",
      message: tr("assistant.session.contextChangedApply"),
    });
    expect(storedDatasetId()).toBe("waiting_draft");
  });
});
