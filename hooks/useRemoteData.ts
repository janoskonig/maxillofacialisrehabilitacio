"use client";

import { useCallback, useEffect, useState } from "react";

/** Keep pending/failed requests distinct from a successfully loaded empty result. */
export function useRemoteData<T>(url: string | null, body?: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${url ?? ""}:${body ?? ""}:${attempt}`;
  const [result, setResult] = useState<{
    key: string;
    data: T | null;
    status: "loading" | "error" | "success";
  }>({ key: "", data: null, status: "loading" });
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(url, {
          credentials: "include",
          signal: controller.signal,
          ...(body
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body,
              }
            : {}),
        });
        if (!response.ok) throw new Error("Request failed");
        const data = await response.json();
        if (data?.success === false) throw new Error("Request failed");
        if (!controller.signal.aborted)
          setResult({ key, data, status: "success" });
      } catch {
        if (!controller.signal.aborted)
          setResult({ key, data: null, status: "error" });
      }
    })();
    return () => controller.abort();
  }, [url, body, key]);

  const current =
    result.key === key ? result : { data: null, status: "loading" as const };
  return { ...current, retry };
}
