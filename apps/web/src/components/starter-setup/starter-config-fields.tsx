import { type StarterSummary } from "@tetherbox/core/app";
import { Badge } from "@tetherbox/ui/components/badge";
import { Field, FieldError, FieldLabel } from "@tetherbox/ui/components/field";
import { Input } from "@tetherbox/ui/components/input";
import { starterFieldKey } from "../../lib/starter-readiness.ts";

export function StarterConfigFields({
  idPrefix,
  starter,
  values,
  fieldErrors,
  onChange,
}: {
  idPrefix: string;
  starter: StarterSummary;
  values: Readonly<Record<string, string>>;
  fieldErrors: Readonly<Record<string, string>>;
  onChange: (fieldKey: string, value: string) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold">Profile settings</span>
        <Badge variant="outline" className="text-[10px] font-normal">
          This profile only
        </Badge>
      </div>
      {starter.configFields.map((field) => {
        const key = starterFieldKey(starter.id, field.key);
        const inputId = `${idPrefix}-cfg-${starter.id}-${field.key}`;
        const error = fieldErrors[key];

        return (
          <Field key={key}>
            <FieldLabel htmlFor={inputId} className="text-xs font-normal text-muted-foreground">
              {field.prompt}
            </FieldLabel>
            <Input
              id={inputId}
              value={values[field.key] ?? ""}
              placeholder={field.placeholder}
              onChange={(event) => onChange(field.key, event.target.value)}
              aria-invalid={error !== undefined}
            />
            {error !== undefined && <FieldError>{error}</FieldError>}
          </Field>
        );
      })}
    </div>
  );
}
