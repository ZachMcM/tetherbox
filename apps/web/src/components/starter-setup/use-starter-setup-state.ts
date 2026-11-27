import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { secretsQueryOptions, startersQueryOptions } from "../../lib/queries.ts";
import { useCliInstallRunner } from "../cli-setup/use-cli-install-runner.ts";
import { getStarterReadiness, type StarterReadiness } from "../../lib/starter-readiness.ts";
import { cliStatusQueryOptions, oauthStatusQueryOptions } from "../../lib/queries.ts";

export function useStarterSetupState() {
  const startersQuery = useQuery(startersQueryOptions);
  const secretsQuery = useQuery(secretsQueryOptions);
  const oauthStatusQuery = useQuery({ ...oauthStatusQueryOptions, refetchOnWindowFocus: "always" });
  const cliStatusQuery = useQuery({ ...cliStatusQueryOptions, refetchOnWindowFocus: "always" });
  const installRunner = useCliInstallRunner();

  const starters = startersQuery.data?.starters ?? [];
  const oauthPresets = oauthStatusQuery.data?.presets ?? [];
  const oauthLogins = oauthStatusQuery.data?.logins ?? [];
  const cliStatuses = cliStatusQuery.data?.clis;

  const readinessById = useMemo(() => {
    const map = new Map<string, StarterReadiness>();

    for (const starter of starters) {
      map.set(
        starter.id,
        getStarterReadiness(starter, {
          secrets: secretsQuery.data?.secrets,
          oauthLogins: oauthStatusQuery.data?.logins,
          cliStatuses,
        }),
      );
    }

    return map;
  }, [starters, secretsQuery.data?.secrets, oauthStatusQuery.data?.logins, cliStatuses]);

  const refreshStatus = () => {
    void cliStatusQuery.refetch();
    void oauthStatusQuery.refetch();
    void secretsQuery.refetch();
  };

  const isRefreshing =
    cliStatusQuery.isFetching || oauthStatusQuery.isFetching || secretsQuery.isFetching;
  const statusPending =
    cliStatusQuery.isPending || oauthStatusQuery.isPending || secretsQuery.isPending;
  const statusError = cliStatusQuery.error ?? oauthStatusQuery.error ?? secretsQuery.error ?? null;

  return {
    starters,
    startersQuery,
    oauthPresets,
    oauthLogins,
    readinessById,
    installRunner,
    isRefreshing,
    statusPending,
    statusError,
    refreshStatus,
  };
}
