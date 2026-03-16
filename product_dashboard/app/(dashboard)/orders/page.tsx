import { Suspense } from "react"

import { SurveysClient } from "@/components/dashboard/surveys-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const revalidate = 3600

export default async function OrdersPage() {
  const data = await loadDashboardData()

  return (
    <Suspense fallback={null}>
      <SurveysClient data={data} />
    </Suspense>
  )
}
