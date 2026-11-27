import { Alert, AlertDescription, AlertTitle } from "@tetherbox/ui/components/alert";
import { ExternalLink } from "./external-link.tsx";

export function AuthorizationPendingAlert({ url }: { url: string }) {
  return (
    <Alert>
      <AlertTitle>Finish authorization in the new tab</AlertTitle>
      <AlertDescription className="space-y-1.5">
        <p>Return here once the callback completes to continue.</p>
        <ExternalLink href={url}>Open authorization link</ExternalLink>
      </AlertDescription>
    </Alert>
  );
}
