import type { ClientStatus, ClientType } from "@/generated/prisma/enums";
import { CLIENT_STATUS_LABELS, CLIENT_TYPE_LABELS } from "@/services/clients";

const STATUS_TONES: Record<ClientStatus, string> = {
  ONBOARDING: "bg-sky-50 text-sky-700",
  ACTIVE: "bg-success/10 text-success",
  PAUSED: "bg-warning/10 text-warning",
  CHURNED: "bg-slate-100 text-slate-500",
};

export function TypeChip({ type }: { type: ClientType }) {
  return <span className="chip bg-brand/10 text-brand">{CLIENT_TYPE_LABELS[type]}</span>;
}

export function StatusChip({ status }: { status: ClientStatus }) {
  return <span className={`chip ${STATUS_TONES[status]}`}>{CLIENT_STATUS_LABELS[status]}</span>;
}
