import type { FormEvent } from "react";
import type { LlmProviderStatus } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { AuthorizationPendingAlert } from "./authorization-pending-alert.tsx";
import { DeviceCodePrompt } from "./device-code-prompt.tsx";
import { ExternalLink } from "./external-link.tsx";
import { useLlmOAuthFlow } from "./use-llm-oauth-flow.ts";

export function LlmOAuthFlowPanel({ provider }: { provider: LlmProviderStatus }) {
  const oauth = useLlmOAuthFlow(provider);
  const { activeFlow, authUrl, deviceCode, promptInput } = oauth;

  const connectionStatus =
    provider.oauthExpires !== undefined
      ? `Connected · expires ${provider.oauthExpires}`
      : "Not connected";
  const connectLabel = provider.oauthExpires !== undefined ? "Reconnect" : "Connect";

  const handlePromptSubmit = (event: FormEvent) => {
    event.preventDefault();

    if (promptInput.trim() !== "") {
      oauth.respond(promptInput.trim());
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            OAuth{provider.oauthLabel !== undefined ? ` (${provider.oauthLabel})` : ""}
          </h3>
          <div className="text-xs text-muted-foreground">
            {activeFlow !== null ? "Waiting for sign-in…" : connectionStatus}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeFlow !== null ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={oauth.isCancelling}
              onClick={oauth.cancel}
            >
              Cancel
            </Button>
          ) : (
            <>
              {provider.oauthExpires !== undefined && (
                <Button
                  type="button"
                  variant="destructive-outline"
                  size="xs"
                  disabled={oauth.isLoggingOut}
                  onClick={oauth.logout}
                >
                  Disconnect
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="xs"
                disabled={oauth.isStarting}
                onClick={oauth.start}
              >
                {oauth.isStarting ? "Starting…" : connectLabel}
              </Button>
            </>
          )}
        </div>
      </div>

      {activeFlow !== null && (
        <div className="space-y-3">
          {deviceCode !== undefined ? (
            <DeviceCodePrompt
              key={activeFlow.id}
              userCode={deviceCode.userCode}
              verificationUri={deviceCode.verificationUri}
              message="Open the verification page and enter this code to finish signing in:"
            />
          ) : activeFlow.status === "waiting_input" && activeFlow.prompt.kind === "text" ? (
            <div className="space-y-2.5">
              {authUrl !== undefined && (
                <ExternalLink href={authUrl}>Open sign-in page</ExternalLink>
              )}
              <form onSubmit={handlePromptSubmit}>
                <Field>
                  <FieldLabel
                    htmlFor={`oauth-prompt-${provider.provider}`}
                    className="text-xs font-normal text-muted-foreground"
                  >
                    {activeFlow.prompt.message}
                  </FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`oauth-prompt-${provider.provider}`}
                      placeholder={activeFlow.prompt.placeholder}
                      value={promptInput}
                      onChange={(event) => oauth.setPromptInput(event.target.value)}
                      required
                    />
                    <Button
                      type="submit"
                      disabled={oauth.isResponding || promptInput.trim() === ""}
                    >
                      Submit
                    </Button>
                  </div>
                </Field>
              </form>
            </div>
          ) : activeFlow.status === "waiting_input" && activeFlow.prompt.kind === "select" ? (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">{activeFlow.prompt.message}</div>
              <div className="space-y-1.5">
                {activeFlow.prompt.options.map((option) => (
                  <Button
                    key={option.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto w-full flex-col items-start py-2 text-left"
                    disabled={oauth.isResponding}
                    onClick={() => oauth.respond(option.id)}
                  >
                    <span>{option.label}</span>
                    {option.description !== undefined && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <AuthorizationPendingAlert
              url={authUrl}
              message={authUrl !== undefined ? "Waiting for browser sign-in…" : "Starting sign-in…"}
            />
          )}

          {oauth.respondError !== null && <FieldError>{oauth.respondError.message}</FieldError>}
        </div>
      )}
    </div>
  );
}
