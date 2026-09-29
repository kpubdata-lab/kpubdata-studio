import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  Button,
  EmptyState,
  FormField,
  LinkButton,
  Stepper,
  StatusBadge,
  TextInput,
} from "@/shared/ui";

describe("Button", () => {
  it("defaults to type=button and applies variant", () => {
    render(<Button variant="danger">삭제</Button>);
    const btn = screen.getByRole("button", { name: "삭제" });
    expect(btn).toHaveAttribute("type", "button");
    expect(btn).toHaveClass("bg-red-600");
  });

  it("is disabled and busy while loading", () => {
    render(<Button loading>저장</Button>);
    const btn = screen.getByRole("button", { name: "저장" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });
});

describe("StatusBadge", () => {
  it("renders the Korean label for a status", () => {
    render(<StatusBadge status="succeeded" />);
    expect(screen.getByText("성공")).toBeInTheDocument();
  });

  it("maps running to its live label", () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText("실행 중")).toBeInTheDocument();
  });

  it("falls back to a neutral badge showing the raw label for an unknown status (#70)", () => {
    render(<StatusBadge status="publish_failed" />);
    expect(screen.getByText("publish_failed")).toBeInTheDocument();
  });
});

describe("Stepper", () => {
  const steps = [
    { id: "a", label: "템플릿" },
    { id: "b", label: "소스" },
    { id: "c", label: "검증" },
  ];

  it("marks the current step with aria-current=step", () => {
    render(<Stepper steps={steps} current={1} />);
    const current = screen.getByText("소스").closest("li");
    expect(current).toHaveAttribute("aria-current", "step");
  });

  it("does not mark non-current steps", () => {
    render(<Stepper steps={steps} current={1} />);
    expect(screen.getByText("템플릿").closest("li")).not.toHaveAttribute("aria-current");
  });

  it("clamps an out-of-range current so aria-current stays on the last step (#74)", () => {
    render(<Stepper steps={steps} current={5} />);
    expect(screen.getByText("검증").closest("li")).toHaveAttribute("aria-current", "step");
  });
});

describe("FormField", () => {
  it("wires label, help and error via aria-describedby and role=alert", () => {
    render(
      <FormField
        id="datasetId"
        label="데이터셋 ID"
        help="예: kma-daily-observations"
        error="데이터셋 ID를 입력해주세요."
      >
        {(field) => <TextInput {...field} />}
      </FormField>,
    );

    const input = screen.getByLabelText("데이터셋 ID");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "datasetId-help datasetId-error");
    expect(screen.getByRole("alert")).toHaveTextContent("데이터셋 ID를 입력해주세요.");
  });

  it("omits error id from aria-describedby when valid", () => {
    render(
      <FormField id="title" label="제목" help="빌드 제목">
        {(field) => <TextInput {...field} />}
      </FormField>,
    );
    const input = screen.getByLabelText("제목");
    expect(input).toHaveAttribute("aria-describedby", "title-help");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders a single anchor CTA (no nested button) to the action href", () => {
    render(
      <MemoryRouter>
        <EmptyState
          title="아직 실행이 없습니다"
          description="첫 빌드를 만들어보세요."
          actionLabel="테이블 만들기"
          actionHref="/refresh-jobs/new"
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "테이블 만들기" });
    expect(link).toHaveAttribute("href", "/refresh-jobs/new");
    // 링크가 버튼으로 감싸지지 않는다(상호작용 요소 중첩 회피).
    expect(link.closest("button")).toBeNull();
  });

  it("renders no CTA when there is no action", () => {
    render(<EmptyState title="결과가 없습니다" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("LinkButton", () => {
  it("renders an anchor styled as a button", () => {
    render(
      <MemoryRouter>
        <LinkButton to="/refresh-jobs">목록</LinkButton>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "목록" });
    expect(link).toHaveAttribute("href", "/refresh-jobs");
    expect(link).toHaveClass("rounded-lg");
  });
});
