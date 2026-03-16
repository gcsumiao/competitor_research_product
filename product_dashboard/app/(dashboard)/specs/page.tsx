import { Suspense } from "react"

import { SpecsClient } from "@/components/dashboard/specs-client"
import { loadDashboardData } from "@/lib/competitor-data"
import { loadTypeSummaries } from "@/lib/type-summaries"

export const revalidate = 3600

export default async function SpecsPage() {
  const [data, summaries] = await Promise.all([loadDashboardData(), loadTypeSummaries()])

  return (
    <Suspense fallback={null}>
      <SpecsClient data={data} summaries={summaries} />
    </Suspense>
  )
}
