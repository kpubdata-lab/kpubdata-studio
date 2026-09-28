import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "./cn";

export interface HelpTooltipProps {
  content: ReactNode;
  label?: string;
  className?: string;
}

export function HelpTooltip({ content, label, className }: HelpTooltipProps) {
  const { t } = useTranslation();
  const resolvedLabel = label ?? t("helpTooltip.label");
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 288 });

  useEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(288, window.innerWidth - 16);
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8));
      const top = Math.min(rect.bottom + 8, window.innerHeight - 120);
      setPosition({ left, top: Math.max(8, top), width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <span className={cn("inline-flex align-middle", className)} onMouseLeave={() => setOpen(false)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={resolvedLabel}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onMouseEnter={() => setOpen(true)}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 9.1v4.2M10 6.5h.01" strokeLinecap="round" />
        </svg>
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              style={position}
              // tooltip surface must be fully opaque — `bg-card`/`text-card-foreground`
              // opaque token defined in globals.css (previous `bg-popover` in this theme
              // shows background). z-index is above drawer/modal backdrop (max z-[82])
              // set to z-[120]. Position is calculated relative to trigger but
              // always clamped inside viewport (even edge triggers don't go offscreen
              // does not go offscreen).
              className="fixed z-[120] rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-normal leading-5 text-card-foreground shadow-lg"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
