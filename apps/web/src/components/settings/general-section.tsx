import { EyeIcon, LayersIcon, LogOutIcon, Minimize2Icon } from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import { ToggleGroup, ToggleGroupItem } from "@tetherbox/ui/components/toggle-group";
import {
  usePreferences,
  type SendShortcut,
  type TranscriptVerbosity,
} from "../../lib/preferences.ts";
import { SectionHeader, SettingGroup, SettingRow } from "./shared.tsx";

const VERBOSITY_CARDS = [
  {
    value: "compact",
    title: "Compact",
    description: "Hide thinking blocks and keep tool traces collapsed.",
    Icon: Minimize2Icon,
  },
  {
    value: "standard",
    title: "Standard",
    description: "Show thinking and tool traces collapsed by default.",
    Icon: LayersIcon,
  },
  {
    value: "verbose",
    title: "Verbose",
    description: "Expand thinking and tool output automatically.",
    Icon: EyeIcon,
  },
] as const satisfies readonly {
  value: TranscriptVerbosity;
  title: string;
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
  const { preferences, updatePreferences } = usePreferences();

  return (
    <div className="space-y-6">
      <SectionHeader
        title="General"
        description="Configure transcript verbosity, composer shortcuts, and browser session."
      />

      <section className="space-y-2.5">
        <h3 className="text-sm font-medium">Transcript verbosity</h3>
        <ToggleGroup
          variant="outline"
          spacing={3}
          value={[preferences.verbosity]}
          onValueChange={(values) => {
            const next = VERBOSITY_CARDS.find((card) => card.value === values[0]);

            if (next !== undefined) {
              updatePreferences({ verbosity: next.value });
            }
          }}
          className="grid w-full grid-cols-1 sm:grid-cols-3"
        >
          {VERBOSITY_CARDS.map(({ value, title, description, Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-auto flex-col items-start justify-start rounded-xl bg-card/40 p-4 text-left whitespace-normal hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-primary/8"
            >
              <Icon className="mb-3 size-4 text-muted-foreground" />
              <div className="text-sm font-medium">{title}</div>
              <p className="mt-1 text-xs leading-relaxed font-normal text-muted-foreground">
                {description}
              </p>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>

      <SettingGroup title="Input box">
        <SettingRow
          title="Send message"
          description="Choose which key sends a message in the chat composer."
          control={
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[preferences.sendShortcut]}
              onValueChange={(values) => {
                const next = SHORTCUT_OPTIONS.find((option) => option.value === values[0]);

                if (next !== undefined) {
                  updatePreferences({ sendShortcut: next.value });
                }
              }}
            >
              {SHORTCUT_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value} className="px-3 text-xs">
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }
        />
      </SettingGroup>

      <SettingGroup title="Session">
        <SettingRow
          title="Browser authentication"
          description="Clear this browser's daemon auth cookie."
          control={
            <Button variant="outline" size="sm" onClick={onLogout} disabled={loggingOut}>
              <LogOutIcon className="size-3.5" />
              <span>Sign out</span>
            </Button>
          }
        />
      </SettingGroup>
    </div>
  );
}
