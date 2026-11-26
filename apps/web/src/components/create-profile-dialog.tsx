import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  llmAuthKindSchema,
  llmProviderIds,
  llmProviderSchema,
  supportedLlmAuthKinds,
  type LlmAuthKind,
  type LlmProvider,
} from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@tetherbox/ui/components/dialog";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { NativeSelect, NativeSelectOption } from "@tetherbox/ui/components/native-select";
import { appClient, queryKeys, unwrapJson } from "../lib/api.ts";

const DEFAULT_MODEL_BY_PROVIDER = {
  anthropic: "claude-sonnet-4-5",
  openai: "gpt-5.2",
  "openai-codex": "gpt-5.6-luna",
  google: "gemini-2.5-pro",
  openrouter: "~anthropic/claude-sonnet-latest",
  opencode: "claude-sonnet-4-5",
  xai: "grok-4.7",
  meta: "muse-spark-1.3",
  "github-copilot": "claude-haiku-4.5",
} as const satisfies Record<LlmProvider, string>;

const DEFAULT_PROVIDER: LlmProvider = "anthropic";
const DEFAULT_AUTH: LlmAuthKind = "api-key";

export function CreateProfileDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (profileId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<LlmProvider>(DEFAULT_PROVIDER);
  const [modelId, setModelId] = useState<string>(DEFAULT_MODEL_BY_PROVIDER[DEFAULT_PROVIDER]);
  const [auth, setAuth] = useState<LlmAuthKind>(DEFAULT_AUTH);

  const supportedAuth = supportedLlmAuthKinds(provider);

  const resetForm = () => {
    setId("");
    setName("");
    setProvider(DEFAULT_PROVIDER);
    setModelId(DEFAULT_MODEL_BY_PROVIDER[DEFAULT_PROVIDER]);
    setAuth(DEFAULT_AUTH);
  };

  const handleProviderChange = (value: string) => {
    const parsed = llmProviderSchema.safeParse(value);

    if (!parsed.success) {
      return;
    }

    const nextProvider = parsed.data;

    setProvider(nextProvider);
    setModelId(DEFAULT_MODEL_BY_PROVIDER[nextProvider]);

    const nextAuthKinds = supportedLlmAuthKinds(nextProvider);

    if (!nextAuthKinds.includes(auth)) {
      setAuth(nextAuthKinds[0] ?? DEFAULT_AUTH);
    }
  };

  const handleAuthChange = (value: string) => {
    const parsed = llmAuthKindSchema.safeParse(value);

    if (parsed.success) {
      setAuth(parsed.data);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const trimmedId = id.trim();
      const response = await appClient.profiles.$post({
        json: {
          id: trimmedId.toLowerCase(),
          name: name.trim() || trimmedId,
          model: { provider, id: modelId.trim(), auth },
          starters: [],
          starterConfig: {},
        },
      });

      return unwrapJson(response);
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      resetForm();
      onOpenChange(false);
      onCreated?.(data.profile.id);
    },
  });

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetForm();
      mutation.reset();
    }

    onOpenChange(nextOpen);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate();
  };

  const canSubmit = !mutation.isPending && id.trim() !== "" && modelId.trim() !== "";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New profile</DialogTitle>
          <DialogDescription>
            Creates a git-backed profile directory and loads it into the daemon.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="profile-id">Profile ID</FieldLabel>
            <Input
              id="profile-id"
              placeholder="work"
              value={id}
              onChange={(event) => setId(event.target.value)}
              pattern="[A-Za-z0-9][A-Za-z0-9-]{0,62}"
              title="Letters, numbers, and hyphens"
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="profile-name">Display name</FieldLabel>
            <Input
              id="profile-name"
              placeholder="Work"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="profile-provider">Provider</FieldLabel>
              <NativeSelect
                id="profile-provider"
                className="w-full"
                value={provider}
                onChange={(event) => handleProviderChange(event.target.value)}
              >
                {llmProviderIds.map((entry) => (
                  <NativeSelectOption key={entry} value={entry}>
                    {entry}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-auth">Auth</FieldLabel>
              <NativeSelect
                id="profile-auth"
                className="w-full"
                value={auth}
                onChange={(event) => handleAuthChange(event.target.value)}
              >
                {supportedAuth.map((kind) => (
                  <NativeSelectOption key={kind} value={kind}>
                    {kind}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="profile-model">Model ID</FieldLabel>
            <Input
              id="profile-model"
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              required
            />
          </Field>
          {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {mutation.isPending ? "Creating…" : "Create profile"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
