/**
 * The one creation flow's waiting drafts, driven through the real Ask KPubData drawer.
 *
 * - #604: a draft approved while `/add` is already open is offered at once (approving
 *   navigates to the same route, which does not mount the page again), and opening it
 *   keeps what was being typed.
 * - #605: a saved draft of the wrong shape is not handed to the form; it is removed with a
 *   notice while the Ask KPubData draft and the current input stay.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AddDataPage } from "./AddDataPage";
import { AssistantDrawer } from "@/features/assistant/AssistantDrawer";
import { useAssistantStore } from "@/features/assistant/useAssistantSession";
import type { AssistantContext, AssistantTurn } from "@/features/assistant/types";
import { loadAddDataDraft, saveAddDataDraft } from "@/features/add-data/draftStorage";
import { INITIAL_DRAFT } from "@/features/add-data/model";
import { saveDraft } from "@/features/build-spec/draftStorage";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { i18n } from "@/shared/i18n";

const SAVED_KEY = "kpubdata-studio:add-data-draft";
const ASK_KEY = "kpubdata-studio:new-build-draft";

const ASK_VALUES = {
  datasetId: "apt_ask",
  title: "Ask 아파트 실거래",
  description: "Ask KPubData 가 만든 초안",
  provider: "datago",
  sourceDataset: "apt_trade",
  sourceParams: "{}",
  outputPath: "artifacts/builds/apt_ask",
  exportFormats: ["jsonl"],
};

function draftTurn(context: AssistantContext): AssistantTurn {
  return {
    id: "turn-draft",
    question: "아파트 실거래 테이블 초안을 만들어줘",
    context,
    createdAt: "2026-10-01T00:00:00.000Z",
    status: "ok",
    query: { status: "idle" },
    actionStates: {},
    response: {
      answer: "초안을 제안합니다.",
      evidenceRefs: [],
      generatedSql: null,
      suggestedActions: [
        {
          type: "CREATE_BUILD_DRAFT",
          values: {
            datasetId: ASK_VALUES.datasetId,
            title: ASK_VALUES.title,
            description: ASK_VALUES.description,
            provider: ASK_VALUES.provider,
            sourceDataset: ASK_VALUES.sourceDataset,
          },
          reason: "요청한 데이터셋",
        },
      ],
    },
  };
}

function renderApp(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/add" element={<AddDataPage />} />
        <Route path="/tables" element={<p>tables</p>} />
      </Routes>
      <AssistantDrawer />
    </MemoryRouter>,
  );
}

const tr = (key: string) => i18n.t(key);

/** Approve the drawer's table draft, then apply it — the two clicks Ask KPubData asks for. */
async function approveAskDraft() {
  fireEvent.click(await screen.findByRole("button", { name: tr("assistant.action.approve") }));
  fireEvent.click(await screen.findByRole("button", { name: tr("assistant.action.apply") }));
  await screen.findByText(tr("assistant.session.draftSaved"));
}

/** Pick the Public API source and type a title, as someone mid-way through the form. */
async function typeInput(title: string) {
  fireEvent.click(await screen.findByRole("button", { name: new RegExp(tr("addData.source.kindTitle.publicApi")) }));
  fireEvent.change(await screen.findByLabelText(tr("addData.configure.titleLabel")), { target: { value: title } });
}

const titleValue = () => (screen.getByLabelText(tr("addData.configure.titleLabel")) as HTMLInputElement).value;

beforeEach(() => {
  localStorage.clear();
  useAssistantStore.setState({ turns: [], onboarded: true });
  useUIStore.setState({ isAssistantDrawerOpen: true });
});

afterEach(() => {
  localStorage.clear();
  useAssistantStore.setState({ turns: [] });
  useUIStore.setState({ isAssistantDrawerOpen: false });
});

describe("AddDataPage — Ask KPubData draft approved while /add is open (#604)", () => {
  it("offers the approved draft at once and opens it", async () => {
    useAssistantStore.setState({ turns: [draftTurn({ page: "add-data" })] });
    renderApp("/add");
    await screen.findByRole("heading", { name: tr("addData.source.title") });
    expect(screen.queryByText(tr("addData.draft.prompt"))).toBeNull();

    await approveAskDraft();

    expect(await screen.findByText(tr("addData.draft.prompt"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restore") }));

    expect(await screen.findByDisplayValue(ASK_VALUES.title)).toBeInTheDocument();
    expect((screen.getByLabelText(tr("addData.configure.providerLabel")) as HTMLSelectElement).value).toBe("datago");
    // Opened once: the draft left storage and the offer is gone, so it is not applied again.
    expect(localStorage.getItem(ASK_KEY)).toBeNull();
    expect(screen.queryByText(tr("addData.draft.prompt"))).toBeNull();
  });

  it("offers a draft approved on another route once /add opens", async () => {
    useAssistantStore.setState({ turns: [draftTurn({ page: "dataset-catalog" })] });
    renderApp("/tables");

    await approveAskDraft();

    expect(await screen.findByText(tr("addData.draft.prompt"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restore") }));
    expect(await screen.findByDisplayValue(ASK_VALUES.title)).toBeInTheDocument();
  });

  it("offers a draft written by another tab", async () => {
    renderApp("/add");
    await screen.findByRole("heading", { name: tr("addData.source.title") });
    expect(screen.queryByText(tr("addData.draft.prompt"))).toBeNull();

    // Another tab's write reaches this one only as a `storage` event.
    localStorage.setItem(ASK_KEY, JSON.stringify({ version: 1, data: ASK_VALUES, savedAt: "2026-10-01T00:00:00.000Z" }));
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ASK_KEY }));
    });

    expect(await screen.findByText(tr("addData.draft.prompt"))).toBeInTheDocument();
  });

  it("keeps the current input and lets the person choose between it and the Ask draft", async () => {
    saveAddDataDraft({ ...INITIAL_DRAFT, sourceKind: "public_api", title: "예전에 저장한 초안" });
    useAssistantStore.setState({ turns: [draftTurn({ page: "add-data" })] });
    renderApp("/add");
    await typeInput("지금 입력 중");

    await approveAskDraft();

    // Both drafts are offered; nothing replaced the form yet.
    expect(await screen.findByText(tr("addData.draft.promptBoth"))).toBeInTheDocument();
    expect(titleValue()).toBe("지금 입력 중");

    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restoreAsk") }));
    expect(await screen.findByDisplayValue(ASK_VALUES.title)).toBeInTheDocument();
    // What was being typed became the saved draft and is offered back.
    expect(screen.getByText(tr("addData.draft.inputKept"))).toBeInTheDocument();
    expect(loadAddDataDraft()?.title).toBe("지금 입력 중");
    expect(screen.getByText(tr("addData.draft.prompt"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restore") }));
    expect(await screen.findByDisplayValue("지금 입력 중")).toBeInTheDocument();
  });
});

describe("AddDataPage — saved draft of the wrong shape (#605)", () => {
  it("does not open it: removes it with a notice, keeping the Ask draft and the current input", async () => {
    localStorage.setItem(
      SAVED_KEY,
      JSON.stringify({ version: 1, data: { sourceKind: "public_api" }, savedAt: "2026-10-01T00:00:00.000Z" }),
    );
    saveDraft(ASK_VALUES);
    const first = renderApp("/add");
    await typeInput("지금 입력 중");
    expect(await screen.findByText(tr("addData.draft.promptBoth"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restoreSaved") }));

    const notice = await screen.findByText(tr("addData.draft.savedCorrupt"));
    expect(notice.closest("[role=status]")).not.toBeNull();
    expect(localStorage.getItem(SAVED_KEY)).toBeNull();
    expect(localStorage.getItem(ASK_KEY)).not.toBeNull();
    expect(titleValue()).toBe("지금 입력 중");
    // Only the Ask KPubData draft is still offered.
    expect(screen.queryByText(tr("addData.draft.promptBoth"))).toBeNull();
    expect(screen.getByText(tr("addData.draft.prompt"))).toBeInTheDocument();

    // Coming back: the damaged draft is not offered again, the Ask draft still opens.
    first.unmount();
    renderApp("/add");
    expect(await screen.findByText(tr("addData.draft.prompt"))).toBeInTheDocument();
    expect(screen.queryByText(tr("addData.draft.promptBoth"))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: tr("addData.draft.restore") }));
    expect(await screen.findByDisplayValue(ASK_VALUES.title)).toBeInTheDocument();
    expect(screen.queryByText(tr("addData.draft.savedCorrupt"))).toBeNull();
  });
});
