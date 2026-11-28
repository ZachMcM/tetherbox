import type { ReactNode } from "react";
import { ExternalLinkIcon } from "lucide-react";

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4"
    >
      <span>{children}</span>
      <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}
