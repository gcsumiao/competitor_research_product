"use client"

import { useEffect, useState } from "react"
import { Calendar, Shield, TrendingUp, Users } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { TopProducts } from "@/components/dashboard/top-products"
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
import type { DashboardData, SnapshotSummary } from "@/lib/competitor-data"
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

const BRAND_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316"]

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

  const brandTotals = activeSnapshot?.brandTotals ?? []
  const topBrands = brandTotals.slice(0, 8)

  const brandChartData = topBrands.map((brand) => ({
    label: brand.brand,
    sales: brand.units,
    revenue: brand.revenue,
  }))

  const brandShareItems = brandTotals.slice(0, 4).map((brand, index) => ({
    label: brand.brand,
    value: brand.revenue,
    color: BRAND_COLORS[index % BRAND_COLORS.length],
  }))

  const topBrand = brandTotals[0]
  const brandListings = activeSnapshot?.brandListings ?? []
  const [selectedBrand, setSelectedBrand] = useState(brandListings[0]?.brand ?? "")

  useEffect(() => {
    if (!brandListings.length) {
      if (selectedBrand) setSelectedBrand("")
      return
    }
    if (!brandListings.find((listing) => listing.brand === selectedBrand)) {
      setSelectedBrand(brandListings[0].brand)
    }
  }, [brandListings, selectedBrand])

  const selectedBrandListing =
    brandListings.find((listing) => listing.brand === selectedBrand) ?? brandListings[0]
  const topBrandProducts = topBrand
    ? (activeSnapshot?.topProducts ?? [])
        .filter((product) => product.brand === topBrand.brand)
        .slice(0, 4)
    : (activeSnapshot?.topProducts ?? []).slice(0, 4)

  const sidebarBrands = brandListings.map((listing) => {
    const share = brandTotals.find((brand) => brand.brand === listing.brand)?.share ?? 0
    return { brand: listing.brand, share }
  })

  const featuredBrandProducts = (selectedBrandListing?.products ?? topBrandProducts).slice(0, 4)

  const competitorTrend = snapshots.map((snapshot) => ({
    label: snapshot.label,
    value: snapshot.totals.brandCount,
  }))

  const top3Share = activeSnapshot?.totals.top3Share ?? 0
  const top5Share = brandTotals.slice(0, 5).reduce((sum, brand) => sum + brand.share, 0)
  const top3Change = previousSnapshot ? pointChange(top3Share, previousSnapshot.totals.top3Share) : null
  const brandCountChange = previousSnapshot
    ? (activeSnapshot?.totals.brandCount ?? 0) - previousSnapshot.totals.brandCount
    : null

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
    {
      title: "Brands tracked",
      value: `${activeSnapshot?.totals.brandCount ?? 0}`,
      change: brandCountChange === null ? "n/a" : formatSigned(brandCountChange, 0),
      changeSuffix: brandCountChange === null ? "" : "brands",
      isPositiveOutcome: (brandCountChange ?? 0) >= 0,
      icon: Users,
    },
    {
      title: "Meaningful competitors",
      value: `${activeSnapshot?.totals.meaningfulCompetitors ?? 0}`,
      change: "share > 1%",
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: Users,
    },
  ]

  const brandMovement = buildBrandMovement(activeSnapshot, previousSnapshot)

  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | ${brandTotals.length} brands tracked`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Brands" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <Users className="w-4 h-4" />
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
          <ProfitChart
            data={brandChartData}
            totalLabel="Brand leaders"
            totalValue={formatCurrencyCompact(topBrand?.revenue ?? 0)}
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="h-full">
          <CustomerOrders
            title="Brand count trend"
            subtitle="How many brands compete each snapshot"
            totalLabel="Brands tracked"
            totalValue={formatNumberCompact(activeSnapshot?.totals.brandCount ?? 0)}
            changeLabel={
              brandCountChange === null ? "n/a" : `${formatSigned(brandCountChange, 0)}`
            }
            changeValueLabel=""
            data={competitorTrend}
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <SalesMap
            title="Brand share mix"
            subtitle="Revenue share by top brands"
            items={brandShareItems}
            topLabel={topBrand?.brand ?? "n/a"}
            topValue={formatCurrencyCompact(topBrand?.revenue ?? 0)}
            growthLabel="Top 3 share"
            growthValue={top3Change === null ? "n/a" : `${formatSigned(top3Change, 1)}pt`}
            totalLabel="Total revenue"
            totalValue={formatCurrencyCompact(activeSnapshot?.totals.revenue ?? 0)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4 mb-6">
        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Top brands</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sidebarBrands.map((brand) => (
              <button
                key={brand.brand}
                type="button"
                onClick={() => setSelectedBrand(brand.brand)}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  selectedBrand === brand.brand
                    ? "bg-[var(--color-accent)]/40 text-foreground"
                    : "hover:bg-muted text-muted-foreground"
                }`}
              >
                <span className="font-medium text-foreground">{brand.brand}</span>
                <span className="text-xs">{formatPercent(brand.share, 1)}</span>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">
              {selectedBrandListing ? `${selectedBrandListing.brand} listings` : "Brand listings"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">ASIN</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Title</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Price</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Units</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rating</th>
                    <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Reviews</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Fulfillment</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Size tier</th>
                    <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Type</th>
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
                      <td className="py-3 px-2 text-xs text-right">
                        {product.price ? formatCurrency(product.price, 0) : "n/a"}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatCurrencyCompact(product.revenue)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatNumberCompact(product.units)}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {product.rating ? product.rating.toFixed(1) : "n/a"}
                      </td>
                      <td className="py-3 px-2 text-xs text-right">
                        {formatNumberCompact(product.reviewCount)}
                      </td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">
                        {product.fulfillment ?? "n/a"}
                      </td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">
                        {product.sizeTier ?? "n/a"}
                      </td>
                      <td className="py-3 px-2 text-xs text-muted-foreground">
                        {product.subcategory ?? "n/a"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Brand movement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Brand</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Share</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">MoM change</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Units</th>
                </tr>
              </thead>
              <tbody>
                {brandMovement.map((brand) => (
                  <tr key={brand.brand} className="border-b border-border last:border-0">
                    <td className="py-3 px-2 text-xs font-medium">{brand.brand}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(brand.revenue)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatPercent(brand.share, 1)}</td>
                    <td className="py-3 px-2 text-xs text-right">
                      {brand.changeLabel}
                    </td>
                    <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(brand.units)}</td>
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

function buildBrandMovement(current?: SnapshotSummary, previous?: SnapshotSummary) {
  if (!current) return []
  const prevMap = new Map<string, number>()
  if (previous) {
    for (const brand of previous.brandTotals) {
      prevMap.set(brand.brand, brand.share)
    }
  }

  return current.brandTotals.slice(0, 12).map((brand) => {
    const prevShare = prevMap.get(brand.brand) ?? 0
    const change = previous ? pointChange(brand.share, prevShare) : null
    return {
      brand: brand.brand,
      revenue: brand.revenue,
      units: brand.units,
      share: brand.share,
      changeLabel: change === null ? "n/a" : `${formatSigned(change, 1)}pt`,
    }
  })
}
