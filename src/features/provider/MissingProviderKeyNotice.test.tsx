/**
 * A missing key is asked for where the user is, and the spec they were about to run is
 * not lost on the way (#787).
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { BuildJob } from "@/features/runs/useBuildJob";
import {
  forgetAllProviderKeys,
  forgetKeyProviders,
  isProviderKeyHeld,
  noteKeyProviders,
} from "@/shared/lib/providerKeys";
import type { MissingProviderKeys } from "@/shared/lib/missingProviderKey";
import type { BuildRun, BuildSpec } from "@/shared/lib/types";
import { BuildKeyNotice, PreviewKeyNotice, providersOf } from "./BuildKeyNotice";
import { MissingProviderKeyNotice, keysToAskFor } from "./MissingProviderKeyNotice";

const TYPED = "stand-in-typed-value-0123";
const HERE = "/refresh-jobs/run-1/edit?step=5";

afterEach(() => {
  cleanup();
  forgetAllProviderKeys();
  forgetKeyProviders();
});

function show(missing: MissingProviderKeys, reason: "refused" | "lost" = "refused") {
  return render(
    <MemoryRouter>
      <MissingProviderKeyNotice missing={missing} reason={reason} returnTo={HERE} />
    </MemoryRouter>,
  );
}

function typeKey(provider: string, value: string) {
  const input = document.getElementById(`missing-provider-key-${provider}`) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest("form") as HTMLFormElement);
  return input;
}

describe("MissingProviderKeyNotice — keys that travel with the request", () => {
  it("names the provider and takes its key here, holding it for the page load", () => {
    const { container } = show({ providers: ["datago"], keptIn: "request" });
    expect(container.querySelector("[data-missing-provider-keys]")?.getAttribute("data-missing-provider-keys")).toBe("datago");
    expect(isProviderKeyHeld("datago")).toBe(false);

    typeKey("datago", TYPED);

    expect(isProviderKeyHeld("datago")).toBe(true);
    expect(container.querySelector('[data-key-held="datago"]')).not.toBeNull();
    // The field is gone and the value is nowhere on the page.
    expect(document.getElementById("missing-provider-key-datago")).toBeNull();
    expect(container.innerHTML).not.toContain(TYPED);
  });

  it("is a password field that the browser is asked not to remember", () => {
    show({ providers: ["datago"], keptIn: "request" });
    const input = document.getElementById("missing-provider-key-datago") as HTMLInputElement;

    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
  });

  it("refuses a key that cannot travel in the header and holds nothing", () => {
    show({ providers: ["datago"], keptIn: "request" });

    typeKey("datago", "one,two");

    expect(isProviderKeyHeld("datago")).toBe(false);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(document.getElementById("missing-provider-key-datago")).not.toBeNull();
  });

  it("cannot be submitted empty", () => {
    show({ providers: ["datago"], keptIn: "request" });
    const input = document.getElementById("missing-provider-key-datago") as HTMLInputElement;
    const button = input.closest("form")?.querySelector('button[type="submit"]') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "   " } });
    expect(button.disabled).toBe(true);
  });

  it("asks for each of several providers, and says so only when all are in", () => {
    const { container } = show({ providers: ["datago", "seoul"], keptIn: "request" });
    const summary = () => container.querySelector("p.text-xs.text-muted-foreground:last-of-type")?.textContent;
    const before = summary();

    typeKey("datago", TYPED);
    expect(container.querySelector('[data-key-needed="seoul"]')).not.toBeNull();
    expect(summary()).toBe(before);

    typeKey("seoul", TYPED);
    expect(container.querySelectorAll("[data-key-needed]").length).toBe(0);
    expect(summary()).not.toBe(before);
  });

  it("asks once for a key several providers share, under the provider whose key it is", () => {
    // What Builder says in GET /providers: these two call with another provider's key.
    noteKeyProviders([
      { provider: "datago", key_provider: "datago" },
      { provider: "shared-a", key_provider: "datago" },
      { provider: "shared-b", key_provider: "datago" },
    ]);

    expect(keysToAskFor(["shared-a", "shared-b"])).toEqual([{ keyProvider: "datago", usedBy: ["shared-a", "shared-b"] }]);
    const { container } = show({ providers: ["shared-a", "shared-b"], keptIn: "request" });
    expect(container.querySelectorAll("[data-key-needed]").length).toBe(1);

    typeKey("datago", TYPED);

    expect(isProviderKeyHeld("datago")).toBe(true);
    expect(isProviderKeyHeld("shared-a")).toBe(false);
    expect(container.querySelectorAll("[data-key-needed]").length).toBe(0);
  });

  it("before Builder has said whose key a provider uses, asks for the provider's own", () => {
    expect(keysToAskFor(["shared-a"])).toEqual([{ keyProvider: "shared-a", usedBy: ["shared-a"] }]);
  });

  it("shows a key that is already held as held, without asking again", () => {
    const first = show({ providers: ["datago"], keptIn: "request" });
    typeKey("datago", TYPED);
    first.unmount();

    const { container } = show({ providers: ["datago"], keptIn: "request" });

    expect(container.querySelector('[data-key-held="datago"]')).not.toBeNull();
    expect(container.querySelector("input")).toBeNull();
  });

  it("offers the Connections page with a way back, and puts no key in the link", () => {
    show({ providers: ["datago"], keptIn: "request" });
    const input = document.getElementById("missing-provider-key-datago") as HTMLInputElement;
    fireEvent.change(input, { target: { value: TYPED } });

    const link = input.closest("form")?.querySelector("a") as HTMLAnchorElement;

    expect(link.getAttribute("href")).toBe(`/connections?provider=datago&returnTo=${encodeURIComponent(HERE)}`);
    expect(link.getAttribute("href")).not.toContain(TYPED);
  });
});

describe("MissingProviderKeyNotice — a deployment that stores keys", () => {
  it("takes no key here: it links to Connections and warns that this page may not be kept", () => {
    const { container } = show({ providers: ["datago", "seoul"], keptIn: "stored" });

    expect(container.querySelector("input")).toBeNull();
    const links = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      `/connections?provider=datago&returnTo=${encodeURIComponent(HERE)}`,
      `/connections?provider=seoul&returnTo=${encodeURIComponent(HERE)}`,
    ]);
  });
});

describe("the reason shown", () => {
  it("differs for a refused request and a run that lost its keys", () => {
    const refused = show({ providers: ["datago"], keptIn: "request" }, "refused").container.textContent;
    cleanup();
    const lost = show({ providers: ["datago"], keptIn: "request" }, "lost").container.textContent;

    expect(refused).not.toBe(lost);
    expect(refused).toContain("datago");
  });
});

const SPEC = {
  datasetId: "d",
  title: "t",
  description: "",
  sources: [
    { provider: "Datago", dataset: "a", params: {} },
    { kind: "public_api", provider: "seoul", dataset: "b", params: {} },
    { provider: "datago", dataset: "c", params: {} },
    { kind: "file", params: {} },
  ],
  exports: [],
  metadata: {},
} as unknown as BuildSpec;

function job(overrides: Partial<BuildJob>): Pick<BuildJob, "status" | "missingKeys" | "run"> {
  return { status: "failed", ...overrides };
}

function run(overrides: Partial<BuildRun>): BuildRun {
  return { id: "run-1", spec: SPEC, status: "failed", startedAt: "s", ...overrides };
}

describe("BuildKeyNotice", () => {
  it("reads a spec's providers from its public-API sources only", () => {
    expect(providersOf(SPEC)).toEqual(["datago", "seoul"]);
  });

  it("shows the keys Builder named when the build was refused", () => {
    const { container } = render(
      <MemoryRouter initialEntries={[HERE]}>
        <BuildKeyNotice job={job({ missingKeys: { providers: ["seoul"], keptIn: "request" } })} />
      </MemoryRouter>,
    );

    expect(container.querySelector('[data-key-needed="seoul"]')).not.toBeNull();
    // The way back is the page the notice is on, query included.
    expect(container.querySelector("a")?.getAttribute("href")).toContain(`returnTo=${encodeURIComponent(HERE)}`);
  });

  it("asks for the keys of the spec's providers when a finished run lost them", () => {
    const { container } = render(
      <MemoryRouter>
        <BuildKeyNotice job={job({ run: run({ keysLost: true }) })} />
      </MemoryRouter>,
    );

    expect([...container.querySelectorAll("[data-key-needed]")].map((li) => li.getAttribute("data-key-needed"))).toEqual([
      "datago",
      "seoul",
    ]);
  });

  it.each([
    ["an ordinary failure", job({ run: run({ error: "pipeline failed" }) })],
    ["a failure with no run", job({})],
    ["a run that is still going", job({ status: "running", missingKeys: { providers: ["datago"], keptIn: "request" } })],
    ["a run that succeeded", job({ status: "succeeded" })],
    ["a lost-key run whose spec calls no provider", job({ run: run({ keysLost: true, spec: { ...SPEC, sources: [] } }) })],
  ])("shows nothing for %s — and needs no router to do so", (_name, state) => {
    const { container } = render(<BuildKeyNotice job={state} />);

    expect(container.innerHTML).toBe("");
  });

  it("the preview notice shows nothing without missing keys, and the keys when there are", () => {
    expect(render(<PreviewKeyNotice missing={undefined} />).container.innerHTML).toBe("");
    const { container } = render(
      <MemoryRouter>
        <PreviewKeyNotice missing={{ providers: ["datago"], keptIn: "request" }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-key-needed="datago"]')).not.toBeNull();
  });
});
