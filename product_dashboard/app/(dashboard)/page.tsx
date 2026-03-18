import { Suspense } from "react"

import { DashboardClient } from "@/components/dashboard/dashboard-client"
import { loadOverviewDashboardData } from "@/lib/competitor-data"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/",
    searchParams,
    forceCodeReaderCategory: true,
  })
  const data = await loadOverviewDashboardData()

  return (
    <Suspense fallback={null}>
      <DashboardClient data={data} />
    </Suspense>
  )
}
