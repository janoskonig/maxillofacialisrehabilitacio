import type { ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

export function RemoteDataState({
  status,
  label,
  onRetry,
  children,
}: {
  status: "loading" | "error" | "success";
  label: string;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (status === "loading") {
    return (
      <p
        role="status"
        className="py-3 text-sm text-gray-600 dark:text-gray-300"
      >
        {label} betöltése…
      </p>
    );
  }
  if (status === "error") {
    return (
      <div role="alert" className="space-y-2 py-2 text-sm">
        <p className="flex items-start gap-2 text-red-700 dark:text-red-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {label} betöltése sikertelen.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Újrapróbálás
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
