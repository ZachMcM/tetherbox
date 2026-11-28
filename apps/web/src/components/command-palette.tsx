import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ProfileSummary, SessionRecord } from "@tetherbox/core/app";
import { CogIcon, MessageSquarePlusIcon, PlusIcon, SunMoonIcon } from "lucide-react";
import { Buddy } from "@tetherbox/ui/components/buddy";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@tetherbox/ui/components/command";
import { SETTINGS_NAV, type SettingsTab } from "./settings/types.ts";
import { useTheme } from "./theme-provider.tsx";

const RECENT_LIMIT = 5;

export function CommandPalette({
  open,
  onOpenChange,
  profiles,
  sessions,
  onNewProfile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profiles: readonly ProfileSummary[];
  sessions: readonly SessionRecord[];
  onNewProfile: () => void;
}) {
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState("");
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const listedSessions = (
    query === ""
      ? sessions.toSorted((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      : sessions
  ).slice(0, query === "" ? RECENT_LIMIT : undefined);

  const run = (action: () => void) => {
    onOpenChange(false);
    setQuery("");
    action();
  };

  const openSettings = (tab: SettingsTab) =>
    void navigate({ to: ".", search: (prev) => ({ ...prev, settings: tab }) });

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);

        if (!next) {
          setQuery("");
        }
      }}
      title="Search"
      description="Search conversations, profiles, and settings"
      className="sm:max-w-xl"
    >
      <Command>
        <CommandInput
          placeholder="Search conversations, profiles, settings"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>

          {listedSessions.length > 0 && (
            <CommandGroup heading={query === "" ? "Recent conversations" : "Conversations"}>
              {listedSessions.map((session) => {
                const profile = profileById.get(session.profileId);

                return (
                  <CommandItem
                    key={session.id}
                    value={`session ${session.id} ${session.title} ${profile?.name ?? ""}`}
                    onSelect={() =>
                      run(
                        () =>
                          void navigate({
                            to: "/sessions/$sessionId",
                            params: { sessionId: session.id },
                          }),
                      )
                    }
                  >
                    {profile !== undefined && <Buddy {...profile.buddy} size={20} />}
                    <span className="truncate">{session.title}</span>
                    {profile !== undefined && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {profile.name}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}

          <CommandGroup heading="Profiles">
            {profiles.flatMap((profile) => [
              <CommandItem
                key={`${profile.id}-new`}
                value={`new conversation in ${profile.name} ${profile.id}`}
                onSelect={() =>
                  run(() => void navigate({ to: "/", search: { profile: profile.id } }))
                }
              >
                <Buddy {...profile.buddy} size={20} />
                <span>New conversation in {profile.name}</span>
              </CommandItem>,
              <CommandItem
                key={`${profile.id}-settings`}
                value={`${profile.name} ${profile.id} profile settings`}
                onSelect={() => run(() => openSettings(`profile:${profile.id}`))}
              >
                <Buddy {...profile.buddy} size={20} />
                <span>{profile.name} settings</span>
              </CommandItem>,
            ])}
          </CommandGroup>

          <CommandGroup heading="Actions">
            <CommandItem
              value="new conversation"
              onSelect={() => run(() => void navigate({ to: "/" }))}
            >
              <MessageSquarePlusIcon />
              <span>New conversation</span>
            </CommandItem>
            <CommandItem value="new profile create" onSelect={() => run(onNewProfile)}>
              <PlusIcon />
              <span>New profile</span>
            </CommandItem>
            {SETTINGS_NAV.map((item) => (
              <CommandItem
                key={item.tab}
                value={`settings ${item.label}`}
                onSelect={() => run(() => openSettings(item.tab))}
              >
                <CogIcon />
                <span>Settings: {item.label}</span>
              </CommandItem>
            ))}
            <CommandItem
              value="toggle theme dark light"
              onSelect={() => run(() => setTheme(theme === "dark" ? "light" : "dark"))}
            >
              <SunMoonIcon />
              <span>Toggle theme</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
