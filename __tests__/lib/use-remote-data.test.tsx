import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useRemoteData } from "@/hooks/useRemoteData";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("does not show a previous patient or a late response after switching patients", async () => {
  const pending = new Map<string, (value: Response) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (url: string) =>
        new Promise<Response>((resolve) => pending.set(url, resolve)),
    ),
  );
  const { result, rerender } = renderHook(
    ({ url }) => useRemoteData<{ name: string }>(url),
    { initialProps: { url: "/first" } },
  );
  rerender({ url: "/second" });
  expect(result.current.status).toBe("loading");
  await act(async () =>
    pending.get("/second")!({
      ok: true,
      json: async () => ({ name: "Second" }),
    } as Response),
  );
  await waitFor(() => expect(result.current.data?.name).toBe("Second"));
  await act(async () =>
    pending.get("/first")!({
      ok: true,
      json: async () => ({ name: "First" }),
    } as Response),
  );
  expect(result.current.data?.name).toBe("Second");
  rerender({ url: "/third" });
  expect(result.current.status).toBe("loading");
  expect(result.current.data).toBeNull();
});

it("treats a JSON failure as an error even when HTTP status is successful", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) })),
  );
  const { result } = renderHook(() => useRemoteData("/resource"));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.data).toBeNull();
});
