import { useEffect, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  requestAuthArgsSchema,
  type AuthRequest,
  type RequestAuthArgs,
  type SecretBinding,
  type SecretInjection,
} from "@tetherbox/core/app";
import { CheckCircle2Icon, KeyRoundIcon } from "lucide-react";
import { Badge } from "@tetherbox/ui/components/badge";
import { Spinner } from "@tetherbox/ui/components/spinner";
import {
  cliStatusQueryOptions,
  oauthStatusQueryOptions,
  secretsQueryOptions,
} from "../lib/queries.ts";
import { OAuthPresetInlineCard } from "./auth-setup/inline-cards.tsx";
import { SecretValueForm } from "./auth-setup/secret-value-form.tsx";
import { describeSecretBinding, findPresetLogin } from "../lib/auth-status.ts";
import { CliAuthFlowPanel } from "./cli-setup/cli-auth-flow-panel.tsx";
import { useCliInstallRunner } from "./cli-setup/use-cli-install-runner.ts";

type ValueRequest = Extract<AuthRequest, { kind: "value" }>;
type OAuthRequest = Extract<AuthRequest, { kind: "oauth" }>;
type CliLoginRequest = Extract<AuthRequest, { kind: "cli-login" }>;
export type AuthCompletionHandler = (message: string) => void;

function injectionMatches(stored: SecretInjection, wanted: SecretInjection): boolean {
  switch (wanted.kind) {
    case "bearer":
      return stored.kind === "bearer";
    case "header":
      return stored.kind === "header" && stored.name.toLowerCase() === wanted.name.toLowerCase();
    case "query":
      return stored.kind === "query" && stored.name === wanted.name;
    default: {
      const exhaustive: never = wanted;

      return exhaustive;
    }
  }
}

function bindingMatches(stored: SecretBinding, wanted: ValueRequest["binding"]): boolean {
  if (wanted.kind === "daemon" || stored.kind !== "proxy") {
    return stored.kind === wanted.kind;
  }

  return (
    wanted.domains.every((domain) => stored.domains.includes(domain)) &&
    injectionMatches(stored.inject, wanted.inject)
  );
}

function bindingToSave(
  stored: SecretBinding | undefined,
  wanted: ValueRequest["binding"],
): ValueRequest["binding"] {
  if (
    wanted.kind !== "proxy" ||
    stored?.kind !== "proxy" ||
    !injectionMatches(stored.inject, wanted.inject)
  ) {
    return wanted;
  }

  const kept = stored.domains.filter((domain) => !wanted.domains.includes(domain));

  return { ...wanted, domains: [...wanted.domains, ...kept] };
}

export function parseRequestAuthArgs(args: unknown): RequestAuthArgs | undefined {
  const parsed = requestAuthArgsSchema.safeParse(args);

  return parsed.success ? parsed.data : undefined;
}

function useNotifyWhenCompleted(
  done: boolean | undefined,
  message: string,
  onComplete: AuthCompletionHandler,
): void {
  const startedIncomplete = useRef<boolean | undefined>(undefined);
  const notified = useRef(false);

  useEffect(() => {
    if (done === undefined) {
      return;
    }

    if (startedIncomplete.current === undefined) {
      startedIncomplete.current = !done;

      return;
    }

    if (done && startedIncomplete.current && !notified.current) {
      notified.current = true;
      onComplete(message);
    }
  }, [done, message, onComplete]);
}

function StatusBadge({ done }: { done: boolean | undefined }) {
  if (done === undefined) {
    return <Spinner className="size-3.5 text-muted-foreground" />;
  }

  return done ? (
    <Badge variant="secondary" className="gap-1">
      <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
      <span>Done</span>
    </Badge>
  ) : (
    <Badge variant="outline">Needs setup</Badge>
  );
}

function CardShell({
  title,
  reason,
  done,
  children,
}: {
  title: ReactNode;
  reason: string;
  done: boolean | undefined;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-semibold">{title}</div>
            <p className="mt-0.5 text-xs text-muted-foreground">{reason}</p>
          </div>
        </div>
        <StatusBadge done={done} />
      </div>
      {done === false && children}
    </div>
  );
}

function SecretValueCard({
  request,
  reason,
  onComplete,
}: {
  request: ValueRequest;
  reason: string;
  onComplete: AuthCompletionHandler;
}) {
  const secretsQuery = useQuery(secretsQueryOptions);
  const stored = secretsQuery.data?.secrets.find((entry) => entry.key === request.key);
  const done =
    secretsQuery.data === undefined
      ? undefined
      : stored !== undefined && bindingMatches(stored.binding, request.binding);

  const binding = bindingToSave(stored?.binding, request.binding);

  useNotifyWhenCompleted(done, `Saved ${request.key}.`, onComplete);

  return (
    <CardShell
      title={<span className="font-mono text-xs">{request.key}</span>}
      reason={reason}
      done={done}
    >
      <SecretValueForm secretKey={request.key} binding={binding}>
        <p className="text-xs text-muted-foreground">{describeSecretBinding(binding)}</p>
      </SecretValueForm>
    </CardShell>
  );
}

function OAuthCard({
  request,
  reason,
  onComplete,
}: {
  request: OAuthRequest;
  reason: string;
  onComplete: AuthCompletionHandler;
}) {
  const oauthQuery = useQuery({ ...oauthStatusQueryOptions, refetchOnWindowFocus: "always" });
  const preset = oauthQuery.data?.presets.find((entry) => entry.id === request.preset);
  const login =
    oauthQuery.data !== undefined
      ? findPresetLogin(oauthQuery.data.logins, request.preset)
      : undefined;
  const done = oauthQuery.data === undefined ? undefined : login !== undefined;
  const label = preset?.label ?? request.preset;

  useNotifyWhenCompleted(done, `Connected ${label}.`, onComplete);

  return (
    <CardShell title={`Connect ${label}`} reason={reason} done={done}>
      {preset !== undefined ? (
        <OAuthPresetInlineCard preset={preset} activeLogin={login} showStatusBadge={false} />
      ) : (
        <p className="text-xs text-muted-foreground">Unknown OAuth preset {request.preset}.</p>
      )}
    </CardShell>
  );
}

function CliLoginCard({
  request,
  reason,
  onComplete,
}: {
  request: CliLoginRequest;
  reason: string;
  onComplete: AuthCompletionHandler;
}) {
  const cliQuery = useQuery({ ...cliStatusQueryOptions, refetchOnWindowFocus: "always" });
  const installRunner = useCliInstallRunner();
  const entry = cliQuery.data?.clis.find((cli) => cli.starterId === request.starter);
  const done =
    cliQuery.data === undefined
      ? undefined
      : entry?.status.kind === "installed" &&
        (entry.status.auth === "authenticated" || entry.status.auth === "none");
  const label = entry?.name ?? request.starter;

  useNotifyWhenCompleted(done, `Signed in to ${label}.`, onComplete);

  return (
    <CardShell title={`Sign in to ${label}`} reason={reason} done={done}>
      {entry !== undefined ? (
        <CliAuthFlowPanel entry={entry} installRunner={installRunner} showStatusBadge={false} />
      ) : (
        <p className="text-xs text-muted-foreground">
          No starter named {request.starter} has a CLI.
        </p>
      )}
    </CardShell>
  );
}

export function AuthRequestCard({
  args,
  onComplete,
}: {
  args: RequestAuthArgs;
  onComplete: AuthCompletionHandler;
}) {
  const { request, reason } = args;

  switch (request.kind) {
    case "value":
      return <SecretValueCard request={request} reason={reason} onComplete={onComplete} />;
    case "oauth":
      return <OAuthCard request={request} reason={reason} onComplete={onComplete} />;
    case "cli-login":
      return <CliLoginCard request={request} reason={reason} onComplete={onComplete} />;
    default: {
      const exhaustive: never = request;

      return exhaustive;
    }
  }
}
