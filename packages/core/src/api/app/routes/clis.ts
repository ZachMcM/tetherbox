import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import type { CliAuthFlowState, CliInstallJobState } from "../../../cli.ts";
import { starterIdParam } from "../params.ts";
import { cliAuthRespondInputSchema, type StarterCliStatusEntry } from "../schemas.ts";

export interface CliHandlers {
  listStatuses(): Promise<StarterCliStatusEntry[]>;
  startInstall(starterId: string): CliInstallJobState;
  getInstallJob(jobId: string): CliInstallJobState;
  startAuth(starterId: string): Promise<CliAuthFlowState>;
  getAuthFlow(flowId: string): CliAuthFlowState;
  respondAuthFlow(flowId: string, value: string): CliAuthFlowState;
  cancelAuthFlow(flowId: string): { cancelled: boolean };
}

export function createCliRoutes(handlers: CliHandlers) {
  return new Hono()
    .get("/clis/status", async (c) => c.json({ clis: await handlers.listStatuses() }, 200))
    .post("/clis/:starterId/install", zValidator("param", starterIdParam), (c) =>
      c.json({ job: handlers.startInstall(c.req.valid("param").starterId) }, 200),
    )
    .get("/clis/installs/:jobId", (c) =>
      c.json({ job: handlers.getInstallJob(c.req.param("jobId")) }, 200),
    )
    .post("/clis/:starterId/auth/start", zValidator("param", starterIdParam), async (c) =>
      c.json({ flow: await handlers.startAuth(c.req.valid("param").starterId) }, 200),
    )
    .get("/clis/auth/flows/:flowId", (c) =>
      c.json({ flow: handlers.getAuthFlow(c.req.param("flowId")) }, 200),
    )
    .post("/clis/auth/flows/:flowId/respond", zValidator("json", cliAuthRespondInputSchema), (c) =>
      c.json(
        { flow: handlers.respondAuthFlow(c.req.param("flowId"), c.req.valid("json").value) },
        200,
      ),
    )
    .post("/clis/auth/flows/:flowId/cancel", (c) =>
      c.json(handlers.cancelAuthFlow(c.req.param("flowId")), 200),
    );
}
