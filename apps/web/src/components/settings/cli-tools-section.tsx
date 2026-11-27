import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { cliStatusQueryOptions } from "../../lib/queries.ts";
import { CliAuthFlowPanel } from "../cli-setup/cli-auth-flow-panel.tsx";
import { CliInstallCard } from "../cli-setup/cli-install-card.tsx";
import { useCliInstallRunner } from "../cli-setup/use-cli-install-runner.ts";
import { SectionHeader } from "./shared.tsx";

export function CliToolsSection() {
  const cliStatusQuery = useQuery({
    ...cliStatusQueryOptions,
    refetchOnWindowFocus: "always",
  });
  const installRunner = useCliInstallRunner();

  const clis = cliStatusQuery.data?.clis ?? [];
  const missingOrInstalling = clis.filter(
    (entry) => entry.status.kind === "missing" || installRunner.jobs[entry.starterId] !== undefined,
  );
  const installedCount = clis.filter((entry) => entry.status.kind === "installed").length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="CLI tools"
        description={`User-space CLIs installed for the agent user (${installedCount}/${clis.length} installed). Binaries and logins are shared across all profiles.`}
      />

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void cliStatusQuery.refetch()}
          disabled={cliStatusQuery.isFetching}
        >
          <RefreshCwIcon className="size-3.5" />
          <span>Refresh status</span>
        </Button>
      </div>

      {cliStatusQuery.isPending ? (
        <div className="flex justify-center py-8">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : cliStatusQuery.error !== null ? (
        <FieldError>{cliStatusQuery.error.message}</FieldError>
      ) : (
        <div className="space-y-4">
          {missingOrInstalling.length > 0 && (
            <CliInstallCard entries={missingOrInstalling} runner={installRunner} />
          )}

          <div className="space-y-3">
            {clis.map((entry) => (
              <div key={entry.starterId} className="rounded-xl border border-border bg-card p-3.5">
                <CliAuthFlowPanel entry={entry} installRunner={installRunner} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
