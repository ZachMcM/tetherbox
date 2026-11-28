import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  secretKeySchema,
  type LlmProvider,
  type LlmProviderStatus,
  type SecretKey,
} from "@tetherbox/core/app";
import { Trash2Icon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Separator } from "@tetherbox/ui/components/separator";
import { appClient, expectOk, unwrapJson } from "../../lib/api.ts";
import { invalidateSecretQueries } from "../../lib/queries.ts";
import { LlmOAuthFlowPanel } from "./llm-oauth-flow-panel.tsx";

function defaultLlmKey(provider: LlmProvider): SecretKey {
  return secretKeySchema.parse(`${provider.toUpperCase().replaceAll("-", "_")}_API_KEY`);
}

export function LlmProviderAuthPanel({
  provider,
  boundApiKey,
}: {
  provider: LlmProviderStatus;
  boundApiKey: SecretKey | undefined;
}) {
  const supportsApiKey = provider.supportedAuth.includes("api-key");
  const supportsOAuth = provider.supportedAuth.includes("oauth");

  return (
    <div className="space-y-5">
      {supportsApiKey && <LlmApiKeyForm provider={provider.provider} boundApiKey={boundApiKey} />}
      {supportsApiKey && supportsOAuth && <Separator />}
      {supportsOAuth && <LlmOAuthFlowPanel provider={provider} />}
    </div>
  );
}

function LlmApiKeyForm({
  provider,
  boundApiKey,
}: {
  provider: LlmProvider;
  boundApiKey: SecretKey | undefined;
}) {
  const queryClient = useQueryClient();
  const [apiKeyValue, setApiKeyValue] = useState("");
  const targetApiKeyName = boundApiKey ?? defaultLlmKey(provider);

  const invalidate = () => invalidateSecretQueries(queryClient);

  const saveMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.secrets[":key"].$put({
          param: { key: targetApiKeyName },
          json: {
            value: apiKeyValue.trim(),
            binding: { kind: "llm", provider },
          },
        }),
      ),
    onSuccess: () => {
      setApiKeyValue("");
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: SecretKey) => {
      await expectOk(await appClient.secrets[":key"].$delete({ param: { key } }));
    },
    onSuccess: invalidate,
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (apiKeyValue.trim() !== "") {
      saveMutation.mutate();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">API key</h3>
        {boundApiKey !== undefined && (
          <Button
            type="button"
            variant="destructive-outline"
            size="xs"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate(boundApiKey)}
          >
            <Trash2Icon className="size-3.5" />
            <span>Remove</span>
          </Button>
        )}
      </div>
      <Field>
        <FieldLabel
          htmlFor={`llm-api-key-${provider}`}
          className="text-xs font-normal text-muted-foreground"
        >
          <span>Secret key</span>
          <code className="font-mono text-xs text-foreground/80">{targetApiKeyName}</code>
        </FieldLabel>
        <div className="flex items-center gap-2">
          <Input
            id={`llm-api-key-${provider}`}
            type="password"
            placeholder={boundApiKey !== undefined ? "Enter new key to replace" : "Paste API key"}
            value={apiKeyValue}
            onChange={(event) => setApiKeyValue(event.target.value)}
          />
          <Button type="submit" disabled={saveMutation.isPending || apiKeyValue.trim() === ""}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        <FieldDescription className="text-xs">
          Stored write-only under <code>{targetApiKeyName}</code> bound to <code>{provider}</code>.
        </FieldDescription>
      </Field>
      {saveMutation.error !== null && <FieldError>{saveMutation.error.message}</FieldError>}
      {deleteMutation.error !== null && <FieldError>{deleteMutation.error.message}</FieldError>}
    </form>
  );
}
