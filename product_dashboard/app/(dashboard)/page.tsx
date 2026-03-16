import { Suspense } from "react"

import { DashboardClient } from "@/components/dashboard/dashboard-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const revalidate = 3600

export default async function DashboardPage() {
  const data = await loadDashboardData()

  return (
    <Suspense fallback={null}>
      <DashboardClient data={data} />
    </Suspense>
  )
}
