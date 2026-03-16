import { Suspense } from "react"

import { CompetitorsClient } from "@/components/dashboard/competitors-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const revalidate = 3600

export default async function CustomersPage() {
  const data = await loadDashboardData()

  return (
    <Suspense fallback={null}>
      <CompetitorsClient data={data} />
    </Suspense>
  )
}
