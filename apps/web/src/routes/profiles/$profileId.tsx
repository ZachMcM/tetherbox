import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Separator } from "@tetherbox/ui/components/separator";
import { SidebarTrigger } from "@tetherbox/ui/components/sidebar";
import { ProfileSettingsSection } from "../../components/settings/profile-section.tsx";

function ProfilePage() {
  const { profileId } = Route.useParams();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 px-4 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
        <SidebarTrigger className="-ml-1" />
        <Separator
          orientation="vertical"
          className="mr-2 data-vertical:h-4 data-vertical:self-center"
        />
        <h1 className="text-sm font-medium">{profileId}</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl">
          <ProfileSettingsSection
            key={profileId}
            profileId={profileId}
            onOpenSettingsTab={(tab) =>
              void navigate({ to: ".", search: (prev) => ({ ...prev, settings: tab }) })
            }
            onDeleted={() => void navigate({ to: "/" })}
          />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/profiles/$profileId")({
  component: ProfilePage,
});
