import { queryOptions } from "@tanstack/react-query";
import { appClient, queryKeys, unwrapJson } from "./api.ts";

export const profilesQueryOptions = queryOptions({
  queryKey: queryKeys.profiles,
  queryFn: async () => unwrapJson(await appClient.profiles.$get()),
});

export const sessionsQueryOptions = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: async () => unwrapJson(await appClient.sessions.$get({ query: {} })),
});
