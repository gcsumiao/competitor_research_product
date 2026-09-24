import { Suspense } from "react"
import { redirect } from "next/navigation"

import { DashboardClient } from "@/components/dashboard/dashboard-client"
import { loadScopedDashboardData } from "@/lib/dashboard-scope"
import { prepareDashboardPageRequest, type DashboardPageSearchParams } from "@/lib/dashboard-request"
import { resolveOverviewRedirect } from "@/lib/overview-redirect"

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<DashboardPageSearchParams>
}) {
  const params = await searchParams
  await prepareDashboardPageRequest({
    pathname: "/",
    searchParams: params,
    forceCodeReaderCategory: true,
  })
  const data = await loadScopedDashboardData("overview")
  const redirectTarget = resolveOverviewRedirect(data.categories, params)
  if (redirectTarget) {
    redirect(redirectTarget)
  }

  return (
    <Suspense fallback={null}>
      <DashboardClient data={data} />
    </Suspense>
  )
}
