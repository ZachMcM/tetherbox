import type { FormEvent } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { Button, buttonVariants } from "@tetherbox/ui/components/button";
import { Input } from "@tetherbox/ui/components/input";
import { ExternalLink } from "./external-link.tsx";

export function CodePastePrompt({
  inputId,
  title,
  description,
  placeholder,
  value,
  pending,
  authUrl,
  requireValue = true,
  variant = "hero",
  onChange,
  onSubmit,
}: {
  inputId: string;
  title: string;
  description?: string | undefined;
  placeholder?: string | undefined;
  value: string;
  pending: boolean;
  authUrl?: string | undefined;
  requireValue?: boolean;
  variant?: "hero" | "compact";
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (!requireValue || value.trim() !== "") {
      onSubmit();
    }
  };

  const form = (
    <form
      onSubmit={handleSubmit}
      className={
        variant === "hero"
          ? "flex w-full max-w-md items-center gap-2"
          : "flex w-full items-center gap-2"
      }
    >
      <Input
        id={inputId}
        value={value}
        placeholder={placeholder ?? "Paste code here"}
        onChange={(event) => onChange(event.target.value)}
        className="font-mono text-xs"
        autoComplete="off"
        autoFocus
        required={requireValue}
      />
      <Button type="submit" size="sm" disabled={pending || (requireValue && value.trim() === "")}>
        {pending ? "Submitting…" : "Continue"}
      </Button>
    </form>
  );

  if (variant === "compact") {
    return (
      <div className="space-y-2.5 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-medium text-foreground">{title}</div>
          {authUrl !== undefined && (
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              <span>Open sign-in page</span>
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
        {form}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <div className="space-y-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description !== undefined && (
          <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
        )}
      </div>

      {form}

      {authUrl !== undefined && (
        <div className="text-xs">
          <ExternalLink href={authUrl}>Open sign-in page</ExternalLink>
        </div>
      )}
    </div>
  );
}
