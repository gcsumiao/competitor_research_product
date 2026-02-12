import { ReportsClient } from "@/components/dashboard/reports-client"
import { loadDashboardData } from "@/lib/competitor-data"
import { loadReportFiles } from "@/lib/report-files"

export const dynamic = "force-dynamic"

export default async function ReportsPage() {
  const [data, reports] = await Promise.all([loadDashboardData(), loadReportFiles()])

  return <ReportsClient data={data} reports={reports} />
}
