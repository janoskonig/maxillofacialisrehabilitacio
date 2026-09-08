import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDbPool: () => ({ query }),
  queryWithRetry: (fn: () => unknown) => fn(),
}));
vi.mock("@/lib/api/route-handler", () => ({
  authedHandler: (handler: unknown) => handler,
}));
import { GET } from "@/app/api/worklists/wip-next-appointments/route";
const id = "a77ba197-8715-45ed-b595-6d7420fb8020";
beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

it("restricts worklist queries to the visible page in one parameterized batch", async () => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/worklists/wip-next-appointments?patientIds=${id}`,
    ),
    { params: {} },
  );
  expect(response.status).toBe(200);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining("pe.patient_id = ANY($1::uuid[])"),
    [[id]],
  );
});

it.each(["not-an-id", "", Array(26).fill(id).join(",")])(
  "rejects invalid or oversized batches before querying patient data",
  async (ids) => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/worklists/wip-next-appointments?patientIds=${ids}`,
      ),
      { params: {} },
    );
    expect(response.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  },
);
