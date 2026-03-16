import { Suspense } from "react"

import { Top50Client } from "@/components/dashboard/top50-client"
import { loadDashboardData } from "@/lib/competitor-data"

export const revalidate = 3600

export default async function SalesPage() {
  const data = await loadDashboardData()

  return (
    <Suspense fallback={null}>
      <Top50Client data={data} />
    </Suspense>
  )
}
