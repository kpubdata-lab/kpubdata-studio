import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FirstRunTour,
  onboardingStepsStorageKey,
  onboardingStorageKey,
  resetFirstRunTour,
} from "./FirstRunTour";

const USER_ID = "keycloak-subject-1";
const OTHER_USER_ID = "keycloak-subject-2";

function renderTour(userId = USER_ID) {
  return render(
    <MemoryRouter>
      <FirstRunTour userId={userId} />
    </MemoryRouter>,
  );
}

describe("FirstRunTour", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    delete window.__KPUBDATA_CONFIG__;
  });

  it("lists the four steps in order, each with a link to the page where it is done", () => {
    renderTour();
    const card = screen.getByRole("region", { name: "처음이라면 이 순서로 시작하세요" });
    const steps = within(card).getAllByRole("listitem");
    expect(steps.map((step) => within(step).getByRole("checkbox").getAttribute("id"))).toEqual([
      "first-run-step-apply",
      "first-run-step-key",
      "first-run-step-probe",
      "first-run-step-table",
    ]);
    expect(within(steps[0]).getByRole("checkbox", { name: "1. 활용신청하기" })).not.toBeChecked();
    expect(steps.map((step) => within(step).getByRole("link").getAttribute("href"))).toEqual([
      "/connections",
      "/connections",
      "/connections",
      "/discover",
    ]);
  });

  it("is not an overlay: no dialog, and nothing covers the page", () => {
    renderTour();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.querySelector(".fixed")).toBeNull();
  });

  it("stays closed after a reload once closed, and says so only for that account", () => {
    const first = renderTour();
    fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    expect(localStorage.getItem(onboardingStorageKey(USER_ID))).toBe("complete");
    expect(screen.queryByTestId("first-run-checklist")).not.toBeInTheDocument();
    first.unmount();

    const again = renderTour();
    expect(screen.queryByTestId("first-run-checklist")).not.toBeInTheDocument();
    again.unmount();

    renderTour(OTHER_USER_ID);
    expect(screen.getByTestId("first-run-checklist")).toBeInTheDocument();
  });

  it("opens again from its own button and from resetFirstRunTour", () => {
    const first = renderTour();
    fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    fireEvent.click(screen.getByRole("button", { name: "시작 안내 다시 보기" }));
    expect(screen.getByTestId("first-run-checklist")).toBeInTheDocument();
    expect(localStorage.getItem(onboardingStorageKey(USER_ID))).toBeNull();
    first.unmount();

    renderTour();
    fireEvent.click(screen.getByRole("button", { name: "안내 닫기" }));
    // A replay asked for another account leaves this one closed.
    act(() => resetFirstRunTour(OTHER_USER_ID));
    expect(screen.queryByTestId("first-run-checklist")).not.toBeInTheDocument();
    act(() => resetFirstRunTour(USER_ID));
    expect(screen.getByTestId("first-run-checklist")).toBeInTheDocument();
  });

  it("remembers the ticked steps across a reload, per account", () => {
    const first = renderTour();
    fireEvent.click(screen.getByRole("checkbox", { name: "1. 활용신청하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "2. 인증키 입력하기" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "1. 활용신청하기" }));
    expect(JSON.parse(localStorage.getItem(onboardingStepsStorageKey(USER_ID)) ?? "null")).toEqual(["key"]);
    first.unmount();

    const again = renderTour();
    expect(screen.getByRole("checkbox", { name: "1. 활용신청하기" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "2. 인증키 입력하기" })).toBeChecked();
    again.unmount();

    renderTour(OTHER_USER_ID);
    expect(screen.getByRole("checkbox", { name: "2. 인증키 입력하기" })).not.toBeChecked();
  });

  it("ignores stored ticks that are not a list of known steps", () => {
    localStorage.setItem(onboardingStepsStorageKey(USER_ID), JSON.stringify({ key: true }));
    const first = renderTour();
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    first.unmount();

    localStorage.setItem(onboardingStepsStorageKey(USER_ID), "not json");
    const second = renderTour();
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    second.unmount();

    localStorage.setItem(onboardingStepsStorageKey(USER_ID), JSON.stringify(["table", "made-up"]));
    renderTour();
    expect(screen.getByRole("checkbox", { name: "4. 첫 테이블 만들기" })).toBeChecked();
    expect(screen.getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked)).toHaveLength(1);
  });

  it("says it is a beta and links the user guide; the contact appears only when the deployment set one", () => {
    const first = renderTour();
    expect(screen.getByTestId("beta-badge")).toHaveTextContent("베타");
    expect(screen.getByRole("link", { name: "사용 가이드 열기" })).toHaveAttribute(
      "href",
      "https://kpubdata-lab.github.io/kpubdata-studio/docs/",
    );
    expect(document.querySelector("[data-support-line]")).toBeNull();
    first.unmount();

    window.__KPUBDATA_CONFIG__ = { supportContact: "help@example.org" };
    renderTour();
    expect(screen.getByRole("link", { name: "help@example.org" })).toHaveAttribute("href", "mailto:help@example.org");
  });
});
