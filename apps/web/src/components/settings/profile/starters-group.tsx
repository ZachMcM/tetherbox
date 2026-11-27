import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ProfileDetail, StarterConfig, StarterSummary } from "@tetherbox/core/app";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, unwrapJson } from "../../../lib/api.ts";
import { CliInstallCard } from "../../cli-setup/cli-install-card.tsx";
import {
  selectInstallEntries,
  STARTER_CATEGORY_ORDER,
  type useStarterSetupState,
} from "../../profile-form-fields.tsx";
import { SettingGroup } from "../shared.tsx";
import { StarterCatalogRow } from "./starter-catalog-row.tsx";

export function StartersGroup({
  profile,
  setup,
  onUpdated,
}: {
  profile: ProfileDetail;
  setup: ReturnType<typeof useStarterSetupState>;
  onUpdated: (data: { profile: ProfileDetail }) => void;
}) {
  const profileId = profile.id;
  const {
    starters,
    startersQuery,
    oauthPresets,
    oauthLogins,
    readinessById,
    installRunner,
    isRefreshing,
    statusError,
    refreshStatus,
  } = setup;
  const [expandedStarters, setExpandedStarters] = useState<Record<string, boolean>>({});
  const [pendingEnableIds, setPendingEnableIds] = useState<Record<string, boolean>>({});

  const updateStartersMutation = useMutation({
    mutationFn: async (input: { starters: string[]; starterConfig: StarterConfig }) =>
      unwrapJson(
        await appClient.profiles[":profileId"].$patch({
          param: { profileId },
          json: input,
        }),
      ),
    onSuccess: onUpdated,
  });

  const [updatingStarterIds, setUpdatingStarterIds] = useState<Record<string, boolean>>({});

  const updateStarterMutation = useMutation({
    onMutate: (starter: StarterSummary) => {
      setUpdatingStarterIds((prev) => ({ ...prev, [starter.id]: true }));
    },
    onSettled: (_data, _error, starter) => {
      setUpdatingStarterIds((prev) => ({ ...prev, [starter.id]: false }));
    },
    mutationFn: async (starter: StarterSummary) =>
      unwrapJson(
        await appClient.profiles[":profileId"].starters[":starterId"].update.$post({
          param: { profileId, starterId: starter.id },
        }),
      ),
    onSuccess: (data, starter) => {
      onUpdated(data);
      toast.add({ type: "success", title: `Updated ${starter.name} from the library` });
    },
  });

  const enabledSet = new Set(profile.config.starters);
  const updateSet = new Set(profile.starterUpdates);
  const enabledSummaries = starters.filter((starter) => enabledSet.has(starter.id));
  const missingInstallEntries = selectInstallEntries(
    enabledSummaries,
    readinessById,
    installRunner,
  );

  const nextOrderedStarters = (nextSet: Set<string>): string[] =>
    starters.filter((starter) => nextSet.has(starter.id)).map((starter) => starter.id);

  const handleToggleStarter = (starter: StarterSummary, checked: boolean) => {
    if (!checked) {
      if (pendingEnableIds[starter.id]) {
        setPendingEnableIds((prev) => ({ ...prev, [starter.id]: false }));
        setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));

        return;
      }

      const nextSet = new Set(profile.config.starters);

      nextSet.delete(starter.id);

      const nextConfig: Record<string, Record<string, string>> = {};

      for (const [id, fields] of Object.entries(profile.config.starterConfig)) {
        if (nextSet.has(id)) {
          nextConfig[id] = fields;
        }
      }

      setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));
      updateStartersMutation.mutate({
        starters: nextOrderedStarters(nextSet),
        starterConfig: nextConfig,
      });

      return;
    }

    if (starter.configFields.length > 0) {
      setPendingEnableIds((prev) => ({ ...prev, [starter.id]: true }));
      setExpandedStarters((prev) => ({ ...prev, [starter.id]: true }));

      return;
    }

    const nextSet = new Set(profile.config.starters);

    nextSet.add(starter.id);

    const readiness = readinessById.get(starter.id);
    const shouldExpand =
      readiness !== undefined &&
      (!readiness.isVmReady || readiness.hasUnverifiedCliAuth || starter.setupNote !== undefined);

    if (shouldExpand) {
      setExpandedStarters((prev) => ({ ...prev, [starter.id]: true }));
    }

    updateStartersMutation.mutate({
      starters: nextOrderedStarters(nextSet),
      starterConfig: profile.config.starterConfig,
    });
  };

  const handleSaveStarterConfig = async (
    starter: StarterSummary,
    values: Record<string, string>,
  ) => {
    const nextSet = new Set(profile.config.starters);

    nextSet.add(starter.id);

    const nextConfig: StarterConfig = {
      ...profile.config.starterConfig,
      [starter.id]: values,
    };

    await updateStartersMutation.mutateAsync({
      starters: nextOrderedStarters(nextSet),
      starterConfig: nextConfig,
    });

    setPendingEnableIds((prev) => ({ ...prev, [starter.id]: false }));

    const readiness = readinessById.get(starter.id);

    if (
      readiness?.isVmReady &&
      !readiness.hasUnverifiedCliAuth &&
      starter.setupNote === undefined
    ) {
      setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));
    }

    toast.add({
      type: "success",
      title: enabledSet.has(starter.id)
        ? `Updated ${starter.name} settings`
        : `Enabled ${starter.name}`,
    });
  };

  return (
    <>
      {missingInstallEntries.length > 0 && (
        <CliInstallCard entries={missingInstallEntries} runner={installRunner} />
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-medium">Starters</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Toggle integrations, coding harnesses, and CLIs for this profile. Binaries and
              credentials persist across the VM.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={refreshStatus}
            disabled={isRefreshing}
          >
            <RefreshCwIcon className="size-3.5" />
            <span>Refresh</span>
          </Button>
        </div>

        {startersQuery.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="size-4 text-muted-foreground" />
          </div>
        ) : startersQuery.error !== null ? (
          <FieldError>{startersQuery.error.message}</FieldError>
        ) : (
          <div className="space-y-4">
            {STARTER_CATEGORY_ORDER.map(({ category, label }) => {
              const group = starters.filter((starter) => starter.category === category);

              if (group.length === 0) {
                return null;
              }

              return (
                <SettingGroup key={category} title={label}>
                  {group.map((starter) => (
                    <StarterCatalogRow
                      key={`${profile.id}-${starter.id}`}
                      profile={profile}
                      starter={starter}
                      enabled={enabledSet.has(starter.id)}
                      readiness={readinessById.get(starter.id)}
                      oauthPresets={oauthPresets}
                      oauthLogins={oauthLogins}
                      installRunner={installRunner}
                      expanded={expandedStarters[starter.id] === true}
                      pendingEnable={pendingEnableIds[starter.id] === true}
                      busy={updateStartersMutation.isPending}
                      updateAvailable={updateSet.has(starter.id)}
                      updating={updatingStarterIds[starter.id] === true}
                      onUpdate={() => updateStarterMutation.mutate(starter)}
                      onToggleExpand={() =>
                        setExpandedStarters((prev) => ({
                          ...prev,
                          [starter.id]: !prev[starter.id],
                        }))
                      }
                      onToggleSwitch={(checked) => handleToggleStarter(starter, checked)}
                      onSaveConfig={(values) => handleSaveStarterConfig(starter, values)}
                      onCancelPending={() => {
                        setPendingEnableIds((prev) => ({ ...prev, [starter.id]: false }));
                        setExpandedStarters((prev) => ({ ...prev, [starter.id]: false }));
                      }}
                    />
                  ))}
                </SettingGroup>
              );
            })}
          </div>
        )}

        {statusError !== null && <FieldError>{statusError.message}</FieldError>}
        {updateStartersMutation.error !== null && (
          <FieldError>{updateStartersMutation.error.message}</FieldError>
        )}
        {updateStarterMutation.error !== null && (
          <FieldError>{updateStarterMutation.error.message}</FieldError>
        )}
      </section>
    </>
  );
}
