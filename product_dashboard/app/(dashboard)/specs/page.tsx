import { Suspense } from "react"

import { SpecsClient } from "@/components/dashboard/specs-client"
import { loadTypesDashboardData } from "@/lib/competitor-data"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"
import { loadTypeSummaries } from "@/lib/type-summaries"

export default async function SpecsPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/specs",
    searchParams,
    forceCodeReaderCategory: true,
  })
  const [data, summaries] = await Promise.all([loadTypesDashboardData(), loadTypeSummaries()])

  return (
    <Suspense fallback={null}>
      <SpecsClient data={data} summaries={summaries} />
    </Suspense>
  )
}
