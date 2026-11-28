import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type SecretBinding, type SecretKey } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { appClient, unwrapJson } from "../../lib/api.ts";
import { invalidateSecretQueries } from "../../lib/queries.ts";

export type SecretValueBinding = SecretBinding | { kind: "invalid"; message: string };

export function SecretValueForm({
  secretKey,
  binding,
  children,
}: {
  secretKey: SecretKey;
  binding: SecretValueBinding;
  children?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (nextBinding: SecretBinding) =>
      unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: secretKey },
          json: { value: value.trim(), binding: nextBinding },
        }),
      ),
    onSuccess: () => {
      setValue("");
      invalidateSecretQueries(queryClient);
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (value.trim() === "") {
      setValidationError("Enter a secret value.");

      return;
    }

    if (binding.kind === "invalid") {
      setValidationError(binding.message);

      return;
    }

    setValidationError(null);
    mutation.mutate(binding);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5">
      {children}
      <Field>
        <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
          Value
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            type="password"
            placeholder={`Paste ${secretKey}`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            required
          />
          <Button type="submit" size="sm" disabled={mutation.isPending || value.trim() === ""}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </Field>
      {validationError !== null && <FieldError>{validationError}</FieldError>}
      {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
    </form>
  );
}
