import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { StarterSummary } from "@tetherbox/core/app";
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
import { Spinner } from "@tetherbox/ui/components/spinner";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, expectOk, queryKeys } from "../../lib/api.ts";
import { startersQueryOptions } from "../../lib/queries.ts";
import { starterKindLabel } from "../profile-form-fields.tsx";
import { StarterIcon } from "../starter-icons.tsx";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

function RemoveLibraryStarterButton({
  starter,
  disabled,
  onRemove,
}: {
  starter: StarterSummary;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={<Button variant="destructive-outline" size="xs" disabled={disabled} />}
      >
        <Trash2Icon className="size-3.5" />
        <span>Remove</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {starter.name} from the library?</AlertDialogTitle>
          <AlertDialogDescription>
            Profiles that already have <code>{starter.id}</code> keep their copy. It comes back to
            the library if one of those profiles changes it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onRemove}>
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function LibrarySection() {
  const queryClient = useQueryClient();
  const startersQuery = useQuery(startersQueryOptions);
  const libraryStarters = (startersQuery.data?.starters ?? []).filter(
    (starter) => starter.source === "library",
  );

  const removeMutation = useMutation({
    mutationFn: async (starter: StarterSummary) => {
      await expectOk(
        await appClient.starters[":starterId"].$delete({ param: { starterId: starter.id } }),
      );
    },
    onSuccess: (_data, starter) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.starters });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
      toast.add({ type: "success", title: `Removed ${starter.name} from the library` });
    },
  });

  let content = (
    <>
      {libraryStarters.map((starter) => (
        <SettingRow
          key={starter.id}
          title={
            <span className="flex items-center gap-2">
              <StarterIcon starter={starter} />
              <span>{starter.name}</span>
            </span>
          }
          description={`${starter.id} · ${starterKindLabel(starter)}`}
          control={
            <RemoveLibraryStarterButton
              starter={starter}
              disabled={removeMutation.isPending}
              onRemove={() => removeMutation.mutate(starter)}
            />
          }
        />
      ))}
    </>
  );

  if (startersQuery.isPending) {
    content = (
      <div className="flex justify-center p-6">
        <Spinner className="size-4 text-muted-foreground" />
      </div>
    );
  } else if (startersQuery.error !== null) {
    content = (
      <div className="px-4 py-4 text-xs text-destructive">{startersQuery.error.message}</div>
    );
  } else if (libraryStarters.length === 0) {
    content = (
      <div className="px-4 py-4 text-xs text-muted-foreground">
        Skills and modules the agent writes in any profile appear here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Starter library"
        description="Skills and modules the agent wrote in your profiles. Any profile can enable them from its starter list."
      />
      <SettingGroup title="Library starters">{content}</SettingGroup>
      {removeMutation.error !== null && <FieldError>{removeMutation.error.message}</FieldError>}
    </div>
  );
}
