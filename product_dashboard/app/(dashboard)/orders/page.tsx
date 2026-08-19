import { Suspense } from "react"

import { SurveysClient } from "@/components/dashboard/surveys-client"
import { loadScopedDashboardData } from "@/lib/dashboard-scope"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/orders",
    searchParams,
    forceCodeReaderCategory: true,
  })
  const data = await loadScopedDashboardData("survey")

  return (
    <Suspense fallback={null}>
      <SurveysClient data={data} />
    </Suspense>
  )
}
