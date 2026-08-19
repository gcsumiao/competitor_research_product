"use client"

import { useMemo, useState } from "react"
import { Calendar, ChevronDown, DollarSign, Layers, Lightbulb, Package, TrendingUp } from "lucide-react"
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
import { QuickGuide } from "@/components/dashboard/quick-guide"
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
  CategoryBrandMixMetric,
  CategoryId,
  DashboardData,
  SnapshotSummary,
  SummaryBrandRankRow,
  TierAsinRankRow,
  TypeBreakdownMetric,
} from "@/lib/competitor-data"
import {
  deriveDimensionRowsWithFallback,
  deriveProductsWithDimensions,
  deriveTrendSeriesByValue,
  filterProductsByDimensionValue,
  getDimensionOptions,
} from "@/lib/types-market-insights"
import type { NonCodeCategoryId } from "@/lib/non-code-category-config"
import type { CategoryTypeSummary } from "@/lib/type-summaries"
import { cn } from "@/lib/utils"
import {
  formatSnapshotDateFull,
  formatSnapshotLabelMonthEnd,
  normalizeSnapshotDate,
} from "@/lib/snapshot-date"
import {
  formatChangeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  formatRating,
  percentChange,
  truncateLabel,
} from "@/lib/dashboard-format"
import { REVENUE_CHART_COLOR, UNITS_CHART_COLOR } from "@/lib/chart-colors"

const SPEC_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316", "#0ea5e9", "#14b8a6"]

type TypeScope =
  | "all_asins"
  | "total_tablet"
  | "total_handheld"
  | "total_dongle"
  | "total_other_tools"

type ResolvedTypeScope =
  | TypeScope
  | "tablet_800_plus"
  | "tablet_400_800"
  | "tablet_under_400"
  | "handheld_75_plus"
  | "handheld_under_75"

type MetricMode = "revenue" | "units"

const TYPE_SCOPE_OPTIONS: Array<{ value: TypeScope; label: string }> = [
  { value: "all_asins", label: "All ASINs" },
  { value: "total_tablet", label: "Total Tablet" },
  { value: "total_handheld", label: "Total Handheld" },
  { value: "total_dongle", label: "Total Dongle" },
  { value: "total_other_tools", label: "Total Other Tools" },
]

const TABLET_TIER_OPTIONS: Array<{ value: ResolvedTypeScope; label: string }> = [
  { value: "total_tablet", label: "All tablet tiers" },
  { value: "tablet_800_plus", label: "Tablet $800+" },
  { value: "tablet_400_800", label: "Tablet $400-$800" },
  { value: "tablet_under_400", label: "Tablet $400-" },
]

const HANDHELD_TIER_OPTIONS: Array<{ value: ResolvedTypeScope; label: string }> = [
  { value: "total_handheld", label: "All handheld tiers" },
  { value: "handheld_75_plus", label: "Handheld $75+" },
  { value: "handheld_under_75", label: "Handheld $75-" },
]

const TYPE_SCOPE_LABELS: Record<ResolvedTypeScope, string> = {
  all_asins: "All ASINs",
  total_tablet: "Total Tablet",
  tablet_800_plus: "Tablet $800+",
  tablet_400_800: "Tablet $400-$800",
  tablet_under_400: "Tablet $400-",
  total_handheld: "Total Handheld",
  handheld_75_plus: "Handheld $75+",
  handheld_under_75: "Handheld $75-",
  total_dongle: "Total Dongle",
  total_other_tools: "Total Other Tools",
}

const TYPE_SCOPE_ORDER: ResolvedTypeScope[] = [
  "tablet_800_plus",
  "tablet_400_800",
  "tablet_under_400",
  "total_tablet",
  "handheld_75_plus",
  "handheld_under_75",
  "total_handheld",
  "total_dongle",
  "total_other_tools",
]

const ALL_SCOPE_BREAKDOWN_ORDER = [...TYPE_SCOPE_ORDER, "total"] as const

const DETAILED_PRICE_TIER_KEYS = new Set<ResolvedTypeScope>([
  "tablet_800_plus",
  "tablet_400_800",
  "tablet_under_400",
  "handheld_75_plus",
  "handheld_under_75",
  "total_dongle",
  "total_other_tools",
])

const PRICE_TIER_COLORS: Record<string, string> = {
  tablet_800_plus: "var(--color-tier-tablet-800-plus)",
  tablet_400_800: "var(--color-tier-tablet-400-800)",
  tablet_under_400: "var(--color-tier-tablet-under-400)",
  handheld_75_plus: "var(--color-tier-handheld-75-plus)",
  handheld_under_75: "var(--color-tier-handheld-under-75)",
  total_dongle: "var(--color-tier-total-dongle)",
  total_other_tools: "var(--color-tier-total-other-tools)",
}

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
  const activeSummary = selectedCategory
    ? resolveSnapshotTypeSummary(selectedCategory.id, activeSnapshot, summaryForCategory, true)
    : null
  const summaryLabel = activeSummary?.fileName ? ` | Source ${activeSummary.fileName}` : ""
  const headerDescription = activeSnapshot
    ? `Snapshot ${formatSnapshotDateFull(activeSnapshot.date)}${summaryLabel}`
    : "No snapshot data available"

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
          data-guide="month"
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

  const quickGuide = (
    <QuickGuide
      pageKey="types"
      steps={[
        {
          id: "scope",
          text: "Choose a type scope — Total Tablet or Total Handheld also unlock a price-tier picker",
        },
        { id: "month", text: "Pick a snapshot month" },
        { id: "mix-toggle", text: "Toggle revenue vs units share" },
      ]}
    />
  )

  if (selectedCategory && selectedCategory.id !== "code_reader_scanner" && activeSnapshot) {
    const nonCodeCategoryId = selectedCategory.id as NonCodeCategoryId
    const previousSummary = resolveSnapshotTypeSummary(
      nonCodeCategoryId,
      previousSnapshot,
      summaryForCategory,
      false
    )
    const summariesByDate = new Map(
      snapshots.map((snapshot) => [
        snapshot.date,
        resolveSnapshotTypeSummary(nonCodeCategoryId, snapshot, summaryForCategory, false),
      ])
    )
    const dimensionOptions = getDimensionOptions(nonCodeCategoryId, activeSummary)
    const resolvedDimension =
      dimensionOptions.find((item) => item.key === selectedDimension)?.key ??
      dimensionOptions[0]?.key ??
      ""
    const resolvedDimensionLabel =
      dimensionOptions.find((item) => item.key === resolvedDimension)?.label ?? "Type"

    const { rows: activeRows } = deriveDimensionRowsWithFallback({
      categoryId: nonCodeCategoryId,
      snapshot: activeSnapshot,
      summary: activeSummary,
      dimensionKey: resolvedDimension,
    })
    const { rows: previousRows } = deriveDimensionRowsWithFallback({
      categoryId: nonCodeCategoryId,
      snapshot: previousSnapshot,
      summary: previousSummary,
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
      nonCodeCategoryId,
      resolvedDimension,
      resolvedValue
    )
    const fallbackProducts = deriveProductsWithDimensions(
      activeSnapshot.topProducts ?? [],
      nonCodeCategoryId
    )
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
      summariesByDate,
      categoryId: nonCodeCategoryId,
      dimensionKey: resolvedDimension,
      valueKey: resolvedValue,
      metric: "revenue",
    })
    const unitsTrend = deriveTrendSeriesByValue({
      snapshots,
      summariesByDate,
      categoryId: nonCodeCategoryId,
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
    const metricCards = buildTargetMetricCards({
      currentRow,
      previousRow,
      rows: activeRows,
    })
    return (
      <>
        {quickGuide}
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
            growthValue={formatPercent(topRevenueRow?.revenueShare ?? 0)}
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
            growthValue={formatPercent(topUnitsRow?.unitsShare ?? 0)}
            totalLabel="Quantity/Mo"
            totalValue={formatNumberCompact(activeRows.reduce((sum, row) => sum + row.units, 0))}
            valueFormatter={formatNumberCompact}
          />
        </div>

        <Card className="bg-card border border-border mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">{resolvedDimensionLabel} Matrix</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Top Revenue Value</p>
                <p className="text-sm font-medium">{topRevenueRow?.label ?? "n/a"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrencyCompact(topRevenueRow?.revenue ?? 0)} | {formatPercent(topRevenueRow?.revenueShare ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Top Units Value</p>
                <p className="text-sm font-medium">{topUnitsRow?.label ?? "n/a"}</p>
                <p className="text-xs text-muted-foreground">
                  {formatNumberCompact(topUnitsRow?.units ?? 0)} | {formatPercent(topUnitsRow?.unitsShare ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">Displayed Value</p>
                <p className="text-sm font-medium">{resolvedValueLabel}</p>
                <p className="text-xs text-muted-foreground">
                  {currentRow
                    ? `${formatCurrencyCompact(currentRow.revenue)} revenue | ${formatNumberCompact(currentRow.units)} units`
                    : "No active row selected"}
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
                        <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.avgPrice)}</td>
                        <td className="py-3 px-2 text-xs text-right">
                          {formatNumberCompact(row.units)}
                        </td>
                        <td className="py-3 px-2 text-xs">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatPercent(row.unitsShare)}</span>
                            <ShareBar value={row.unitsShare} tone="units" />
                          </div>
                        </td>
                        <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(row.revenue)}</td>
                        <td className="py-3 px-2 text-xs">
                          <div className="flex items-center justify-end gap-2">
                            <span>{formatPercent(row.revenueShare)}</span>
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
              Product Details | {resolvedDimensionLabel} = {resolvedValueLabel}
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
                      <td className="py-3 px-2 text-xs text-right">{formatCurrency(product.price)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(product.revenue)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(product.units)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatRating(product.rating)}</td>
                      <td className="py-3 px-2 text-xs">{formatKeySpecs(dimensions, nonCodeCategoryId)}</td>
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

  return (
    <>
      {quickGuide}
      <CodeReaderTypesPage
        activeSnapshot={activeSnapshot}
        previousSnapshot={previousSnapshot}
        snapshots={snapshots}
        categories={categories}
        selectedCategory={selectedCategory}
        headerDescription={headerDescription}
        setCategory={setCategory}
        setSnapshot={setSnapshot}
      />
    </>
  )
}

function CodeReaderTypesPage({
  activeSnapshot,
  previousSnapshot,
  snapshots,
  categories,
  selectedCategory,
  headerDescription,
  setCategory,
  setSnapshot,
}: {
  activeSnapshot: SnapshotSummary | undefined
  previousSnapshot: SnapshotSummary | undefined
  snapshots: SnapshotSummary[]
  categories: DashboardData["categories"]
  selectedCategory: DashboardData["categories"][number] | undefined
  headerDescription: string
  setCategory: (id: string) => void
  setSnapshot: (date: string) => void
}) {
  const [selectedScope, setSelectedScope] = useState<TypeScope>("all_asins")
  const [tabletTier, setTabletTier] = useState<ResolvedTypeScope>("total_tablet")
  const [handheldTier, setHandheldTier] = useState<ResolvedTypeScope>("total_handheld")
  const [typeMixMetric, setTypeMixMetric] = useState<MetricMode>("revenue")
  const [trendMetric, setTrendMetric] = useState<MetricMode>("revenue")
  const [brandRankMetric, setBrandRankMetric] = useState<MetricMode>("revenue")
  const [asinRankMetric, setAsinRankMetric] = useState<MetricMode>("revenue")

  const resolvedScope: ResolvedTypeScope =
    selectedScope === "total_tablet"
      ? tabletTier
      : selectedScope === "total_handheld"
        ? handheldTier
        : selectedScope
  const resolvedScopeLabel = TYPE_SCOPE_LABELS[resolvedScope]

  const view = useMemo(() => {
    const rows = activeSnapshot?.typeBreakdowns?.allAsins ?? []
    const previousRows = previousSnapshot?.typeBreakdowns?.allAsins ?? []
    const scopeRows = selectScopeRows(rows, resolvedScope)
    const scopeMetric = findPrimaryScopeMetric(rows, resolvedScope)
    const previousScopeMetric = findPrimaryScopeMetric(previousRows, resolvedScope)
    const metricCards = buildCodeReaderMetricCards(
      resolvedScopeLabel,
      scopeMetric,
      previousScopeMetric
    )
    const productTypeRows = selectProductTypeRows(rows, resolvedScope)
    const typeChartData = productTypeRows.map((row) => ({
      label: truncateLabel(row.label, 22),
      sales: row.units,
      revenue: row.revenue,
    }))
    // Pie slice order is fixed (revenue desc) regardless of the toggle so a
    // slice keeps its angular position and just tweens in size when switching
    // revenue <-> units; only the "Top tier" headline follows the metric.
    const mixRows = selectPriceTierMixRows(rows, resolvedScope)
      .slice()
      .sort((a, b) => b.revenue - a.revenue)
    const typeShareItems = mixRows.map((row, index) => ({
      label: row.label,
      value: typeMixMetric === "revenue" ? row.revenue : row.units,
      color: PRICE_TIER_COLORS[row.scopeKey] ?? SPEC_COLORS[index % SPEC_COLORS.length],
      revenueShare: row.revenueShare,
      unitsShare: row.unitsShare,
    }))
    const topMixRow = mixRows
      .slice()
      .sort((a, b) =>
        typeMixMetric === "units" ? b.units - a.units : b.revenue - a.revenue
      )[0]
    const topTypeProducts = (activeSnapshot?.topProducts ?? [])
      .filter((product) => productMatchesScope(product, resolvedScope))
      .slice(0, 4)
      .map((product) => ({
        asin: product.asin,
        name: truncateLabel(product.title, 36),
        brand: product.brand,
        priceLabel: product.price ? formatCurrency(product.price) : "n/a",
        revenueLabel: formatCurrencyCompact(product.revenue),
        image: product.imageUrl,
        url: product.url,
      }))
    const trendRows = snapshots.map((snapshot) => ({
      label: formatSnapshotLabelMonthEnd(snapshot.date),
      value:
        findPrimaryScopeMetric(snapshot.typeBreakdowns?.allAsins ?? [], resolvedScope)?.[
          trendMetric
        ] ?? 0,
    }))
    const currentTrendValue = findPrimaryScopeMetric(rows, resolvedScope)?.[trendMetric] ?? 0
    const previousTrendValue =
      findPrimaryScopeMetric(previousRows, resolvedScope)?.[trendMetric] ?? 0
    const summaryRankRows = (activeSnapshot?.summaryBrandRanks?.[brandRankMetric] ?? []).slice(
      0,
      15
    )
    const brandMixRows = (activeSnapshot?.typeBreakdowns?.categoryBrandMix ?? [])
      .filter((row) => row.scopeKey === resolvedScope)
      .sort((a, b) => b.revenue - a.revenue)
    const asinRankRows =
      activeSnapshot?.tierAsinRanks?.find(
        (section) => section.scopeKey === resolvedScope && section.metric === asinRankMetric
      )?.rows ?? []

    return {
      scopeRows,
      scopeMetric,
      previousScopeMetric,
      metricCards,
      typeChartData,
      typeShareItems,
      topMixRow,
      topTypeProducts,
      trendRows,
      currentTrendValue,
      previousTrendValue,
      summaryRankRows,
      brandMixRows,
      asinRankRows,
      sourceTitle: activeSnapshot
        ? formatSummaryRankSource(activeSnapshot.date, brandRankMetric)
        : `Monthly Summary - ${brandRankMetric === "revenue" ? "Revenue" : "Units"}`,
    }
  }, [
    activeSnapshot,
    asinRankMetric,
    brandRankMetric,
    previousSnapshot,
    resolvedScope,
    snapshots,
    trendMetric,
    typeMixMetric,
  ])

  const scopeRevenue = view.scopeMetric?.revenue ?? 0
  const previousScopeRevenue = view.previousScopeMetric?.revenue ?? 0
  const trendFormatter = trendMetric === "revenue" ? formatCurrencyCompact : formatNumberCompact
  const mixFormatter = typeMixMetric === "revenue" ? formatCurrencyCompact : formatNumberCompact

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Types</h1>
          <p className="text-sm text-muted-foreground">{headerDescription}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              data-guide="scope"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "min-w-44 justify-between border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/30 px-4 shadow-sm hover:bg-[var(--color-accent)]/40"
              )}
            >
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                {TYPE_SCOPE_OPTIONS.find((option) => option.value === selectedScope)?.label}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {TYPE_SCOPE_OPTIONS.map((option) => (
                <DropdownMenuItem key={option.value} onClick={() => setSelectedScope(option.value)}>
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {selectedScope === "total_tablet" ? (
            <TierDropdown
              value={tabletTier}
              options={TABLET_TIER_OPTIONS}
              onChange={setTabletTier}
            />
          ) : null}
          {selectedScope === "total_handheld" ? (
            <TierDropdown
              value={handheldTier}
              options={HANDHELD_TIER_OPTIONS}
              onChange={setHandheldTier}
            />
          ) : null}

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
              data-guide="month"
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
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {view.metricCards.map((metric) => (
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ProfitChart
          data={view.typeChartData}
          totalLabel="Product type mix"
          totalValue={formatCurrencyCompact(scopeRevenue)}
          changeLabel={formatChangeLabel(percentChange(scopeRevenue, previousScopeRevenue))}
          highlightIndex={0}
        />
        <SalesMap
          title={typeMixMetric === "revenue" ? "Price tier mix" : "Units tier mix"}
          subtitle={
            typeMixMetric === "revenue"
              ? "Revenue share by selected scope"
              : "Units share by selected scope"
          }
          items={view.typeShareItems}
          topLabel={view.topMixRow?.label ?? "n/a"}
          topDisplayOrder="label-first"
          topValue={
            typeMixMetric === "revenue"
              ? formatCurrencyCompact(view.topMixRow?.revenue ?? 0)
              : formatNumberCompact(view.topMixRow?.units ?? 0)
          }
          growthLabel={typeMixMetric === "revenue" ? "Rev share" : "Units share"}
          growthValue={
            view.topMixRow
              ? formatPercent(
                  typeMixMetric === "revenue"
                    ? view.topMixRow.revenueShare
                    : view.topMixRow.unitsShare
                )
              : "n/a"
          }
          growthSubLabel=""
          totalLabel={
            typeMixMetric === "revenue"
              ? `${resolvedScopeLabel} revenue`
              : `${resolvedScopeLabel} units`
          }
          totalValue={
            typeMixMetric === "revenue"
              ? formatCurrencyCompact(view.scopeMetric?.revenue ?? 0)
              : formatNumberCompact(view.scopeMetric?.units ?? 0)
          }
          valueFormatter={mixFormatter}
          toggleControl={{
            value: typeMixMetric,
            onChange: (value) => setTypeMixMetric(value as MetricMode),
            options: [
              { value: "revenue", label: "Revenue" },
              { value: "units", label: "Units" },
            ],
          }}
          toggleGuideId="mix-toggle"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <CustomerOrders
          title={`${resolvedScopeLabel} trend`}
          subtitle={`${trendMetric === "revenue" ? "Revenue" : "Units"} trend across snapshots`}
          totalLabel={
            trendMetric === "revenue"
              ? `Current ${resolvedScopeLabel} revenue`
              : `Current ${resolvedScopeLabel} units`
          }
          totalValue={trendFormatter(view.currentTrendValue)}
          changeLabel={formatChangeLabel(
            percentChange(view.currentTrendValue, view.previousTrendValue)
          )}
          changeValueLabel=""
          data={view.trendRows}
          valueFormatter={trendFormatter}
          color={trendMetric === "revenue" ? REVENUE_CHART_COLOR : UNITS_CHART_COLOR}
          headerRight={<MetricToggle value={trendMetric} onChange={setTrendMetric} />}
        />
        <TopProducts
          products={view.topTypeProducts}
          title={`${resolvedScopeLabel} leaders`}
          subtitle="Top listings in selected type scope"
        />
      </div>

      <TypeScopeBreakdown rows={view.scopeRows} />

      {resolvedScope === "all_asins" ? (
        <SummaryBrandRankings
          rows={view.summaryRankRows}
          metric={brandRankMetric}
          sourceTitle={view.sourceTitle}
          onMetricChange={setBrandRankMetric}
        />
      ) : (
        <ScopedBrandRankings
          scopeLabel={resolvedScopeLabel}
          brandRows={view.brandMixRows}
          asinRows={view.asinRankRows}
          asinMetric={asinRankMetric}
          onAsinMetricChange={setAsinRankMetric}
        />
      )}
    </>
  )
}

function TierDropdown({
  value,
  options,
  onChange,
}: {
  value: ResolvedTypeScope
  options: Array<{ value: ResolvedTypeScope; label: string }>
  onChange: (value: ResolvedTypeScope) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "min-w-48 justify-between rounded-full border-2 border-[var(--color-accent)] bg-[var(--color-accent)]/30 px-4 shadow-sm hover:bg-[var(--color-accent)]/45"
        )}
      >
        {options.find((option) => option.value === value)?.label ?? TYPE_SCOPE_LABELS[value]}
        <ChevronDown className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => onChange(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MetricToggle({
  value,
  onChange,
}: {
  value: MetricMode
  onChange: (value: MetricMode) => void
}) {
  return (
    <div className="flex items-center rounded-full border border-border bg-background/40 p-0.5">
      {(["revenue", "units"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={cn(
            "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
            value === option
              ? "bg-[var(--color-accent)] text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option === "revenue" ? "Revenue" : "Units"}
        </button>
      ))}
    </div>
  )
}

function TypeScopeBreakdown({ rows }: { rows: TypeBreakdownMetric[] }) {
  return (
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
              {rows.length ? (
                rows.map((row) => {
                  const key = row.label.trim().toLowerCase()
                  const isGrand = key === "total"
                  const isTotal = key.startsWith("total")

                  return (
                    <tr
                      key={`${row.scopeKey}-${row.label}`}
                      className={cn(
                        "border-b border-border last:border-0",
                        !isTotal && "even:bg-muted/30",
                        isTotal && !isGrand && "bg-[var(--color-accent)]/20",
                        isGrand && "bg-[var(--color-accent)]/45 font-semibold"
                      )}
                    >
                      <td className="py-3 px-2 text-xs font-medium">{row.label}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.avgPrice)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(row.units)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatPercent(row.unitsShare)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(row.revenue)}</td>
                      <td className="py-3 px-2 text-xs text-right">{formatPercent(row.revenueShare)}</td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatChangeLabel(percentFromRatio(row.revenueMoM))}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatChangeLabel(percentFromRatio(row.revenueYoY))}
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-xs text-muted-foreground">
                    No type breakdown is available for this scope.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function SummaryBrandRankings({
  rows,
  metric,
  sourceTitle,
  onMetricChange,
}: {
  rows: SummaryBrandRankRow[]
  metric: MetricMode
  sourceTitle: string
  onMetricChange: (value: MetricMode) => void
}) {
  const color = metric === "revenue" ? REVENUE_CHART_COLOR : UNITS_CHART_COLOR
  const maxValue = Math.max(
    ...rows.map((row) => (metric === "revenue" ? row.monthlyRevenue : row.monthlyUnits)),
    1
  )

  return (
    <Card className="bg-card border border-border mb-6">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">Brand rankings</CardTitle>
          <p className="text-xs text-muted-foreground">{sourceTitle}</p>
        </div>
        <MetricToggle value={metric} onChange={onMetricChange} />
      </CardHeader>
      <CardContent>
        {rows.length ? (
          <div className="overflow-x-auto">
            <div className="min-w-[620px] space-y-2">
              {rows.map((row) => {
                const value = metric === "revenue" ? row.monthlyRevenue : row.monthlyUnits
                return (
                  <div
                    key={`${metric}-${row.rank}-${row.brand}`}
                    className="grid grid-cols-[2rem_10rem_minmax(10rem,1fr)_6rem_3.5rem] items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted/40"
                  >
                    <span className="text-xs font-semibold text-muted-foreground">#{row.rank}</span>
                    <span className="truncate text-sm font-medium">{row.brand}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.max(1, (value / maxValue) * 100)}%`, backgroundColor: color }}
                      />
                    </span>
                    <span className="text-right text-xs font-medium">
                      {metric === "revenue"
                        ? formatCurrencyCompact(value)
                        : formatNumberCompact(value)}
                    </span>
                    <span className="text-right text-xs text-muted-foreground">
                      {formatPercent(row.share)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <QuietEmptyState message="Brand rankings are not available for this snapshot." />
        )}
      </CardContent>
    </Card>
  )
}

function ScopedBrandRankings({
  scopeLabel,
  brandRows,
  asinRows,
  asinMetric,
  onAsinMetricChange,
}: {
  scopeLabel: string
  brandRows: CategoryBrandMixMetric[]
  asinRows: TierAsinRankRow[]
  asinMetric: MetricMode
  onAsinMetricChange: (value: MetricMode) => void
}) {
  return (
    <section className="mb-6">
      <div className="mb-3">
        <h2 className="text-lg font-semibold">Brand rankings</h2>
        <p className="text-xs text-muted-foreground">Brand and ASIN leaders for {scopeLabel}</p>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Brand mix</CardTitle>
            <p className="text-xs text-muted-foreground">Monthly performance by brand</p>
          </CardHeader>
          <CardContent>
            {brandRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Brand</th>
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
                    {brandRows.map((row) => {
                      const key = row.brand.trim().toLowerCase()
                      const isGrand = key === "total"
                      const isTotal = key.startsWith("total")

                      return (
                        <tr
                          key={`${row.scopeKey}-${row.brand}`}
                          className={cn(
                            "border-b border-border last:border-0",
                            !isTotal && "even:bg-muted/30",
                            isTotal && !isGrand && "bg-[var(--color-accent)]/20",
                            isGrand && "bg-[var(--color-accent)]/45 font-semibold"
                          )}
                        >
                          <td className="py-3 px-2 text-xs font-medium">{row.brand}</td>
                          <td className="py-3 px-2 text-xs text-right">{formatCurrency(row.avgPrice)}</td>
                          <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(row.units)}</td>
                          <td className="py-3 px-2 text-xs text-right">{formatPercent(row.unitsShare)}</td>
                          <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(row.revenue)}</td>
                          <td className="py-3 px-2 text-xs text-right">{formatPercent(row.revenueShare)}</td>
                          <td className="py-3 px-2 text-xs text-right">
                            {formatChangeLabel(percentFromRatio(row.revenueMoM))}
                          </td>
                          <td className="py-3 px-2 text-xs text-right">
                            {formatChangeLabel(percentFromRatio(row.revenueYoY))}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <QuietEmptyState message="Brand mix is not available for this scope and snapshot." />
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-medium">Top 10 ASINs</CardTitle>
              <p className="text-xs text-muted-foreground">Ranked by {asinMetric}</p>
            </div>
            <MetricToggle value={asinMetric} onChange={onAsinMetricChange} />
          </CardHeader>
          <CardContent>
            {asinRows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Rank</th>
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">ASIN</th>
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Product</th>
                      <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Brand</th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Price</th>
                      <th
                        className={cn(
                          "text-right py-3 px-2 text-xs font-medium",
                          asinMetric === "revenue" ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        Revenue
                      </th>
                      <th
                        className={cn(
                          "text-right py-3 px-2 text-xs font-medium",
                          asinMetric === "units" ? "text-foreground" : "text-muted-foreground"
                        )}
                      >
                        Units
                      </th>
                      <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asinRows.map((row) => (
                      <tr key={`${asinMetric}-${row.rank}-${row.asin}`} className="border-b border-border last:border-0 even:bg-muted/30">
                        <td className="py-3 px-2 text-xs text-muted-foreground">{row.rank}</td>
                        <td className="py-3 px-2 text-xs font-medium">
                          <a
                            href={`https://www.amazon.com/dp/${row.asin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground hover:underline"
                          >
                            {row.asin}
                          </a>
                        </td>
                        <td className="max-w-56 py-3 px-2 text-xs text-muted-foreground" title={row.title}>
                          {truncateLabel(row.title, 42)}
                        </td>
                        <td className="py-3 px-2 text-xs text-muted-foreground">{row.brand}</td>
                        <td className="py-3 px-2 text-xs text-right">{formatNullableCurrency(row.price)}</td>
                        <td
                          className={cn(
                            "py-3 px-2 text-xs text-right",
                            asinMetric === "revenue" ? "font-semibold text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {formatCurrencyCompact(row.revenue)}
                        </td>
                        <td
                          className={cn(
                            "py-3 px-2 text-xs text-right",
                            asinMetric === "units" ? "font-semibold text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {formatNumberCompact(row.units)}
                        </td>
                        <td className="py-3 px-2 text-xs text-right">{formatNullableRating(row.rating)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <QuietEmptyState message="Top ASIN rankings are not available for this scope and snapshot." />
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  )
}

function QuietEmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
      {message}
    </div>
  )
}

function ShareBar({ value, tone }: { value: number; tone: "units" | "revenue" }) {
  const width = Math.max(0, Math.min(100, value * 100))
  const color = tone === "units" ? UNITS_CHART_COLOR : REVENUE_CHART_COLOR
  return (
    <span className="inline-flex items-center w-20 h-2 rounded-full bg-muted overflow-hidden">
      <span className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
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
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickFormatter={formatNumberCompact} />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11 }}
                tickFormatter={formatCurrencyCompact}
              />
              <Tooltip
                formatter={(value: number, name: string) => [
                  name === "Revenue/Mo" ? formatCurrencyCompact(value) : formatNumberCompact(value),
                  name,
                ]}
              />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="units" name="Quantity/Mo" stroke={UNITS_CHART_COLOR} strokeWidth={2} dot={false} />
              <Line yAxisId="right" type="monotone" dataKey="revenue" name="Revenue/Mo" stroke={REVENUE_CHART_COLOR} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}

function resolveSnapshotTypeSummary(
  categoryId: CategoryId,
  snapshot: DashboardData["categories"][number]["snapshots"][number] | undefined,
  fallbackSummary: CategoryTypeSummary | null,
  allowFallback: boolean
) {
  const metadata = snapshot?.metadata
  const sections = Array.isArray(metadata?.typeSummarySections)
    ? (metadata.typeSummarySections as CategoryTypeSummary["sections"])
    : []
  const fileName =
    typeof metadata?.typeSummaryFileName === "string"
      ? metadata.typeSummaryFileName
      : fallbackSummary?.fileName ?? ""

  if (sections.length || fileName) {
    return {
      categoryId,
      fileName,
      sections,
    } as CategoryTypeSummary
  }

  return allowFallback ? fallbackSummary : null
}

function formatKeySpecs(
  dimensions: Record<string, string>,
  categoryId: NonCodeCategoryId
) {
  if (categoryId === "borescope") {
    return `${dimensions.type ?? "-"} | ${dimensions.two_four_way ?? "-"} | ${dimensions.display ?? "-"} | ${
      dimensions.lens_diameter ?? "-"
    }`
  }
  if (categoryId === "thermal_imager") {
    return `${dimensions.type ?? "-"} | ${dimensions.display ?? "-"} | ${dimensions.basic_resolution ?? "-"} | ${
      dimensions.wifi ?? "-"
    }`
  }
  return dimensions.type ?? "-"
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
      secondaryValue: `Share ${formatPercent(params.currentRow?.revenueShare ?? 0)}`,
      change: formatChangeLabel(
        percentChange(params.currentRow?.revenue ?? 0, params.previousRow?.revenue ?? 0)
      ),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: DollarSign,
    },
    {
      title: "Selected Value Units",
      value: formatNumberCompact(params.currentRow?.units ?? 0),
      secondaryValue: `Share ${formatPercent(params.currentRow?.unitsShare ?? 0)}`,
      change: formatChangeLabel(
        percentChange(params.currentRow?.units ?? 0, params.previousRow?.units ?? 0)
      ),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: Package,
    },
    {
      title: "Avg Retail Price",
      value: formatCurrency(params.currentRow?.avgPrice ?? 0),
      secondaryValue: "Top 50 summary",
      change: formatChangeLabel(
        percentChange(params.currentRow?.avgPrice ?? 0, params.previousRow?.avgPrice ?? 0)
      ),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: DollarSign,
    },
    {
      title: "Concentration (Top 3)",
      value: formatPercent(top3Share),
      secondaryValue: top3Share >= 0.8 ? "High concentration" : "Addressable concentration",
      change: top3Share >= 0.8 ? "Defend & differentiate" : "Entry feasible",
      isPositiveOutcome: top3Share < 0.8,
      icon: Lightbulb,
    },
  ]
}

function selectScopeRows(rows: TypeBreakdownMetric[], scope: ResolvedTypeScope) {
  if (!rows.length) return [] as TypeBreakdownMetric[]

  if (scope === "all_asins") {
    return rowsInScopeOrder(rows, ALL_SCOPE_BREAKDOWN_ORDER)
  }

  if (scope === "total_tablet") {
    return rowsInScopeOrder(rows, [
      "tablet_800_plus",
      "tablet_400_800",
      "tablet_under_400",
      "total_tablet",
    ])
  }

  if (scope === "total_handheld") {
    return rowsInScopeOrder(rows, [
      "handheld_75_plus",
      "handheld_under_75",
      "total_handheld",
    ])
  }

  return rows.filter((row) => row.scopeKey === scope)
}

function rowsInScopeOrder(rows: TypeBreakdownMetric[], order: readonly string[]) {
  const byScope = new Map(rows.map((row) => [row.scopeKey, row]))
  return order.flatMap((scopeKey) => {
    const row = byScope.get(scopeKey)
    return row ? [row] : []
  })
}

function selectProductTypeRows(rows: TypeBreakdownMetric[], scope: ResolvedTypeScope) {
  if (scope === "all_asins") {
    return rowsInScopeOrder(rows, [
      "total_tablet",
      "total_handheld",
      "total_dongle",
      "total_other_tools",
    ])
  }
  if (scope === "total_tablet") {
    return rowsInScopeOrder(rows, [
      "tablet_800_plus",
      "tablet_400_800",
      "tablet_under_400",
    ])
  }
  if (scope === "total_handheld") {
    return rowsInScopeOrder(rows, ["handheld_75_plus", "handheld_under_75"])
  }
  return rows.filter((row) => row.scopeKey === scope)
}

function selectPriceTierMixRows(rows: TypeBreakdownMetric[], scope: ResolvedTypeScope) {
  if (scope === "all_asins") {
    return rows.filter((row) => DETAILED_PRICE_TIER_KEYS.has(row.scopeKey as ResolvedTypeScope))
  }
  if (scope === "total_tablet") {
    return rowsInScopeOrder(rows, [
      "tablet_800_plus",
      "tablet_400_800",
      "tablet_under_400",
    ])
  }
  if (scope === "total_handheld") {
    return rowsInScopeOrder(rows, ["handheld_75_plus", "handheld_under_75"])
  }
  return rows.filter((row) => row.scopeKey === scope)
}

function findPrimaryScopeMetric(rows: TypeBreakdownMetric[], scope: ResolvedTypeScope) {
  if (!rows.length) return undefined
  if (scope === "all_asins") {
    return rows.find((row) => row.scopeKey === "total") ?? rows.find((row) => row.scopeKey === "total_tablet")
  }
  return rows.find((row) => row.scopeKey === scope)
}

function productMatchesScope(
  product: SnapshotSummary["topProducts"][number],
  scope: ResolvedTypeScope
) {
  if (scope === "all_asins") return true

  const type = `${product.subcategory ?? ""} ${product.toolType ?? ""}`
  const isTablet = /tablet/i.test(type)
  const isHandheld = /handheld/i.test(type)
  const isDongle = /dongle/i.test(type)

  if (scope === "total_tablet") return isTablet
  if (scope === "tablet_800_plus") return isTablet && product.price >= 800
  if (scope === "tablet_400_800") return isTablet && product.price >= 400 && product.price < 800
  if (scope === "tablet_under_400") return isTablet && product.price < 400
  if (scope === "total_handheld") return isHandheld
  if (scope === "handheld_75_plus") return isHandheld && product.price >= 75
  if (scope === "handheld_under_75") return isHandheld && product.price < 75
  if (scope === "total_dongle") return isDongle
  return !isTablet && !isHandheld && !isDongle
}

function formatSummaryRankSource(date: string, metric: MetricMode) {
  const normalized = normalizeSnapshotDate(date)
  const parsed = new Date(`${normalized}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) {
    return `Monthly Summary - ${metric === "revenue" ? "Revenue" : "Units"} (${date})`
  }
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(parsed)
  const year = new Intl.DateTimeFormat("en-US", {
    year: "2-digit",
    timeZone: "UTC",
  }).format(parsed)
  return `Monthly Summary - ${metric === "revenue" ? "Revenue" : "Units"} (${month} '${year})`
}

function formatNullableCurrency(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? formatCurrency(value) : "n/a"
}

function formatNullableRating(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? formatRating(value) : "n/a"
}

function buildCodeReaderMetricCards(
  scopeLabel: string,
  current: TypeBreakdownMetric | undefined,
  previous: TypeBreakdownMetric | undefined
): SpecsMetricCard[] {
  const revenueChange = percentFromRatio(current?.revenueMoM)
  const unitsChange = percentFromRatio(current?.unitsMoM)

  return [
    {
      title: `${scopeLabel} Revenue`,
      value: current ? formatCurrencyCompact(current.revenue) : "n/a",
      secondaryValue: current ? `Share ${formatPercent(current.revenueShare)}` : undefined,
      change: formatChangeLabel(revenueChange),
      changeSuffix: "MoM",
      isPositiveOutcome: (revenueChange ?? 0) >= 0,
      icon: DollarSign,
    },
    {
      title: `${scopeLabel} Units`,
      value: current ? formatNumberCompact(current.units) : "n/a",
      secondaryValue: current ? `Share ${formatPercent(current.unitsShare)}` : undefined,
      change: formatChangeLabel(unitsChange),
      changeSuffix: "MoM",
      isPositiveOutcome: (unitsChange ?? 0) >= 0,
      icon: Package,
    },
    {
      title: "Average Price",
      value: current ? formatCurrency(current.avgPrice) : "n/a",
      secondaryValue: previous ? `Prev ${formatCurrency(previous.avgPrice)}` : undefined,
      change: formatChangeLabel(percentFromRatio(current?.avgPriceMoM)),
      changeSuffix: "MoM",
      isPositiveOutcome: true,
      icon: DollarSign,
    },
    {
      title: "Revenue YoY",
      value: formatChangeLabel(percentFromRatio(current?.revenueYoY)),
      secondaryValue: `Units YoY ${formatChangeLabel(percentFromRatio(current?.unitsYoY))}`,
      change: "Summary sheet",
      isPositiveOutcome: true,
      icon: TrendingUp,
    },
  ]
}

function percentFromRatio(value: number | null | undefined) {
  if (value === null || value === undefined) return null
  return value * 100
}
