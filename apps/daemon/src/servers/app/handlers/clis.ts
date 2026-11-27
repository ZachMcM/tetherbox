import type { CliHandlers } from "@tetherbox/core";
import type { CliAuthFlows } from "../../../clis/auth-flows.ts";
import type { CliInstallJobs } from "../../../clis/install-jobs.ts";
import type { CliStatusProbe } from "../../../clis/status.ts";

export function createCliHandlers({
  cliStatus,
  cliInstalls,
  cliAuthFlows,
}: {
  cliStatus: CliStatusProbe;
  cliInstalls: CliInstallJobs;
  cliAuthFlows: CliAuthFlows;
}): CliHandlers {
  return {
    listStatuses: () => cliStatus.list(),
    startInstall: (starterId) => cliInstalls.start(starterId),
    getInstallJob: (jobId) => cliInstalls.get(jobId),
    startAuth: (starterId) => cliAuthFlows.start(starterId),
    getAuthFlow: (flowId) => cliAuthFlows.get(flowId),
    respondAuthFlow: (flowId, value) => cliAuthFlows.respond(flowId, value),
    cancelAuthFlow: (flowId) => cliAuthFlows.cancel(flowId),
  };
}
