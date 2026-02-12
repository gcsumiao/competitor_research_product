import { ConsultMeClient } from "@/components/dashboard/consult-me-client"
import { loadConsultMeResearchAssets } from "@/lib/consult-me/research-files"
import { loadDashboardData } from "@/lib/competitor-data"

export const dynamic = "force-dynamic"

export default async function ConsultMePage() {
  const [data, researchAssets] = await Promise.all([
    loadDashboardData(),
    loadConsultMeResearchAssets(),
  ])

  return <ConsultMeClient data={data} researchAssets={researchAssets} />
}
