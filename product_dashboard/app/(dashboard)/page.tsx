import { DashboardClient } from "@/components/dashboard/dashboard-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const data = await loadDashboardData()

  return <DashboardClient data={data} />
}
