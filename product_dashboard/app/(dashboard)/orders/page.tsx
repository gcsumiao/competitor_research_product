import { SurveysClient } from "@/components/dashboard/surveys-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const dynamic = "force-dynamic"

export default async function OrdersPage() {
  const data = await loadDashboardData()

  return <SurveysClient data={data} />
}
