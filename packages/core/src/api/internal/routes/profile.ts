import { Hono } from "hono";
import type { ProfileValidation } from "../../../profile.ts";
import type { InternalEnv, RunContext } from "../run-context.ts";

export interface ProfileValidationHandlers {
  validate(run: RunContext): Promise<ProfileValidation>;
}

export function createProfileValidationRoutes(handlers: ProfileValidationHandlers) {
  return new Hono<InternalEnv>().post("/rpc/profile/validate", async (c) =>
    c.json(await handlers.validate(c.get("run"))),
  );
}
