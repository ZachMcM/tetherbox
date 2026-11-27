import type { FormEvent } from "react";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";

export function CliResponseForm({
  inputId,
  prompt,
  value,
  pending,
  onChange,
  onSubmit,
}: {
  inputId: string;
  prompt: string | null;
  value: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5">
      <Field>
        <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
          {prompt ?? "Send response to CLI (code, token, or Enter)"}
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            placeholder="Paste code or response"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={pending}>
            Send
          </Button>
        </div>
      </Field>
    </form>
  );
}
