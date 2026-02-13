"use client"

import { useState } from "react"
import { Calendar, Shield, TrendingUp, Users } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { TopProducts } from "@/components/dashboard/top-products"
import { SalesMap } from "@/components/dashboard/sales-map"
import { AllBrandsRankChart } from "@/components/dashboard/all-brands-rank-chart"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardData, SnapshotSummary } from "@/lib/competitor-data"
import { cn } from "@/lib/utils"
import { formatSnapshotDateFull, formatSnapshotLabelMonthEnd } from "@/lib/snapshot-date"
import {
  formatChangeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatNumberCompact,
  formatPercent,
  formatSigned,
  percentChange,
  pointChange,
  truncateLabel,
} from "@/lib/dashboard-format"

const BRAND_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316", "#0ea5e9", "#14b8a6"]

type BrandSortMode = "revenue" | "units"

export function CompetitorsClient({ data }: { data: DashboardData }) {
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

  const [selectedBrand, setSelectedBrand] = useState("")
  const [brandScope, setBrandScope] = useState("all_asins")
  const [brandSortMode, setBrandSortMode] = useState<BrandSortMode>("revenue")

  const brandTotals = activeSnapshot?.brandTotals ?? []
  const topBrands = brandTotals.slice(0, 8)

  const brandChartData = topBrands.map((brand) => ({
    label: brand.brand,
    sales: brand.units,
    revenue: brand.revenue,
  }))

  const scopeOptions = buildScopeOptions(activeSnapshot)
  const resolvedScope = scopeOptions.some((option) => option.value === brandScope)
    ? brandScope
    : (scopeOptions[0]?.value ?? "all_asins")

  const shareRows = buildShareRows(activeSnapshot, resolvedScope, brandSortMode)
  const brandShareItems = shareRows.slice(0, 6).map((brand, index) => ({
    label: brand.brand,
    value: brandSortMode === "units" ? brand.units : brand.revenue,
    color: BRAND_COLORS[index % BRAND_COLORS.length],
  }))

  const topShareBrand = shareRows[0]

  const brandListings = activeSnapshot?.brandListings ?? []
  const resolvedSelectedBrand = brandListings.find((listing) => listing.brand === selectedBrand)
    ? selectedBrand
    : (brandListings[0]?.brand ?? "")

  const selectedBrandListing =
    brandListings.find((listing) => listing.brand === resolvedSelectedBrand) ?? brandListings[0]

  const featuredBrandProducts = (selectedBrandListing?.products ?? []).slice(0, 4)
  const listingAnnotation = buildBrandListingAnnotation(activeSnapshot, resolvedSelectedBrand)

  const top3Share = activeSnapshot?.totals.top3Share ?? 0
  const top5Share = brandTotals.slice(0, 5).reduce((sum, brand) => sum + brand.share, 0)
  const top3Change = previousSnapshot ? pointChange(top3Share, previousSnapshot.totals.top3Share) : null

  const metricCards = [
    {
      title: "Top 3 share",
      value: formatPercent(top3Share, 1),
      change: top3Change === null ? "n/a" : `${formatSigned(top3Change, 1)}pt`,
      changeSuffix: "",
      isPositiveOutcome: (top3Change ?? 0) <= 0,
      icon: Shield,
    },
    {
      title: "Top 5 share",
      value: formatPercent(top5Share, 1),
      change: "Market coverage",
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: TrendingUp,
    },
  ]

  const revenueRankTrend = snapshots
    .map((snapshot) => ({
      label: formatSnapshotLabelMonthEnd(snapshot.date),
      value: findRank(snapshot, "revenue", resolvedSelectedBrand) ?? 0,
    }))
    .filter((entry) => entry.value > 0)

  const unitsRankTrend = snapshots
    .map((snapshot) => ({
      label: formatSnapshotLabelMonthEnd(snapshot.date),
      value: findRank(snapshot, "units", resolvedSelectedBrand) ?? 0,
    }))
    .filter((entry) => entry.value > 0)

  const currentRevenueRank = findRank(activeSnapshot, "revenue", resolvedSelectedBrand)
  const previousRevenueRank = findRank(previousSnapshot, "revenue", resolvedSelectedBrand)
  const currentUnitsRank = findRank(activeSnapshot, "units", resolvedSelectedBrand)
  const previousUnitsRank = findRank(previousSnapshot, "units", resolvedSelectedBrand)

  const revenueRankChange = rankMovement(currentRevenueRank, previousRevenueRank)
  const unitsRankChange = rankMovement(currentUnitsRank, previousUnitsRank)
  const maxRevenueRank = Math.max(
    ...revenueRankTrend.map((entry) => entry.value),
    currentRevenueRank ?? 0,
    1
  )
  const maxUnitsRank = Math.max(
    ...unitsRankTrend.map((entry) => entry.value),
    currentUnitsRank ?? 0,
    1
  )
  const rankYMax = Math.min(25, Math.max(maxRevenueRank, maxUnitsRank, 25))

  const headerDescription = activeSnapshot
    ? `Snapshot ${formatSnapshotDateFull(activeSnapshot.date)} | ${brandTotals.length} brands tracked`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Brands" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2 bg-transparent text-sm"
            )}
          >
            <Users className="w-4 h-4" />
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

      <SalesMap
        title="Brand share mix"
        subtitle={isCodeReader ? "Brand share inside selected code-reader scope" : "Revenue share by top brands"}
        items={brandShareItems}
        topLabel={topShareBrand?.brand ?? "n/a"}
        topValue={brandSortMode === "units"
          ? formatNumberCompact(topShareBrand?.units ?? 0)
          : formatCurrencyCompact(topShareBrand?.revenue ?? 0)}
        growthLabel="Top 3 share"
        growthValue={top3Change === null ? "n/a" : `${formatSigned(top3Change, 1)}pt`}
        totalLabel={brandSortMode === "units" ? "Total units" : "Total revenue"}
        totalValue={brandSortMode === "units"
          ? formatNumberCompact(activeSnapshot?.totals.units ?? 0)
          : formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0)}
        valueFormatter={(value) => brandSortMode === "units" ? formatNumberCompact(value) : formatCurrencyCompact(value)}
        primaryControl={{
          value: resolvedScope,
          onChange: setBrandScope,
          options: scopeOptions,
        }}
        secondaryControl={{
          value: brandSortMode,
          onChange: (value) => setBrandSortMode(value as BrandSortMode),
          options: [
            { value: "revenue", label: "Sort: Revenue" },
            { value: "units", label: "Sort: Units" },
          ],
        }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 my-6">
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
            data={brandChartData}
            totalLabel="Brand leaders"
            totalValue={formatCurrencyCompact(brandTotals[0]?.revenue ?? 0)}
            changeLabel={formatChangeLabel(
              percentChange(activeSnapshot?.totals.revenue ?? 0, previousSnapshot?.totals.revenue ?? 0)
            )}
            highlightIndex={0}
          />
        </div>
        <div>
          <TopProducts
            products={featuredBrandProducts.map((product) => ({
              name: truncateLabel(product.title, 36),
              brand: product.brand,
              priceLabel: product.price ? formatCurrency(product.price, 0) : "n/a",
              revenueLabel: formatCurrencyCompact(product.revenue),
              image: product.imageUrl,
              url: product.url,
            }))}
            title={selectedBrandListing ? `${selectedBrandListing.brand} leaders` : "Top brand ASINs"}
            subtitle="Top ASINs from selected brand"
          />
        </div>
      </div>

      <div className="mb-6">
        <AllBrandsRankChart
          snapshots={snapshots}
          selectedSnapshotDate={activeSnapshot?.date}
          title="Rolling 12mon Rank (All Brands)"
          maxRank={25}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <CustomerOrders
          title="Rolling 12mon Revenue Rank"
          subtitle={selectedBrandListing ? `${selectedBrandListing.brand} rank movement` : "Selected brand rank movement"}
          totalLabel="Current rank"
          totalValue={currentRevenueRank ? `#${currentRevenueRank}` : "n/a"}
          changeLabel={revenueRankChange === null ? "n/a" : `${formatSigned(revenueRankChange, 0)} rank`}
          changeValueLabel="vs previous snapshot"
          data={revenueRankTrend}
          isRankChart
          yMin={1}
          yMax={rankYMax}
        />

        <CustomerOrders
          title="Rolling 12mon Units Rank"
          subtitle={selectedBrandListing ? `${selectedBrandListing.brand} rank movement` : "Selected brand rank movement"}
          totalLabel="Current rank"
          totalValue={currentUnitsRank ? `#${currentUnitsRank}` : "n/a"}
          changeLabel={unitsRankChange === null ? "n/a" : `${formatSigned(unitsRankChange, 0)} rank`}
          changeValueLabel="vs previous snapshot"
          data={unitsRankTrend}
          isRankChart
          yMin={1}
          yMax={rankYMax}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 mb-6">
        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Brands</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[420px] overflow-auto">
            {brandListings.map((brand) => {
              return (
                <button
                  key={brand.brand}
                  type="button"
                  onClick={() => setSelectedBrand(brand.brand)}
                  className={`w-full flex items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    resolvedSelectedBrand === brand.brand
                      ? "bg-[var(--color-accent)]/40 text-foreground"
                      : "hover:bg-muted text-muted-foreground"
                  }`}
                >
                  <span className="font-medium text-foreground">{brand.brand}</span>
                </button>
              )
            })}
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              {selectedBrandListing ? `${selectedBrandListing.brand} listings` : "Brand listings"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {listingAnnotation ? (
              <div className="mb-3 rounded-lg border border-border bg-background/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">{listingAnnotation}</p>
              </div>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">ASIN</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Product Name</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Avg Price</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Estimated 12mo Revenue</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Monthly Revenue</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Estimated 12mon Units</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Monthly Units</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Reviews</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Tool Rating</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedBrandListing?.products ?? []).map((product) => (
                    <tr key={product.asin} className="border-b border-border last:border-0">
                      <td className="py-3 px-2 text-xs font-medium">
                        {product.url ? (
                          <a className="text-foreground hover:underline" href={product.url} target="_blank" rel="noreferrer">
                            {product.asin}
                          </a>
                        ) : (
                          product.asin
                        )}
                      </td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">
                        {truncateLabel(product.title, 60)}
                      </td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">
                        {product.toolType ?? product.subcategory ?? "n/a"}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatCurrencyPrecise(product.avgPrice ?? product.price)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatCurrencyPrecise(product.estimatedRevenue12mo)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatCurrencyPrecise(product.monthlyRevenue ?? product.revenue)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatInteger(product.estimatedUnits12mo)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatInteger(product.monthlyUnits ?? product.units)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">{formatInteger(product.reviewCount)}</td>
                      <td className="py-3 px-2 text-xs text-right">
                        {typeof product.toolRating === "number" && product.toolRating > 0
                          ? product.toolRating.toFixed(1)
                          : (product.rating > 0 ? product.rating.toFixed(1) : "n/a")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function buildBrandListingAnnotation(snapshot: SnapshotSummary | undefined, brand: string) {
  if (!snapshot || !brand) return ""
  const entry = snapshot.brandTotals.find((b) => b.brand.toLowerCase() === brand.toLowerCase())
  if (!entry || entry.units <= 0 || entry.revenue <= 0) return ""

  const brandAsp = entry.revenue / entry.units
  const marketAsp = snapshot.totals.avgPrice || snapshot.totals.revenue / Math.max(snapshot.totals.units, 1)
  const unitShare = snapshot.totals.units ? entry.units / snapshot.totals.units : 0
  const revShare = entry.share || (snapshot.totals.revenue ? entry.revenue / snapshot.totals.revenue : 0)

  const aspIndex = marketAsp > 0 ? brandAsp / marketAsp : 1

  const isPriceLed = aspIndex >= 1.15 && unitShare <= revShare * 0.9
  const isVolumeLed = aspIndex <= 0.9 && unitShare >= revShare * 1.1

  const label = isPriceLed ? "high-value (price-led)" : isVolumeLed ? "high-units (volume-led)" : "balanced"

  const aspText = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(brandAsp)
  const marketText = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(marketAsp)

  const pct = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value)

  return `Annotation: ${brand} is earning mainly via ${label} items this month. Avg price ${aspText} vs market ${marketText}. Revenue share ${pct(revShare)} vs unit share ${pct(unitShare)}.`
}

function buildScopeOptions(snapshot: SnapshotSummary | undefined) {
  if (!snapshot?.typeBreakdowns?.allAsins.length) {
    return [{ value: "all_asins", label: "All ASINs" }]
  }

  const keys = new Set(snapshot.typeBreakdowns.allAsins.map((item) => item.scopeKey))
  const options = [{ value: "all_asins", label: "All ASINs" }]
  if (keys.has("total_tablet")) options.push({ value: "total_tablet", label: "Total Tablet" })
  if (keys.has("total_handheld")) options.push({ value: "total_handheld", label: "Total Handheld" })
  if (keys.has("total_dongle")) options.push({ value: "total_dongle", label: "Total Dongle" })
  if (keys.has("total_other_tools")) options.push({ value: "total_other_tools", label: "Total Other Tools" })
  return options
}

function buildShareRows(
  snapshot: SnapshotSummary | undefined,
  scope: string,
  sortMode: BrandSortMode
) {
  if (!snapshot) return [] as Array<{ brand: string; revenue: number; units: number; share: number }>

  if (scope === "all_asins") {
    const rows = snapshot.brandTotals.map((brand) => ({
      brand: brand.brand,
      revenue: brand.revenue,
      units: brand.units,
      share: brand.share,
    }))
    return rows.sort((a, b) =>
      sortMode === "units" ? b.units - a.units : b.revenue - a.revenue
    )
  }

  const mixRows = snapshot.typeBreakdowns?.categoryBrandMix
    ?.filter((row) => row.scopeKey === scope)
    .map((row) => ({
      brand: row.brand,
      revenue: row.revenue,
      units: row.units,
      share: sortMode === "units" ? row.unitsShare : row.revenueShare,
    })) ?? []

  return mixRows.sort((a, b) =>
    sortMode === "units" ? b.units - a.units : b.revenue - a.revenue
  )
}

function findRank(
  snapshot: SnapshotSummary | undefined,
  metric: "revenue" | "units",
  brand: string
) {
  if (!snapshot || !brand) return undefined
  const pool = metric === "revenue"
    ? snapshot.rolling12?.revenue?.brands
    : snapshot.rolling12?.units?.brands

  return pool?.find((item) => item.brand.toLowerCase() === brand.toLowerCase())?.rank
}

function rankMovement(current?: number, previous?: number) {
  if (!current || !previous) return null
  return previous - current
}

function formatCurrencyPrecise(value: number | undefined) {
  if (typeof value !== "number" || value <= 0) return "n/a"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function formatInteger(value: number | undefined) {
  if (typeof value !== "number" || value <= 0) return "n/a"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)
}
