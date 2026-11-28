import type * as React from "react"
import { cn } from "cn"
import { ArrowUpIcon, SquareIcon } from "lucide-react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@tetherbox/ui/components/input-group"
import { Spinner } from "@tetherbox/ui/components/spinner"

function PromptInput({
  className,
  onSubmit,
  children,
  ...props
}: React.ComponentProps<"form">) {
  return (
    <form
      data-slot="prompt-input"
      className={cn("w-full", className)}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit?.(event)
      }}
      {...props}
    >
      <InputGroup className="rounded-3xl border-transparent bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 has-[[data-slot=input-group-control]:focus-visible]:border-transparent has-[[data-slot=input-group-control]:focus-visible]:ring-1 has-[[data-slot=input-group-control]:focus-visible]:ring-foreground/10 dark:bg-popover">
        {children}
      </InputGroup>
    </form>
  )
}

function PromptInputTextarea({
  className,
  ...props
}: React.ComponentProps<typeof InputGroupTextarea>) {
  return (
    <InputGroupTextarea
      className={cn("max-h-48 min-h-12 px-4 py-3 text-sm", className)}
      {...props}
    />
  )
}

function PromptInputFooter({
  className,
  ...props
}: React.ComponentProps<typeof InputGroupAddon>) {
  return (
    <InputGroupAddon
      align="block-end"
      className={cn(
        "cursor-default justify-between gap-2 pr-2.5 pb-2.5 pl-3 text-foreground",
        className
      )}
      {...props}
    />
  )
}

function PromptInputTools({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-input-tools"
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
      {...props}
    />
  )
}

function PromptInputActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="prompt-input-actions"
      className={cn("flex shrink-0 items-center gap-1.5", className)}
      {...props}
    />
  )
}

function PromptInputSubmit(
  props: Omit<React.ComponentProps<typeof InputGroupButton>, "type" | "children">
) {
  return (
    <InputGroupButton
      type="submit"
      variant="default"
      size="icon-sm"
      aria-label="Send message"
      {...props}
    >
      <ArrowUpIcon className="size-4" />
    </InputGroupButton>
  )
}

function PromptInputStop({
  stopping = false,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupButton>, "type" | "children"> & {
  stopping?: boolean
}) {
  return (
    <InputGroupButton
      type="button"
      variant="default"
      size="icon-sm"
      aria-label="Stop"
      disabled={stopping}
      {...props}
    >
      {stopping ? <Spinner /> : <SquareIcon className="size-3 fill-current" />}
    </InputGroupButton>
  )
}

export {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputTools,
  PromptInputActions,
  PromptInputSubmit,
  PromptInputStop,
}
