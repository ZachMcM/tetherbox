import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ProfileSummary, SessionRecord } from "@tetherbox/core/app";
import {
  ActivityIcon,
  BellIcon,
  ClockIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  CogIcon,
  Trash2Icon,
  WebhookIcon,
  XIcon,
} from "lucide-react";
import { Buddy } from "@tetherbox/ui/components/buddy";
import { Button } from "@tetherbox/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@tetherbox/ui/components/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, expectOk, queryKeys } from "../lib/api.ts";
import { EMPTY_SESSION_FILTER, usePreferences, type SessionFilter } from "../lib/preferences.ts";
import { profilesQueryOptions, sessionsQueryOptions } from "../lib/queries.ts";
import { groupSessionsByDay, matchesSessionFilter } from "../lib/session-list.ts";
import { CommandPalette } from "./command-palette.tsx";
import { CreateProfileDialog } from "./create-profile-dialog.tsx";
import {
  SessionFilterPopover,
  STATUS_FILTER_LABELS,
  UPDATED_WITHIN_LABELS,
} from "./session-filter-popover.tsx";
import type { SettingsTab } from "./settings/types.ts";

function SessionStatusMark({ session }: { session: SessionRecord }) {
  if (session.status === "running") {
    return <Spinner className="size-3.5 shrink-0 text-muted-foreground" />;
  }

  if (session.status === "error") {
    return <span className="size-2 shrink-0 rounded-full bg-destructive" title="Last run failed" />;
  }

  if (session.unreadAlert) {
    return <span className="size-2 shrink-0 rounded-full bg-primary" title="Unread" />;
  }

  const iconClass = "size-3.5 shrink-0 text-muted-foreground";

  switch (session.triggerKind) {
    case "cron":
      return <ClockIcon className={iconClass} />;
    case "webhook":
      return <WebhookIcon className={iconClass} />;
    case "poll":
      return <ActivityIcon className={iconClass} />;
    case "reminder":
      return <BellIcon className={iconClass} />;
    case "user":
      return null;
    default: {
      const exhaustive: never = session.triggerKind;

      return exhaustive;
    }
  }
}

function SessionRow({
  session,
  profile,
  isActive,
  onDelete,
}: {
  session: SessionRecord;
  profile: ProfileSummary | undefined;
  isActive: boolean;
  onDelete: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="lg"
        isActive={isActive}
        className="gap-2.5"
        render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}
      >
        {profile !== undefined && <Buddy {...profile.buddy} size={28} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{session.title}</span>
          {profile !== undefined && (
            <span className="truncate text-xs font-normal text-muted-foreground">
              {profile.name}
            </span>
          )}
        </span>
        <SessionStatusMark session={session} />
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              showOnHover
              aria-label="Session actions"
              className="top-1/2! -translate-y-1/2"
            />
          }
        >
          <MoreHorizontalIcon className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive-outline" onClick={onDelete}>
            <Trash2Icon className="size-3.5" />
            <span>Delete conversation</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function ActiveFilterChips({
  filter,
  profiles,
  onChange,
}: {
  filter: SessionFilter;
  profiles: readonly ProfileSummary[];
  onChange: (next: SessionFilter) => void;
}) {
  const chips = [
    ...filter.profileIds.flatMap((id) => {
      const profile = profiles.find((entry) => entry.id === id);

      return profile === undefined
        ? []
        : [
            {
              key: `profile-${id}`,
              label: profile.name,
              buddy: profile.buddy,
              remove: () =>
                onChange({
                  ...filter,
                  profileIds: filter.profileIds.filter((entry) => entry !== id),
                }),
            },
          ];
    }),
    ...(filter.updatedWithin === "any"
      ? []
      : [
          {
            key: "updated",
            label: UPDATED_WITHIN_LABELS[filter.updatedWithin],
            buddy: undefined,
            remove: () => onChange({ ...filter, updatedWithin: "any" }),
          },
        ]),
    ...filter.statuses.map((status) => ({
      key: `status-${status}`,
      label: STATUS_FILTER_LABELS[status],
      buddy: undefined,
      remove: () =>
        onChange({ ...filter, statuses: filter.statuses.filter((entry) => entry !== status) }),
    })),
  ];

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {chips.map((chip) => (
        <Button
          key={chip.key}
          variant="secondary"
          size="xs"
          className="rounded-full pr-1"
          onClick={chip.remove}
          aria-label={`Remove ${chip.label} filter`}
        >
          {chip.buddy !== undefined && <Buddy {...chip.buddy} size={16} animated={false} />}
          <span>{chip.label}</span>
          <XIcon className="text-muted-foreground" />
        </Button>
      ))}
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground"
        onClick={() => onChange(EMPTY_SESSION_FILTER)}
      >
        Clear
      </Button>
    </div>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { preferences, updatePreferences } = usePreferences();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const profilesQuery = useQuery(profilesQueryOptions);
  const sessionsQuery = useQuery(sessionsQueryOptions);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      await expectOk(await appClient.sessions[":sessionId"].$delete({ param: { sessionId } }));

      return sessionId;
    },
    onSuccess: (deletedId) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });

      if (pathname === `/sessions/${deletedId}`) {
        void navigate({ to: "/" });
      }
    },
  });

  const openSettings = (tab: SettingsTab) => {
    void navigate({ to: ".", search: (prev) => ({ ...prev, settings: tab }) });
  };

  const profiles = profilesQuery.data?.profiles ?? [];
  const sessions = sessionsQuery.data?.sessions ?? [];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const storedFilter = preferences.sessionFilter;
  const filter = profilesQuery.isSuccess
    ? {
        ...storedFilter,
        profileIds: storedFilter.profileIds.filter((id) =>
          profiles.some((profile) => profile.id === id),
        ),
      }
    : storedFilter;
  const setFilter = (sessionFilter: SessionFilter) => updatePreferences({ sessionFilter });
  const now = new Date();
  const visibleSessions = sessions.filter((session) => matchesSessionFilter(session, filter, now));
  const dayGroups = groupSessionsByDay(visibleSessions, now);

  return (
    <>
      <Sidebar>
        <SidebarHeader className="gap-2 px-3 pt-3">
          <div className="flex h-8 items-center justify-between pl-1.5">
            <span className="font-heading text-base font-semibold tracking-tight">Tetherbox</span>
            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Search"
                className="text-sidebar-foreground/75"
                onClick={() => setPaletteOpen(true)}
              >
                <SearchIcon />
              </Button>
              <SessionFilterPopover
                profiles={profiles}
                sessions={sessions}
                filter={filter}
                visibleCount={visibleSessions.length}
                onChange={setFilter}
              />
            </div>
          </div>
          <Button
            className="w-full justify-start"
            onClick={() => void navigate({ to: "/" })}
            disabled={profiles.length === 0}
          >
            <PlusIcon data-icon="inline-start" />
            <span>New conversation</span>
          </Button>
          <ActiveFilterChips filter={filter} profiles={profiles} onChange={setFilter} />
        </SidebarHeader>

        <SidebarContent>
          {sessions.length > 0 && dayGroups.length === 0 && (
            <div className="px-4 py-2 text-xs text-muted-foreground">
              No conversations match these filters.
            </div>
          )}
          {dayGroups.map((group) => (
            <SidebarGroup key={group.label} className="py-1">
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.sessions.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      profile={profileById.get(session.profileId)}
                      isActive={pathname === `/sessions/${session.id}`}
                      onDelete={() => deleteSessionMutation.mutate(session.id)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => openSettings("general")}>
                <CogIcon className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        profiles={profiles}
        sessions={sessions}
        onNewProfile={() => setCreateOpen(true)}
      />
      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(profileId) => void navigate({ to: "/", search: { profile: profileId } })}
      />
    </>
  );
}
