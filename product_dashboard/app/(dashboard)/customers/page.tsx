import { Suspense } from "react"

import { CompetitorsClient } from "@/components/dashboard/competitors-client"
import { loadBrandsDashboardData } from "@/lib/competitor-data"
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
  const data = await loadBrandsDashboardData()

  return (
    <Suspense fallback={null}>
      <CompetitorsClient data={data} />
    </Suspense>
  )
}
