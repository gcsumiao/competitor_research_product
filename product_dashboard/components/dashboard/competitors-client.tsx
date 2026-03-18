"use client"

import { useEffect, useState } from "react"
import { Calendar, Shield, TrendingUp, Users } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { TopProducts } from "@/components/dashboard/top-products"
import { SalesMap } from "@/components/dashboard/sales-map"
import { AllBrandsRankChart } from "@/components/dashboard/all-brands-rank-chart"
import { TrendLineCard } from "@/components/dashboard/trend-line-card"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
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
import {
  buildBrandRolling12Trend,
  getBrandRolling12GrandTotals,
  normalizeBrandKey,
} from "@/lib/code-reader-brand-rolling12"

const FIXED_BRAND_COLORS: Record<string, string> = {
  autel: "#3b82f6",
  launch: "#f97316",
  topdon: "#8b5cf6",
  ancel: "#22c55e",
  foxwell: "#ef4444",
  xtool: "#eab308",
  obdlink: "#14b8a6",
  innova: "#6366f1",
  blcktec: "#10b981",
  thinkcar: "#ec4899",
  icarsoft: "#06b6d4",
  bluedriver: "#334155",
}

const BRAND_COLOR_PALETTE = [
  "#3b82f6",
  "#f97316",
  "#8b5cf6",
  "#22c55e",
  "#ef4444",
  "#eab308",
  "#14b8a6",
  "#6366f1",
  "#10b981",
  "#ec4899",
  "#06b6d4",
  "#334155",
]

function normalizeBrand(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function fallbackBrandColor(brand: string) {
  const key = normalizeBrand(brand)
  let hash = 0
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  }
  return BRAND_COLOR_PALETTE[hash % BRAND_COLOR_PALETTE.length]
}

function colorForBrand(brand: string) {
  const key = normalizeBrand(brand)
  return FIXED_BRAND_COLORS[key] ?? fallbackBrandColor(brand)
}

type BrandSortMode = "revenue" | "units"
type BrandListingAnnotation = {
  label: string
  summary: string
  tone: "price_led" | "units_led" | "balanced"
}

export function CompetitorsClient({ data }: { data: DashboardData }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
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

  const [brandScope, setBrandScope] = useState("all_asins")
  const [brandSortMode, setBrandSortMode] = useState<BrandSortMode>("revenue")
  const [brandSearch, setBrandSearch] = useState("")

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
  const brandShareItems = shareRows.slice(0, 6).map((brand) => ({
    label: brand.brand,
    value: brandSortMode === "units" ? brand.units : brand.revenue,
    color: colorForBrand(brand.brand),
    revenueShare: brand.revenueShare,
    unitsShare: brand.unitsShare,
  }))

  const topShareBrand = shareRows[0]

  const brandListings = activeSnapshot?.brandListings ?? []
  const filteredBrandListings = brandListings.filter((listing) =>
    listing.brand.toLowerCase().includes(brandSearch.trim().toLowerCase())
  )
  const paramBrand = searchParams.get("brand") ?? ""
  const resolvedSelectedBrand =
    brandListings.find((listing) => normalizeBrandKey(listing.brand) === normalizeBrandKey(paramBrand))?.brand ??
    brandListings[0]?.brand ??
    ""

  const selectedBrandListing =
    brandListings.find((listing) => listing.brand === resolvedSelectedBrand) ?? brandListings[0]
  const setSelectedBrand = (brand: string) => {
    const params = new URLSearchParams(searchParams)
    params.set("brand", brand)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  useEffect(() => {
    if (!resolvedSelectedBrand) return
    if (normalizeBrandKey(paramBrand) === normalizeBrandKey(resolvedSelectedBrand)) return

    const params = new URLSearchParams(searchParams)
    params.set("brand", resolvedSelectedBrand)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [paramBrand, pathname, resolvedSelectedBrand, router, searchParams])

  const featuredBrandProducts = (selectedBrandListing?.products ?? []).slice(0, 4)
  const listingAnnotation = buildBrandListingAnnotation(activeSnapshot, resolvedSelectedBrand)
  const listingAnnotationStyle = listingAnnotation ? annotationToneClasses(listingAnnotation) : null
  const rolling12GrandTotals = getBrandRolling12GrandTotals(activeSnapshot, resolvedSelectedBrand)
  const previousRolling12GrandTotals = getBrandRolling12GrandTotals(previousSnapshot, resolvedSelectedBrand)
  const rolling12Trend = buildBrandRolling12Trend(snapshots, resolvedSelectedBrand).filter(
    (row) => row.revenueGrandTotal > 0 || row.unitsGrandTotal > 0
  )

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

  const rolling12RevenueTrend = rolling12Trend.map((row) => ({
    label: row.label,
    value: row.revenueGrandTotal,
  }))
  const rolling12UnitsTrend = rolling12Trend.map((row) => ({
    label: row.label,
    value: row.unitsGrandTotal,
  }))

  const revenueRankChange = rankMovement(currentRevenueRank, previousRevenueRank)
  const unitsRankChange = rankMovement(currentUnitsRank, previousUnitsRank)
  const rolling12RevenueChange = percentChange(
    rolling12GrandTotals?.revenueGrandTotal ?? 0,
    previousRolling12GrandTotals?.revenueGrandTotal ?? 0
  )
  const rolling12UnitsChange = percentChange(
    rolling12GrandTotals?.unitsGrandTotal ?? 0,
    previousRolling12GrandTotals?.unitsGrandTotal ?? 0
  )
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

      {!isCodeReader ? (
        <>
          <SalesMap
            title="Brand share mix"
            subtitle="Revenue share by top brands"
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
            toggleControl={{
              value: brandSortMode,
              onChange: (value) => setBrandSortMode(value as BrandSortMode),
              options: [
                { value: "revenue", label: "Revenue" },
                { value: "units", label: "Units" },
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
        </>
      ) : null}

      <div className={cn("mb-6", isCodeReader ? "grid grid-cols-1" : "grid grid-cols-1 lg:grid-cols-3 gap-4")}>
        <div className={cn(isCodeReader ? "" : "lg:col-span-2")}>
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
        {!isCodeReader ? (
          <div>
            <TopProducts
              products={featuredBrandProducts.map((product) => ({
                asin: product.asin,
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
        ) : null}
      </div>

      <div className="mb-6">
        <AllBrandsRankChart
          snapshots={snapshots}
          selectedSnapshotDate={activeSnapshot?.date}
          title="Rolling 12mon Rank (Top20)"
          maxRank={20}
        />
      </div>

      {isCodeReader ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[240px_1fr] gap-4 mb-6 items-start">
            <Card className="bg-card border border-border xl:sticky xl:top-24 self-start">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Brands</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  value={brandSearch}
                  onChange={(event) => setBrandSearch(event.target.value)}
                  placeholder="Search brand"
                  className="h-9"
                />
                <div className="max-h-[420px] overflow-y-auto pr-1 space-y-2">
                {filteredBrandListings.map((brand) => {
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
                {filteredBrandListings.length === 0 ? (
                  <p className="px-1 py-3 text-sm text-muted-foreground">
                    No brands match “{brandSearch}”.
                  </p>
                ) : null}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Selected brand</p>
                    <p className="mt-1 text-2xl font-semibold text-foreground">
                      {selectedBrandListing?.brand ?? "No brand selected"}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Snapshot {activeSnapshot ? formatSnapshotDateFull(activeSnapshot.date) : "n/a"}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-border p-4">
                    <p className="text-xs text-muted-foreground">Rolling 12 Grand Total Revenue</p>
                    <p className="mt-2 text-3xl font-semibold">
                      {formatCurrency(rolling12GrandTotals?.revenueGrandTotal ?? 0, 0)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current month {formatCurrencyCompact(rolling12GrandTotals?.revenueMonthly ?? 0)} | {formatChangeLabel(rolling12RevenueChange)} vs previous snapshot
                    </p>
                  </div>
                  <div className="rounded-xl border border-border p-4">
                    <p className="text-xs text-muted-foreground">Rolling 12 Grand Total Units</p>
                    <p className="mt-2 text-3xl font-semibold">
                      {formatInteger(rolling12GrandTotals?.unitsGrandTotal ?? 0)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Current month {formatInteger(rolling12GrandTotals?.unitsMonthly ?? 0)} | {formatChangeLabel(rolling12UnitsChange)} vs previous snapshot
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <TrendLineCard
                  title="Rolling 12 Grand Total Revenue"
                  subtitle={selectedBrandListing ? `${selectedBrandListing.brand} revenue trend across snapshots` : "Selected brand revenue trend"}
                  totalLabel="Current grand total revenue"
                  totalValue={formatCurrency(rolling12GrandTotals?.revenueGrandTotal ?? 0, 0)}
                  changeLabel={formatChangeLabel(rolling12RevenueChange)}
                  changeValueLabel="vs previous snapshot"
                  data={rolling12RevenueTrend}
                  color="#3b82f6"
                  formatter={(value) => formatCurrency(value, 0)}
                  axisFormatter={(value) => formatCurrencyCompact(value)}
                  compactSummary
                />
                <TrendLineCard
                  title="Rolling 12 Grand Total Units"
                  subtitle={selectedBrandListing ? `${selectedBrandListing.brand} units trend across snapshots` : "Selected brand units trend"}
                  totalLabel="Current grand total units"
                  totalValue={formatInteger(rolling12GrandTotals?.unitsGrandTotal ?? 0)}
                  changeLabel={formatChangeLabel(rolling12UnitsChange)}
                  changeValueLabel="vs previous snapshot"
                  data={rolling12UnitsTrend}
                  color="#10b981"
                  formatter={(value) => value.toLocaleString()}
                  axisFormatter={(value) => formatNumberCompact(value)}
                  compactSummary
                />
              </div>

              <Card className="bg-card border border-border">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-medium">
                    {selectedBrandListing ? `${selectedBrandListing.brand} listings` : "Brand listings"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {listingAnnotation && listingAnnotationStyle ? (
                    <div className={cn("mb-4 rounded-xl border px-4 py-3", listingAnnotationStyle.container)}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide", listingAnnotationStyle.badge)}>
                          {listingAnnotation.label}
                        </span>
                        <p className="text-sm font-medium text-foreground">
                          {selectedBrandListing?.brand ?? "Selected brand"} monthly performance signal
                        </p>
                      </div>
                      <p className="mt-2 text-sm text-foreground/90">{listingAnnotation.summary}</p>
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

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-4 mb-6">
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
        </>
      ) : (
        <>
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
              <CardContent className="space-y-2">
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
                    <p className="text-xs text-muted-foreground">{listingAnnotation.summary}</p>
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
      )}
    </>
  )
}

function buildBrandListingAnnotation(
  snapshot: SnapshotSummary | undefined,
  brand: string
): BrandListingAnnotation | null {
  if (!snapshot || !brand) return null
  const entry = snapshot.brandTotals.find((b) => b.brand.toLowerCase() === brand.toLowerCase())
  if (!entry || entry.units <= 0 || entry.revenue <= 0) return null

  const brandAsp = entry.revenue / entry.units
  const marketAsp = snapshot.totals.avgPrice || snapshot.totals.revenue / Math.max(snapshot.totals.units, 1)
  const unitShare = snapshot.totals.units ? entry.units / snapshot.totals.units : 0
  const revShare = entry.share || (snapshot.totals.revenue ? entry.revenue / snapshot.totals.revenue : 0)

  const aspIndex = marketAsp > 0 ? brandAsp / marketAsp : 1

  const isPriceLed = aspIndex >= 1.15 && unitShare <= revShare * 0.9
  const isVolumeLed = aspIndex <= 0.9 && unitShare >= revShare * 1.1

  const label = isPriceLed ? "Price-led" : isVolumeLed ? "Units-led" : "Balanced"
  const tone = isPriceLed ? "price_led" : isVolumeLed ? "units_led" : "balanced"

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

  return {
    label,
    tone,
    summary: `${brand} is earning mainly via ${label.toLowerCase()} items this month. Avg price ${aspText} vs market ${marketText}. Revenue share ${pct(revShare)} vs unit share ${pct(unitShare)}.`,
  }
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
  if (!snapshot) {
    return [] as Array<{
      brand: string
      revenue: number
      units: number
      revenueShare: number
      unitsShare: number
    }>
  }

  if (scope === "all_asins") {
    const rows = snapshot.brandTotals.map((brand) => ({
      brand: brand.brand,
      revenue: brand.revenue,
      units: brand.units,
      revenueShare: brand.share,
      unitsShare: snapshot.totals.units ? brand.units / snapshot.totals.units : 0,
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
      revenueShare: row.revenueShare,
      unitsShare: row.unitsShare,
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

function annotationToneClasses(annotation: BrandListingAnnotation) {
  if (annotation.tone === "price_led") {
    return {
      container: "border-amber-300 bg-amber-50/80",
      badge: "bg-amber-500/15 text-amber-700",
    }
  }
  if (annotation.tone === "units_led") {
    return {
      container: "border-emerald-300 bg-emerald-50/80",
      badge: "bg-emerald-500/15 text-emerald-700",
    }
  }
  return {
    container: "border-slate-300 bg-slate-50/80",
    badge: "bg-slate-500/15 text-slate-700",
  }
}
