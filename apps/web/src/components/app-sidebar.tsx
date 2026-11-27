import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import type { ProfileSummary, SessionRecord } from "@tetherbox/core/app";
import {
  ActivityIcon,
  BellIcon,
  ClockIcon,
  FolderIcon,
  FolderPlusIcon,
  ListFilterIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import { Button } from "@tetherbox/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@tetherbox/ui/components/collapsible";
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
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { appClient, expectOk, queryKeys } from "../lib/api.ts";
import { profilesQueryOptions, sessionsQueryOptions } from "../lib/queries.ts";
import { CreateProfileDialog } from "./create-profile-dialog.tsx";
import type { SettingsTab } from "./settings/types.ts";

function TriggerIcon({ kind }: { kind: SessionRecord["triggerKind"] }) {
  switch (kind) {
    case "cron":
      return <ClockIcon className="size-3.5 text-muted-foreground" />;
    case "webhook":
      return <WebhookIcon className="size-3.5 text-muted-foreground" />;
    case "poll":
      return <ActivityIcon className="size-3.5 text-muted-foreground" />;
    case "reminder":
      return <BellIcon className="size-3.5 text-muted-foreground" />;
    case "user":
      return <MessageSquareIcon className="size-3.5 text-muted-foreground" />;
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

function ProfileGroup({
  profile,
  sessions,
  activePath,
  onStartConversation,
  onDeleteSession,
  onOpenSettings,
}: {
  profile: ProfileSummary;
  sessions: readonly SessionRecord[];
  activePath: string;
  onStartConversation: (profileId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenSettings: (profileId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <div className="flex items-center justify-between gap-1 px-1">
        <CollapsibleTrigger className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-sidebar-foreground/80 ring-sidebar-ring outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0">
          <FolderIcon className="text-muted-foreground" />
          <span className="truncate">{profile.config.name}</span>
        </CollapsibleTrigger>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onOpenSettings(profile.id)}
            title={`${profile.config.name} settings`}
            aria-label={`${profile.config.name} settings`}
          >
            <MoreVerticalIcon className="size-3.5 text-muted-foreground" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onStartConversation(profile.id)}
            title={`New conversation in ${profile.config.name}`}
            aria-label={`New conversation in ${profile.config.name}`}
          >
            <PlusIcon className="size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
      <CollapsibleContent className="pl-3">
        <SidebarMenu className="mt-0.5">
          {sessions.length === 0 ? (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">No conversations yet</div>
          ) : (
            sessions.map((session) => {
              const isActive = activePath === `/sessions/${session.id}`;

              return (
                <SidebarMenuItem key={session.id}>
                  <SidebarMenuButton
                    isActive={isActive}
                    render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}
                  >
                    {session.status === "running" ? (
                      <Spinner className="size-3.5 shrink-0" />
                    ) : (
                      <TriggerIcon kind={session.triggerKind} />
                    )}
                    <span className="flex-1 truncate">{session.title}</span>
                    {session.unreadAlert && (
                      <span className="size-2 shrink-0 rounded-full bg-primary" />
                    )}
                    {session.status === "error" && (
                      <span className="size-2 shrink-0 rounded-full bg-destructive" />
                    )}
                  </SidebarMenuButton>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<SidebarMenuAction showOnHover aria-label="Session actions" />}
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        variant="destructive-outline"
                        onClick={() => onDeleteSession(session.id)}
                      >
                        <Trash2Icon className="size-3.5" />
                        <span>Delete conversation</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </SidebarMenuItem>
              );
            })
          )}
        </SidebarMenu>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AppSidebar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [createOpen, setCreateOpen] = useState(false);

  const profilesQuery = useQuery(profilesQueryOptions);
  const sessionsQuery = useQuery(sessionsQueryOptions);

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
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, settings: tab }),
    });
  };

  const profiles = profilesQuery.data?.profiles ?? [];
  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <>
      <Sidebar>
        <SidebarHeader className="h-16 justify-center px-3">
          <Button
            variant="default"
            className="w-full justify-start gap-2"
            onClick={() => void navigate({ to: "/" })}
            disabled={profiles.length === 0}
            title={profiles.length === 0 ? "Create a profile first" : undefined}
          >
            <PlusIcon className="size-4" />
            <span>New conversation</span>
          </Button>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <div className="mb-1 flex items-center justify-between px-2">
              <span className="text-xs font-medium text-sidebar-foreground/60">Profiles</span>
              <div className="flex items-center gap-0.5">
                {/* TODO: Wire sidebar profile filter and sort controls */}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled
                  title="Filter and sort profiles"
                  aria-label="Filter and sort profiles"
                >
                  <ListFilterIcon className="size-4 text-muted-foreground" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setCreateOpen(true)}
                  title="New profile"
                  aria-label="New profile"
                >
                  <FolderPlusIcon className="size-4 text-muted-foreground" />
                </Button>
              </div>
            </div>
            <SidebarGroupContent className="space-y-1">
              {profiles.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">No profiles yet</div>
              ) : (
                profiles.map((profile) => (
                  <ProfileGroup
                    key={profile.id}
                    profile={profile}
                    sessions={sessions.filter((session) => session.profileId === profile.id)}
                    activePath={pathname}
                    onStartConversation={(profileId) =>
                      void navigate({
                        to: "/",
                        search: (prev) => ({ ...prev, profile: profileId }),
                      })
                    }
                    onDeleteSession={(sessionId) => deleteSessionMutation.mutate(sessionId)}
                    onOpenSettings={(profileId) => openSettings(`profile:${profileId}`)}
                  />
                ))
              )}
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => openSettings("general")}>
                <SettingsIcon className="size-4" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <CreateProfileDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(profileId) => {
          void navigate({ to: "/", search: (prev) => ({ ...prev, profile: profileId }) });
        }}
      />
    </>
  );
}
