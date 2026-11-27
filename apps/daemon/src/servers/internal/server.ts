import { chmod, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import { createInternalApi } from "@tetherbox/core";
import { createInternalHandlers, type InternalHandlerDeps } from "./handlers.ts";

export interface InternalServerDeps extends InternalHandlerDeps {
  socketPath: string;
}

export async function startInternalServer({ socketPath, ...deps }: InternalServerDeps) {
  const app = createInternalApi(createInternalHandlers(deps));
  const server = createAdaptorServer({ fetch: app.fetch });

  await mkdir(dirname(socketPath), { recursive: true });
  await rm(socketPath, { force: true });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  // TODO: Have the installer create a group shared by the daemon and agent users and chgrp the
  // socket to it, so 0660 lets agent runs connect and nobody else.
  await chmod(socketPath, 0o660);

  return server;
}
