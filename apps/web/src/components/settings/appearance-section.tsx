import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@tetherbox/ui/components/toggle-group";
import { useTheme, type Theme } from "../theme-provider.tsx";
import { SectionHeader } from "./shared.tsx";

const THEME_OPTIONS = [
  {
    value: "light",
    label: "Light",
    description: "Bright neutral surface palette for well-lit spaces.",
    Icon: SunIcon,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Low-glare dark palette tuned for long sessions.",
    Icon: MoonIcon,
  },
  {
    value: "system",
    label: "System",
    description: "Follow your operating system appearance automatically.",
    Icon: MonitorIcon,
  },
] as const satisfies readonly {
  value: Theme;
  label: string;
  description: string;
  Icon: typeof SunIcon;
}[];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const activeTheme = THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[2];

  return (
    <div className="space-y-6">
      <SectionHeader title="Appearance" description="Choose how Tetherbox looks on this browser." />

      <section className="space-y-2.5">
        <h3 className="text-sm font-medium">Theme</h3>
        <ToggleGroup
          variant="outline"
          spacing={2}
          value={[theme]}
          onValueChange={(values) => {
            const next = THEME_OPTIONS.find((option) => option.value === values[0]);

            if (next !== undefined) {
              setTheme(next.value);
            }
          }}
        >
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              aria-label={label}
              className="h-18 min-w-22 flex-col gap-1.5 rounded-xl px-3"
            >
              <Icon className="size-5" />
              <span className="text-xs font-normal text-muted-foreground">{label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">{activeTheme.description}</p>
      </section>
    </div>
  );
}
