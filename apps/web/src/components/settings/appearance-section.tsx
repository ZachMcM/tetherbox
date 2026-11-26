import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@tetherbox/ui/components/toggle-group";
import { useTheme, type Theme } from "../theme-provider.tsx";
import { SectionHeader } from "./shared.tsx";

const THEME_CARDS = [
  {
    value: "light",
    title: "Light",
    description: "Bright surface palette for well-lit spaces.",
    Icon: SunIcon,
  },
  {
    value: "dark",
    title: "Dark",
    description: "Low-glare dark palette tuned for long sessions.",
    Icon: MoonIcon,
  },
  {
    value: "system",
    title: "System",
    description: "Follow your operating system appearance.",
    Icon: MonitorIcon,
  },
] as const satisfies readonly {
  value: Theme;
  title: string;
  description: string;
  Icon: typeof SunIcon;
}[];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6">
      <SectionHeader title="Appearance" description="Choose how Tetherbox looks on this browser." />

      <section className="space-y-2.5">
        <h3 className="text-sm font-medium">Theme</h3>
        <ToggleGroup
          variant="outline"
          spacing={3}
          value={[theme]}
          onValueChange={(values) => {
            const next = THEME_CARDS.find((card) => card.value === values[0]);

            if (next !== undefined) {
              setTheme(next.value);
            }
          }}
          className="grid w-full grid-cols-1 sm:grid-cols-3"
        >
          {THEME_CARDS.map(({ value, title, description, Icon }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className="h-auto flex-col items-start justify-start rounded-xl bg-card/40 p-4 text-left whitespace-normal hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-primary/8"
            >
              <Icon className="mb-3 size-4 text-muted-foreground" />
              <div className="text-sm font-medium">{title}</div>
              <p className="mt-1 text-xs leading-relaxed font-normal text-muted-foreground">
                {description}
              </p>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
    </div>
  );
}
