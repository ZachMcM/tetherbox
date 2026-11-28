import type { ProfileSummary } from "@tetherbox/core/app";
import { PlusIcon } from "lucide-react";
import { Buddy } from "@tetherbox/ui/components/buddy";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@tetherbox/ui/components/select";
import { buttonVariants } from "@tetherbox/ui/components/button";
import { cn } from "@tetherbox/ui/lib/utils";

const NEW_PROFILE = "+new";

export function ProfileSelect({
  profiles,
  value,
  onChange,
  onCreateProfile,
}: {
  profiles: readonly ProfileSummary[];
  value: string;
  onChange: (profileId: string) => void;
  onCreateProfile: () => void;
}) {
  const items = [
    ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
    { value: NEW_PROFILE, label: "New profile" },
  ];
  const selected = profiles.find((profile) => profile.id === value);

  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next === NEW_PROFILE) {
          onCreateProfile();
        } else if (typeof next === "string") {
          onChange(next);
        }
      }}
    >
      <SelectTrigger
        aria-label="Profile"
        className={cn(buttonVariants({ variant: "ghost" }), "px-2 dark:bg-transparent")}
      >
        <SelectValue>
          {selected !== undefined && (
            <>
              <Buddy {...selected.buddy} size={22} />
              <span>{selected.name}</span>
            </>
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent side="top" align="start" alignItemWithTrigger={false} className="min-w-48">
        <SelectGroup>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              <span className="flex items-center gap-2">
                <Buddy {...profile.buddy} size={24} />
                <span>{profile.name}</span>
              </span>
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectSeparator className="my-0" />
        <SelectGroup>
          <SelectItem value={NEW_PROFILE} className="text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="grid size-6 place-items-center">
                <PlusIcon />
              </span>
              <span>New profile</span>
            </span>
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
