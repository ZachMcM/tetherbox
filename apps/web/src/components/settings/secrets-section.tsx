import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  llmProviderIds,
  llmProviderSchema,
  secretInjectionSchema,
  secretKeySchema,
  type LlmProvider,
  type SecretBinding,
  type SecretInjection,
  type SecretKind,
  type SecretListEntry,
} from "@tetherbox/core/app";
import { PlusIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@tetherbox/ui/components/alert-dialog";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@tetherbox/ui/components/native-select";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, expectOk, unwrapJson } from "../../lib/api.ts";
import { parseDomainsList } from "../../lib/lists.ts";
import { invalidateSecretQueries, secretsQueryOptions } from "../../lib/queries.ts";
import { describeSecretBinding } from "../auth-setup-panels.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

type SecretViewMode = { kind: "create" } | { kind: "edit"; entry: SecretListEntry };

function SecretFormView({ mode, onClose }: { mode: SecretViewMode; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existingBinding = mode.kind === "edit" ? mode.entry.binding : null;
  const existingProxy = existingBinding?.kind === "proxy" ? existingBinding : null;
  const [rawKey, setRawKey] = useState(mode.kind === "edit" ? mode.entry.key : "");
  const [value, setValue] = useState("");
  const [bindingKind, setBindingKind] = useState<SecretKind>(existingBinding?.kind ?? "proxy");
  const [domainsText, setDomainsText] = useState(existingProxy?.domains.join(", ") ?? "");
  const [injectKind, setInjectKind] = useState<SecretInjection["kind"]>(
    existingProxy?.inject.kind ?? "bearer",
  );
  const [injectName, setInjectName] = useState(
    existingProxy !== null && existingProxy.inject.kind !== "bearer"
      ? existingProxy.inject.name
      : "",
  );
  const [provider, setProvider] = useState<LlmProvider>(
    existingBinding?.kind === "llm" ? existingBinding.provider : llmProviderIds[0],
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { key: string; value: string; binding: SecretBinding }) =>
      unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: input.key },
          json: { value: input.value, binding: input.binding },
        }),
      ),
    onSuccess: () => {
      invalidateSecretQueries(queryClient);
      onClose();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const parsedKey = secretKeySchema.safeParse(rawKey.trim().toUpperCase());

    if (!parsedKey.success) {
      setValidationError(
        "Secret key must start with A-Z and contain only uppercase letters, numbers, and underscores.",
      );

      return;
    }

    const trimmedValue = value.trim();

    if (trimmedValue === "") {
      setValidationError("A secret value is required.");

      return;
    }

    let binding: SecretBinding;

    switch (bindingKind) {
      case "daemon":
        binding = { kind: "daemon" };
        break;
      case "llm":
        binding = { kind: "llm", provider };
        break;
      case "proxy": {
        const parsedDomains = parseDomainsList(domainsText);

        if (!parsedDomains.ok) {
          setValidationError(parsedDomains.error);

          return;
        }

        const rawInject =
          injectKind === "bearer"
            ? { kind: "bearer" as const }
            : { kind: injectKind, name: injectName.trim() };
        const parsedInject = secretInjectionSchema.safeParse(rawInject);

        if (!parsedInject.success) {
          setValidationError(
            injectKind === "header"
              ? "Enter a valid HTTP header name (for example Authorization or X-Api-Key)."
              : "Enter a valid query parameter name.",
          );

          return;
        }

        binding = { kind: "proxy", domains: parsedDomains.domains, inject: parsedInject.data };
        break;
      }
      default: {
        const exhaustive: never = bindingKind;

        return exhaustive;
      }
    }

    setValidationError(null);
    mutation.mutate({ key: parsedKey.data, value: trimmedValue, binding });
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        onBack={onClose}
        title={mode.kind === "create" ? "Add secret" : `Update ${mode.entry.key}`}
        description="Secrets are write-only. Saving replaces the stored credential."
      />

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field>
          <FieldLabel htmlFor="secret-key">Key name</FieldLabel>
          <Input
            id="secret-key"
            placeholder="LINEAR_API_KEY"
            value={rawKey}
            onChange={(event) => setRawKey(event.target.value)}
            disabled={mode.kind === "edit"}
            required
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="secret-value">Value</FieldLabel>
          <Input
            id="secret-value"
            type="password"
            placeholder={mode.kind === "edit" ? "Enter new secret value" : "Paste secret value"}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            required
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="secret-binding-kind">Binding</FieldLabel>
          <NativeSelect
            id="secret-binding-kind"
            className="w-full"
            value={bindingKind}
            onChange={(event) => {
              const next = event.target.value;

              if (next === "daemon" || next === "proxy" || next === "llm") {
                setBindingKind(next);
                setValidationError(null);
              }
            }}
          >
            <NativeSelectOption value="proxy">Proxy (domain-pinned HTTP)</NativeSelectOption>
            <NativeSelectOption value="daemon">Daemon-only (webhooks, OAuth)</NativeSelectOption>
            <NativeSelectOption value="llm">LLM provider API key</NativeSelectOption>
          </NativeSelect>
        </Field>

        {bindingKind === "proxy" && (
          <>
            <Field>
              <FieldLabel htmlFor="secret-domains">Pinned hostnames</FieldLabel>
              <Input
                id="secret-domains"
                placeholder="api.linear.app"
                value={domainsText}
                onChange={(event) => setDomainsText(event.target.value)}
                required
              />
              <FieldDescription>
                Comma-separated hostnames the secret proxy may send this secret to.
              </FieldDescription>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="secret-inject-kind">Injection</FieldLabel>
                <NativeSelect
                  id="secret-inject-kind"
                  className="w-full"
                  value={injectKind}
                  onChange={(event) => {
                    const next = event.target.value;

                    if (next === "bearer" || next === "header" || next === "query") {
                      setInjectKind(next);
                    }
                  }}
                >
                  <NativeSelectOption value="bearer">Bearer token</NativeSelectOption>
                  <NativeSelectOption value="header">Header</NativeSelectOption>
                  <NativeSelectOption value="query">Query parameter</NativeSelectOption>
                </NativeSelect>
              </Field>

              {injectKind !== "bearer" && (
                <Field>
                  <FieldLabel htmlFor="secret-inject-name">
                    {injectKind === "header" ? "Header name" : "Query param"}
                  </FieldLabel>
                  <Input
                    id="secret-inject-name"
                    placeholder={injectKind === "header" ? "Authorization" : "api_key"}
                    value={injectName}
                    onChange={(event) => setInjectName(event.target.value)}
                    required
                  />
                </Field>
              )}
            </div>
          </>
        )}

        {bindingKind === "llm" && (
          <Field>
            <FieldLabel htmlFor="secret-llm-provider">LLM provider</FieldLabel>
            <NativeSelect
              id="secret-llm-provider"
              className="w-full"
              value={provider}
              onChange={(event) => {
                const parsed = llmProviderSchema.safeParse(event.target.value);

                if (parsed.success) {
                  setProvider(parsed.data);
                }
              }}
            >
              {llmProviderIds.map((entry) => (
                <NativeSelectOption key={entry} value={entry}>
                  {entry}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        )}

        {validationError !== null && <FieldError>{validationError}</FieldError>}
        {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save secret"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function SecretsSection() {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<SecretViewMode | null>(null);
  const secretsQuery = useQuery(secretsQueryOptions);

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      await expectOk(await appClient.secrets[":key"].$delete({ param: { key } }));
    },
    onSuccess: () => {
      invalidateSecretQueries(queryClient);
    },
  });

  if (viewMode !== null) {
    return (
      <SecretFormView
        key={viewMode.kind === "edit" ? viewMode.entry.key : "create"}
        mode={viewMode}
        onClose={() => setViewMode(null)}
      />
    );
  }

  const secrets = secretsQuery.data?.secrets ?? [];

  let content =
    secrets.length === 0 ? (
      <div className="px-4 py-4 text-xs text-muted-foreground">No secrets stored yet</div>
    ) : (
      <>
        {secrets.map((entry) => (
          <SettingRow
            key={entry.key}
            title={entry.key}
            description={describeSecretBinding(entry.binding)}
            control={
              <div className="flex items-center gap-2">
                <Badge variant="outline">{entry.binding.kind}</Badge>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => setViewMode({ kind: "edit", entry })}
                >
                  Edit
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Delete ${entry.key}`}
                        disabled={deleteMutation.isPending}
                      />
                    }
                  >
                    <Trash2Icon className="size-3.5 text-muted-foreground" />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {entry.key}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Modules or webhooks that reference <code>{entry.key}</code> will fail until
                        a replacement secret is stored.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => deleteMutation.mutate(entry.key)}
                        disabled={deleteMutation.isPending}
                      >
                        Delete secret
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            }
          />
        ))}
      </>
    );

  if (secretsQuery.isPending) {
    content = (
      <div className="flex justify-center p-6">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  } else if (secretsQuery.error !== null) {
    content = (
      <div className="px-4 py-4 text-xs text-destructive">{secretsQuery.error.message}</div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Secrets"
        description="Write-only keys held by the daemon and injected only on pinned hosts."
      />

      <SettingGroup
        title="Stored keys"
        action={
          <Button variant="outline" size="xs" onClick={() => setViewMode({ kind: "create" })}>
            <PlusIcon className="size-3.5" />
            <span>Add secret</span>
          </Button>
        }
      >
        {content}
      </SettingGroup>

      {deleteMutation.error !== null && <FieldError>{deleteMutation.error.message}</FieldError>}
    </div>
  );
}
