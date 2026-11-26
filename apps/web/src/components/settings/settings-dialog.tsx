import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderIcon, LogOutIcon } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@tetherbox/ui/components/dialog";
import { cn } from "@tetherbox/ui/lib/utils";
import { logout, queryKeys } from "../../lib/api.ts";
import { profilesQueryOptions } from "../../lib/queries.ts";
import { AppearanceSection } from "./appearance-section.tsx";
import { GeneralSection } from "./general-section.tsx";
import { IntegrationsSection } from "./integrations-section.tsx";
import { ProfileSettingsSection } from "./profile-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";
import { SecretsSection } from "./secrets-section.tsx";
import { SETTINGS_NAV, type SettingsTab } from "./types.ts";

export function SettingsDialog({ activeTab }: { activeTab: SettingsTab | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = activeTab !== undefined;

  const profilesQuery = useQuery({
    ...profilesQueryOptions,
    enabled: open,
  });

  const setTab = (next: SettingsTab | undefined) => {
    void navigate({
      to: ".",
      search: (prev) => {
        const { settings: _removed, ...rest } = prev;

        return next !== undefined ? { ...rest, settings: next } : rest;
      },
      replace: next !== undefined,
    });
  };

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setTab(undefined);
      queryClient.clear();
      void queryClient.invalidateQueries({ queryKey: queryKeys.auth });
    },
  });

  const profiles = profilesQuery.data?.profiles ?? [];
  const profileId = activeTab?.startsWith("profile:")
    ? activeTab.slice("profile:".length)
    : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setTab(undefined);
        }
      }}
    >
      <DialogContent className="flex h-[min(85vh,680px)] w-full max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <aside className="flex w-52 shrink-0 flex-col justify-between border-r border-border bg-sidebar/60 p-3">
          <div className="space-y-5 overflow-y-auto">
            <div className="space-y-0.5">
              <div className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
                Settings
              </div>
              {SETTINGS_NAV.map((item) => {
                const active = activeTab === item.tab;

                return (
                  <button
                    key={item.tab}
                    type="button"
                    onClick={() => setTab(item.tab)}
                    className={cn(
                      "flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                      active
                        ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            {profiles.length > 0 && (
              <div className="space-y-0.5">
                <div className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">
                  Profiles
                </div>
                {profiles.map((profile) => {
                  const tab: SettingsTab = `profile:${profile.id}`;
                  const active = activeTab === tab;

                  return (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => setTab(tab)}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                      )}
                    >
                      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{profile.config.name}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground disabled:opacity-50"
            >
              <LogOutIcon className="size-3.5 shrink-0" />
              <span>Sign out</span>
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
          {activeTab === "general" && (
            <GeneralSection
              onLogout={() => logoutMutation.mutate()}
              loggingOut={logoutMutation.isPending}
            />
          )}
          {activeTab === "appearance" && <AppearanceSection />}
          {activeTab === "providers" && <ProvidersSection enabled={open} />}
          {activeTab === "secrets" && <SecretsSection enabled={open} />}
          {activeTab === "integrations" && <IntegrationsSection enabled={open} />}
          {profileId !== undefined && (
            <ProfileSettingsSection profileId={profileId} enabled={open} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
