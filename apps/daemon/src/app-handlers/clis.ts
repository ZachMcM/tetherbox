import type { CliHandlers } from "@tetherbox/core";
import type { CliManager } from "../cli-manager.ts";

export function createCliHandlers({ clis }: { clis: CliManager }): CliHandlers {
  return {
    listStatuses: () => clis.listStatuses(),
    startInstall: (starterId) => clis.startInstall(starterId),
    getInstallJob: (jobId) => clis.getInstallJob(jobId),
    startAuth: (starterId) => clis.startAuth(starterId),
    getAuthFlow: (flowId) => clis.getAuthFlow(flowId),
    respondAuthFlow: (flowId, value) => clis.respondAuthFlow(flowId, value),
    cancelAuthFlow: (flowId) => clis.cancelAuthFlow(flowId),
  };
}
