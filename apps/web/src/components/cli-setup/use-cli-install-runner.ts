import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { CliInstallJobState } from "@tetherbox/core/app";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, unwrapJson } from "../../lib/api.ts";
import { upsertCliInstallJob, useCliInstallJobs } from "../../lib/live-store.ts";

export interface CliInstallRunner {
  readonly jobs: Readonly<Record<string, CliInstallJobState>>;
  readonly starting: Readonly<Record<string, boolean>>;
  readonly isAnyRunning: boolean;
  readonly installOne: (starterId: string) => Promise<void>;
  readonly installAll: (starterIds: readonly string[]) => Promise<void>;
}

export function useCliInstallRunner(): CliInstallRunner {
  const queryClient = useQueryClient();
  const jobs = useCliInstallJobs();
  const [starting, setStarting] = useState<Record<string, boolean>>({});
  const [startedJobIds, setStartedJobIds] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const settled = Object.values(jobs).filter(
      (job) => job.status !== "running" && startedJobIds.has(job.id),
    );

    if (settled.length === 0) {
      return;
    }

    for (const job of settled) {
      if (job.status === "completed") {
        toast.add({ type: "success", title: `Installed ${job.binary}` });
      } else {
        toast.add({
          type: "error",
          title: `Could not install ${job.binary}`,
          description: job.error,
        });
      }
    }

    setStartedJobIds(
      (prev) => new Set([...prev].filter((id) => !settled.some((job) => job.id === id))),
    );
  }, [jobs, startedJobIds]);

  const installOne = useCallback(
    async (starterId: string) => {
      setStarting((prev) => ({ ...prev, [starterId]: true }));

      try {
        const result = await unwrapJson(
          await appClient.clis[":starterId"].install.$post({ param: { starterId } }),
        );

        setStartedJobIds((prev) => new Set(prev).add(result.job.id));
        upsertCliInstallJob(result.job, queryClient);
      } catch (error) {
        toast.add({
          type: "error",
          title: `Could not start ${starterId} install`,
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setStarting((prev) => ({ ...prev, [starterId]: false }));
      }
    },
    [queryClient],
  );

  const installAll = useCallback(
    async (starterIds: readonly string[]) => {
      await Promise.all(starterIds.map((id) => installOne(id)));
    },
    [installOne],
  );

  const isAnyRunning =
    Object.values(jobs).some((job) => job.status === "running") ||
    Object.values(starting).some((isStarting) => isStarting);

  return { jobs, starting, isAnyRunning, installOne, installAll };
}
