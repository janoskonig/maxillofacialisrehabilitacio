import { beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import Home from "@/app/page";
import { visibleGroups } from "@/lib/navigation";
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(url);
  }),
}));
beforeEach(() => vi.clearAllMocks());

it("starts at the daily workspace and preserves old filtered directory links", () => {
  expect(() => Home({ searchParams: {} })).toThrow("/today");
  expect(() =>
    Home({
      searchParams: { scope: "mine", phase: "consult", q: "Minta Anna" },
    }),
  ).toThrow("/patients?scope=mine&phase=consult&q=Minta+Anna");
  expect(redirect).toHaveBeenCalledWith("/today");
});

it("preserves patient links from the former dashboard", () => {
  const id = "a77ba197-8715-45ed-b595-6d7420fb8020";
  expect(() => Home({ searchParams: { patientId: id } })).toThrow(
    `/patients/${id}/view`,
  );
});

it("has exactly one active navigation item on the directory, patient chart, pipeline, and daily workspace", () => {
  const items = visibleGroups("admin").flatMap((group) => group.items);
  for (const [path, expected] of [
    ["/patients", "patients"],
    ["/patients/new", "patients"],
    ["/patients/p1/view", "patients"],
    ["/patients/pipeline", "pipeline"],
    ["/patients/stages/gantt", "treatment-plans"],
    ["/today", "home"],
  ]) {
    expect(
      items.filter((item) => item.match(path)).map((item) => item.id),
    ).toEqual([expected]);
  }
});
