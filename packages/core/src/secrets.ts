import { z } from "zod";

const hostnameSchema = z
  .string()
  .regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/);

export const secretInjectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bearer") }),
  z.object({ kind: z.literal("header"), name: z.string().min(1) }),
  z.object({ kind: z.literal("query"), name: z.string().min(1) }),
]);
export type SecretInjection = z.infer<typeof secretInjectionSchema>;

export const secretBindingSchema = z.object({
  domains: z.array(hostnameSchema).nonempty(),
  inject: secretInjectionSchema,
});
export type SecretBinding = z.infer<typeof secretBindingSchema>;
