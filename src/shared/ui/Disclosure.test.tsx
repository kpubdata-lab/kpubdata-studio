/**
 * Disclosure (#255 §3) — verifies secondary evidence like Run Events/BuildSpec snapshots stays
 * collapsed but remains keyboard-operable via a real button + aria-expanded.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Disclosure } from "./Disclosure";

describe("Disclosure", () => {
  it("is collapsed by default and hides its content", () => {
    render(
      <Disclosure title="Run Events (12)">
        <p>event detail</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: /Run Events \(12\)/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("event detail")).not.toBeInTheDocument();
  });

  it("expands on click and toggles aria-expanded, using a real button for keyboard access", () => {
    render(
      <Disclosure title="BuildSpec snapshot">
        <p>digest: abc123</p>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: "BuildSpec snapshot" });
    expect(button.tagName).toBe("BUTTON");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("digest: abc123")).toBeInTheDocument();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("digest: abc123")).not.toBeInTheDocument();
  });

  it("honors defaultOpen for primary sections that must stay expanded", () => {
    render(
      <Disclosure title="Pipeline" defaultOpen>
        <p>stage detail</p>
      </Disclosure>,
    );
    expect(screen.getByRole("button", { name: "Pipeline" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("stage detail")).toBeInTheDocument();
  });
});
