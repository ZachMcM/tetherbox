import type * as React from "react"
import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react"

import { Badge } from "@tetherbox/ui/components/badge"
import { Spinner } from "@tetherbox/ui/components/spinner"

type Status = "success" | "pending" | "attention" | "error"

function StatusIcon({ status }: { status: Status }) {
  switch (status) {
    case "success":
      return <CheckCircle2Icon data-icon="inline-start" />
    case "pending":
      return <Spinner data-icon="inline-start" className="size-3" />
    case "error":
      return <AlertCircleIcon data-icon="inline-start" />
    case "attention":
      return null
    default: {
      const exhaustive: never = status
      return exhaustive
    }
  }
}

const variantByStatus = {
  success: "success",
  pending: "outline",
  attention: "outline",
  error: "destructive",
} as const satisfies Record<Status, string>

function StatusBadge({
  status,
  className,
  children,
}: {
  status: Status
  className?: string
  children: React.ReactNode
}) {
  return (
    <Badge variant={variantByStatus[status]} className={className}>
      <StatusIcon status={status} />
      <span>{children}</span>
    </Badge>
  )
}

export { StatusBadge }
