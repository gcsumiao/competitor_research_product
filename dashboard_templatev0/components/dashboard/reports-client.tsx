"use client"

import { Calendar, Download, FileText } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { SalesMap } from "@/components/dashboard/sales-map"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData, ProductSummary } from "@/lib/competitor-data"
import type { ReportFile } from "@/lib/report-files"
import {
  formatChangeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  formatSigned,
  percentChange,
  pointChange,
} from "@/lib/dashboard-format"

const CATEGORY_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316"]
const ALLOWED_REPORTS = [
  "DMM_market_research_summary.xlsx",
  "26-01-14 Thermal Imager.xlsx",
  "25-11-25 Thermal Imager V4.xlsx",
  "Night_Vision_Monoculars_top50(20260115).xlsx",
  "26-01-14 Borescope.xlsx",
  "25-11-25 Borescope V4.xlsx",
]

export function ReportsClient({ data, reports }: { data: DashboardData; reports: ReportFile[] }) {
  const {
    categories,
    selectedCategory,
    selectedSnapshot,
    snapshots,
    setCategory,
    setSnapshot,
  } = useDashboardFilters(data)

  const activeSnapshot = selectedSnapshot
  const activeIndex = snapshots.findIndex((snapshot) => snapshot.date === activeSnapshot?.date)
  const previousSnapshot = activeIndex > 0 ? snapshots[activeIndex - 1] : undefined

  const unitsComparison = [
    {
      label: previousSnapshot?.label ?? "Prev",
      value: previousSnapshot?.totals.units ?? 0,
    },
    {
      label: activeSnapshot?.label ?? "Current",
      value: activeSnapshot?.totals.units ?? 0,
    },
  ]
  const revenueComparison = [
    {
      label: previousSnapshot?.label ?? "Prev",
      value: previousSnapshot?.totals.revenue ?? 0,
    },
    {
      label: activeSnapshot?.label ?? "Current",
      value: activeSnapshot?.totals.revenue ?? 0,
    },
  ]

  const revenueChange = percentChange(
    activeSnapshot?.totals.revenue ?? 0,
    previousSnapshot?.totals.revenue ?? 0
  )
  const unitsChange = percentChange(
    activeSnapshot?.totals.units ?? 0,
    previousSnapshot?.totals.units ?? 0
  )

  const avgPriceChange = percentChange(
    activeSnapshot?.totals.avgPrice ?? 0,
    previousSnapshot?.totals.avgPrice ?? 0
  )

  const categoryTotals = buildCategoryTotals(activeSnapshot?.topProducts.slice(0, 50) ?? [])
  const topCategory = categoryTotals[0]
  const totalRevenue = activeSnapshot?.totals.revenue ?? 0
  const totalUnits = activeSnapshot?.totals.units ?? 0
  const topCategoryShare = totalRevenue ? (topCategory?.revenue ?? 0) / totalRevenue : 0
  const topCategoryUnitsShare = totalUnits ? (topCategory?.units ?? 0) / totalUnits : 0

  const salesCategoryItems = categoryTotals.slice(0, 4).map((item, index) => ({
    label: item.label,
    value: item.revenue,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }))

  const unitsCategoryItems = categoryTotals.slice(0, 4).map((item, index) => ({
    label: item.label,
    value: item.units,
    color: CATEGORY_COLORS[index % CATEGORY_COLORS.length],
  }))

  const topCategoryChange = previousSnapshot
    ? pointChange(topCategoryShare, buildTopCategoryShare(previousSnapshot))
    : null

  const allowedReportList = ALLOWED_REPORTS.map((name) =>
    reports.find((report) => report.name === name)
  ).filter(Boolean) as ReportFile[]

  const metricCards = [
    {
      title: "Revenue this month",
      value: formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0),
      change: formatChangeLabel(revenueChange),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: revenueChange >= 0,
      icon: FileText,
    },
    {
      title: "Units this month",
      value: formatNumberCompact(activeSnapshot?.totals.units ?? 0),
      change: formatChangeLabel(unitsChange),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: unitsChange >= 0,
      icon: FileText,
    },
    {
      title: "Avg price",
      value: formatCurrency(activeSnapshot?.totals.avgPrice ?? 0, 2),
      change: formatChangeLabel(avgPriceChange),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: avgPriceChange >= 0,
      icon: FileText,
    },
    {
      title: "Top category share",
      value: topCategory?.label ?? "n/a",
      change: topCategoryChange === null ? "n/a" : `${formatSigned(topCategoryChange, 1)}pt`,
      changeSuffix: "",
      isPositiveOutcome: (topCategoryChange ?? 0) >= 0,
      icon: FileText,
    },
  ]

  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | Reports and comparisons`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Reports" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <FileText className="w-4 h-4" />
              {selectedCategory?.label ?? "Select category"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem key={category.id} onSelect={() => setCategory(category.id)}>
                {category.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <Calendar className="w-4 h-4" />
              {activeSnapshot?.date ?? "Snapshot"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {snapshots.map((snapshot) => (
              <DropdownMenuItem key={snapshot.date} onSelect={() => setSnapshot(snapshot.date)}>
                {snapshot.date}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {metricCards.map((metric) => (
          <MetricCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            change={metric.change}
            changeSuffix={metric.changeSuffix}
            isPositiveOutcome={metric.isPositiveOutcome}
            icon={metric.icon}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <CustomerOrders
            title="Revenue comparison"
            subtitle="This month vs last month"
            totalLabel="Revenue this month"
            totalValue={formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0)}
            changeLabel={formatChangeLabel(revenueChange)}
            changeValueLabel={
              previousSnapshot
                ? formatCurrencyCompact((activeSnapshot?.totals.revenue ?? 0) - previousSnapshot.totals.revenue)
                : ""
            }
            data={revenueComparison}
          />
        </div>
        <div>
          <CustomerOrders
            title="Units comparison"
            subtitle="This month vs last month"
            totalLabel="Units this month"
            totalValue={formatNumberCompact(activeSnapshot?.totals.units ?? 0)}
            changeLabel={formatChangeLabel(unitsChange)}
            changeValueLabel={
              previousSnapshot
                ? `${formatSigned((activeSnapshot?.totals.units ?? 0) - previousSnapshot.totals.units, 0)} units`
                : ""
            }
            data={unitsComparison}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <SalesMap
          title="Sales by category"
          subtitle="Top 50 revenue by product type"
          items={salesCategoryItems}
          topLabel={topCategory?.label ?? "n/a"}
          topValue={formatCurrencyCompact(topCategory?.revenue ?? 0)}
          growthLabel="Top share"
          growthValue={formatPercent(topCategoryShare, 1)}
          totalLabel="Total revenue"
          totalValue={formatCurrencyCompact(totalRevenue)}
        />
        <SalesMap
          title="Units by category"
          subtitle="Top 50 units by product type"
          items={unitsCategoryItems}
          topLabel={topCategory?.label ?? "n/a"}
          topValue={formatNumberCompact(topCategory?.units ?? 0)}
          growthLabel="Top share"
          growthValue={formatPercent(topCategoryUnitsShare, 1)}
          totalLabel="Total units"
          totalValue={formatNumberCompact(totalUnits)}
          valueFormatter={(value) => value.toLocaleString()}
        />
      </div>

      <Card className="bg-card border border-border">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base font-medium">Available reports</CardTitle>
          <Button variant="outline" size="sm" className="bg-transparent">
            <Download className="w-4 h-4 mr-2" />
            Download all
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Report</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Category</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Updated</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Download</th>
                </tr>
              </thead>
              <tbody>
                {allowedReportList.length ? (
                  allowedReportList.map((report) => (
                    <tr key={report.relativePath} className="border-b border-border last:border-0">
                      <td className="py-3 px-2 text-xs font-medium">{report.name}</td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">{report.category}</td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">
                        {formatDate(report.modifiedAt)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        <a
                          className="inline-flex items-center gap-2 text-xs font-medium text-foreground hover:underline"
                          href={`/api/report?file=${encodeURIComponent(report.relativePath)}`}
                        >
                          <Download className="w-4 h-4" />
                          Download
                        </a>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-xs text-muted-foreground">
                      No reports found yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  )
}

function buildCategoryTotals(products: ProductSummary[]) {
  const totals = new Map<string, { revenue: number; units: number }>()

  for (const product of products) {
    const label = product.subcategory?.trim() || "Unspecified"
    const current = totals.get(label) ?? { revenue: 0, units: 0 }
    current.revenue += product.revenue
    current.units += product.units
    totals.set(label, current)
  }

  return Array.from(totals.entries())
    .map(([label, values]) => ({
      label,
      revenue: values.revenue,
      units: values.units,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function buildTopCategoryShare(snapshot?: { topProducts: ProductSummary[]; totals: { revenue: number } }) {
  if (!snapshot) return 0
  const categoryTotals = buildCategoryTotals(snapshot.topProducts.slice(0, 50))
  const top = categoryTotals[0]
  return snapshot.totals.revenue ? (top?.revenue ?? 0) / snapshot.totals.revenue : 0
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("en-CA")
}
