"use client"

import { useState } from "react"
import { Calendar, Gauge, Layers, Zap } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { SalesMap } from "@/components/dashboard/sales-map"
import { TopProducts } from "@/components/dashboard/top-products"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData, TypeBreakdownMetric } from "@/lib/competitor-data"
import type { CategoryTypeSummary } from "@/lib/type-summaries"
import { cn } from "@/lib/utils"
import { formatSnapshotDateFull, formatSnapshotLabelMonthEnd } from "@/lib/snapshot-date"
import {
  formatChangeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  percentChange,
  truncateLabel,
} from "@/lib/dashboard-format"

const SPEC_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316", "#0ea5e9", "#14b8a6"]

type TypeScope = "all_asins" | "total_tablet" | "total_handheld" | "total_dongle" | "total_other_tools"

type SpecsMetricCard = {
  title: string
  value: string
  secondaryValue?: string
  change: string
  changeSuffix?: string
  isPositiveOutcome: boolean
  icon: typeof Layers
}

export function SpecsClient({
  data,
  summaries,
}: {
  data: DashboardData
  summaries: Record<string, CategoryTypeSummary | null>
}) {
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
  const isCodeReader = selectedCategory?.id === "code_reader_scanner"

  const [selectedScope, setSelectedScope] = useState<TypeScope>("all_asins")

  const scopeOptions = buildScopeOptions(activeSnapshot?.typeBreakdowns?.allAsins ?? [])
  const resolvedScope = scopeOptions.some((option) => option.value === selectedScope)
    ? selectedScope
    : (scopeOptions[0]?.value as TypeScope | undefined) ?? "all_asins"

  const scopeRows = selectScopeRows(activeSnapshot?.typeBreakdowns?.allAsins ?? [], resolvedScope)
  const previousScopeRows = selectScopeRows(previousSnapshot?.typeBreakdowns?.allAsins ?? [], resolvedScope)

  const selectedScopeMetric = findPrimaryScopeMetric(activeSnapshot?.typeBreakdowns?.allAsins ?? [], resolvedScope)
  const previousScopeMetric = findPrimaryScopeMetric(previousSnapshot?.typeBreakdowns?.allAsins ?? [], resolvedScope)

  const metricCards = isCodeReader
    ? buildCodeReaderMetricCards(selectedScopeMetric, previousScopeMetric)
    : buildDefaultMetricCards(activeSnapshot, previousSnapshot)

  const typeChartData = scopeRows.slice(0, 6).map((row) => ({
    label: truncateLabel(row.label, 22),
    sales: row.units,
    revenue: row.revenue,
  }))

  const typeShareItems = scopeRows.slice(0, 6).map((row, index) => ({
    label: row.label,
    value: row.revenue,
    color: SPEC_COLORS[index % SPEC_COLORS.length],
  }))

  const topScopeRow = scopeRows[0]
  const previousTopScope = previousScopeRows.find((item) => item.scopeKey === topScopeRow?.scopeKey)

  const topTypeProducts = (activeSnapshot?.topProducts ?? [])
    .filter((product) => {
      if (!topScopeRow) return true
      if (resolvedScope === "total_tablet") return /tablet/i.test(product.subcategory ?? "")
      if (resolvedScope === "total_handheld") return /handheld/i.test(product.subcategory ?? "")
      if (resolvedScope === "total_dongle") return /dongle/i.test(product.subcategory ?? "")
      if (resolvedScope === "total_other_tools") {
        return !/tablet|handheld|dongle/i.test(product.subcategory ?? "")
      }
      return true
    })
    .slice(0, 4)
    .map((product) => ({
      name: truncateLabel(product.title, 36),
      brand: product.brand,
      priceLabel: product.price ? formatCurrency(product.price, 0) : "n/a",
      revenueLabel: formatCurrencyCompact(product.revenue),
      image: product.imageUrl,
      url: product.url,
    }))

  const typeTrend = snapshots.map((snapshot) => {
    const rows = selectScopeRows(snapshot.typeBreakdowns?.allAsins ?? [], resolvedScope)
    const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
    return {
      label: formatSnapshotLabelMonthEnd(snapshot.date),
      value: revenue,
    }
  })

  const summaryForCategory = selectedCategory ? summaries[selectedCategory.id] : null
  const summaryLabel = summaryForCategory?.fileName ? ` | Source ${summaryForCategory.fileName}` : ""

  const headerDescription = activeSnapshot
    ? `Snapshot ${formatSnapshotDateFull(activeSnapshot.date)} | ${formatNumberCompact(scopeRows.length)} scope rows${summaryLabel}`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Types" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2 bg-transparent text-sm"
            )}
          >
            <Layers className="w-4 h-4" />
            {selectedCategory?.label ?? "Select category"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem key={category.id} onClick={() => setCategory(category.id)}>
                {category.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2 bg-transparent text-sm"
            )}
          >
            <Calendar className="w-4 h-4" />
            {activeSnapshot ? formatSnapshotDateFull(activeSnapshot.date) : "Snapshot"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {snapshots.map((snapshot) => (
              <DropdownMenuItem key={snapshot.date} onClick={() => setSnapshot(snapshot.date)}>
                {formatSnapshotDateFull(snapshot.date)}
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
            secondaryValue={metric.secondaryValue}
            change={metric.change}
            changeSuffix={metric.changeSuffix}
            isPositiveOutcome={metric.isPositiveOutcome}
            icon={metric.icon}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <ProfitChart
            data={typeChartData}
            totalLabel="Product type mix"
            totalValue={formatCurrencyCompact(topScopeRow?.revenue ?? 0)}
            changeLabel={formatChangeLabel(
              percentChange(topScopeRow?.revenue ?? 0, previousTopScope?.revenue ?? 0)
            )}
            highlightIndex={0}
          />
        </div>
        <div>
          <TopProducts
            products={topTypeProducts}
            title={topScopeRow ? `${topScopeRow.label} leaders` : "Top ASINs"}
            subtitle="Top listings in selected type scope"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="h-full">
          <CustomerOrders
            title="Scope trend"
            subtitle="Revenue trend across snapshots"
            totalLabel="Current scope revenue"
            totalValue={formatCurrencyCompact(scopeRows.reduce((sum, row) => sum + row.revenue, 0))}
            changeLabel={formatChangeLabel(percentChange(
              scopeRows.reduce((sum, row) => sum + row.revenue, 0),
              previousScopeRows.reduce((sum, row) => sum + row.revenue, 0)
            ))}
            changeValueLabel=""
            data={typeTrend}
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <SalesMap
            title="Top product types"
            subtitle="Revenue split by selected type scope"
            items={typeShareItems}
            topLabel={topScopeRow?.label ?? "n/a"}
            topValue={formatCurrencyCompact(topScopeRow?.revenue ?? 0)}
            growthLabel="Top share"
            growthValue={topScopeRow ? formatPercent(topScopeRow.revenueShare, 1) : "n/a"}
            totalLabel="Scope revenue"
            totalValue={formatCurrencyCompact(scopeRows.reduce((sum, row) => sum + row.revenue, 0))}
            primaryControl={{
              value: resolvedScope,
              onChange: (value) => setSelectedScope(value as TypeScope),
              options: scopeOptions,
            }}
          />
        </div>
      </div>

      <Card className="bg-card border border-border mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Type scope breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Type Scope</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Avg Price</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Units</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Unit Share</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rev Share</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rev MoM</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rev YoY</th>
                </tr>
              </thead>
              <tbody>
                {scopeRows.map((row) => (
                  <tr key={`${row.scopeKey}-${row.label}`} className="border-b border-border last:border-0">
                    <td className="py-3 px-2 text-xs font-medium">{row.label}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.avgPrice, 2)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(row.units)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatPercent(row.unitsShare, 1)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(row.revenue)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatPercent(row.revenueShare, 1)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatChangeLabel(percentFromRatio(row.revenueMoM))}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatChangeLabel(percentFromRatio(row.revenueYoY))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {summaryForCategory?.sections?.length ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          {summaryForCategory.sections.map((section) => (
            <Card key={section.title} className="bg-card border border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        {section.columns.map((column, index) => (
                          <th
                            key={`${section.title}-${index}`}
                            className="text-left py-3 px-2 text-xs font-medium text-muted-foreground"
                          >
                            {column || "Metric"}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row, rowIndex) => (
                        <tr
                          key={`${section.title}-row-${rowIndex}`}
                          className="border-b border-border last:border-0"
                        >
                          {section.columns.map((_, colIndex) => (
                            <td key={`${section.title}-cell-${rowIndex}-${colIndex}`} className="py-3 px-2 text-xs">
                              {row[colIndex] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </>
  )
}

function buildScopeOptions(rows: TypeBreakdownMetric[]) {
  if (!rows.length) {
    return [{ value: "all_asins", label: "All ASINs" }]
  }

  const keys = new Set(rows.map((row) => row.scopeKey))
  const options: Array<{ value: TypeScope; label: string }> = [
    { value: "all_asins", label: "All ASINs" },
  ]
  if (keys.has("total_tablet")) options.push({ value: "total_tablet", label: "Total Tablet" })
  if (keys.has("total_handheld")) options.push({ value: "total_handheld", label: "Total Handheld" })
  if (keys.has("total_dongle")) options.push({ value: "total_dongle", label: "Total Dongle" })
  if (keys.has("total_other_tools")) {
    options.push({ value: "total_other_tools", label: "Total Other Tools" })
  }

  return options
}

function selectScopeRows(rows: TypeBreakdownMetric[], scope: TypeScope) {
  if (!rows.length) return [] as TypeBreakdownMetric[]

  if (scope === "all_asins") {
    return rows
      .filter((row) => [
        "tablet_800_plus",
        "tablet_400_800",
        "tablet_under_400",
        "total_tablet",
        "handheld_75_plus",
        "handheld_under_75",
        "total_handheld",
        "total_dongle",
        "total_other_tools",
      ].includes(row.scopeKey))
      .sort((a, b) => b.revenue - a.revenue)
  }

  if (scope === "total_tablet") {
    return rows
      .filter((row) => ["tablet_800_plus", "tablet_400_800", "tablet_under_400", "total_tablet"].includes(row.scopeKey))
      .sort((a, b) => b.revenue - a.revenue)
  }

  if (scope === "total_handheld") {
    return rows
      .filter((row) => ["handheld_75_plus", "handheld_under_75", "total_handheld"].includes(row.scopeKey))
      .sort((a, b) => b.revenue - a.revenue)
  }

  if (scope === "total_dongle") {
    return rows.filter((row) => row.scopeKey === "total_dongle")
  }

  if (scope === "total_other_tools") {
    return rows.filter((row) => row.scopeKey === "total_other_tools")
  }

  return rows
}

function findPrimaryScopeMetric(rows: TypeBreakdownMetric[], scope: TypeScope) {
  if (!rows.length) return undefined
  if (scope === "all_asins") {
    return rows.find((row) => row.scopeKey === "total")
      ?? rows.find((row) => row.scopeKey === "total_tablet")
  }
  return rows.find((row) => row.scopeKey === scope)
}

function buildCodeReaderMetricCards(
  current: TypeBreakdownMetric | undefined,
  previous: TypeBreakdownMetric | undefined
): SpecsMetricCard[] {
  const revenueChange = percentFromRatio(current?.revenueMoM)
  const unitsChange = percentFromRatio(current?.unitsMoM)

  return [
    {
      title: "Scope Revenue",
      value: formatCurrencyCompact(current?.revenue ?? 0),
      secondaryValue: `Share ${formatPercent(current?.revenueShare ?? 0, 1)}`,
      change: formatChangeLabel(revenueChange),
      changeSuffix: "MoM",
      isPositiveOutcome: (revenueChange ?? 0) >= 0,
      icon: Layers,
    },
    {
      title: "Scope Units",
      value: formatNumberCompact(current?.units ?? 0),
      secondaryValue: `Share ${formatPercent(current?.unitsShare ?? 0, 1)}`,
      change: formatChangeLabel(unitsChange),
      changeSuffix: "MoM",
      isPositiveOutcome: (unitsChange ?? 0) >= 0,
      icon: Gauge,
    },
    {
      title: "Average Price",
      value: formatCurrency(current?.avgPrice ?? 0, 2),
      secondaryValue: previous ? `Prev ${formatCurrency(previous.avgPrice, 2)}` : undefined,
      change: formatChangeLabel(percentFromRatio(current?.avgPriceMoM)),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: Zap,
    },
    {
      title: "Revenue YoY",
      value: formatChangeLabel(percentFromRatio(current?.revenueYoY)),
      secondaryValue: `Units YoY ${formatChangeLabel(percentFromRatio(current?.unitsYoY))}`,
      change: "Summary sheet",
      isPositiveOutcome: true,
      icon: Layers,
    },
  ]
}

function buildDefaultMetricCards(
  activeSnapshot?: { totals: { revenue: number; units: number; avgPrice: number } },
  previousSnapshot?: { totals: { revenue: number; units: number; avgPrice: number } }
): SpecsMetricCard[] {
  const revenueChange = percentChange(activeSnapshot?.totals.revenue ?? 0, previousSnapshot?.totals.revenue ?? 0)
  const unitsChange = percentChange(activeSnapshot?.totals.units ?? 0, previousSnapshot?.totals.units ?? 0)
  const avgPriceChange = percentChange(activeSnapshot?.totals.avgPrice ?? 0, previousSnapshot?.totals.avgPrice ?? 0)

  return [
    {
      title: "Revenue",
      value: formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0),
      change: formatChangeLabel(revenueChange),
      changeSuffix: "MoM",
      isPositiveOutcome: (revenueChange ?? 0) >= 0,
      icon: Layers,
    },
    {
      title: "Units",
      value: formatNumberCompact(activeSnapshot?.totals.units ?? 0),
      change: formatChangeLabel(unitsChange),
      changeSuffix: "MoM",
      isPositiveOutcome: (unitsChange ?? 0) >= 0,
      icon: Gauge,
    },
    {
      title: "Avg Price",
      value: formatCurrency(activeSnapshot?.totals.avgPrice ?? 0, 2),
      change: formatChangeLabel(avgPriceChange),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: Zap,
    },
    {
      title: "Category",
      value: "Top Types",
      change: "Use filters",
      isPositiveOutcome: true,
      icon: Layers,
    },
  ]
}

function percentFromRatio(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  return value * 100
}
