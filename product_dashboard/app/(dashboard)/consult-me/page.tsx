import { Suspense } from "react"

import { ConsultMeClient } from "@/components/dashboard/consult-me-client"
import { loadConsultMeDashboardData } from "@/lib/competitor-data"
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
  const data = await loadConsultMeDashboardData()

  return (
    <Suspense fallback={null}>
      <ConsultMeClient data={data} />
    </Suspense>
  )
}
