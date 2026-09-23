import type { DimensionStatus } from "@blast/core";
import { CheckIcon, CircleIcon, WarningIcon } from "./icons";

const LABEL: Record<DimensionStatus, string> = {
  risk: "Needs attention",
  acceptable: "Within budget",
  unmeasured: "Unmeasured",
};

const VARIANT: Record<DimensionStatus, string> = {
  risk: "badge--risk",
  acceptable: "badge--ok",
  unmeasured: "badge--unmeasured",
};

export function StatusBadge({ status, label }: { status: DimensionStatus; label?: string }) {
  return (
    <span className={`badge ${VARIANT[status]}`}>
      <span className="badge__dot" aria-hidden="true" />
      {label ?? LABEL[status]}
    </span>
  );
}

export function StatusIcon({ status }: { status: DimensionStatus }) {
  if (status === "risk") return <WarningIcon />;
  if (status === "acceptable") return <CheckIcon />;
  return <CircleIcon />;
}
