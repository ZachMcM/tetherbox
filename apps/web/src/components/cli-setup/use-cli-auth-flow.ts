import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { StarterCliStatusEntry } from "@tetherbox/core/app";
import { toast } from "@tetherbox/ui/components/toast";
import { appClient, unwrapJson } from "../../lib/api.ts";
import { openAuthWindow } from "../../lib/auth-window.ts";
import {
  upsertCliAuthFlow,
  useCliAuthFlow as useLiveCliAuthFlow,
  watchCliAuthFlow,
} from "../../lib/live/cli-store.ts";

function cancelFlowRequest(flowId: string) {
  return appClient.clis.auth.flows[":flowId"].cancel.$post({ param: { flowId } });
}

export function useCliAuthFlow(entry: StarterCliStatusEntry) {
  const queryClient = useQueryClient();
  const [flowId, setFlowId] = useState<string | null>(null);
  const flow = useLiveCliAuthFlow(flowId);
  const [responseInput, setResponseInput] = useState("");
  const [showOutput, setShowOutput] = useState(false);
  const openedUrlRef = useRef<string | null>(null);
  const handledFlowIdRef = useRef<string | null>(null);
  const activeFlowIdRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);

  const startMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.clis[":starterId"].auth.start.$post({
          param: { starterId: entry.starterId },
        }),
      ),
    onSuccess: (data) => {
      if (!mountedRef.current) {
        void cancelFlowRequest(data.flow.id);

        return;
      }

      openedUrlRef.current = null;
      setResponseInput("");
      watchCliAuthFlow(data.flow, queryClient);
      setFlowId(data.flow.id);
    },
    onError: (error) => {
      toast.add({
        type: "error",
        title: `Could not start ${entry.name} login`,
        description: error.message,
      });
    },
  });

  const respondMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) =>
      unwrapJson(
        await appClient.clis.auth.flows[":flowId"].respond.$post({
          param: { flowId: id },
          json: { value },
        }),
      ),
    onSuccess: (data) => {
      setResponseInput("");
      upsertCliAuthFlow(data.flow, queryClient);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => unwrapJson(await cancelFlowRequest(id)),
    onSuccess: () => {
      setFlowId(null);
      setResponseInput("");
    },
  });

  const activeFlow = flow?.status === "running" ? flow : null;
  const activeFlowId = activeFlow?.id;
  const deviceCode = activeFlow?.events.findLast((event) => event.kind === "device_code");
  const authUrl =
    deviceCode?.verificationUri ??
    activeFlow?.events.findLast((event) => event.kind === "auth_url")?.url;

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
    if (authUrl !== undefined && openedUrlRef.current !== authUrl) {
      openedUrlRef.current = authUrl;
      openAuthWindow(authUrl);
    }
  }, [authUrl]);

  useEffect(() => {
    if (flow === null || flow.status === "running" || handledFlowIdRef.current === flow.id) {
      return;
    }

    handledFlowIdRef.current = flow.id;

    if (flow.status === "completed") {
      toast.add({ type: "success", title: `${entry.name} signed in` });
      setFlowId(null);
    } else if (flow.status === "failed") {
      toast.add({
        type: "error",
        title: `${entry.name} sign-in failed`,
        description: flow.error,
      });
      setShowOutput(true);
    }
  }, [flow, entry.name]);

  return {
    flow,
    activeFlow,
    deviceCode,
    authUrl,
    responseInput,
    setResponseInput,
    showOutput,
    toggleOutput: () => setShowOutput((prev) => !prev),
    start: () => startMutation.mutate(),
    isStarting: startMutation.isPending,
    respond: () => {
      if (activeFlow !== null) {
        respondMutation.mutate({ id: activeFlow.id, value: responseInput });
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
  };
}
