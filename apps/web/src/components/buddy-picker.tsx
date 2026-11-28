import {
  buddyColorSchema,
  buddyGazeSchema,
  buddyShapeSchema,
  type Buddy as BuddyValue,
  type BuddyGaze,
} from "@tetherbox/core/app";
import { Buddy } from "@tetherbox/ui/components/buddy";
import { FieldLegend, FieldSet } from "@tetherbox/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@tetherbox/ui/components/toggle-group";

const GAZE_LABELS: Record<BuddyGaze, string> = {
  ahead: "Ahead",
  left: "Left",
  right: "Right",
  up: "Up",
  "up-right": "Up right",
  down: "Down",
};

export function BuddyTile({ buddy }: { buddy: BuddyValue }) {
  return (
    <div className="grid size-[4.5rem] shrink-0 place-items-center rounded-2xl bg-muted">
      <Buddy {...buddy} size={48} />
    </div>
  );
}

export function BuddyPicker({
  value,
  onChange,
}: {
  value: BuddyValue;
  onChange: (next: BuddyValue) => void;
}) {
  return (
    <div className="space-y-4">
      <FieldSet className="gap-0">
        <FieldLegend variant="label">Shape</FieldLegend>
        <ToggleGroup
          variant="outline"
          value={[value.shape]}
          onValueChange={(next) => {
            const shape = buddyShapeSchema.safeParse(next[0]);

            if (shape.success) {
              onChange({ ...value, shape: shape.data });
            }
          }}
        >
          {buddyShapeSchema.options.map((shape) => (
            <ToggleGroupItem key={shape} value={shape} aria-label={shape} className="size-11 p-0">
              <Buddy {...value} shape={shape} size={28} animated={false} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>

      <FieldSet className="gap-0">
        <FieldLegend variant="label">Color</FieldLegend>
        <ToggleGroup
          className="p-1"
          value={[value.color]}
          onValueChange={(next) => {
            const color = buddyColorSchema.safeParse(next[0]);

            if (color.success) {
              onChange({ ...value, color: color.data });
            }
          }}
        >
          {buddyColorSchema.options.map((color) => (
            <ToggleGroupItem
              key={color}
              value={color}
              aria-label={color}
              className="size-8 rounded-full p-0 aria-pressed:bg-transparent aria-pressed:ring-2 aria-pressed:ring-foreground"
            >
              <span
                className="size-6 rounded-full"
                style={{ background: `var(--buddy-${color})` }}
              />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>

      <FieldSet className="gap-0">
        <FieldLegend variant="label">Looking</FieldLegend>
        <ToggleGroup
          variant="outline"
          size="sm"
          className="flex-wrap"
          value={[value.gaze]}
          onValueChange={(next) => {
            const gaze = buddyGazeSchema.safeParse(next[0]);

            if (gaze.success) {
              onChange({ ...value, gaze: gaze.data });
            }
          }}
        >
          {buddyGazeSchema.options.map((gaze) => (
            <ToggleGroupItem key={gaze} value={gaze}>
              {GAZE_LABELS[gaze]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>
    </div>
  );
}
