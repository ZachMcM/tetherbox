import { z } from "zod";
import { entryNameSchema } from "./ids.ts";
import { slackChannelIdSchema, slackTsSchema } from "./profile.ts";

const reminderBase = {
  name: entryNameSchema,
  prompt: z.string().min(1),
};

export const scheduleReminderInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("at"),
    ...reminderBase,
    fireAt: z.iso.datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal("in"),
    ...reminderBase,
    delaySeconds: z.int().positive(),
  }),
]);
export type ScheduleReminderInput = z.infer<typeof scheduleReminderInputSchema>;

export const scheduledReminderSchema = z.object({
  name: entryNameSchema,
  fireAt: z.iso.datetime(),
  prompt: z.string().min(1),
  createdAt: z.iso.datetime(),
  channelId: slackChannelIdSchema.optional(),
  threadTs: slackTsSchema.optional(),
});
export type ScheduledReminder = z.infer<typeof scheduledReminderSchema>;
