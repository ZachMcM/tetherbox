import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";

export function DeviceCodePrompt({
  userCode,
  verificationUri,
}: {
  userCode: string;
  verificationUri: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">
        Open the verification page and enter this one-time code:
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-background px-2 py-1 font-mono text-sm font-semibold tracking-wider">
          {userCode}
        </code>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => {
            void navigator.clipboard.writeText(userCode).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </Button>
        <a
          href={verificationUri}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
        >
          <span>Open verification page</span>
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
