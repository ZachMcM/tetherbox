import { useId, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  formatSecretInjection,
  hostnameSchema,
  type SecretBinding,
  type SecretKey,
  type StarterConfig,
  type StarterSecret,
} from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { appClient, unwrapJson } from "../../lib/api.ts";
import { describeSecretBinding } from "../../lib/auth-status.ts";
import { invalidateSecretQueries } from "../../lib/queries.ts";

export function domainFromStarterConfig(
  starterConfig: StarterConfig,
  ref: { readonly starterId: string; readonly key: string } | undefined,
): string {
  if (ref === undefined) {
    return "";
  }

  const rawUrl = starterConfig[ref.starterId]?.[ref.key];

  if (rawUrl === undefined) {
    return "";
  }

  const parsed = URL.parse(rawUrl);

  if (parsed === null) {
    return "";
  }

  const host = parsed.hostname.toLowerCase();

  return hostnameSchema.safeParse(host).success ? host : "";
}

export function describeStarterSecretBinding(secret: StarterSecret, derivedDomain: string): string {
  if (secret.kind === "fixed") {
    return describeSecretBinding(secret.binding);
  }

  const hostLabel = derivedDomain !== "" ? derivedDomain : secret.domainPlaceholder;

  return `${hostLabel} (${formatSecretInjection(secret.inject)})`;
}

type SecretValueBinding = SecretBinding | { kind: "invalid"; message: string };

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

export function starterSecretBinding(secret: StarterSecret, domain: string): SecretValueBinding {
  if (secret.kind === "fixed") {
    return secret.binding;
  }

  const normalized = domain.trim().toLowerCase();

  return hostnameSchema.safeParse(normalized).success
    ? { kind: "proxy", domains: [normalized], inject: secret.inject }
    : { kind: "invalid", message: "Enter a valid hostname without scheme or path." };
}
