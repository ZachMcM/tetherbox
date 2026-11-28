import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { starterConfigFieldSchemas, type StarterSummary } from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { StatusBadge } from "@tetherbox/ui/components/status-badge";
import { appClient, unwrapJson } from "../../lib/api.ts";
import { starterFieldKey } from "../../lib/starter-readiness.ts";
import { CliOutputLog } from "../cli-setup/cli-output-log.tsx";

export type StarterConnectionState = "idle" | "checking" | "connected" | "failed";

export function StarterConfigFields({
  idPrefix,
  starter,
  values,
  fieldErrors,
  canTestConnection = true,
  refreshNonce = 0,
  onConnectionStateChange,
  onChange,
}: {
  idPrefix: string;
  starter: StarterSummary;
  values: Readonly<Record<string, string>>;
  fieldErrors: Readonly<Record<string, string>>;
  canTestConnection?: boolean;
  refreshNonce?: number;
  onConnectionStateChange?: (state: StarterConnectionState) => void;
  onChange: (fieldKey: string, value: string) => void;
}) {
  const valuesSignature = JSON.stringify(values);
  const [touchedFields, setTouchedFields] = useState<ReadonlySet<string>>(() => new Set());
  const lastRefreshNonceRef = useRef(refreshNonce);

  const checkMutation = useMutation({
    mutationFn: async (input: { signature: string; config: Record<string, string> }) => ({
      signature: input.signature,
      result: await unwrapJson(
        await appClient.starters[":starterId"].check.$post({
          param: { starterId: starter.id },
          json: { config: input.config },
        }),
      ),
    }),
  });

  const allFieldsValid = starter.configFields.every(
    (field) => starterConfigFieldSchemas[field.kind].safeParse(values[field.key] ?? "").success,
  );
  const isCurrentMutation = checkMutation.variables?.signature === valuesSignature;
  const activeCheck =
    checkMutation.data?.signature === valuesSignature ? checkMutation.data.result : null;
  const checkError =
    isCurrentMutation && checkMutation.error !== null
      ? checkMutation.error.message
      : activeCheck !== null && !activeCheck.ok
        ? activeCheck.error
        : null;

  const connectionState: StarterConnectionState =
    isCurrentMutation && checkMutation.isPending
      ? "checking"
      : checkError !== null
        ? "failed"
        : activeCheck?.ok === true
          ? "connected"
          : "idle";

  useEffect(() => {
    onConnectionStateChange?.(connectionState);
  }, [connectionState, onConnectionStateChange]);

  useEffect(() => {
    if (refreshNonce === lastRefreshNonceRef.current) {
      return;
    }

    lastRefreshNonceRef.current = refreshNonce;

    if (starter.hasConnectionCheck && allFieldsValid && canTestConnection) {
      checkMutation.reset();
      checkMutation.mutate({
        signature: valuesSignature,
        config: { ...values },
      });
    }
  }, [
    refreshNonce,
    starter.hasConnectionCheck,
    allFieldsValid,
    canTestConnection,
    valuesSignature,
    values,
    checkMutation,
  ]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold">Profile settings</span>
          <Badge variant="attribute">This profile only</Badge>
        </div>
        {starter.hasConnectionCheck && (
          <div className="flex items-center gap-2">
            {onConnectionStateChange === undefined && connectionState === "connected" && (
              <StatusBadge status="success">Connected</StatusBadge>
            )}
            {onConnectionStateChange === undefined && connectionState === "failed" && (
              <StatusBadge status="error">Connection failed</StatusBadge>
            )}
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={!allFieldsValid || !canTestConnection || checkMutation.isPending}
              onClick={() => {
                checkMutation.reset();
                checkMutation.mutate({
                  signature: valuesSignature,
                  config: { ...values },
                });
              }}
            >
              {checkMutation.isPending && <Spinner className="size-3" />}
              <span>{checkMutation.isPending ? "Testing…" : "Test connection"}</span>
            </Button>
          </div>
        )}
      </div>
      {starter.configFields.map((field) => {
        const key = starterFieldKey(starter.id, field.key);
        const inputId = `${idPrefix}-cfg-${starter.id}-${field.key}`;
        const rawValue = values[field.key] ?? "";
        const liveValidation = touchedFields.has(field.key)
          ? starterConfigFieldSchemas[field.kind].safeParse(rawValue)
          : null;
        const error =
          fieldErrors[key] ??
          (liveValidation !== null && !liveValidation.success
            ? (liveValidation.error.issues[0]?.message ?? "Invalid value")
            : undefined);

        return (
          <Field key={key}>
            <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
              {field.prompt}
            </FieldLabel>
            <Input
              id={inputId}
              value={rawValue}
              placeholder={field.placeholder}
              onChange={(event) => {
                setTouchedFields((prev) =>
                  prev.has(field.key) ? prev : new Set(prev).add(field.key),
                );
                onChange(field.key, event.target.value);
              }}
              aria-invalid={error !== undefined || connectionState === "failed"}
            />
            {error !== undefined && <FieldError>{error}</FieldError>}
          </Field>
        );
      })}
      {checkError !== null &&
        (checkError.includes("\n") ? (
          <CliOutputLog output={checkError} variant="error" />
        ) : (
          <FieldError>{checkError}</FieldError>
        ))}
    </div>
  );
}
