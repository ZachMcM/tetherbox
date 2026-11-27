import { z } from "zod";

export const notifyInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(1000),
});
export type NotifyInput = z.infer<typeof notifyInputSchema>;
