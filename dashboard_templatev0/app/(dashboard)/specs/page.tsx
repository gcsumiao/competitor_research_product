import { SpecsClient } from "@/components/dashboard/specs-client"
import { loadDashboardData } from "@/lib/competitor-data"
import { loadTypeSummaries } from "@/lib/type-summaries"

export const dynamic = "force-dynamic"

export default async function SpecsPage() {
  const [data, summaries] = await Promise.all([loadDashboardData(), loadTypeSummaries()])

  return <SpecsClient data={data} summaries={summaries} />
}
