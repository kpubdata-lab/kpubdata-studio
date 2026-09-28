import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders common Markdown without exposing syntax markers", () => {
    const { container } = render(<MarkdownContent>{"Run X의 상태는 **성공(ok)**입니다.\n\n- 항목\n\n`pm10Value`\n\n```sql\nSELECT 1\n```"}</MarkdownContent>);
    expect(screen.getByText("성공(ok)").tagName).toBe("STRONG");
    expect(screen.getByText("항목").tagName).toBe("LI");
    expect(screen.getByText("pm10Value").tagName).toBe("CODE");
    expect(screen.getByText("SELECT 1").tagName).toBe("CODE");
    expect(container.textContent).not.toContain("**");
  });

  it("keeps raw HTML inert and blocks unsafe link protocols", () => {
    const { container } = render(<MarkdownContent>{'<img src=x onerror="alert(1)"> [bad](javascript:alert(1))'}</MarkdownContent>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("<img");
  });
});
