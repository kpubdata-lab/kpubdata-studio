/**
 * Top-level Kubi natural-language search input (#247, #256).
 *
 * Input is not sent directly to the LLM here — `useKubiSession` seeds it into the conversation
 * and opens the global drawer. Actual evidence fetching, LLM calls, and structured response handling
 * are taken over by `useKubiSession` when the drawer (`KubiContent`) opens. We do not invent results
 * here — to avoid creating hallucinated datasets.
 */
import { useTranslation } from "react-i18next";
import { useState, type FormEvent } from "react";
import { useUIStore } from "@/shared/hooks/useUIStore";
import { useKubiStore } from "./useKubiSession";

export function KubiSearchInput() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const openKubiDrawer = useUIStore((state) => state.openKubiDrawer);
  const seedQuestion = useKubiStore((state) => state.seedQuestion);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed) seedQuestion(trimmed);
    setQuery("");
    openKubiDrawer();
  }

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className="hidden min-w-0 max-w-md flex-1 items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring sm:flex"
    >
      <span aria-hidden="true">🔍</span>
      <label className="sr-only" htmlFor="kubi-search">
        {t("kubi.search.label")}
      </label>
      <input
        className="w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
        id="kubi-search"
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("kubi.search.placeholder")}
        type="search"
        value={query}
      />
    </form>
  );
}
