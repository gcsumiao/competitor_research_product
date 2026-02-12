"use client"
import { BarChart3, Calendar, DollarSign, Package, ShoppingCart, Upload, Users } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { TopProducts } from "@/components/dashboard/top-products"
import { SalesMap } from "@/components/dashboard/sales-map"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData, SnapshotSummary } from "@/lib/competitor-data"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
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

const PRICE_TIER_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316"]

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

  const metricCards = buildMetricCards(activeSnapshot, previousSnapshot, sortedSnapshots)
  const profitChartData = sortedSnapshots.map((snapshot) => ({
    label: snapshot.label,
    sales: snapshot.totals.units,
    revenue: snapshot.totals.revenue,
  }))

  const brandLeaders = (activeSnapshot?.brandTotals ?? []).slice(0, 2).map((brand, index) => ({
    label: brand.brand,
    value: formatPercent(brand.share, 1),
    sublabel: `${formatCurrencyCompact(brand.revenue)} revenue`,
    tone: index === 0 ? "green" : "orange",
  }))

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

  const priceTiers = (activeSnapshot?.priceTiers ?? []).map((tier, index) => ({
    label: tier.label,
    value: tier.revenue,
    color: PRICE_TIER_COLORS[index % PRICE_TIER_COLORS.length],
  }))

  const topTier = [...priceTiers].sort((a, b) => b.value - a.value)[0]
  const tierGrowth = previousSnapshot
    ? computeTierGrowth(activeSnapshot, previousSnapshot, topTier?.label)
    : undefined

  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | ${activeSnapshot.totals.asinCount} ASINs tracked`
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
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <BarChart3 className="w-4 h-4" />
              {selectedCategory?.label ?? "Select category"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem
                key={category.id}
                onSelect={() => {
                  setCategory(category.id)
                }}
              >
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
            {sortedSnapshots.map((snapshot) => (
              <DropdownMenuItem
                key={snapshot.date}
                onSelect={() => setSnapshot(snapshot.date)}
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
            subtitle="Revenue share by price tier"
            items={priceTiers}
            topLabel={topTier?.label ?? "n/a"}
            topValue={formatCurrencyCompact(topTier?.value ?? 0)}
            growthLabel="Tier momentum"
            growthValue={formatChangeLabel(tierGrowth)}
            totalLabel="Total revenue"
            totalValue={formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0)}
          />
        </div>
      </div>
    </>
  )
}

function buildMetricCards(
  current: SnapshotSummary | undefined,
  previous: SnapshotSummary | undefined,
  snapshots: SnapshotSummary[]
) {
  const revenueChange = previous
    ? percentChange(current?.totals.revenue ?? 0, previous.totals.revenue)
    : null
  const unitsChange = previous
    ? percentChange(current?.totals.units ?? 0, previous.totals.units)
    : null

  const revenueRange = buildRange(snapshots.map((snapshot) => snapshot.totals.revenue))
  const unitsRange = buildRange(snapshots.map((snapshot) => snapshot.totals.units))

  const concentrationChange = previous
    ? pointChange(current?.totals.top3Share ?? 0, previous.totals.top3Share)
    : null
  const competitorChange = previous
    ? (current?.totals.meaningfulCompetitors ?? 0) - previous.totals.meaningfulCompetitors
    : null

  return [
    {
      title: "Market 30D Revenue",
      value: formatCurrencyCompact(current?.totals.revenue ?? 0),
      change: formatChangeLabel(revenueChange),
      changeSuffix: revenueChange === null ? "" : "MoM",
      isPositiveOutcome: (revenueChange ?? 0) >= 0,
      icon: DollarSign,
    },
    {
      title: "Market 30D Units",
      value: formatNumberCompact(current?.totals.units ?? 0),
      change: formatChangeLabel(unitsChange),
      changeSuffix: unitsChange === null ? "" : "MoM",
      isPositiveOutcome: (unitsChange ?? 0) >= 0,
      icon: ShoppingCart,
    },
    {
      title: "Est 12M Revenue",
      value: `${formatCurrencyCompact(revenueRange.min * 12)} - ${formatCurrencyCompact(revenueRange.max * 12)}`,
      change: `Median ${formatCurrencyCompact(revenueRange.median * 12)}`,
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: BarChart3,
    },
    {
      title: "Est 12M Units",
      value: `${formatNumberCompact(unitsRange.min * 12)} - ${formatNumberCompact(unitsRange.max * 12)}`,
      change: `Median ${formatNumberCompact(unitsRange.median * 12)}`,
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: Package,
    },
    {
      title: "Market Concentration",
      value: `Top 3 = ${formatPercent(current?.totals.top3Share ?? 0, 1)}`,
      change: concentrationChange === null ? "n/a" : `${formatSigned(concentrationChange, 1)}pt`,
      changeSuffix: "",
      isPositiveOutcome: (concentrationChange ?? 0) <= 0,
      icon: Users,
    },
    {
      title: "Meaningful Competitors",
      value: `${current?.totals.meaningfulCompetitors ?? 0} brands`,
      change: competitorChange === null ? "n/a" : formatSigned(competitorChange, 0),
      changeSuffix: competitorChange === null ? "" : "brands",
      isPositiveOutcome: (competitorChange ?? 0) >= 0,
      icon: BarChart3,
    },
  ]
}

function computeTierGrowth(
  current: SnapshotSummary | undefined,
  previous: SnapshotSummary,
  label: string | undefined
) {
  if (!current || !label) return null
  const currentTier = current.priceTiers.find((tier) => tier.label === label)
  const prevTier = previous.priceTiers.find((tier) => tier.label === label)
  if (!currentTier || !prevTier) return null
  return pointChange(currentTier.share, prevTier.share)
}
