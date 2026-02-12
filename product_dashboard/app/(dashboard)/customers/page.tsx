import { CompetitorsClient } from "@/components/dashboard/competitors-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const dynamic = "force-dynamic"

export default async function CustomersPage() {
  const data = await loadDashboardData()

  return <CompetitorsClient data={data} />
}
