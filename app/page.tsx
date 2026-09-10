import { redirect } from "next/navigation";

/** Preserve bookmarks and dashboard links that previously filtered the home directory. */
export default function Home({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const patientId = searchParams.patientId;
  if (
    typeof patientId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      patientId,
    )
  ) {
    redirect(`/patients/${patientId}/view`);
  }
  const filters = new URLSearchParams();
  for (const key of ["scope", "phase", "filters", "view", "q"]) {
    const value = searchParams[key];
    if (typeof value === "string") filters.set(key, value);
  }
  redirect(filters.size ? `/patients?${filters.toString()}` : "/today");
}
