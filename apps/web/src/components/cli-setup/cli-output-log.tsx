const variantClasses = {
  log: "max-h-36",
  error: "max-h-32",
  live: "max-h-36",
} as const;

export function CliOutputLog({
  output,
  variant,
}: {
  output: string;
  variant: keyof typeof variantClasses;
}) {
  const trimmed = output.trim();

  if (trimmed === "") {
    return null;
  }

  return (
    <pre
      className={`${variantClasses[variant]} overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground`}
    >
      {trimmed}
    </pre>
  );
}
