import { z } from "zod";
import { entryNameSchema } from "./ids.ts";

export const pollJobSchema = z.object({
  check: z.object({
    command: z.tuple([z.string().min(1)], z.string()),
  }),
  intervalSeconds: z.int().min(10),
  stallAfterSeconds: z.int().positive(),
  prompt: z.string().min(1),
});
export type PollJob = z.infer<typeof pollJobSchema>;

export const registerPollJobInputSchema = pollJobSchema.extend({ name: entryNameSchema });
export type RegisterPollJobInput = z.infer<typeof registerPollJobInputSchema>;

export const registeredPollJobSchema = z.object({
  name: entryNameSchema,
  job: pollJobSchema,
  registeredAt: z.iso.datetime(),
  threadTs: z.string().min(1).optional(),
});
export type RegisteredPollJob = z.infer<typeof registeredPollJobSchema>;
