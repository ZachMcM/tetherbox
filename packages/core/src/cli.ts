import { z } from "zod";

const cliInstallJobBaseSchema = {
  id: z.string(),
  starterId: z.string(),
  binary: z.string(),
  output: z.string(),
};

export const cliInstallJobStateSchema = z.discriminatedUnion("status", [
  z.object({
    ...cliInstallJobBaseSchema,
    status: z.literal("running"),
    error: z.null(),
  }),
  z.object({
    ...cliInstallJobBaseSchema,
    status: z.literal("completed"),
    error: z.null(),
  }),
  z.object({
    ...cliInstallJobBaseSchema,
    status: z.literal("failed"),
    error: z.string(),
  }),
]);
export type CliInstallJobState = z.infer<typeof cliInstallJobStateSchema>;

export const cliAuthFlowEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("auth_url"), url: z.string() }),
  z.object({
    kind: z.literal("device_code"),
    verificationUri: z.string(),
    userCode: z.string(),
  }),
]);
export type CliAuthFlowEvent = z.infer<typeof cliAuthFlowEventSchema>;

const cliAuthFlowBaseSchema = {
  id: z.string(),
  starterId: z.string(),
  binary: z.string(),
  events: z.array(cliAuthFlowEventSchema),
  output: z.string(),
};

export const cliAuthFlowStateSchema = z.discriminatedUnion("status", [
  z.object({
    ...cliAuthFlowBaseSchema,
    status: z.literal("running"),
    prompt: z.string().nullable(),
    error: z.null(),
  }),
  z.object({
    ...cliAuthFlowBaseSchema,
    status: z.literal("completed"),
    prompt: z.null(),
    error: z.null(),
  }),
  z.object({
    ...cliAuthFlowBaseSchema,
    status: z.literal("failed"),
    prompt: z.null(),
    error: z.string(),
  }),
  z.object({
    ...cliAuthFlowBaseSchema,
    status: z.literal("cancelled"),
    prompt: z.null(),
    error: z.string(),
  }),
]);
export type CliAuthFlowState = z.infer<typeof cliAuthFlowStateSchema>;
