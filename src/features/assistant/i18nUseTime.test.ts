// @vitest-environment jsdom
/**
 * Assistant strings are translated when used, not when their module is evaluated (#978).
 *
 * The app loads its locale chunks after the entry chunk, so a module evaluated before
 * `i18nReady` settles sees an i18n instance with no resources. These tests give the
 * assistant modules a fresh instance that has nothing loaded — unlike the shared test
 * setup, which preloads both locales — import the modules cold, and only then load a
 * locale, as a slow chunk would.
 */
import { createInstance, type i18n as I18n } from "i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/shared/i18n/locales/en.json";
import ko from "@/shared/i18n/locales/ko.json";

let cold: I18n;

beforeEach(async () => {
  cold = createInstance();
  await cold.init({ resources: {}, lng: "ko", fallbackLng: false, interpolation: { escapeValue: false } });
  vi.resetModules();
  vi.doMock("@/shared/i18n", () => ({ i18n: cold }));
  localStorage.clear();
});

afterEach(() => {
  vi.doUnmock("@/shared/i18n");
  vi.restoreAllMocks();
  localStorage.clear();
});

function loadLocales(): void {
  cold.addResourceBundle("ko", "translation", ko);
  cold.addResourceBundle("en", "translation", en);
}

describe("key-persistence consent (#978)", () => {
  it("shows the full localized warning when the locale arrived after the module loaded", async () => {
    const { useAssistConfig } = await import("./config");
    loadLocales();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    useAssistConfig.getState().setConfig({ apiKey: "sk-test" });
    useAssistConfig.getState().enablePersistence();

    expect(confirm).toHaveBeenCalledWith(ko.assistant.config.persistWarning);
    expect(useAssistConfig.getState().persistToStorage).toBe(true);
  });

  it("asks in the language the reader switched to", async () => {
    const { useAssistConfig } = await import("./config");
    loadLocales();
    await cold.changeLanguage("en");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    useAssistConfig.getState().enablePersistence();

    expect(confirm).toHaveBeenCalledWith(en.assistant.config.persistWarning);
  });

  it("saves nothing, and asks nothing, while no warning text is loaded", async () => {
    const { useAssistConfig } = await import("./config");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);

    useAssistConfig.getState().setConfig({ apiKey: "sk-test" });
    useAssistConfig.getState().enablePersistence();

    expect(confirm).not.toHaveBeenCalled();
    expect(useAssistConfig.getState().persistToStorage).toBe(false);
    expect(Object.values({ ...localStorage })).not.toContain("sk-test");
  });
});

describe("suggested questions (#978)", () => {
  it("are translated when asked for, after a late locale load", async () => {
    const { getStartQuestions, getSuggestedQuestions } = await import("./suggestedQuestions");
    loadLocales();

    expect(getStartQuestions()[0]).toBe(ko.assistant.questions.q01);
    expect(getSuggestedQuestions({ context: { page: "home" }, turns: [] })[0]).toBe(ko.assistant.questions.q01);
  });

  it("follow a language change", async () => {
    const { getSuggestedQuestions } = await import("./suggestedQuestions");
    loadLocales();
    await cold.changeLanguage("en");

    expect(getSuggestedQuestions({ context: { page: "home" }, turns: [] })[0]).toBe(en.assistant.questions.q01);
  });

  it("never offer a translation key as a question", async () => {
    const { getStartQuestions, getSuggestedQuestions } = await import("./suggestedQuestions");

    expect(getStartQuestions()).toEqual([]);
    expect(getSuggestedQuestions({ context: { page: "home" }, turns: [] })).toEqual([]);
  });
});
