import { Suspense } from "react"

import { ConsultMeClient } from "@/components/dashboard/consult-me-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const revalidate = 3600

export default async function ConsultMePage() {
  const data = await loadDashboardData()

  return (
    <Suspense fallback={null}>
      <ConsultMeClient data={data} />
    </Suspense>
  )
}
