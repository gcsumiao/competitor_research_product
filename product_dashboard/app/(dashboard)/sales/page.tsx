import { Top50Client } from "@/components/dashboard/top50-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const dynamic = "force-dynamic"

export default async function SalesPage() {
  const data = await loadDashboardData()

  return <Top50Client data={data} />
}
