import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { Toaster } from "@tetherbox/ui/components/toast";
import { ThemeProvider } from "./components/theme-provider.tsx";
import { queryKeys, registerUnauthorizedHandler } from "./lib/api.ts";
import { routeTree } from "./routeTree.gen.ts";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

registerUnauthorizedHandler(() => {
  queryClient.setQueryData(queryKeys.auth, { authenticated: false });
  void queryClient.invalidateQueries({ queryKey: queryKeys.auth });
});

const router = createRouter({
  routeTree,
  context: { queryClient },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider defaultTheme="system" storageKey="tetherbox-theme">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
      <Toaster />
    </ThemeProvider>
  </StrictMode>,
);
