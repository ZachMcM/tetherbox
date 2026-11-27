import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { EyeIcon, LayersIcon, LogOutIcon, Minimize2Icon, RotateCcwIcon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { Tabs, TabsList, TabsTrigger } from "@tetherbox/ui/components/tabs";
import { FieldError } from "@tetherbox/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@tetherbox/ui/components/toggle-group";
import { appClient, queryKeys, unwrapJson } from "../../lib/api.ts";
import {
  usePreferences,
  type SendShortcut,
  type TranscriptVerbosity,
} from "../../lib/preferences.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

const VERBOSITY_OPTIONS = [
  {
    value: "compact",
    label: "Compact",
    description: "Hide thinking blocks and keep tool traces collapsed.",
    Icon: Minimize2Icon,
  },
  {
    value: "standard",
    label: "Standard",
    description: "Show thinking and tool traces collapsed by default.",
    Icon: LayersIcon,
  },
  {
    value: "verbose",
    label: "Verbose",
    description: "Expand thinking and tool output automatically.",
    Icon: EyeIcon,
  },
] as const satisfies readonly {
  value: TranscriptVerbosity;
  label: string;
  description: string;
  Icon: typeof EyeIcon;
}[];

const SHORTCUT_OPTIONS = [
  { value: "enter", label: "Enter" },
  { value: "mod-enter", label: "Cmd+Enter" },
] as const satisfies readonly { value: SendShortcut; label: string }[];

export function GeneralSection({
  onLogout,
  loggingOut,
}: {
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { preferences, updatePreferences } = usePreferences();

  const rerunOnboardingMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(await appClient.settings.$patch({ json: { onboardingCompleted: false } })),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.settings, data);
      void navigate({ to: "/onboarding" });
    },
  });
  const activeVerbosity =
    VERBOSITY_OPTIONS.find((option) => option.value === preferences.verbosity) ??
    VERBOSITY_OPTIONS[1];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="General"
        description="Configure transcript verbosity, composer shortcuts, guided setup, and browser session."
      />

      <section className="space-y-2.5">
        <h3 className="text-sm font-medium">Transcript verbosity</h3>
        <ToggleGroup
          variant="outline"
          spacing={2}
          value={[preferences.verbosity]}
          onValueChange={(values) => {
            const next = VERBOSITY_OPTIONS.find((option) => option.value === values[0]);

            if (next !== undefined) {
              updatePreferences({ verbosity: next.value });
            }
          }}
        >
          {VERBOSITY_OPTIONS.map(({ value, label, Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={label}
              className="h-18 min-w-22 flex-col gap-1.5 rounded-xl px-3"
            >
              <Icon className="size-5" />
              <span className="text-xs font-normal text-muted-foreground">{label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{activeVerbosity.description}</p>
      </section>

      <SettingGroup title="Input box">
        <SettingRow
          title="Send message"
          description="Choose which key sends a message in the chat composer."
          control={
            <Tabs
              value={preferences.sendShortcut}
              onValueChange={(value) => {
                const next = SHORTCUT_OPTIONS.find((option) => option.value === value);

                if (next !== undefined) {
                  updatePreferences({ sendShortcut: next.value });
                }
              }}
            >
              <TabsList>
                {SHORTCUT_OPTIONS.map((option) => (
                  <TabsTrigger key={option.value} value={option.value} className="px-2.5 text-xs">
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          }
        />
      </SettingGroup>

      <SettingGroup title="Setup">
        <SettingRow
          title="Guided setup"
          description="Walk through connecting providers, picking a default model, and creating a profile."
          control={
            <Button
              variant="outline"
              size="sm"
              onClick={() => rerunOnboardingMutation.mutate()}
              disabled={rerunOnboardingMutation.isPending}
            >
              <RotateCcwIcon className="size-3.5" />
              <span>Run setup again</span>
            </Button>
          }
        />
      </SettingGroup>
      {rerunOnboardingMutation.error !== null && (
        <FieldError>{rerunOnboardingMutation.error.message}</FieldError>
      )}

      <SettingGroup title="Session">
        <SettingRow
          title="Browser authentication"
          description="Clear this browser's daemon auth cookie."
          control={
            <Button
              variant="destructive-outline"
              size="sm"
              onClick={onLogout}
              disabled={loggingOut}
            >
              <LogOutIcon className="size-3.5" />
              <span>Sign out</span>
            </Button>
          }
        />
      </SettingGroup>
    </div>
  );
}
