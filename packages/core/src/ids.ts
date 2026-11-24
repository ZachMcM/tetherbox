import { z } from "zod";

const slug = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const profileIdSchema = z.string().regex(slug).brand<"ProfileId">();
export type ProfileId = z.infer<typeof profileIdSchema>;

export const entryNameSchema = z.string().regex(slug).brand<"EntryName">();
export type EntryName = z.infer<typeof entryNameSchema>;

export const runIdSchema = z.uuid().brand<"RunId">();
export type RunId = z.infer<typeof runIdSchema>;

export const secretKeySchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{0,127}$/)
  .brand<"SecretKey">();
export type SecretKey = z.infer<typeof secretKeySchema>;
