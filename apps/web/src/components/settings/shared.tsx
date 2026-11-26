import type { ReactNode } from "react";

export function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="font-heading text-xl font-semibold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
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
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        {description !== undefined && (
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
