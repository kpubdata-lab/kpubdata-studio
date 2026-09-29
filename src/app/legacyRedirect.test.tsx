import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { LegacyRedirect, legacyTarget } from "./legacyRedirect";

function Where() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="where">{`${pathname}${search}${hash}`}</output>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        {["datasets", "builds", "provider"].map((p) => (
          <Route element={<LegacyRedirect />} key={p} path={`${p}/*`} />
        ))}
        <Route element={<Where />} path="*" />
      </Routes>
    </MemoryRouter>,
  );
}

describe("legacy URLs (#423)", () => {
  it.each([
    ["/datasets", "/tables"],
    ["/datasets/air-quality?run=r1&stage=gold", "/tables/air-quality?run=r1&stage=gold"],
    ["/builds?run=abc", "/refresh-jobs?run=abc"],
    ["/builds/run-1/artifacts#files", "/refresh-jobs/run-1/artifacts#files"],
    ["/builds/new?savedSpecId=s1", "/refresh-jobs/new?savedSpecId=s1"],
    ["/provider?provider=datago&returnTo=%2Fadd", "/connections?provider=datago&returnTo=%2Fadd"],
  ])("%s → %s", (from, to) => {
    renderAt(from);
    expect(screen.getByTestId("where")).toHaveTextContent(to);
  });

  it("leaves paths that only look similar alone", () => {
    expect(legacyTarget("/datasets-archive")).toBeNull();
    expect(legacyTarget("/buildspec")).toBeNull();
    expect(legacyTarget("/providers")).toBeNull();
    expect(legacyTarget("/tables/air-quality")).toBeNull();
  });
});
