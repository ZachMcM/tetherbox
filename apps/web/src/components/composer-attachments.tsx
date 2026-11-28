import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { FileTextIcon, PlusIcon, XIcon } from "lucide-react";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@tetherbox/ui/components/attachment";
import { InputGroupAddon, InputGroupButton } from "@tetherbox/ui/components/input-group";

interface ComposerAttachment {
  id: string;
  file: File;
  previewUrl: string | null;
}

function formatSize(bytes: number): string {
  const kilobytes = bytes / 1024;

  return kilobytes >= 1024
    ? `${(kilobytes / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(kilobytes))} KB`;
}

function releasePreviews(attachments: readonly ComposerAttachment[]) {
  for (const attachment of attachments) {
    if (attachment.previewUrl !== null) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

export function useComposerAttachments() {
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const latest = useRef(attachments);

  useEffect(() => {
    latest.current = attachments;
  }, [attachments]);

  useEffect(() => () => releasePreviews(latest.current), []);

  const add = (files: FileList | readonly File[]) => {
    const added = Array.from(files, (file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));

    if (added.length > 0) {
      setAttachments((current) => [...current, ...added]);
    }
  };

  const remove = (id: string) => {
    setAttachments((current) => {
      releasePreviews(current.filter((attachment) => attachment.id === id));

      return current.filter((attachment) => attachment.id !== id);
    });
  };

  const clear = () => {
    setAttachments((current) => {
      releasePreviews(current);

      return [];
    });
  };

  const dropTarget = {
    onDragOver: (event: DragEvent<HTMLFormElement>) => {
      if (event.dataTransfer.types.includes("Files")) {
        event.preventDefault();
      }
    },
    onDrop: (event: DragEvent<HTMLFormElement>) => {
      if (event.dataTransfer.files.length > 0) {
        event.preventDefault();
        add(event.dataTransfer.files);
      }
    },
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    if (event.clipboardData.files.length > 0) {
      event.preventDefault();
      add(event.clipboardData.files);
    }
  };

  return { attachments, add, remove, clear, dropTarget, onPaste };
}

export function AttachmentButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          if (event.target.files !== null) {
            onFiles(event.target.files);
          }

          event.target.value = "";
        }}
      />
      <InputGroupButton
        variant="ghost"
        size="icon-sm"
        aria-label="Attach files"
        onClick={() => inputRef.current?.click()}
      >
        <PlusIcon />
      </InputGroupButton>
    </>
  );
}

export function AttachmentList({
  attachments,
  onRemove,
}: {
  attachments: readonly ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <InputGroupAddon align="block-start" className="px-3 pt-3">
      <AttachmentGroup className="w-full">
        {attachments.map((attachment) => (
          <Attachment key={attachment.id} size="sm">
            <AttachmentMedia variant={attachment.previewUrl === null ? "icon" : "image"}>
              {attachment.previewUrl === null ? (
                <FileTextIcon />
              ) : (
                <img src={attachment.previewUrl} alt="" />
              )}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle className="text-foreground">{attachment.file.name}</AttachmentTitle>
              <AttachmentDescription>{formatSize(attachment.file.size)}</AttachmentDescription>
            </AttachmentContent>
            <AttachmentActions>
              <AttachmentAction
                aria-label={`Remove ${attachment.file.name}`}
                onClick={() => onRemove(attachment.id)}
              >
                <XIcon />
              </AttachmentAction>
            </AttachmentActions>
          </Attachment>
        ))}
      </AttachmentGroup>
    </InputGroupAddon>
  );
}
