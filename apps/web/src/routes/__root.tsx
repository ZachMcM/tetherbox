import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { TooltipProvider } from "@tetherbox/ui/components/tooltip";
import { AppSidebar } from "../components/app-sidebar.tsx";
import { LoginScreen } from "../components/login-screen.tsx";
import { SettingsDialog } from "../components/settings/settings-dialog.tsx";
import { parseSettingsTab, type SettingsTab } from "../components/settings/types.ts";
import { getAuthStatus, queryKeys } from "../lib/api.ts";
import { useDaemonEvents } from "../lib/live-store.ts";

interface RootSearch {
  settings?: SettingsTab;
}

function RootLayout() {
  const settingsTab = Route.useSearch({ select: (search) => search.settings });
  const authQuery = useQuery({
    queryKey: queryKeys.auth,
    queryFn: getAuthStatus,
  });

  const authenticated = authQuery.data?.authenticated === true;

  useDaemonEvents(authenticated);

  if (authQuery.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }

  if (!authenticated) {
    return (
      <TooltipProvider>
        <LoginScreen />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <SidebarProvider className="h-svh overflow-hidden">
        <AppSidebar />
        <SidebarInset className="min-h-0 overflow-hidden">
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
      <SettingsDialog activeTab={settingsTab} />
    </TooltipProvider>
  );
}

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): RootSearch => {
    const settings = parseSettingsTab(search.settings);

    return settings !== undefined ? { settings } : {};
  },
  component: RootLayout,
});
