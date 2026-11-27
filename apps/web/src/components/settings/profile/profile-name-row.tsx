import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ProfileDetail } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, unwrapJson } from "../../../lib/api.ts";

export function ProfileNameRow({
  profile,
  onSaved,
}: {
  profile: ProfileDetail;
  onSaved: (updated: { profile: ProfileDetail }) => void;
}) {
  const [name, setName] = useState(profile.config.name);
  const trimmed = name.trim();
  const dirty = trimmed !== "" && trimmed !== profile.config.name;

  const mutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId: profile.id },
          json: { name: trimmed },
        }),
      ),
    onSuccess: (data) => {
      onSaved(data);
      toast.add({ type: "success", title: "Profile name updated" });
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (dirty) {
      mutation.mutate();
    }
  };

  return (
    <div className="space-y-2 px-4 py-3">
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <Field className="flex-1">
          <FieldLabel htmlFor={`profile-name-${profile.id}`}>Display name</FieldLabel>
          <Input
            id={`profile-name-${profile.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </Field>
        {dirty && (
          <Button type="submit" size="sm" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
        )}
      </form>
      {mutation.error !== null && <FieldError>{mutation.error.message}</FieldError>}
    </div>
  );
}
