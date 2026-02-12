"use client"

import { useMemo, useState } from "react"
import {
  BarChart3,
  Calendar,
  DollarSign,
  Package,
  ShoppingCart,
  TrendingUp,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData, SnapshotSummary } from "@/lib/competitor-data"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { cn } from "@/lib/utils"
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

type MetricCardView = {
  title: string
  value: string
  secondaryValue?: string
  change: string
  changeSuffix?: string
  isPositiveOutcome: boolean
  icon: typeof DollarSign
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

  const metricCards = buildMetricCards(
    activeSnapshot,
    previousSnapshot,
    sortedSnapshots,
    isCodeReader
  )

  const profitChartData = sortedSnapshots.map((snapshot) => ({
    label: snapshot.label,
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

  const unitTrendData = sortedSnapshots.map((snapshot) => ({
    label: snapshot.label,
    value: snapshot.totals.units,
  }))

  const products = (activeSnapshot?.topProducts ?? []).slice(0, 4).map((product) => ({
    name: truncateLabel(product.title, 36),
    brand: product.brand,
    priceLabel: product.price ? formatCurrency(product.price, 0) : "n/a",
    revenueLabel: formatCurrencyCompact(product.revenue),
    image: product.imageUrl,
    url: product.url,
  }))

  const priceScopeOptions = buildPriceScopeOptions(activeSnapshot)
  const resolvedPriceScope = priceScopeOptions.some((option) => option.value === priceScope)
    ? priceScope
    : (priceScopeOptions[0]?.value ?? "all_asins")

  const priceTiers = buildPriceTierItems(activeSnapshot, resolvedPriceScope).map((tier, index) => ({
    label: tier.label,
    value: tier.revenue,
    color: PRICE_TIER_COLORS[index % PRICE_TIER_COLORS.length],
  }))

  const topTier = [...priceTiers].sort((a, b) => b.value - a.value)[0]
  const tierGrowth = previousSnapshot
    ? computeTierGrowth(activeSnapshot, previousSnapshot, topTier?.label, resolvedPriceScope)
    : null

  const issueCount = (activeSnapshot?.qualityIssues ?? []).length
  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | ${activeSnapshot.totals.asinCount} ASINs tracked${issueCount ? ` | ${issueCount} data warning${issueCount > 1 ? "s" : ""}` : ""}`
    : "No snapshot data available"

  const totalRevenueValue = formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0)
  const revenueChange = previousSnapshot
    ? percentChange(activeSnapshot?.totals.revenue ?? 0, previousSnapshot.totals.revenue)
    : null

  const unitsChange = previousSnapshot
    ? percentChange(activeSnapshot?.totals.units ?? 0, previousSnapshot.totals.units)
    : null

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
            {activeSnapshot?.date ?? "Snapshot"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {sortedSnapshots.map((snapshot) => (
              <DropdownMenuItem
                key={snapshot.date}
                onClick={() => setSnapshot(snapshot.date)}
              >
                {snapshot.date}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" className="flex items-center gap-2 bg-transparent">
          <Upload className="w-4 h-4" />
          Export Report
        </Button>
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
            data={profitChartData}
            totalLabel="Market overview"
            totalValue={totalRevenueValue}
            changeLabel={formatChangeLabel(revenueChange)}
            highlightIndex={activeIndex >= 0 ? activeIndex : undefined}
            leaders={brandLeaders}
          />
        </div>
        <div>
          <TopProducts
            products={products}
            title="Top ASINs"
            subtitle="Revenue leaders in selected snapshot"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="h-full">
          <CustomerOrders
            title="Market Units"
            subtitle="Units trend across snapshots"
            totalLabel="Total units"
            totalValue={formatNumberCompact(activeSnapshot?.totals.units ?? 0)}
            changeLabel={formatChangeLabel(unitsChange)}
            changeValueLabel={formatDeltaLabel(activeSnapshot?.totals.units ?? 0, previousSnapshot?.totals.units)}
            data={unitTrendData}
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <SalesMap
            title="Price tier mix"
            subtitle="Revenue share by selected scope"
            items={priceTiers}
            topLabel={topTier?.label ?? "n/a"}
            topValue={formatCurrencyCompact(topTier?.value ?? 0)}
            growthLabel="Tier momentum"
            growthValue={formatChangeLabel(tierGrowth)}
            totalLabel="Total revenue"
            totalValue={formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0)}
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

function buildMetricCards(
  current: SnapshotSummary | undefined,
  previous: SnapshotSummary | undefined,
  snapshots: SnapshotSummary[],
  isCodeReader: boolean
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

    return [
      {
        title: "Innova Rolling 12 Rank",
        value: rankLabel(innovaCurrentRevenue?.rank),
        secondaryValue: `Units ${formatNumberCompact(innovaCurrentUnits?.grandTotal ?? 0)} · Rank ${rankLabel(innovaCurrentUnits?.rank)}`,
        change: formatChangeLabel(revenueChange),
        changeSuffix: previous ? "MoM" : "",
        isPositiveOutcome: (revenueChange ?? 0) >= 0,
        icon: TrendingUp,
      },
      {
        title: "BLCKTEC Rolling 12 Rank",
        value: rankLabel(blcktecCurrentRevenue?.rank),
        secondaryValue: `Units ${formatNumberCompact(blcktecCurrentUnits?.grandTotal ?? 0)} · Rank ${rankLabel(blcktecCurrentUnits?.rank)}`,
        change: formatChangeLabel(unitsChange),
        changeSuffix: previous ? "MoM" : "",
        isPositiveOutcome: (unitsChange ?? 0) >= 0,
        icon: TrendingUp,
      },
      {
        title: "Innova Ranking Move",
        value: `Rev ${rankMovementLabel(innovaRevenueDelta)}`,
        secondaryValue: `Units ${rankMovementLabel(innovaUnitsDelta)}`,
        change: innovaRevenueDelta === null ? "n/a" : `${formatSigned(innovaRevenueDelta, 0)} rank`,
        isPositiveOutcome: (innovaRevenueDelta ?? 0) >= 0,
        icon: Users,
      },
      {
        title: "BLCKTEC Ranking Move",
        value: `Rev ${rankMovementLabel(blcktecRevenueDelta)}`,
        secondaryValue: `Units ${rankMovementLabel(blcktecUnitsDelta)}`,
        change: blcktecRevenueDelta === null ? "n/a" : `${formatSigned(blcktecRevenueDelta, 0)} rank`,
        isPositiveOutcome: (blcktecRevenueDelta ?? 0) >= 0,
        icon: Users,
      },
      {
        title: "Market 30D Revenue",
        value: formatCurrencyCompact(current.totals.revenue),
        change: formatChangeLabel(revenueChange),
        changeSuffix: previous ? "MoM" : "",
        isPositiveOutcome: (revenueChange ?? 0) >= 0,
        icon: DollarSign,
      },
      {
        title: "Market 30D Units",
        value: formatNumberCompact(current.totals.units),
        change: formatChangeLabel(unitsChange),
        changeSuffix: previous ? "MoM" : "",
        isPositiveOutcome: (unitsChange ?? 0) >= 0,
        icon: ShoppingCart,
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
      title: "Market 30D Revenue",
      value: formatCurrencyCompact(current.totals.revenue),
      change: formatChangeLabel(revenueChange),
      changeSuffix: revenueChange === null ? "" : "MoM",
      isPositiveOutcome: (revenueChange ?? 0) >= 0,
      icon: DollarSign,
    },
    {
      title: "Market 30D Units",
      value: formatNumberCompact(current.totals.units),
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

function rankLabel(rank: number | undefined) {
  if (!rank || rank <= 0) return "#-"
  return `#${rank}`
}

function rankDelta(currentRank: number | undefined, previousRank: number | undefined) {
  if (!currentRank || !previousRank) return null
  return previousRank - currentRank
}

function rankMovementLabel(delta: number | null) {
  if (delta === null) return "n/a"
  if (delta > 0) return `+${delta}`
  if (delta < 0) return `${delta}`
  return "0"
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

function buildPriceTierItems(snapshot: SnapshotSummary | undefined, scope: string) {
  if (!snapshot) return [] as Array<{ label: string; revenue: number; share: number }>

  const metrics = snapshot.typeBreakdowns?.allAsins ?? []
  if (!metrics.length) {
    return snapshot.priceTiers.map((tier) => ({
      label: tier.label,
      revenue: tier.revenue,
      share: tier.share,
    }))
  }

  if (scope === "all_asins") {
    const detailed = metrics.filter((metric) => DETAILED_PRICE_TIER_KEYS.has(metric.scopeKey))
    if (detailed.length) {
      return detailed.map((metric) => ({
        label: metric.label,
        revenue: metric.revenue,
        share: metric.revenueShare,
      }))
    }
  }

  if (scope === "total_tablet") {
    return metrics
      .filter((metric) => ["tablet_800_plus", "tablet_400_800", "tablet_under_400"].includes(metric.scopeKey))
      .map((metric) => ({
        label: metric.label,
        revenue: metric.revenue,
        share: metric.revenueShare,
      }))
  }

  if (scope === "total_handheld") {
    return metrics
      .filter((metric) => ["handheld_75_plus", "handheld_under_75"].includes(metric.scopeKey))
      .map((metric) => ({
        label: metric.label,
        revenue: metric.revenue,
        share: metric.revenueShare,
      }))
  }

  if (scope === "total_dongle") {
    return metrics
      .filter((metric) => metric.scopeKey === "total_dongle")
      .map((metric) => ({
        label: metric.label,
        revenue: metric.revenue,
        share: metric.revenueShare,
      }))
  }

  if (scope === "total_other_tools") {
    return metrics
      .filter((metric) => metric.scopeKey === "total_other_tools")
      .map((metric) => ({
        label: metric.label,
        revenue: metric.revenue,
        share: metric.revenueShare,
      }))
  }

  return snapshot.priceTiers.map((tier) => ({
    label: tier.label,
    revenue: tier.revenue,
    share: tier.share,
  }))
}

function computeTierGrowth(
  current: SnapshotSummary | undefined,
  previous: SnapshotSummary,
  label: string | undefined,
  scope: string
) {
  if (!current || !label) return null

  const currentTier = buildPriceTierItems(current, scope).find((tier) => tier.label === label)
  const previousTier = buildPriceTierItems(previous, scope).find((tier) => tier.label === label)

  if (!currentTier || !previousTier) return null
  return pointChange(currentTier.share, previousTier.share)
}
