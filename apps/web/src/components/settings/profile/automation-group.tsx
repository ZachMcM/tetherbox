import { useMutation, useQueryClient } from "@tanstack/react-query";
import { webhookPath, type ProfileDetail } from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { appClient, queryKeys, unwrapJson } from "../../../lib/api.ts";
import { SettingGroup, SettingRow } from "../shared.tsx";

export function AutomationGroup({ profile }: { profile: ProfileDetail }) {
  const queryClient = useQueryClient();
  const profileId = profile.id;

  const cancelPollMutation = useMutation({
    mutationFn: async (name: string) =>
      unwrapJson(
        await appClient.profiles[":profileId"]["poll-jobs"][":name"].$delete({
          param: { profileId, name },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profileId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });

  const cancelReminderMutation = useMutation({
    mutationFn: async (name: string) =>
      unwrapJson(
        await appClient.profiles[":profileId"].reminders[":name"].$delete({
          param: { profileId, name },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profileId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
    },
  });

  return (
    <SettingGroup title="Automation">
      <SettingRow
        title="Cron jobs"
        description={
          profile.cron.length > 0
            ? profile.cron.map(({ name, job }) => `${name} (${job.schedule})`).join(", ")
            : undefined
        }
        control={<Badge variant="outline">{profile.cron.length}</Badge>}
      />
      <SettingRow
        title="Webhooks"
        description={
          profile.webhooks.length > 0
            ? profile.webhooks
                .map(
                  ({ name, webhook }) =>
                    `${webhookPath(profile.id, name)} (${webhook.verify.kind})`,
                )
                .join(", ")
            : undefined
        }
        control={<Badge variant="outline">{profile.webhooks.length}</Badge>}
      />
      {profile.pollJobs.map((job) => (
        <SettingRow
          key={`poll-${job.name}`}
          title={`Poll: ${job.name}`}
          description={`Every ${job.job.intervalSeconds}s`}
          control={
            <Button
              variant="outline"
              size="xs"
              disabled={cancelPollMutation.isPending}
              onClick={() => cancelPollMutation.mutate(job.name)}
            >
              Cancel
            </Button>
          }
        />
      ))}
      {profile.reminders.map((reminder) => (
        <SettingRow
          key={`reminder-${reminder.name}`}
          title={`Reminder: ${reminder.name}`}
          description={`Due ${new Date(reminder.fireAt).toLocaleString()}`}
          control={
            <Button
              variant="outline"
              size="xs"
              disabled={cancelReminderMutation.isPending}
              onClick={() => cancelReminderMutation.mutate(reminder.name)}
            >
              Cancel
            </Button>
          }
        />
      ))}
    </SettingGroup>
  );
}
