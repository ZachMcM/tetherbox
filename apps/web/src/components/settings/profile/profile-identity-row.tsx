import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Buddy as BuddyValue, ProfileDetail } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, unwrapJson } from "../../../lib/api.ts";
import { BuddyPicker, BuddyTile } from "../../buddy-picker.tsx";

export function ProfileIdentityRow({
  profile,
  onSaved,
}: {
  profile: ProfileDetail;
  onSaved: (updated: { profile: ProfileDetail }) => void;
}) {
  const [name, setName] = useState(profile.name);
  const trimmed = name.trim();
  const dirty = trimmed !== "" && trimmed !== profile.name;

  const nameMutation = useMutation({
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

  const buddyMutation = useMutation({
    scope: { id: `profile-buddy-${profile.id}` },
    mutationFn: async (buddy: BuddyValue) =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId: profile.id },
          json: { buddy },
        }),
      ),
    onSuccess: onSaved,
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (dirty) {
      nameMutation.mutate();
    }
  };

  const buddy = buddyMutation.isPending ? buddyMutation.variables : profile.buddy;

  return (
    <div className="space-y-4 px-4 py-4">
      <div className="flex items-end gap-4">
        <BuddyTile buddy={buddy} />
        <form onSubmit={handleSubmit} className="flex flex-1 items-end gap-2">
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
            <Button type="submit" disabled={nameMutation.isPending}>
              {nameMutation.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form>
      </div>
      {nameMutation.error !== null && <FieldError>{nameMutation.error.message}</FieldError>}
      <BuddyPicker value={buddy} onChange={(next) => buddyMutation.mutate(next)} />
      {buddyMutation.error !== null && <FieldError>{buddyMutation.error.message}</FieldError>}
    </div>
  );
}
