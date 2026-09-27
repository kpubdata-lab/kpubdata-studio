/**
 * USER_CONTENT block add/edit form (#258 §10).
 *
 * Always save separately from Builder evidence blocks. Input text here is stored as-is in markdown
 * on save; rendering always passes through safe renderer in `markdown.ts` (plain textarea editor
 * means no script execution risk at input stage).
 */
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { Button, Textarea, TextInput } from "@/shared/ui";

export function UserContentEditor({
  initialHeading = "",
  initialMarkdown = "",
  onSave,
  onCancel,
}: {
  initialHeading?: string;
  initialMarkdown?: string;
  onSave: (heading: string, markdown: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [heading, setHeading] = useState(initialHeading);
  const [markdown, setMarkdown] = useState(initialMarkdown);

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-border p-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground" htmlFor="user-block-heading">
          {t("reports.userEditor.heading")}
        </label>
        <TextInput
          id="user-block-heading"
          value={heading}
          onChange={(e) => setHeading(e.target.value)}
          placeholder={t("reports.userEditor.headingPlaceholder")}
          className="mt-1"
        />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground" htmlFor="user-block-markdown">
          {t("reports.userEditor.body")}
        </label>
        <Textarea
          id="user-block-markdown"
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          rows={6}
          placeholder={t("reports.userEditor.bodyPlaceholder")}
          className="mt-1"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("reports.userEditor.cancel")}
        </Button>
        <Button
          onClick={() => onSave(heading.trim() || t("reports.userEditor.untitled"), markdown)}
          disabled={markdown.trim().length === 0}
        >
          {t("reports.userEditor.save")}
        </Button>
      </div>
    </div>
  );
}
