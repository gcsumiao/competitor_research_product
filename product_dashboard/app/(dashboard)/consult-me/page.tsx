import { ConsultMeClient } from "@/components/dashboard/consult-me-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const dynamic = "force-dynamic"

export default async function ConsultMePage() {
  const data = await loadDashboardData()

  return <ConsultMeClient data={data} />
}
