"use client"

import { useState } from "react"
import { Calendar, Gauge, Layers, Lightbulb, Zap } from "lucide-react"
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type {
  DashboardData,
  ProductSummary,
  TypeBreakdownMetric,
} from "@/lib/competitor-data"
import {
  deriveDimensionRowsWithFallback,
  deriveProductsWithDimensions,
  deriveTrendSeriesByValue,
  filterProductsByDimensionValue,
  getDimensionOptions,
  isTargetTypesCategory,
  type TargetCategoryId,
  type ProductWithDimensions,
} from "@/lib/types-market-insights"
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

type TypeScope =
  | "all_asins"
  | "total_tablet"
  | "total_handheld"
  | "total_dongle"
  | "total_other_tools"

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

  const summaryForCategory = selectedCategory ? summaries[selectedCategory.id] : null
  const summaryLabel = summaryForCategory?.fileName ? ` | Source ${summaryForCategory.fileName}` : ""
  const headerDescription = activeSnapshot
    ? `Snapshot ${formatSnapshotDateFull(activeSnapshot.date)}${summaryLabel}`
    : "No snapshot data available"

  const [selectedScope, setSelectedScope] = useState<TypeScope>("all_asins")
  const [typeMixMetric, setTypeMixMetric] = useState<"revenue" | "units">("revenue")
  const [selectedDimension, setSelectedDimension] = useState("")
  const [selectedDimensionValue, setSelectedDimensionValue] = useState("")

  const header = (
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
  )

  if (isTargetTypesCategory(selectedCategory?.id) && activeSnapshot) {
    const targetCategoryId: TargetCategoryId = selectedCategory.id
    const dimensionOptions = getDimensionOptions(targetCategoryId)
    const resolvedDimension =
      dimensionOptions.find((item) => item.key === selectedDimension)?.key ??
      dimensionOptions[0]?.key ??
      ""
    const resolvedDimensionLabel =
      dimensionOptions.find((item) => item.key === resolvedDimension)?.label ?? "Type"

    const { rows: activeRows } = deriveDimensionRowsWithFallback({
      categoryId: targetCategoryId,
      snapshot: activeSnapshot,
      summary: summaryForCategory,
      dimensionKey: resolvedDimension,
    })
    const { rows: previousRows } = deriveDimensionRowsWithFallback({
      categoryId: targetCategoryId,
      snapshot: previousSnapshot,
      summary: summaryForCategory,
      dimensionKey: resolvedDimension,
    })

    const valueOptions = activeRows.map((row) => ({
      value: row.valueKey,
      label: row.label,
    }))
    const resolvedValue =
      valueOptions.find((item) => item.value === selectedDimensionValue)?.value ??
      valueOptions[0]?.value ??
      ""
    const resolvedValueLabel =
      valueOptions.find((item) => item.value === resolvedValue)?.label ?? "Unknown"

    const currentRow = activeRows.find((row) => row.valueKey === resolvedValue)
    const previousRow = previousRows.find((row) => row.valueKey === resolvedValue)

    const filteredProducts = filterProductsByDimensionValue(
      activeSnapshot.topProducts ?? [],
      targetCategoryId,
      resolvedDimension,
      resolvedValue
    )
    const fallbackProducts = deriveProductsWithDimensions(activeSnapshot.topProducts ?? [], targetCategoryId)
      .sort((a, b) => b.product.revenue - a.product.revenue)
      .slice(0, 12)
    const selectedProducts = filteredProducts.length ? filteredProducts : fallbackProducts

    const revenueItems = activeRows.slice(0, 8).map((row, index) => ({
      label: row.label,
      value: row.revenue,
      color: SPEC_COLORS[index % SPEC_COLORS.length],
      revenueShare: row.revenueShare,
      unitsShare: row.unitsShare,
    }))
    const unitsItems = activeRows.slice(0, 8).map((row, index) => ({
      label: row.label,
      value: row.units,
      color: SPEC_COLORS[index % SPEC_COLORS.length],
      revenueShare: row.revenueShare,
      unitsShare: row.unitsShare,
    }))

    const revenueTrend = deriveTrendSeriesByValue({
      snapshots,
      categoryId: targetCategoryId,
      dimensionKey: resolvedDimension,
      valueKey: resolvedValue,
      metric: "revenue",
    })
    const unitsTrend = deriveTrendSeriesByValue({
      snapshots,
      categoryId: targetCategoryId,
      dimensionKey: resolvedDimension,
      valueKey: resolvedValue,
      metric: "units",
    })
    const trendRows = revenueTrend.map((point, index) => ({
      label: point.label,
      revenue: point.value,
      units: unitsTrend[index]?.value ?? 0,
    }))

    const topRevenueRow = [...activeRows].sort((a, b) => b.revenue - a.revenue)[0]
    const topUnitsRow = [...activeRows].sort((a, b) => b.units - a.units)[0]

    const targetCards = buildTargetMetricCards({
      currentRow,
      previousRow,
      rows: activeRows,
    })

    return (
      <>
        {header}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {targetCards.map((metric) => (
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

        <Card className="bg-card border border-border mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Dimension Drilldown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Dimension</p>
                <Select
                  value={resolvedDimension}
                  onValueChange={(value) => setSelectedDimension(value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dimensionOptions.map((option) => (
                      <SelectItem key={option.key} value={option.key}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Value</p>
                <Select
                  value={resolvedValue}
                  onValueChange={(value) => setSelectedDimensionValue(value ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {valueOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
          <SalesMap
            title="Revenue Share"
            subtitle={`${resolvedDimensionLabel} mix by revenue`}
            items={revenueItems}
            topLabel={topRevenueRow?.label ?? "n/a"}
            topValue={formatCurrencyCompact(topRevenueRow?.revenue ?? 0)}
            growthLabel="Top value share"
            growthValue={formatPercent(topRevenueRow?.revenueShare ?? 0, 0)}
            totalLabel="Revenue/Mo"
            totalValue={formatCurrencyCompact(activeRows.reduce((sum, row) => sum + row.revenue, 0))}
          />
          <SalesMap
            title="Units Share"
            subtitle={`${resolvedDimensionLabel} mix by units`}
            items={unitsItems}
            topLabel={topUnitsRow?.label ?? "n/a"}
            topValue={formatNumberCompact(topUnitsRow?.units ?? 0)}
            growthLabel="Top value share"
            growthValue={formatPercent(topUnitsRow?.unitsShare ?? 0, 0)}
            totalLabel="Quantity/Mo"
            totalValue={formatNumberCompact(activeRows.reduce((sum, row) => sum + row.units, 0))}
            valueFormatter={(value) => value.toLocaleString()}
          />
        </div>

        <Card className="bg-card border border-border mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              {resolvedDimensionLabel} Matrix | Top 50 Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Top Revenue Value</p>
                <p className="text-sm font-medium">{topRevenueRow?.label ?? "n/a"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrencyCompact(topRevenueRow?.revenue ?? 0)} | {formatPercent(topRevenueRow?.revenueShare ?? 0, 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Top Units Value</p>
                <p className="text-sm font-medium">{topUnitsRow?.label ?? "n/a"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumberCompact(topUnitsRow?.units ?? 0)} | {formatPercent(topUnitsRow?.unitsShare ?? 0, 0)}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">
                      {resolvedDimensionLabel}
                    </th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Avg Price</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Quantity/Mo</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Qty by %</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue/Mo</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue by %</th>
                  </tr>
                </thead>
                <tbody>
                  {activeRows.length ? (
                    activeRows.map((row) => (
                      <tr key={`matrix-${row.valueKey}`} className="border-b border-border last:border-0">
                        <td className="py-3 px-2 text-xs font-medium">{row.label}</td>
                        <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.avgPrice, 2)}</td>
                        <td className="py-3 px-2 text-xs text-right">
                          {row.units.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                        <td className="py-3 px-2 text-xs">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatPercent(row.unitsShare, 0)}</span>
                            <ShareBar value={row.unitsShare} tone="units" />
                          </div>
                        </td>
                        <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.revenue, 0)}</td>
                        <td className="py-3 px-2 text-xs">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatPercent(row.revenueShare, 0)}</span>
                            <ShareBar value={row.revenueShare} tone="revenue" />
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                        No rows found for this dimension.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <DualMetricTrendCard
          title={`Trend Over Time | ${resolvedValueLabel}`}
          subtitle={`${resolvedDimensionLabel} trend with Quantity/Mo and Revenue/Mo`}
          rows={trendRows}
        />

        <Card className="bg-card border border-border mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              Pricing & Specs | {resolvedDimensionLabel} = {resolvedValueLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">ASIN</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Brand</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Price</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Units</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rating</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Key Specs</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProducts.slice(0, 12).map(({ product, dimensions }) => (
                    <tr key={`${product.asin}-${product.brand}`} className="border-b border-border last:border-0">
                      <td className="py-3 px-2 text-xs font-medium">
                        <a
                          href={product.url || `https://www.amazon.com/dp/${product.asin}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-foreground hover:underline"
                        >
                          {product.asin}
                        </a>
                      </td>
                      <td className="py-3 px-2 text-xs">{product.brand}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatCurrency(product.price, 0)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(product.revenue)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(product.units)}</td>
                      <td className="py-3 px-2 text-xs text-right">{product.rating.toFixed(1)}</td>
                      <td className="py-3 px-2 text-xs">
                        {formatKeySpecs(dimensions, targetCategoryId)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </>
    )
  }

  const isCodeReader = selectedCategory?.id === "code_reader_scanner"
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

  const scopeRowsForMix = [...scopeRows]
    .sort((a, b) => (typeMixMetric === "units" ? b.units - a.units : b.revenue - a.revenue))
    .slice(0, 6)

  const typeShareItems = scopeRowsForMix.map((row, index) => ({
    label: row.label,
    value: typeMixMetric === "revenue" ? row.revenue : row.units,
    color: SPEC_COLORS[index % SPEC_COLORS.length],
    revenueShare: row.revenueShare,
    unitsShare: row.unitsShare,
  }))

  const topScopeRow = scopeRows[0]
  const topScopeRowForMix = scopeRowsForMix[0]
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
      asin: product.asin,
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

  return (
    <>
      {header}

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

      {isCodeReader ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
            <div className="h-full">
              <CustomerOrders
                title="Scope trend"
                subtitle="Revenue trend across snapshots"
                totalLabel="Current scope revenue"
                totalValue={formatCurrencyCompact(scopeRows.reduce((sum, row) => sum + row.revenue, 0))}
                changeLabel={formatChangeLabel(
                  percentChange(
                    scopeRows.reduce((sum, row) => sum + row.revenue, 0),
                    previousScopeRows.reduce((sum, row) => sum + row.revenue, 0)
                  )
                )}
                changeValueLabel=""
                data={typeTrend}
              />
            </div>
            <div className="lg:col-span-2 h-full">
              <SalesMap
                title={typeMixMetric === "revenue" ? "Price tier mix" : "Units tier mix"}
                subtitle={
                  typeMixMetric === "revenue"
                    ? "Revenue share by selected scope"
                    : "Units share by selected scope"
                }
                items={typeShareItems}
                topLabel={topScopeRowForMix?.label ?? "n/a"}
                topValue={
                  typeMixMetric === "revenue"
                    ? formatCurrencyCompact(topScopeRowForMix?.revenue ?? 0)
                    : formatNumberCompact(topScopeRowForMix?.units ?? 0)
                }
                growthLabel="Top share"
                growthValue={
                  topScopeRowForMix
                    ? formatPercent(
                        typeMixMetric === "revenue"
                          ? topScopeRowForMix.revenueShare
                          : topScopeRowForMix.unitsShare,
                        1
                      )
                    : "n/a"
                }
                totalLabel={typeMixMetric === "revenue" ? "Scope revenue" : "Scope units"}
                totalValue={
                  typeMixMetric === "revenue"
                    ? formatCurrencyCompact(scopeRows.reduce((sum, row) => sum + row.revenue, 0))
                    : formatNumberCompact(scopeRows.reduce((sum, row) => sum + row.units, 0))
                }
                primaryControl={{
                  value: resolvedScope,
                  onChange: (value) => setSelectedScope(value as TypeScope),
                  options: scopeOptions,
                }}
                toggleControl={{
                  value: typeMixMetric,
                  onChange: (value) => setTypeMixMetric(value as "revenue" | "units"),
                  options: [
                    { value: "revenue", label: "Revenue" },
                    { value: "units", label: "Units" },
                  ],
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
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">
                        Type Scope
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Avg Price
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Units
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Unit Share
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Revenue
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Rev Share
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Rev MoM
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">
                        Rev YoY
                      </th>
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
                        <td className="py-3 px-2 text-xs text-right">
                          {formatChangeLabel(percentFromRatio(row.revenueMoM))}
                        </td>
                        <td className="py-3 px-2 text-xs text-right">
                          {formatChangeLabel(percentFromRatio(row.revenueYoY))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
          <div className="h-full">
            <CustomerOrders
              title="Scope trend"
              subtitle="Revenue trend across snapshots"
              totalLabel="Current scope revenue"
              totalValue={formatCurrencyCompact(scopeRows.reduce((sum, row) => sum + row.revenue, 0))}
              changeLabel={formatChangeLabel(
                percentChange(
                  scopeRows.reduce((sum, row) => sum + row.revenue, 0),
                  previousScopeRows.reduce((sum, row) => sum + row.revenue, 0)
                )
              )}
              changeValueLabel=""
              data={typeTrend}
            />
          </div>
          <Card className="bg-card border border-border xl:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="text-base font-medium">Type Matrix | Top 50 Summary Fields</CardTitle>
                <Select
                  value={resolvedScope}
                  onValueChange={(value) => setSelectedScope((value as TypeScope) ?? "all_asins")}
                >
                  <SelectTrigger className="w-full sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {scopeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Type</th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Avg Price</th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Quantity/Mo</th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Qty by %</th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue/Mo</th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue by %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scopeRows.length ? (
                      scopeRows.map((row) => (
                        <tr key={`scope-matrix-${row.scopeKey}-${row.label}`} className="border-b border-border last:border-0">
                          <td className="py-3 px-2 text-xs font-medium">{row.label}</td>
                          <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.avgPrice, 2)}</td>
                          <td className="py-3 px-2 text-xs text-right">
                            {row.units.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td className="py-3 px-2 text-xs">
                            <div className="flex items-center justify-end gap-2">
                              <span>{formatPercent(row.unitsShare, 0)}</span>
                              <ShareBar value={row.unitsShare} tone="units" />
                            </div>
                          </td>
                          <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.revenue, 0)}</td>
                          <td className="py-3 px-2 text-xs">
                            <div className="flex items-center justify-end gap-2">
                              <span>{formatPercent(row.revenueShare, 0)}</span>
                              <ShareBar value={row.revenueShare} tone="revenue" />
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                          No type rows found for this scope.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
                            <td
                              key={`${section.title}-cell-${rowIndex}-${colIndex}`}
                              className="py-3 px-2 text-xs"
                            >
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

function ShareBar({ value, tone }: { value: number; tone: "units" | "revenue" }) {
  const width = Math.max(0, Math.min(100, value * 100))
  const bg = tone === "units" ? "bg-emerald-500/80" : "bg-blue-500/80"
  return (
    <span className="inline-flex items-center w-20 h-2 rounded-full bg-muted overflow-hidden">
      <span className={cn("h-full rounded-full", bg)} style={{ width: `${width}%` }} />
    </span>
  )
}

function DualMetricTrendCard({
  title,
  subtitle,
  rows,
}: {
  title: string
  subtitle: string
  rows: Array<{ label: string; revenue: number; units: number }>
}) {
  const current = rows.at(-1) ?? { revenue: 0, units: 0 }
  return (
    <Card className="bg-card border border-border mb-6">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Current Quantity/Mo</p>
            <p className="text-lg font-semibold">{formatNumberCompact(current.units)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted-foreground">Current Revenue/Mo</p>
            <p className="text-lg font-semibold">{formatCurrencyCompact(current.revenue)}</p>
          </div>
        </div>
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === "Revenue/Mo" ? formatCurrency(value, 0) : value.toLocaleString(),
                  name,
                ]}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="units" name="Quantity/Mo" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue/Mo" stroke="#3b82f6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function formatKeySpecs(
  dimensions: Record<string, string>,
  categoryId: TargetCategoryId
) {
  if (categoryId === "borescope") {
    return `${dimensions.type ?? "-"} | ${dimensions.two_four_way ?? "-"} | ${dimensions.display ?? "-"} | ${
      dimensions.lens_diameter ?? "-"
    }`
  }
  return `${dimensions.type ?? "-"} | ${dimensions.display ?? "-"} | ${dimensions.basic_resolution ?? "-"} | ${
    dimensions.wifi ?? "-"
  }`
}

function buildTargetMetricCards(params: {
  currentRow: { revenue: number; units: number; avgPrice: number; revenueShare: number; unitsShare: number; label: string } | undefined
  previousRow: { revenue: number; units: number; avgPrice: number } | undefined
  rows: Array<{ revenueShare: number }>
}): SpecsMetricCard[] {
  const top3Share = params.rows
    .slice()
    .sort((a, b) => b.revenueShare - a.revenueShare)
    .slice(0, 3)
    .reduce((sum, row) => sum + row.revenueShare, 0)

  return [
    {
      title: "Selected Value Revenue",
      value: formatCurrencyCompact(params.currentRow?.revenue ?? 0),
      secondaryValue: `Share ${formatPercent(params.currentRow?.revenueShare ?? 0, 1)}`,
      change: formatChangeLabel(
        percentChange(params.currentRow?.revenue ?? 0, params.previousRow?.revenue ?? 0)
      ),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: Layers,
    },
    {
      title: "Selected Value Units",
      value: formatNumberCompact(params.currentRow?.units ?? 0),
      secondaryValue: `Share ${formatPercent(params.currentRow?.unitsShare ?? 0, 1)}`,
      change: formatChangeLabel(
        percentChange(params.currentRow?.units ?? 0, params.previousRow?.units ?? 0)
      ),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: Gauge,
    },
    {
      title: "Avg Retail Price",
      value: formatCurrency(params.currentRow?.avgPrice ?? 0, 0),
      secondaryValue: "Top 50 summary",
      change: formatChangeLabel(
        percentChange(params.currentRow?.avgPrice ?? 0, params.previousRow?.avgPrice ?? 0)
      ),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: Zap,
    },
    {
      title: "Concentration (Top 3)",
      value: formatPercent(top3Share, 1),
      secondaryValue: top3Share >= 0.8 ? "High concentration" : "Addressable concentration",
      change: top3Share >= 0.8 ? "Defend & differentiate" : "Entry feasible",
      isPositiveOutcome: top3Share < 0.8,
      icon: Lightbulb,
    },
  ]
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
      .filter((row) =>
        [
          "tablet_800_plus",
          "tablet_400_800",
          "tablet_under_400",
          "total_tablet",
          "handheld_75_plus",
          "handheld_under_75",
          "total_handheld",
          "total_dongle",
          "total_other_tools",
        ].includes(row.scopeKey)
      )
      .sort((a, b) => b.revenue - a.revenue)
  }

  if (scope === "total_tablet") {
    return rows
      .filter((row) =>
        ["tablet_800_plus", "tablet_400_800", "tablet_under_400", "total_tablet"].includes(row.scopeKey)
      )
      .sort((a, b) => b.revenue - a.revenue)
  }

  if (scope === "total_handheld") {
    return rows
      .filter((row) =>
        ["handheld_75_plus", "handheld_under_75", "total_handheld"].includes(row.scopeKey)
      )
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
    return rows.find((row) => row.scopeKey === "total") ?? rows.find((row) => row.scopeKey === "total_tablet")
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
