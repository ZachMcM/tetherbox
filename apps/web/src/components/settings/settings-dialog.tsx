import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogTitle } from "@tetherbox/ui/components/dialog";
import { cn } from "@tetherbox/ui/lib/utils";
import { logout, queryKeys } from "../../lib/api.ts";
import { AppearanceSection } from "./appearance-section.tsx";
import { GeneralSection } from "./general-section.tsx";
import { IntegrationsSection } from "./integrations-section.tsx";
import { ProfileSettingsSection } from "./profile-section.tsx";
import { ProfilesSection } from "./profiles-section.tsx";
import { ProvidersSection } from "./providers-section.tsx";
import { SecretsSection } from "./secrets-section.tsx";
import { SETTINGS_NAV, type SettingsTab } from "./types.ts";

export function SettingsDialog({ activeTab }: { activeTab: SettingsTab | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const open = activeTab !== undefined;

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
      <DialogContent className="flex h-[min(85vh,680px)] w-full max-w-[calc(100%-2rem)] gap-0 overflow-hidden bg-background p-0 text-foreground sm:max-w-4xl">
        <DialogTitle className="sr-only">Settings</DialogTitle>

        <aside className="w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border bg-sidebar p-3 text-sidebar-foreground">
          <div className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">Settings</div>
          {SETTINGS_NAV.map((item) => {
            const active =
              activeTab === item.tab || (item.tab === "profiles" && profileId !== undefined);

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
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto bg-background px-8 py-6">
          {activeTab === "general" && (
            <GeneralSection
              onLogout={() => logoutMutation.mutate()}
              loggingOut={logoutMutation.isPending}
            />
          )}
          {activeTab === "appearance" && <AppearanceSection />}
          {activeTab === "providers" && <ProvidersSection />}
          {activeTab === "secrets" && <SecretsSection />}
          {activeTab === "integrations" && <IntegrationsSection />}
          {activeTab === "profiles" && (
            <ProfilesSection onOpenProfile={(id) => setTab(`profile:${id}`)} />
          )}
          {profileId !== undefined && (
            <ProfileSettingsSection
              key={profileId}
              profileId={profileId}
              onBack={() => setTab("profiles")}
              onOpenSettingsTab={setTab}
              onDeleted={() => setTab("profiles")}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
