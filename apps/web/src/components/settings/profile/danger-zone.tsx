import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProfileDetail } from "@tetherbox/core/app";
import { Trash2Icon } from "lucide-react";
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
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { appClient, expectOk, queryKeys } from "../../../lib/api.ts";
import { SettingGroup, SettingRow } from "../shared.tsx";

export function DangerZone({
  profile,
  onDeleted,
}: {
  profile: ProfileDetail;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const profileId = profile.id;

  const deleteProfileMutation = useMutation({
    mutationFn: async () => {
      await expectOk(await appClient.profiles[":profileId"].$delete({ param: { profileId } }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      queryClient.removeQueries({ queryKey: queryKeys.profile(profileId) });
      onDeleted();
    },
  });

  return (
    <>
      <SettingGroup title="Danger zone">
        <SettingRow
          title="Delete profile"
          description="Removes this profile directory, its sessions, poll jobs, and reminders."
          control={
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="destructive-outline"
                    size="xs"
                    disabled={deleteProfileMutation.isPending}
                  />
                }
              >
                <Trash2Icon className="size-3.5" />
                <span>Delete</span>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {profile.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes profile <code>{profile.id}</code> and all of its
                    conversations.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={() => deleteProfileMutation.mutate()}
                    disabled={deleteProfileMutation.isPending}
                  >
                    {deleteProfileMutation.isPending ? "Deleting…" : "Delete profile"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          }
        />
      </SettingGroup>
      {deleteProfileMutation.error !== null && (
        <FieldError>{deleteProfileMutation.error.message}</FieldError>
      )}
    </>
  );
}
