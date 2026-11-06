import { approvalsApi } from "@/lib/api";
import { useApi } from "@/lib/useApi";

/** code -> description for every rejection reason (GET /approvals/reason-codes), used to show reasons without internal codes. */
export function useReasonDescriptions(): Record<string, string> {
  const list = useApi(() => approvalsApi.reasonCodes(), []);
  const out: Record<string, string> = {};
  for (const r of list.data ?? []) out[r.code] = r.description;
  return out;
}
