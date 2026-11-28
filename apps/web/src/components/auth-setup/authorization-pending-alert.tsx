import { ExternalLinkIcon } from "lucide-react";
import { buttonVariants } from "@tetherbox/ui/components/button";
import { Spinner } from "@tetherbox/ui/components/spinner";

export function AuthorizationPendingAlert({
  url,
  message = "Waiting for browser authorization…",
}: {
  url?: string | undefined;
  message?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner className="size-3.5 shrink-0" />
        <span>{message}</span>
      </div>
      {url !== undefined && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "xs" })}
        >
          <span>Open sign-in page</span>
          <ExternalLinkIcon className="size-3" />
        </a>
      )}
    </div>
  );
}
