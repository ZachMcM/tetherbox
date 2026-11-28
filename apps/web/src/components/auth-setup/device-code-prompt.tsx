import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { ExternalLink } from "./external-link.tsx";

export function DeviceCodePrompt({
  userCode,
  verificationUri,
  message,
  codeBackground,
}: {
  userCode: string;
  verificationUri: string;
  message: string;
  codeBackground: "bg-muted" | "bg-background";
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-2 text-xs">
      <p className="text-muted-foreground">{message}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code
          className={`${codeBackground} rounded px-2 py-1 font-mono text-sm font-semibold tracking-wider`}
        >
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
        <ExternalLink href={verificationUri}>Open verification page</ExternalLink>
      </div>
    </div>
  );
}
