import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { LlmOAuthFlowState, LlmProviderStatus } from "@tetherbox/core/app";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, expectOk, queryKeys, unwrapJson } from "../../lib/api.ts";
import { openAuthWindow } from "../../lib/auth-window.ts";

const POLL_INTERVAL_MS = 1000;

type ActiveFlow = LlmOAuthFlowState & { status: "pending" | "waiting_input" };

function isActiveFlow(flow: LlmOAuthFlowState | null): flow is ActiveFlow {
  return flow !== null && (flow.status === "pending" || flow.status === "waiting_input");
}

function cancelFlowRequest(flowId: string) {
  return appClient.llm.oauth.flows[":flowId"].cancel.$post({ param: { flowId } });
}

export function useLlmOAuthFlow(provider: LlmProviderStatus) {
  const queryClient = useQueryClient();
  const [flow, setFlow] = useState<LlmOAuthFlowState | null>(null);
  const [promptInput, setPromptInput] = useState("");
  const openedUrlRef = useRef<string | null>(null);
  const handledFlowIdRef = useRef<string | null>(null);
  const activeFlowIdRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  const providerLabel = provider.oauthLabel ?? provider.provider;

  const startMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.llm.oauth[":provider"].start.$post({
          param: { provider: provider.provider },
        }),
      ),
    onSuccess: (data) => {
      if (!mountedRef.current) {
        void cancelFlowRequest(data.flow.id);

        return;
      }

      setPromptInput("");
      setFlow(data.flow);
    },
    onError: (error) => {
      toast.add({
        type: "error",
        title: `Could not start ${providerLabel} sign-in`,
        description: error.message,
      });
    },
  });

  const respondMutation = useMutation({
    mutationFn: async ({ flowId, value }: { flowId: string; value: string }) =>
      unwrapJson(
        await appClient.llm.oauth.flows[":flowId"].respond.$post({
          param: { flowId },
          json: { value },
        }),
      ),
    onSuccess: (data) => {
      setPromptInput("");
      setFlow(data.flow);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (flowId: string) => unwrapJson(await cancelFlowRequest(flowId)),
    onSuccess: () => {
      setFlow(null);
      setPromptInput("");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await expectOk(
        await appClient.llm.oauth[":provider"].$delete({
          param: { provider: provider.provider },
        }),
      );
    },
    onSuccess: () => {
      setFlow(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmModels });
      toast.add({ type: "success", title: `${providerLabel} disconnected` });
    },
    onError: (error) => {
      toast.add({
        type: "error",
        title: `Could not disconnect ${providerLabel}`,
        description: error.message,
      });
    },
  });

  const activeFlow = isActiveFlow(flow) ? flow : null;
  const activeFlowId = activeFlow?.id;
  const authUrl = activeFlow?.events.findLast((event) => event.kind === "auth_url")?.url;
  const deviceCode = activeFlow?.events.findLast((event) => event.kind === "device_code");

  useEffect(() => {
    activeFlowIdRef.current = activeFlowId;
  }, [activeFlowId]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const pendingId = activeFlowIdRef.current;

      if (pendingId !== undefined) {
        void cancelFlowRequest(pendingId);
      }
    };
  }, []);

  useEffect(() => {
    if (activeFlowId === undefined) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const result = await unwrapJson(
          await appClient.llm.oauth.flows[":flowId"].$get({ param: { flowId: activeFlowId } }),
        );

        if (!cancelled) {
          setFlow(result.flow);
        }
      } catch {
        // Keep the latest state if a single poll fails transiently.
      }
    };

    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeFlowId]);

  useEffect(() => {
    if (deviceCode === undefined && authUrl !== undefined && openedUrlRef.current !== authUrl) {
      openedUrlRef.current = authUrl;
      openAuthWindow(authUrl);
    }
  }, [authUrl, deviceCode]);

  useEffect(() => {
    if (flow === null || isActiveFlow(flow) || handledFlowIdRef.current === flow.id) {
      return;
    }

    handledFlowIdRef.current = flow.id;

    if (flow.status === "completed") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmStatus });
      void queryClient.invalidateQueries({ queryKey: queryKeys.llmModels });
      toast.add({
        type: "success",
        title: `${providerLabel} connected`,
        description: "OAuth credentials saved.",
      });
    } else if (flow.status === "failed") {
      toast.add({
        type: "error",
        title: `${providerLabel} sign-in failed`,
        description: flow.error,
      });
    }

    setFlow(null);
    setPromptInput("");
  }, [flow, providerLabel, queryClient]);

  return {
    activeFlow,
    authUrl,
    deviceCode,
    promptInput,
    setPromptInput,
    start: () => startMutation.mutate(),
    isStarting: startMutation.isPending,
    respond: (value: string) => {
      if (activeFlow !== null) {
        respondMutation.mutate({ flowId: activeFlow.id, value });
      }
    },
    isResponding: respondMutation.isPending,
    respondError: respondMutation.error,
    cancel: () => {
      if (activeFlow !== null) {
        cancelMutation.mutate(activeFlow.id);
      }
    },
    isCancelling: cancelMutation.isPending,
    logout: () => logoutMutation.mutate(),
    isLoggingOut: logoutMutation.isPending,
  };
}
