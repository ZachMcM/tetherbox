import type { ReactNode } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";

export function SectionHeader({
  title,
  description,
  onBack,
}: {
  title: ReactNode;
  description: string;
  onBack?: (() => void) | undefined;
}) {
  return (
    <div className="space-y-4">
      {onBack !== undefined && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="-ml-2 text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-3.5" />
          <span>Back</span>
        </Button>
      )}
      <div>
        <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export function SettingGroup({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-sm font-medium">{title}</h3>
        {action}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

export function SettingRow({
  leading,
  title,
  description,
  control,
}: {
  leading?: ReactNode;
  title: ReactNode;
  description?: string | undefined;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      {leading}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{title}</div>
        {description !== undefined && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
