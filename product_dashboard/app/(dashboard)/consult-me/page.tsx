import { Suspense } from "react"

import { ConsultMeClient } from "@/components/dashboard/consult-me-client"
import { loadScopedDashboardData } from "@/lib/dashboard-scope"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"

export default async function ConsultMePage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/consult-me",
    searchParams,
  })
  const data = await loadScopedDashboardData("consult")

  return (
    <Suspense fallback={null}>
      <ConsultMeClient data={data} />
    </Suspense>
  )
}
