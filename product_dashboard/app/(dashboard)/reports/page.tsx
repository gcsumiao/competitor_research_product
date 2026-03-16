import { Suspense } from "react"

import { ReportsClient } from "@/components/dashboard/reports-client"
import { loadDashboardData } from "@/lib/competitor-data"
import { loadReportFiles } from "@/lib/report-files"

export const revalidate = 3600

export default async function ReportsPage() {
  const [data, reports] = await Promise.all([loadDashboardData(), loadReportFiles()])

  return (
    <Suspense fallback={null}>
      <ReportsClient data={data} reports={reports} />
    </Suspense>
  )
}
