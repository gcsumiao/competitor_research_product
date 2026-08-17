import { Suspense } from "react"
import { redirect } from "next/navigation"

import { DashboardClient } from "@/components/dashboard/dashboard-client"
import { loadOverviewDashboardData } from "@/lib/competitor-data"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"
import { normalizeSnapshotDate } from "@/lib/snapshot-date"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  const params = await searchParams
  await prepareDashboardPageRequest({
    pathname: "/",
    searchParams: params,
    forceCodeReaderCategory: true,
  })
  const data = await loadOverviewDashboardData()
  const codeReader = data.categories.find((category) => category.id === "code_reader_scanner")
  const latestSnapshot = codeReader?.snapshots.at(-1)
  const requestedCategory = firstSearchParam(params.category)
  const requestedSnapshot = normalizeSnapshotDate(firstSearchParam(params.snapshot) ?? "")
  const hasRequestedSnapshot = codeReader?.snapshots.some(
    (snapshot) => snapshot.date === requestedSnapshot
  )

  if (
    latestSnapshot &&
    (requestedCategory !== "code_reader_scanner" || !hasRequestedSnapshot)
  ) {
    const target = new URLSearchParams()
    target.set("category", "code_reader_scanner")
    target.set("snapshot", latestSnapshot.date)
    redirect(`/?${target.toString()}`)
  }

  return (
    <Suspense fallback={null}>
      <DashboardClient data={data} />
    </Suspense>
  )
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
