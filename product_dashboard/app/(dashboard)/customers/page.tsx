import { Suspense } from "react"

import { CompetitorsClient } from "@/components/dashboard/competitors-client"
import { loadScopedDashboardData } from "@/lib/dashboard-scope"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/customers",
    searchParams,
    forceCodeReaderCategory: true,
  })
  const data = await loadScopedDashboardData("brands")

  return (
    <Suspense fallback={null}>
      <CompetitorsClient data={data} />
    </Suspense>
  )
}
