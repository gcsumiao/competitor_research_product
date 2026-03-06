"use client"

import { useMemo, useState } from "react"
import {
  BarChart3,
  Calendar,
  DollarSign,
  Lightbulb,
  Package,
  ShoppingCart,
  Upload,
  Users,
} from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { TopProducts } from "@/components/dashboard/top-products"
import { SalesMap } from "@/components/dashboard/sales-map"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData, SnapshotSummary, TypeBreakdownMetric } from "@/lib/competitor-data"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { cn } from "@/lib/utils"
import {
  formatSnapshotDateFull,
  formatSnapshotLabelMonthEnd,
  getSnapshotMonthRange,
} from "@/lib/snapshot-date"
import {
  buildRange,
  formatChangeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatDeltaLabel,
  formatNumberCompact,
  formatPercent,
  formatSigned,
  percentChange,
  pointChange,
  truncateLabel,
} from "@/lib/dashboard-format"

const PRICE_TIER_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316", "#14b8a6", "#f97316"]
const INNOVA_BRAND = "innova"
const BLCKTEC_BRAND = "blcktec"

const DETAILED_PRICE_TIER_KEYS = new Set([
  "tablet_800_plus",
  "tablet_400_800",
  "tablet_under_400",
  "handheld_75_plus",
  "handheld_under_75",
  "total_dongle",
  "total_other_tools",
])

const CODE_READER_TOTAL_MARKET_OVERRIDE: Record<string, { revenue: number; units: number }> = {
  "2025-02": { revenue: 22940941, units: 203310 },
  "2025-03": { revenue: 24750554, units: 232565 },
  "2025-04": { revenue: 25065042, units: 240072 },
  "2025-05": { revenue: 26091258, units: 260811 },
  "2025-06": { revenue: 26311740, units: 257039 },
  "2025-07": { revenue: 30305871, units: 275178 },
  "2025-08": { revenue: 30170320, units: 290216 },
  "2025-09": { revenue: 30022425, units: 278892 },
  "2025-10": { revenue: 31389111, units: 283420 },
  "2025-11": { revenue: 32780117, units: 307632 },
  "2025-12": { revenue: 37456304, units: 352296 },
  "2026-01": { revenue: 29801239, units: 277103 },
}

type MetricCardView = {
  title: string
  value: string
  valueBadgeText?: string
  valueBadgeClassName?: string
  secondaryValue?: string
  change: string
  changeSuffix?: string
  isPositiveOutcome: boolean
  icon: typeof DollarSign
  valueClassName?: string
  secondaryValueClassName?: string
  changeClassName?: string
  showChange?: boolean
}

type DashboardEntryInsights = {
  pricingGap: string
  concentrationRisk: string
  specWhitespace: string
  entryAngles: string[]
}

export function DashboardClient({ data }: { data: DashboardData }) {
  const {
    categories,
    selectedCategory,
    selectedSnapshot,
    snapshots: sortedSnapshots,
    setCategory,
    setSnapshot,
  } = useDashboardFilters(data)

  const activeSnapshot = selectedSnapshot
  const activeIndex = sortedSnapshots.findIndex((snapshot) => snapshot.date === activeSnapshot?.date)
  const previousSnapshot = activeIndex > 0 ? sortedSnapshots[activeIndex - 1] : undefined
  const isCodeReader = selectedCategory?.id === "code_reader_scanner"

  const [priceScope, setPriceScope] = useState("all_asins")
  const [priceTierMetric, setPriceTierMetric] = useState<"revenue" | "units">("revenue")
  const [marketTrendMetric, setMarketTrendMetric] = useState<"units" | "revenue">("revenue")
  const [topAsinsMetric, setTopAsinsMetric] = useState<"units" | "revenue">("revenue")
  const selectedTimeRangeLabel = activeSnapshot ? formatSnapshotRangeLabel(activeSnapshot.date) : "n/a"

  const metricCards = buildMetricCards(
    activeSnapshot,
    previousSnapshot,
    sortedSnapshots,
    isCodeReader,
    selectedTimeRangeLabel
  )
  const entryInsights = !isCodeReader
    ? buildDashboardEntryInsights(activeSnapshot, previousSnapshot)
    : undefined

  const rollingMarketSeries = useMemo(
    () => (isCodeReader ? buildCodeReaderMarketSeries(activeSnapshot) : []),
    [activeSnapshot, isCodeReader]
  )

  const profitChartData = isCodeReader && rollingMarketSeries.length
    ? rollingMarketSeries.map((point) => ({
        label: point.label,
        sales: point.units,
        revenue: point.revenue,
      }))
    : sortedSnapshots.map((snapshot) => ({
        label: formatSnapshotLabelMonthEnd(snapshot.date),
        sales: snapshot.totals.units,
        revenue: snapshot.totals.revenue,
      }))

  const brandLeaders = useMemo(() => {
    if (!activeSnapshot) return []

    if (isCodeReader) {
      const targets = [INNOVA_BRAND, BLCKTEC_BRAND]
      return targets.map((target, index) => {
        const brand = activeSnapshot.brandTotals.find(
          (entry) => entry.brand.toLowerCase() === target
        )
        return {
          label: target === INNOVA_BRAND ? "Innova" : "BLCKTEC",
          value: formatPercent(brand?.share ?? 0, 1),
          sublabel: `${formatCurrencyCompact(brand?.revenue ?? 0)} revenue`,
          tone: index === 0 ? "green" as const : "orange" as const,
        }
      })
    }

    return (activeSnapshot.brandTotals ?? []).slice(0, 2).map((brand, index) => ({
      label: brand.brand,
      value: formatPercent(brand.share, 1),
      sublabel: `${formatCurrencyCompact(brand.revenue)} revenue`,
      tone: index === 0 ? "green" as const : "orange" as const,
    }))
  }, [activeSnapshot, isCodeReader])

  const currentRevenue = isCodeReader && rollingMarketSeries.length
    ? (rollingMarketSeries[rollingMarketSeries.length - 1]?.revenue ?? 0)
    : (activeSnapshot?.totals.revenue ?? 0)
  const previousRevenue = isCodeReader && rollingMarketSeries.length > 1
    ? rollingMarketSeries[rollingMarketSeries.length - 2]?.revenue
    : previousSnapshot?.totals.revenue
  const currentUnits = isCodeReader && rollingMarketSeries.length
    ? (rollingMarketSeries[rollingMarketSeries.length - 1]?.units ?? 0)
    : (activeSnapshot?.totals.units ?? 0)
  const previousUnits = isCodeReader && rollingMarketSeries.length > 1
    ? rollingMarketSeries[rollingMarketSeries.length - 2]?.units
    : previousSnapshot?.totals.units

  const marketTrendData = isCodeReader && rollingMarketSeries.length
    ? rollingMarketSeries.map((point) => ({
        label: point.label,
        value: marketTrendMetric === "units" ? point.units : point.revenue,
      }))
    : sortedSnapshots.map((snapshot) => ({
        label: formatSnapshotLabelMonthEnd(snapshot.date),
        value: marketTrendMetric === "units" ? snapshot.totals.units : snapshot.totals.revenue,
      }))

  const topAsinsSource = isCodeReader && topAsinsMetric === "units"
    ? (activeSnapshot?.top50ByUnits ?? activeSnapshot?.topProducts ?? [])
    : (activeSnapshot?.topProducts ?? [])

  const products = topAsinsSource.slice(0, 4).map((product) => ({
    asin: product.asin,
    name: truncateLabel(product.title, 36),
    brand: product.brand,
    priceLabel: product.price ? formatCurrency(product.price, 0) : "n/a",
    revenueLabel:
      isCodeReader && topAsinsMetric === "units"
        ? formatNumberCompact(product.units)
        : formatCurrencyCompact(product.revenue),
    image: product.imageUrl,
    url: product.url,
  }))

  const priceScopeOptions = buildPriceScopeOptions(activeSnapshot)
  const resolvedPriceScope = priceScopeOptions.some((option) => option.value === priceScope)
    ? priceScope
    : (priceScopeOptions[0]?.value ?? "all_asins")

  const currentPriceTierRows = buildPriceTierItems(activeSnapshot, resolvedPriceScope)
  const scopeMetric = findPriceScopeMetric(activeSnapshot, resolvedPriceScope, currentPriceTierRows)

  const priceTiers = currentPriceTierRows.map((tier, index) => ({
    label: tier.label,
    value: priceTierMetric === "revenue" ? tier.revenue : tier.units,
    color: PRICE_TIER_COLORS[index % PRICE_TIER_COLORS.length],
    revenueShare: tier.revenueShare,
    unitsShare: tier.unitsShare,
  }))

  const topTier = [...priceTiers].sort((a, b) => b.value - a.value)[0]
  const scopeTotalRevenue = scopeMetric?.revenue
    ?? currentPriceTierRows.reduce((sum, row) => sum + row.revenue, 0)
  const scopeTotalUnits = scopeMetric?.units
    ?? currentPriceTierRows.reduce((sum, row) => sum + row.units, 0)
  const scopeMoM = ratioToPercent(
    priceTierMetric === "revenue" ? scopeMetric?.revenueMoM : scopeMetric?.unitsMoM
  )
  const scopeYoY = ratioToPercent(
    priceTierMetric === "revenue" ? scopeMetric?.revenueYoY : scopeMetric?.unitsYoY
  )

  const issueCount = (activeSnapshot?.qualityIssues ?? []).length
  const rangeFragment = !isCodeReader && activeSnapshot
    ? ` | Selected range ${selectedTimeRangeLabel}`
    : ""
  const headerDescription = activeSnapshot
    ? `Snapshot ${formatSnapshotDateFull(activeSnapshot.date)}${rangeFragment} | ${activeSnapshot.totals.asinCount} ASINs tracked${issueCount ? ` | ${issueCount} data warning${issueCount > 1 ? "s" : ""}` : ""}`
    : "No snapshot data available"

  const totalRevenueValue = formatCurrencyCompact(currentRevenue)
  const revenueChange = typeof previousRevenue === "number"
    ? percentChange(currentRevenue, previousRevenue)
    : null

  const unitsChange = typeof previousUnits === "number"
    ? percentChange(currentUnits, previousUnits)
    : null

  const marketTrendTotalLabel = marketTrendMetric === "units" ? "Total units" : "Total revenue"
  const marketTrendTotalValue =
    marketTrendMetric === "units"
      ? formatNumberCompact(currentUnits)
      : formatCurrencyCompact(currentRevenue)
  const marketTrendChange = marketTrendMetric === "units" ? unitsChange : revenueChange
  const marketTrendDeltaLabel =
    marketTrendMetric === "units"
      ? formatDeltaLabel(currentUnits, previousUnits)
      : formatCurrencyDeltaCompact(currentRevenue, previousRevenue)

  return (
    <>
      <PageHeader
        title="Competitor Market Dashboard"
        description={headerDescription}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2 bg-transparent text-sm"
            )}
          >
            <BarChart3 className="w-4 h-4" />
            {selectedCategory?.label ?? "Select category"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem
                key={category.id}
                onClick={() => {
                  setCategory(category.id)
                }}
              >
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
            {sortedSnapshots.map((snapshot) => (
              <DropdownMenuItem
                key={snapshot.date}
                onClick={() => setSnapshot(snapshot.date)}
              >
                {formatSnapshotDateFull(snapshot.date)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" className="flex items-center gap-2 bg-transparent">
          <Upload className="w-4 h-4" />
          Export Report
        </Button>
      </PageHeader>

      {isCodeReader ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {metricCards.map((metric) => (
            <MetricCard
              key={metric.title}
              title={metric.title}
              value={metric.value}
              valueBadgeText={metric.valueBadgeText}
              valueBadgeClassName={metric.valueBadgeClassName}
              secondaryValue={metric.secondaryValue}
              change={metric.change}
              changeSuffix={metric.changeSuffix}
              isPositiveOutcome={metric.isPositiveOutcome}
              icon={metric.icon}
              valueClassName={metric.valueClassName}
              secondaryValueClassName={metric.secondaryValueClassName}
              changeClassName={metric.changeClassName}
              showChange={metric.showChange}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mb-6">
          <div className="xl:col-span-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {metricCards.map((metric) => (
              <MetricCard
                key={metric.title}
                title={metric.title}
                value={metric.value}
                valueBadgeText={metric.valueBadgeText}
                valueBadgeClassName={metric.valueBadgeClassName}
                secondaryValue={metric.secondaryValue}
                change={metric.change}
                changeSuffix={metric.changeSuffix}
                isPositiveOutcome={metric.isPositiveOutcome}
                icon={metric.icon}
                valueClassName={metric.valueClassName}
                secondaryValueClassName={metric.secondaryValueClassName}
                changeClassName={metric.changeClassName}
                showChange={metric.showChange}
              />
            ))}
          </div>
          <div className="xl:col-span-4">
            <EntryInsightsCard insights={entryInsights} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <ProfitChart
            data={profitChartData}
            totalLabel="Market overview"
            totalValue={totalRevenueValue}
            changeLabel={formatChangeLabel(revenueChange)}
            highlightIndex={
              isCodeReader && rollingMarketSeries.length
                ? rollingMarketSeries.length - 1
                : (activeIndex >= 0 ? activeIndex : undefined)
            }
            leaders={brandLeaders}
          />
        </div>
        <div>
          {isCodeReader ? (
            <TopProducts
              products={products}
              title="Top ASINs"
              subtitle={
                topAsinsMetric === "units"
                  ? "Units leaders in selected month"
                  : "Revenue leaders in selected month"
              }
              headerRight={
                <div className="flex items-center rounded-full border border-border bg-background/40 p-0.5">
                  <button
                    type="button"
                    onClick={() => setTopAsinsMetric("revenue")}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
                      topAsinsMetric === "revenue"
                        ? "bg-[var(--color-accent)] text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Revenue
                  </button>
                  <button
                    type="button"
                    onClick={() => setTopAsinsMetric("units")}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
                      topAsinsMetric === "units"
                        ? "bg-[var(--color-accent)] text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Units
                  </button>
                </div>
              }
            />
          ) : (
          <TopProducts
            products={products}
            title="Top ASINs"
            subtitle="Revenue leaders in selected snapshot"
          />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="h-full">
          <CustomerOrders
            title="Market trend"
            subtitle={
              isCodeReader
                ? (marketTrendMetric === "units"
                    ? "Units trend from Rolling 12 mo Total Market row"
                    : "Revenue trend from Rolling 12 mo Total Market row")
                : (marketTrendMetric === "units"
                    ? "Units trend across snapshots"
                    : "Revenue trend across snapshots")
            }
            totalLabel={marketTrendTotalLabel}
            totalValue={marketTrendTotalValue}
            changeLabel={formatChangeLabel(marketTrendChange)}
            changeValueLabel={marketTrendDeltaLabel}
            data={marketTrendData}
            headerRight={
              <div className="flex items-center rounded-full border border-border bg-background/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setMarketTrendMetric("revenue")}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
                    marketTrendMetric === "revenue"
                      ? "bg-[var(--color-accent)] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Revenue
                </button>
                <button
                  type="button"
                  onClick={() => setMarketTrendMetric("units")}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
                    marketTrendMetric === "units"
                      ? "bg-[var(--color-accent)] text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Units
                </button>
              </div>
            }
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <SalesMap
            title={priceTierMetric === "revenue" ? "Price tier mix" : "Units tier mix"}
            subtitle={priceTierMetric === "revenue"
              ? "Revenue share by selected scope"
              : "Units share by selected scope"}
            items={priceTiers}
            topLabel={topTier?.label ?? "n/a"}
            topValue={priceTierMetric === "revenue"
              ? formatCurrencyCompact(topTier?.value ?? 0)
              : formatNumberCompact(topTier?.value ?? 0)}
            growthLabel="Scope momentum"
            growthValue={formatChangeLabel(scopeMoM)}
            growthSubLabel="MoM change"
            growthSecondaryValue={formatChangeLabel(scopeYoY)}
            growthSecondaryLabel="YoY change"
            growthValueClassName={metricDeltaClassName(scopeMoM)}
            growthSecondaryValueClassName={metricDeltaClassName(scopeYoY)}
            totalLabel={priceTierMetric === "revenue" ? "Total revenue" : "Total units"}
            totalValue={priceTierMetric === "revenue"
              ? formatCurrencyCompact(scopeTotalRevenue)
              : formatNumberCompact(scopeTotalUnits)}
            valueFormatter={(value) =>
              priceTierMetric === "revenue"
                ? formatCurrencyCompact(value)
                : formatNumberCompact(value)
            }
            toggleControl={isCodeReader ? {
              value: priceTierMetric,
              onChange: (value) => setPriceTierMetric(value as "revenue" | "units"),
              options: [
                { value: "revenue", label: "Revenue" },
                { value: "units", label: "Units" },
              ],
            } : undefined}
            primaryControl={{
              value: resolvedPriceScope,
              onChange: setPriceScope,
              options: priceScopeOptions,
            }}
          />
        </div>
      </div>
    </>
  )
}

function EntryInsightsCard({ insights }: { insights: DashboardEntryInsights | undefined }) {
  if (!insights) return null

  return (
    <Card className="bg-card border border-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Lightbulb className="w-4 h-4" />
          Entry Insights
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <InsightRow label="Pricing Gap" value={insights.pricingGap} />
        <InsightRow label="Concentration Risk" value={insights.concentrationRisk} />
        <InsightRow label="Spec Whitespace" value={insights.specWhitespace} />
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Entry Angles</p>
          <ul className="text-xs space-y-1">
            {insights.entryAngles.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

function InsightRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground mb-1">{label}</p>
      <p className="text-xs">{value}</p>
    </div>
  )
}

function formatCurrencyDeltaCompact(current: number, previous?: number) {
  if (typeof previous !== "number" || !Number.isFinite(previous)) return ""
  const delta = current - previous
  const label = formatCurrencyCompact(Math.abs(delta))
  return `${delta >= 0 ? "+" : "-"}${label}`
}

function buildMetricCards(
  current: SnapshotSummary | undefined,
  previous: SnapshotSummary | undefined,
  snapshots: SnapshotSummary[],
  isCodeReader: boolean,
  selectedTimeRangeLabel: string
): MetricCardView[] {
  if (!current) {
    return []
  }

  const revenueChange = previous
    ? percentChange(current.totals.revenue, previous.totals.revenue)
    : null
  const unitsChange = previous
    ? percentChange(current.totals.units, previous.totals.units)
    : null

  if (isCodeReader) {
    const innovaCurrentRevenue = findRollingRank(current, "revenue", INNOVA_BRAND)
    const innovaCurrentUnits = findRollingRank(current, "units", INNOVA_BRAND)
    const blcktecCurrentRevenue = findRollingRank(current, "revenue", BLCKTEC_BRAND)
    const blcktecCurrentUnits = findRollingRank(current, "units", BLCKTEC_BRAND)

    const innovaPreviousRevenue = findRollingRank(previous, "revenue", INNOVA_BRAND)
    const innovaPreviousUnits = findRollingRank(previous, "units", INNOVA_BRAND)
    const blcktecPreviousRevenue = findRollingRank(previous, "revenue", BLCKTEC_BRAND)
    const blcktecPreviousUnits = findRollingRank(previous, "units", BLCKTEC_BRAND)

    const innovaRevenueDelta = rankDelta(innovaCurrentRevenue?.rank, innovaPreviousRevenue?.rank)
    const innovaUnitsDelta = rankDelta(innovaCurrentUnits?.rank, innovaPreviousUnits?.rank)
    const blcktecRevenueDelta = rankDelta(blcktecCurrentRevenue?.rank, blcktecPreviousRevenue?.rank)
    const blcktecUnitsDelta = rankDelta(blcktecCurrentUnits?.rank, blcktecPreviousUnits?.rank)
    const innovaRevenueMoM = metricMoM(innovaCurrentRevenue?.monthly, innovaPreviousRevenue?.monthly)
    const innovaUnitsMoM = metricMoM(innovaCurrentUnits?.monthly, innovaPreviousUnits?.monthly)
    const blcktecRevenueMoM = metricMoM(blcktecCurrentRevenue?.monthly, blcktecPreviousRevenue?.monthly)
    const blcktecUnitsMoM = metricMoM(blcktecCurrentUnits?.monthly, blcktecPreviousUnits?.monthly)
    const innovaRevenueMove = rankMovementBadge(innovaRevenueDelta)
    const innovaUnitsMove = rankMovementBadge(innovaUnitsDelta)
    const blcktecRevenueMove = rankMovementBadge(blcktecRevenueDelta)
    const blcktecUnitsMove = rankMovementBadge(blcktecUnitsDelta)

    return [
      {
        title: "Innova Rolling 12 Rev Rank",
        value: rankLabel(innovaCurrentRevenue?.rank),
        valueBadgeText: innovaRevenueMove.label,
        valueBadgeClassName: innovaRevenueMove.className,
        secondaryValue: `Revenue ${formatCurrencyCompact(innovaCurrentRevenue?.monthly ?? 0)}`,
        change: `Rev ${formatChangeLabel(innovaRevenueMoM)} MoM`,
        changeClassName: metricDeltaClassName(innovaRevenueMoM),
        isPositiveOutcome: (innovaRevenueMoM ?? 0) >= 0,
        icon: DollarSign,
      },
      {
        title: "Innova Rolling 12 Units Rank",
        value: rankLabel(innovaCurrentUnits?.rank),
        valueBadgeText: innovaUnitsMove.label,
        valueBadgeClassName: innovaUnitsMove.className,
        secondaryValue: `Units ${formatNumberCompact(innovaCurrentUnits?.monthly ?? 0)}`,
        change: `Units ${formatChangeLabel(innovaUnitsMoM)} MoM`,
        changeClassName: metricDeltaClassName(innovaUnitsMoM),
        isPositiveOutcome: (innovaUnitsMoM ?? 0) >= 0,
        icon: Package,
      },
      {
        title: "BLCKTEC Rolling 12 Rev Rank",
        value: rankLabel(blcktecCurrentRevenue?.rank),
        valueBadgeText: blcktecRevenueMove.label,
        valueBadgeClassName: blcktecRevenueMove.className,
        secondaryValue: `Revenue ${formatCurrencyCompact(blcktecCurrentRevenue?.monthly ?? 0)}`,
        change: `Rev ${formatChangeLabel(blcktecRevenueMoM)} MoM`,
        changeClassName: metricDeltaClassName(blcktecRevenueMoM),
        isPositiveOutcome: (blcktecRevenueMoM ?? 0) >= 0,
        icon: DollarSign,
      },
      {
        title: "BLCKTEC Rolling 12 Units Rank",
        value: rankLabel(blcktecCurrentUnits?.rank),
        valueBadgeText: blcktecUnitsMove.label,
        valueBadgeClassName: blcktecUnitsMove.className,
        secondaryValue: `Units ${formatNumberCompact(blcktecCurrentUnits?.monthly ?? 0)}`,
        change: `Units ${formatChangeLabel(blcktecUnitsMoM)} MoM`,
        changeClassName: metricDeltaClassName(blcktecUnitsMoM),
        isPositiveOutcome: (blcktecUnitsMoM ?? 0) >= 0,
        icon: Package,
      },
    ]
  }

  const revenueRange = buildRange(snapshots.map((snapshot) => snapshot.totals.revenue))
  const unitsRange = buildRange(snapshots.map((snapshot) => snapshot.totals.units))

  const concentrationChange = previous
    ? pointChange(current.totals.top3Share, previous.totals.top3Share)
    : null
  const competitorChange = previous
    ? current.totals.meaningfulCompetitors - previous.totals.meaningfulCompetitors
    : null

  return [
    {
      title: "Market Monthly Revenue",
      value: formatCurrencyCompact(current.totals.revenue),
      secondaryValue: `Selected range ${selectedTimeRangeLabel}`,
      change: formatChangeLabel(revenueChange),
      changeSuffix: revenueChange === null ? "" : "MoM",
      isPositiveOutcome: (revenueChange ?? 0) >= 0,
      icon: DollarSign,
    },
    {
      title: "Market Monthly Units",
      value: formatNumberCompact(current.totals.units),
      secondaryValue: `Selected range ${selectedTimeRangeLabel}`,
      change: formatChangeLabel(unitsChange),
      changeSuffix: unitsChange === null ? "" : "MoM",
      isPositiveOutcome: (unitsChange ?? 0) >= 0,
      icon: ShoppingCart,
    },
    {
      title: "Est 12M Revenue",
      value: `${formatCurrencyCompact(revenueRange.min * 12)} - ${formatCurrencyCompact(revenueRange.max * 12)}`,
      change: `Median ${formatCurrencyCompact(revenueRange.median * 12)}`,
      isPositiveOutcome: true,
      icon: BarChart3,
    },
    {
      title: "Est 12M Units",
      value: `${formatNumberCompact(unitsRange.min * 12)} - ${formatNumberCompact(unitsRange.max * 12)}`,
      change: `Median ${formatNumberCompact(unitsRange.median * 12)}`,
      isPositiveOutcome: true,
      icon: Package,
    },
    {
      title: "Market Concentration",
      value: `Top 3 = ${formatPercent(current.totals.top3Share, 1)}`,
      change: concentrationChange === null ? "n/a" : `${formatSigned(concentrationChange, 1)}pt`,
      isPositiveOutcome: (concentrationChange ?? 0) <= 0,
      icon: Users,
    },
    {
      title: "Meaningful Competitors",
      value: `${current.totals.meaningfulCompetitors} brands`,
      change: competitorChange === null ? "n/a" : formatSigned(competitorChange, 0),
      changeSuffix: competitorChange === null ? "" : "brands",
      isPositiveOutcome: (competitorChange ?? 0) >= 0,
      icon: BarChart3,
    },
  ]
}

type CodeReaderMarketPoint = {
  label: string
  revenue: number
  units: number
}

function buildCodeReaderMarketSeries(
  snapshot: SnapshotSummary | undefined
): CodeReaderMarketPoint[] {
  const revenueSeries = snapshot?.rolling12?.revenue?.marketSeries ?? []
  const unitsSeries = snapshot?.rolling12?.units?.marketSeries ?? []
  const seriesLength = Math.max(revenueSeries.length, unitsSeries.length)
  if (!snapshot || !seriesLength) return []

  const snapshotDate = new Date(`${snapshot.date}T00:00:00Z`)
  if (Number.isNaN(snapshotDate.getTime())) return []

  const baseYear = snapshotDate.getUTCFullYear()
  const baseMonth = snapshotDate.getUTCMonth()

  return Array.from({ length: seriesLength }, (_, index) => {
    const offset = index - (seriesLength - 1)
    const monthDate = new Date(Date.UTC(baseYear, baseMonth + offset, 1))
    const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`
    const monthDateKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}-01`
    const override = CODE_READER_TOTAL_MARKET_OVERRIDE[monthKey]
    return {
      label: formatSnapshotLabelMonthEnd(monthDateKey),
      revenue: override?.revenue ?? (revenueSeries[index] ?? 0),
      units: override?.units ?? (unitsSeries[index] ?? 0),
    }
  })
}

function rankLabel(rank: number | undefined) {
  if (!rank || rank <= 0) return "#-"
  return `#${rank}`
}

function rankDelta(currentRank: number | undefined, previousRank: number | undefined) {
  if (!currentRank || !previousRank) return null
  return previousRank - currentRank
}

function rankMovementBadge(delta: number | null) {
  if (delta === null) {
    return {
      label: "No prev",
      className: "border-border bg-muted/40 text-muted-foreground",
    }
  }
  if (delta > 0) {
    return {
      label: `+${delta}`,
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    }
  }
  if (delta < 0) {
    return {
      label: `${delta}`,
      className: "border-red-200 bg-red-50 text-red-700",
    }
  }
  return {
    label: "0",
    className: "border-slate-300 bg-slate-100 text-foreground",
  }
}

function metricDeltaClassName(delta: number | null) {
  if (delta === null) return "text-muted-foreground"
  if (delta > 0) return "text-[var(--color-positive)]"
  if (delta < 0) return "text-[var(--color-negative)]"
  return "text-foreground"
}

function metricMoM(currentValue: number | undefined, previousValue: number | undefined) {
  if (typeof currentValue !== "number" || typeof previousValue !== "number") return null
  return percentChange(currentValue, previousValue)
}

function findRollingRank(
  snapshot: SnapshotSummary | undefined,
  metric: "revenue" | "units",
  brandKey: string
) {
  const brands = metric === "revenue"
    ? snapshot?.rolling12?.revenue?.brands
    : snapshot?.rolling12?.units?.brands

  if (!brands?.length) return undefined
  return brands.find((brand) => brand.brand.toLowerCase() === brandKey)
}

function buildPriceScopeOptions(snapshot: SnapshotSummary | undefined) {
  if (!snapshot?.typeBreakdowns?.allAsins.length) {
    return [{ value: "all_asins", label: "All ASINs" }]
  }

  const keys = new Set(snapshot.typeBreakdowns.allAsins.map((item) => item.scopeKey))
  const options = [{ value: "all_asins", label: "All ASINs" }]

  if (keys.has("total_tablet")) options.push({ value: "total_tablet", label: "Total Tablet" })
  if (keys.has("total_handheld")) options.push({ value: "total_handheld", label: "Total Handheld" })
  if (keys.has("total_dongle")) options.push({ value: "total_dongle", label: "Total Dongle" })
  if (keys.has("total_other_tools")) {
    options.push({ value: "total_other_tools", label: "Total Other Tools" })
  }

  return options
}

type PriceTierItem = {
  scopeKey: string
  label: string
  units: number
  unitsShare: number
  unitsMoM: number | null
  unitsYoY: number | null
  revenue: number
  revenueShare: number
  revenueMoM: number | null
  revenueYoY: number | null
}

function toPriceTierItem(metric: TypeBreakdownMetric): PriceTierItem {
  return {
    scopeKey: metric.scopeKey,
    label: metric.label,
    units: metric.units,
    unitsShare: metric.unitsShare,
    unitsMoM: metric.unitsMoM,
    unitsYoY: metric.unitsYoY,
    revenue: metric.revenue,
    revenueShare: metric.revenueShare,
    revenueMoM: metric.revenueMoM,
    revenueYoY: metric.revenueYoY,
  }
}

function buildPriceTierItems(snapshot: SnapshotSummary | undefined, scope: string) {
  if (!snapshot) return [] as PriceTierItem[]

  const metrics = snapshot.typeBreakdowns?.allAsins ?? []
  if (!metrics.length) {
    return snapshot.priceTiers.map((tier) => ({
      scopeKey: tier.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      label: tier.label,
      units: 0,
      unitsShare: 0,
      unitsMoM: null,
      unitsYoY: null,
      revenue: tier.revenue,
      revenueShare: tier.share,
      revenueMoM: null,
      revenueYoY: null,
    }))
  }

  if (scope === "all_asins") {
    const detailed = metrics.filter((metric) => DETAILED_PRICE_TIER_KEYS.has(metric.scopeKey))
    if (detailed.length) {
      return detailed.map(toPriceTierItem)
    }
  }

  if (scope === "total_tablet") {
    return metrics
      .filter((metric) => ["tablet_800_plus", "tablet_400_800", "tablet_under_400"].includes(metric.scopeKey))
      .map(toPriceTierItem)
  }

  if (scope === "total_handheld") {
    return metrics
      .filter((metric) => ["handheld_75_plus", "handheld_under_75"].includes(metric.scopeKey))
      .map(toPriceTierItem)
  }

  if (scope === "total_dongle") {
    return metrics
      .filter((metric) => metric.scopeKey === "total_dongle")
      .map(toPriceTierItem)
  }

  if (scope === "total_other_tools") {
    return metrics
      .filter((metric) => metric.scopeKey === "total_other_tools")
      .map(toPriceTierItem)
  }

  return snapshot.priceTiers.map((tier) => ({
    scopeKey: tier.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    label: tier.label,
    units: 0,
    unitsShare: 0,
    unitsMoM: null,
    unitsYoY: null,
    revenue: tier.revenue,
    revenueShare: tier.share,
    revenueMoM: null,
    revenueYoY: null,
  }))
}

function findPriceScopeMetric(
  snapshot: SnapshotSummary | undefined,
  scope: string,
  scopedRows: PriceTierItem[]
) {
  const rows = snapshot?.typeBreakdowns?.allAsins ?? []
  if (!rows.length) return undefined
  if (scope === "all_asins") {
    return rows.find((row) => row.scopeKey === "total")
      ?? rows.find((row) => row.scopeKey === "all_asins")
      ?? undefined
  }
  return rows.find((row) => row.scopeKey === scope)
    ?? (scopedRows.length === 1
      ? rows.find((row) => row.scopeKey === scopedRows[0].scopeKey)
      : undefined)
}

function ratioToPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value * 100
}

function formatSnapshotRangeLabel(snapshotDate: string) {
  const range = getSnapshotMonthRange(snapshotDate)
  return `${range.start} to ${range.end}`
}

function buildDashboardEntryInsights(
  current: SnapshotSummary | undefined,
  previous: SnapshotSummary | undefined
): DashboardEntryInsights {
  if (!current) {
    return {
      pricingGap: "No snapshot selected yet.",
      concentrationRisk: "No snapshot selected yet.",
      specWhitespace: "No snapshot selected yet.",
      entryAngles: ["Select a snapshot to generate entry suggestions."],
    }
  }

  const pricingGap = buildPricingGapInsight(current)
  const concentrationRisk = buildConcentrationInsight(current, previous)
  const specWhitespace = buildWhitespaceInsight(current)
  const entryAngles = buildEntryAngleInsights(current)

  return {
    pricingGap,
    concentrationRisk,
    specWhitespace,
    entryAngles,
  }
}

function buildPricingGapInsight(snapshot: SnapshotSummary) {
  const products = snapshot.topProducts ?? []
  if (!products.length) {
    return "No product-level pricing evidence available."
  }

  const bands = [
    { label: "<$100", min: 0, max: 100 },
    { label: "$100-$200", min: 100, max: 200 },
    { label: "$200-$400", min: 200, max: 400 },
    { label: "$400+", min: 400, max: Number.POSITIVE_INFINITY },
  ]

  const totals = bands.map((band) => {
    const inBand = products.filter((product) => product.price >= band.min && product.price < band.max)
    const revenue = inBand.reduce((sum, product) => sum + product.revenue, 0)
    return { label: band.label, count: inBand.length, revenue }
  })

  const totalCount = totals.reduce((sum, item) => sum + item.count, 0) || 1
  const totalRevenue = totals.reduce((sum, item) => sum + item.revenue, 0) || 1
  const strongestGap = totals
    .map((item) => ({
      ...item,
      countShare: item.count / totalCount,
      revenueShare: item.revenue / totalRevenue,
      gap: item.revenue / totalRevenue - item.count / totalCount,
    }))
    .sort((a, b) => b.gap - a.gap)[0]

  if (strongestGap && strongestGap.revenueShare >= 0.12 && strongestGap.gap >= 0.08) {
    return `${strongestGap.label} over-indexes on revenue with fewer listings; this is the main pricing gap.`
  }

  return "Price bands are balanced; differentiation should focus on specs and bundle value."
}

function buildConcentrationInsight(
  current: SnapshotSummary,
  previous: SnapshotSummary | undefined
) {
  const top3 = current.totals.top3Share
  const top3Delta = previous ? pointChange(top3, previous.totals.top3Share) : null
  const direction = top3Delta === null ? "" : ` (${formatSigned(top3Delta, 1)}pt vs prior snapshot)`

  if (top3 >= 0.8) {
    return `High concentration: top 3 brands control ${formatPercent(top3, 1)}${direction}. Entry is difficult without sharp differentiation.`
  }
  if (top3 >= 0.65) {
    return `Moderate concentration: top 3 brands control ${formatPercent(top3, 1)}${direction}. Entry is viable with targeted positioning.`
  }
  return `Low concentration: top 3 brands control ${formatPercent(top3, 1)}${direction}. Market remains open for new entrants.`
}

function buildWhitespaceInsight(snapshot: SnapshotSummary) {
  const typeRows = (snapshot.typeBreakdowns?.allAsins ?? [])
    .filter((row) => {
      const scope = row.scopeKey.toLowerCase()
      return !scope.startsWith("total") && scope !== "all_asins" && scope !== "total"
    })
    .sort((a, b) => b.revenueShare - a.revenueShare)

  const whitespaceCandidate = typeRows.find(
    (row) => row.revenueShare >= 0.06 && row.unitsShare > 0 && row.unitsShare <= row.revenueShare * 0.75
  )

  if (whitespaceCandidate) {
    return `${whitespaceCandidate.label} shows whitespace: ${formatPercent(whitespaceCandidate.revenueShare, 1)} revenue share with lower unit share ${formatPercent(whitespaceCandidate.unitsShare, 1)}.`
  }

  return "No clear whitespace bucket in current type rows; test differentiation inside top segments."
}

function buildEntryAngleInsights(snapshot: SnapshotSummary) {
  const angles: string[] = []
  const topBrand = snapshot.brandTotals[0]
  const secondBrand = snapshot.brandTotals[1]
  const avgTopPrice = averagePrice(snapshot.topProducts)

  if (topBrand) {
    angles.push(
      `Position against ${topBrand.brand} (${formatPercent(topBrand.share, 1)} share) with focused SKU messaging.`
    )
  }
  if (secondBrand) {
    angles.push(`Use ${secondBrand.brand} price/spec bands as the secondary benchmark lane.`)
  }
  if (avgTopPrice > 0) {
    angles.push(`Target launch MSRP near ${formatCurrency(avgTopPrice, 0)} with differentiated features.`)
  }
  return angles.slice(0, 3)
}

function averagePrice(products: SnapshotSummary["topProducts"]) {
  const prices = products.filter((product) => product.price > 0).map((product) => product.price)
  if (!prices.length) return 0
  return prices.reduce((sum, value) => sum + value, 0) / prices.length
}
