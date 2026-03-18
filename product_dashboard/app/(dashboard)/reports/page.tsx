import { Suspense } from "react"

import { ReportsClient } from "@/components/dashboard/reports-client"
import { loadReportsDashboardData } from "@/lib/competitor-data"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"
import { loadReportFiles } from "@/lib/report-files"

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  await prepareDashboardPageRequest({
    pathname: "/reports",
    searchParams,
    forceCodeReaderCategory: true,
  })
  const [data, reports] = await Promise.all([loadReportsDashboardData(), loadReportFiles()])

  return (
    <Suspense fallback={null}>
      <ReportsClient data={data} reports={reports} />
    </Suspense>
  )
}
