import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
} from "@tetherbox/ui/components/code-block";

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
    <CodeBlock size="sm" variant={variant === "error" ? "destructive" : "default"}>
      <CodeBlockActions>
        <CodeBlockCopyButton value={trimmed} />
      </CodeBlockActions>
      <CodeBlockContent wrap className={variantClasses[variant]}>
        {trimmed}
      </CodeBlockContent>
    </CodeBlock>
  );
}
