import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ProfileDetail } from "@tetherbox/core/app";
import { Button } from "@tetherbox/ui/components/button";
import { FieldError } from "@tetherbox/ui/components/field";
import { Textarea } from "@tetherbox/ui/components/textarea";
import { appClient, queryKeys, unwrapJson } from "../../../lib/api.ts";

const MEMORY_LIMIT_BYTES = 8 * 1024;
const textEncoder = new TextEncoder();

function ProfileMemoryEditor({
  profileId,
  initialContent,
  onDone,
}: {
  profileId: string;
  initialContent: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState(initialContent);
  const bytes = textEncoder.encode(content).byteLength;
  const overLimit = bytes > MEMORY_LIMIT_BYTES;

  const saveMutation = useMutation({
    mutationFn: async () =>
      unwrapJson(
        await appClient.profiles[":profileId"].memory.$put({
          param: { profileId },
          json: { content },
        }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile(profileId) });
      onDone();
    },
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    saveMutation.mutate();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        className="min-h-48 font-mono text-xs"
        placeholder="# Profile memory"
      />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={overLimit ? "text-destructive" : "text-muted-foreground"}>
          {bytes.toLocaleString()} / {MEMORY_LIMIT_BYTES.toLocaleString()} bytes loaded per turn
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="xs" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="xs" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {saveMutation.error !== null && <FieldError>{saveMutation.error.message}</FieldError>}
    </form>
  );
}

export function ProfileMemorySection({ profile }: { profile: ProfileDetail }) {
  const [editingMemory, setEditingMemory] = useState(false);

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium">MEMORY.md</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Loaded into every turn for this profile.
          </p>
        </div>
        {!editingMemory && (
          <Button variant="outline" size="xs" onClick={() => setEditingMemory(true)}>
            Edit
          </Button>
        )}
      </div>
      {editingMemory ? (
        <ProfileMemoryEditor
          key={profile.id}
          profileId={profile.id}
          initialContent={profile.memory}
          onDone={() => setEditingMemory(false)}
        />
      ) : (
        <pre className="max-h-48 overflow-auto rounded-xl border border-border bg-muted/50 p-3 font-mono text-xs whitespace-pre-wrap">
          {profile.memory || "(empty)"}
        </pre>
      )}
    </section>
  );
}
