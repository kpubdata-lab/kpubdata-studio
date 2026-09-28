/**
 * Top-level Assistant natural-language search input (#247, #256).
 *
 * Input is not sent directly to the LLM here — `useAssistantSession` seeds it into the conversation
 * and opens the global drawer. Actual evidence fetching, LLM calls, and structured response handling
 * are taken over by `useAssistantSession` when the drawer (`AssistantContent`) opens. We do not invent results
 * here — to avoid creating hallucinated datasets.
 */
import { useTranslation } from "react-i18next";
import { useState, type FormEvent } from "react";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { useAssistantStore } from "./useAssistantSession";

export function AssistantSearchInput() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const openAssistantDrawer = useUIStore((state) => state.openAssistantDrawer);
  const seedQuestion = useAssistantStore((state) => state.seedQuestion);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed) seedQuestion(trimmed);
    setQuery("");
    openAssistantDrawer();
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className="hidden min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:flex"
    >
      <span aria-hidden="true">🔍</span>
      <label className="sr-only" htmlFor="assistant-search">
        {t("assistant.search.label")}
      </label>
      <input
        className="w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        id="assistant-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("assistant.search.placeholder")}
        type="search"
        value={query}
      />
    </form>
  );
}
