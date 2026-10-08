import type { QuoteStatus } from "@prisma/client";
import { Badge } from "@/components/ui";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";

const TONE = {
  DRAFT: "neutral", SENT: "blue", ACCEPTED: "green", CONVERTED: "green",
  REJECTED: "red", EXPIRED: "amber", CANCELLED: "red",
} as const;

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge tone={TONE[status]}>{QUOTE_STATUS_LABEL[status]}</Badge>;
}
