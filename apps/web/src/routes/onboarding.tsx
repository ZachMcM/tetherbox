import { createFileRoute } from "@tanstack/react-router";
import { OnboardingScreen } from "../components/onboarding-screen.tsx";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingScreen,
});
