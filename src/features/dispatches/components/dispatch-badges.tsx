import {
  dispatchResultTone,
  dispatchStatusTone,
  formatDispatchResult,
  formatDispatchStatus,
} from "../formatters";
import type { DispatchResult, DispatchStatus } from "../types";

export function DispatchStatusBadge({ status }: { status: DispatchStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${dispatchStatusTone(status)}`}>
      {formatDispatchStatus(status)}
    </span>
  );
}

export function DispatchResultBadge({ result }: { result: DispatchResult | null }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${dispatchResultTone(result)}`}>
      {formatDispatchResult(result)}
    </span>
  );
}
