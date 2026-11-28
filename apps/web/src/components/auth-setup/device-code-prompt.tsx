import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button, buttonVariants } from "@tetherbox/ui/components/button";

export function DeviceCodePrompt({
  userCode,
  verificationUri,
  message,
}: {
  userCode: string;
  verificationUri: string;
  message: string;
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
