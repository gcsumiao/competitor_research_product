import { Suspense } from "react"

import { Top50Client } from "@/components/dashboard/top50-client"
import { loadScopedDashboardData } from "@/lib/dashboard-scope"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/sales",
    searchParams,
    forceCodeReaderCategory: true,
  })
  const data = await loadScopedDashboardData("top50")

  return (
    <Suspense fallback={null}>
      <Top50Client data={data} />
    </Suspense>
  )
}
