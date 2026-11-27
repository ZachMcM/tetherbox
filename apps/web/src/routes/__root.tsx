import { useQuery, type QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Button } from "@tetherbox/ui/components/button";
import { SidebarInset, SidebarProvider } from "@tetherbox/ui/components/sidebar";
import { Spinner } from "@tetherbox/ui/components/spinner";
import { TooltipProvider } from "@tetherbox/ui/components/tooltip";
import { AppSidebar } from "../components/app-sidebar.tsx";
import { LoginScreen } from "../components/login-screen.tsx";
import { SettingsDialog } from "../components/settings/settings-dialog.tsx";
import { parseSettingsTab, type SettingsTab } from "../components/settings/types.ts";
import { useDaemonEvents } from "../lib/live-store.ts";
import { appSettingsQueryOptions, authQueryOptions } from "../lib/queries.ts";

interface RootRouterContext {
  queryClient: QueryClient;
}

interface RootSearch {
  settings?: SettingsTab;
}

function RootErrorScreen({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background p-4 text-center">
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button size="sm" variant="outline" onClick={() => void router.invalidate()}>
        Retry
      </Button>
    </div>
  );
}

function RootLayout() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const settingsTab = Route.useSearch({ select: (search) => search.settings });
  const authQuery = useQuery(authQueryOptions);
  const authenticated = authQuery.data?.authenticated === true;
  const settingsQuery = useQuery({ ...appSettingsQueryOptions, enabled: authenticated });
  const isOnboardingRoute = pathname === "/onboarding";

  useDaemonEvents(authenticated && !isOnboardingRoute);

  if (authQuery.isPending || (authenticated && settingsQuery.data === undefined)) {
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

  if (isOnboardingRoute) {
    return (
      <TooltipProvider>
        <Outlet />
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

export const Route = createRootRouteWithContext<RootRouterContext>()({
  beforeLoad: async ({ context, location }) => {
    const auth = await context.queryClient.ensureQueryData({ ...authQueryOptions, retry: 2 });

    if (!auth.authenticated) {
      return;
    }

    const settings = await context.queryClient.ensureQueryData({
      ...appSettingsQueryOptions,
      retry: 2,
    });

    if (!settings.onboardingCompleted && location.pathname !== "/onboarding") {
      throw redirect({ to: "/onboarding" });
    }

    if (settings.onboardingCompleted && location.pathname === "/onboarding") {
      throw redirect({ to: "/" });
    }
  },
  validateSearch: (search: Record<string, unknown>): RootSearch => {
    const settings = parseSettingsTab(search.settings);

    return settings !== undefined ? { settings } : {};
  },
  component: RootLayout,
  errorComponent: RootErrorScreen,
});
