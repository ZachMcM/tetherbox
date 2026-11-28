import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button, buttonVariants } from "@tetherbox/ui/components/button";

export function DeviceCodePrompt({
  userCode,
  verificationUri,
  message,
  variant = "hero",
}: {
  userCode: string;
  verificationUri: string;
  message: string;
  variant?: "hero" | "compact";
}) {
  const [copied, setCopied] = useState(false);

  const copyCode = () => {
    void navigator.clipboard
      .writeText(userCode)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  if (variant === "compact") {
    return (
      <div className="space-y-2 py-1">
        <p className="text-xs text-muted-foreground">{message}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <code className="select-all rounded-md bg-muted/70 px-3 py-1 font-mono text-base font-semibold tracking-[0.15em] text-foreground">
              {userCode}
            </code>
            <Button type="button" variant="outline" size="xs" onClick={copyCode}>
              {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
              <span>{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
          <a
            href={verificationUri}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ size: "xs" })}
          >
            <span>Open verification page</span>
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-4 text-center">
      <p className="max-w-sm text-xs text-muted-foreground">{message}</p>
      <code className="select-all rounded-lg bg-muted/70 px-5 py-2.5 font-mono text-2xl font-semibold tracking-[0.2em] text-foreground">
        {userCode}
      </code>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyCode}>
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          <span>{copied ? "Copied" : "Copy code"}</span>
        </Button>
        <a
          href={verificationUri}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ size: "sm" })}
        >
          <span>Open verification page</span>
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
