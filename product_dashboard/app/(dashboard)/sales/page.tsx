import { Suspense } from "react"

import { Top50Client } from "@/components/dashboard/top50-client"
import { loadSalesDashboardData } from "@/lib/competitor-data"
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
  const data = await loadSalesDashboardData()

  return (
    <Suspense fallback={null}>
      <Top50Client data={data} />
    </Suspense>
  )
}
