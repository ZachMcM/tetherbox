import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { appClient, getAuthStatus, queryKeys, unwrapJson } from "./api.ts";

export const authQueryOptions = queryOptions({
  queryKey: queryKeys.auth,
  queryFn: getAuthStatus,
});

export const appSettingsQueryOptions = queryOptions({
  queryKey: queryKeys.settings,
  queryFn: async () => unwrapJson(await appClient.settings.$get()),
});

export const profilesQueryOptions = queryOptions({
  queryKey: queryKeys.profiles,
  queryFn: async () => unwrapJson(await appClient.profiles.$get()),
});

export const startersQueryOptions = queryOptions({
  queryKey: queryKeys.starters,
  queryFn: async () => unwrapJson(await appClient.starters.$get()),
});

export const sessionsQueryOptions = queryOptions({
  queryKey: queryKeys.sessions,
  queryFn: async () => unwrapJson(await appClient.sessions.$get({ query: {} })),
});

export const secretsQueryOptions = queryOptions({
  queryKey: queryKeys.secrets,
  queryFn: async () => unwrapJson(await appClient.secrets.$get()),
});

export const llmStatusQueryOptions = queryOptions({
  queryKey: queryKeys.llmStatus,
  queryFn: async () => unwrapJson(await appClient.llm.status.$get()),
});

export const llmModelsQueryOptions = queryOptions({
  queryKey: queryKeys.llmModels,
  queryFn: async () => unwrapJson(await appClient.llm.models.$get()),
});

export const oauthStatusQueryOptions = queryOptions({
  queryKey: queryKeys.oauthStatus,
  queryFn: async () => unwrapJson(await appClient.oauth.status.$get()),
});

export function invalidateSecretQueries(queryClient: QueryClient): void {
  for (const queryKey of [
    queryKeys.secrets,
    queryKeys.llmStatus,
    queryKeys.oauthStatus,
    queryKeys.llmModels,
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}
