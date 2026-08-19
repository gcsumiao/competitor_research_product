"use client"

import { useMemo, useState } from "react"
import { Calendar, DollarSign, Download, ListOrdered, Package, Star } from "lucide-react"

import { ExportPdfButton } from "@/components/dashboard/export-pdf-button"
import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
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
import type { DashboardData, ProductSummary, SnapshotSummary } from "@/lib/competitor-data"
import { REVENUE_CHART_COLOR, UNITS_CHART_COLOR } from "@/lib/chart-colors"
import { cn } from "@/lib/utils"
import { averagePriceForCategory } from "@/lib/jump-starters-classification"
import { formatSnapshotDateFull, formatSnapshotLabelMonthEnd } from "@/lib/snapshot-date"
import {
  formatChangeLabel,
  formatCurrency,
  formatCurrencyCompact,
  formatInteger,
  formatNumberCompact,
  formatSigned,
  formatPercent,
  formatRating,
  percentChange,
  truncateLabel,
} from "@/lib/dashboard-format"

type Top50Mode = "revenue" | "units"

export function Top50Client({ data }: { data: DashboardData }) {
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

  const [trendModeRaw, setTrendMode] = useState<Top50Mode>("revenue")
  const [topProductsModeRaw, setTopProductsMode] = useState<Top50Mode>("revenue")
  const [listModeRaw, setListMode] = useState<Top50Mode>("revenue")

  const hasUnitsRanking = (activeSnapshot?.top50ByUnits?.length ?? 0) > 0
  const trendMode = hasUnitsRanking ? trendModeRaw : "revenue"
  const topProductsMode = hasUnitsRanking ? topProductsModeRaw : "revenue"
  const listMode = hasUnitsRanking ? listModeRaw : "revenue"

  const activeRevenueTop50 = selectTop50(activeSnapshot, "revenue")
  const previousRevenueTop50 = selectTop50(previousSnapshot, "revenue")

  const activeTotals = summarizeTop50(activeRevenueTop50, activeSnapshot, selectedCategory?.id)
  const previousTotals = summarizeTop50(previousRevenueTop50, previousSnapshot, selectedCategory?.id)

  const activeTrendTotals = summarizeTop50(
    selectTop50(activeSnapshot, trendMode),
    activeSnapshot,
    selectedCategory?.id
  )
  const previousTrendTotals = summarizeTop50(
    selectTop50(previousSnapshot, trendMode),
    previousSnapshot,
    selectedCategory?.id
  )

  const top50Trend = snapshots.map((snapshot) => {
    const selectedTop = selectTop50(snapshot, trendMode)
    const summary = summarizeTop50(selectedTop, snapshot, selectedCategory?.id)
    return {
      label: formatSnapshotLabelMonthEnd(snapshot.date),
      value: trendMode === "revenue" ? summary.revenue : summary.units,
    }
  })

  const productImageFallbacks = useMemo(
    () => buildProductImageFallbacks(selectedCategory?.snapshots ?? []),
    [selectedCategory]
  )

  const topProductsSource = selectTop50(activeSnapshot, topProductsMode)
  const listTop50 = selectTop50(activeSnapshot, listMode)

  const metricCards = [
    {
      title: "Top 50 Revenue",
      value: formatCurrencyCompact(activeTotals.revenue),
      change: formatChangeLabel(percentChange(activeTotals.revenue, previousTotals.revenue)),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: activeTotals.revenue >= previousTotals.revenue,
      icon: DollarSign,
    },
    {
      title: hasUnitsRanking ? "Top 50 Units (revenue-ranked)" : "Top 50 Units",
      value: formatNumberCompact(activeTotals.units),
      change: formatChangeLabel(percentChange(activeTotals.units, previousTotals.units)),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: activeTotals.units >= previousTotals.units,
      icon: Package,
    },
    {
      title: "Avg Price (Top 50)",
      value: formatCurrency(activeTotals.avgPrice),
      change: formatChangeLabel(percentChange(activeTotals.avgPrice, previousTotals.avgPrice)),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: activeTotals.avgPrice >= previousTotals.avgPrice,
      icon: DollarSign,
    },
    {
      title: "Average Ratings",
      value: formatAverageRating(activeTotals.averageRating),
      change: previousSnapshot
        ? formatSigned(activeTotals.averageRating - previousTotals.averageRating, 1)
        : "n/a",
      changeSuffix: previousSnapshot ? "pts" : "",
      isPositiveOutcome: activeTotals.averageRating >= previousTotals.averageRating,
      icon: Star,
    },
  ]

  const topProductsCard = topProductsSource.slice(0, 4).map((product) => ({
    asin: product.asin,
    name: truncateLabel(product.title, 36),
    brand: product.brand,
    priceLabel: product.price ? formatCurrency(product.price) : "n/a",
    revenueLabel: topProductsMode === "revenue"
      ? formatCurrencyCompact(product.revenue)
      : `${formatNumberCompact(product.units)} units`,
    image: product.imageUrl,
    url: product.url,
  }))

  const issueCount = (activeSnapshot?.qualityIssues ?? []).length
  const headerDescription = activeSnapshot
    ? `Snapshot ${formatSnapshotDateFull(activeSnapshot.date)} | Top 50 share ${formatPercent(activeTotals.share)}${issueCount ? ` | ${issueCount} data warning${issueCount > 1 ? "s" : ""}` : ""}`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Top 50 Products" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2 bg-transparent text-sm"
            )}
          >
            <ListOrdered className="w-4 h-4" />
            {selectedCategory?.label ?? "Select category"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem
                key={category.id}
                onClick={() => setCategory(category.id)}
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
            {snapshots.map((snapshot) => (
              <DropdownMenuItem
                key={snapshot.date}
                onClick={() => setSnapshot(snapshot.date)}
              >
                {formatSnapshotDateFull(snapshot.date)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ExportPdfButton>
          <Download className="w-4 h-4" />
          Export Top 50
        </ExportPdfButton>
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
            data={top50Trend}
            title="Top 50 trend"
            subtitle={trendMode === "revenue" ? "Revenue trend across snapshots" : "Units trend across snapshots"}
            totalLabel={trendMode === "revenue" ? "Top 50 revenue" : "Top 50 units"}
            totalValue={trendMode === "revenue"
              ? formatCurrencyCompact(activeTrendTotals.revenue)
              : formatNumberCompact(activeTrendTotals.units)}
            changeLabel={trendMode === "revenue"
              ? formatChangeLabel(percentChange(activeTrendTotals.revenue, previousTrendTotals.revenue))
              : formatChangeLabel(percentChange(activeTrendTotals.units, previousTrendTotals.units))}
            changeValueLabel={previousSnapshot ? "vs previous snapshot" : ""}
            valueFormatter={trendMode === "revenue" ? formatCurrencyCompact : formatNumberCompact}
            color={trendMode === "revenue" ? REVENUE_CHART_COLOR : UNITS_CHART_COLOR}
            headerRight={hasUnitsRanking ? <MetricToggle value={trendMode} onChange={setTrendMode} /> : undefined}
          />
        </div>
        <div>
          <TopProducts
            products={topProductsCard}
            imageFallbacks={productImageFallbacks}
            title="Top 4 from Top 50"
            subtitle={topProductsMode === "revenue" ? "Highest revenue ASINs" : "Highest units ASINs"}
            headerRight={hasUnitsRanking ? <MetricToggle value={topProductsMode} onChange={setTopProductsMode} /> : undefined}
          />
        </div>
      </div>

      <Card className="bg-card border border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-medium">
            Top 50 list ({listMode === "revenue" ? "Revenue" : "Units"})
          </CardTitle>
          {hasUnitsRanking ? <MetricToggle value={listMode} onChange={setListMode} /> : null}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Rank</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">ASIN</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Title</th>
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Brand</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Price</th>
                  <th className={cn(
                    "text-right py-3 px-2 text-xs font-medium",
                    listMode === "revenue" ? "text-foreground" : "text-muted-foreground"
                  )}>Revenue</th>
                  <th className={cn(
                    "text-right py-3 px-2 text-xs font-medium",
                    listMode === "units" ? "text-foreground" : "text-muted-foreground"
                  )}>Units</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Reviews</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rating</th>
                </tr>
              </thead>
              <tbody>
                {listTop50.map((product, index) => (
                  <tr key={product.asin} className="border-b border-border last:border-0 even:bg-muted/30">
                    <td className="py-3 px-2 text-xs text-muted-foreground">{index + 1}</td>
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
                      {truncateLabel(product.title, 70)}
                    </td>
                    <td className="py-3 px-2 text-xs text-muted-foreground">{product.brand}</td>
                    <td className="py-3 px-2 text-xs text-right">
                      {product.price ? formatCurrency(product.price) : "n/a"}
                    </td>
                    <td className={cn(
                      "py-3 px-2 text-xs text-right",
                      listMode === "revenue" ? "font-semibold text-foreground" : "text-muted-foreground"
                    )}>{formatCurrencyCompact(product.revenue)}</td>
                    <td className={cn(
                      "py-3 px-2 text-xs text-right",
                      listMode === "units" ? "font-semibold text-foreground" : "text-muted-foreground"
                    )}>{formatNumberCompact(product.units)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatInteger(product.reviewCount)}</td>
                    <td className="py-3 px-2 text-xs text-right">
                      {product.rating ? formatRating(product.rating) : "n/a"}
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

function MetricToggle({
  value,
  onChange,
}: {
  value: Top50Mode
  onChange: (value: Top50Mode) => void
}) {
  return (
    <div className="flex items-center rounded-full border border-border bg-background/40 p-0.5">
      {(["revenue", "units"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
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

function selectTop50(snapshot: SnapshotSummary | undefined, mode: Top50Mode) {
  if (!snapshot) return []
  if (mode === "units") {
    return (snapshot.top50ByUnits ?? snapshot.topProducts).slice(0, 50)
  }
  return snapshot.topProducts.slice(0, 50)
}

function buildProductImageFallbacks(snapshots: SnapshotSummary[]): Map<string, string> {
  const fallbacks = new Map<string, string>()

  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index]
    if (!snapshot) continue

    const groups: ProductSummary[][] = [
      snapshot.topProducts ?? [],
      snapshot.top50ByUnits ?? [],
      ...(snapshot.brandListings ?? []).map((listing) => listing.products ?? []),
    ]

    for (const products of groups) {
      for (const product of products) {
        const asin = product.asin?.trim().toUpperCase()
        const imageUrl = product.imageUrl?.trim()
        if (!asin || !imageUrl || fallbacks.has(asin)) continue
        fallbacks.set(asin, imageUrl)
      }
    }
  }

  return fallbacks
}

function summarizeTop50(
  products: SnapshotSummary["topProducts"],
  snapshot?: SnapshotSummary,
  categoryId?: string
) {
  const revenue = products.reduce((sum, item) => sum + item.revenue, 0)
  const units = products.reduce((sum, item) => sum + item.units, 0)
  const avgPrice = averagePriceForCategory(categoryId, products)
  const validRatings = products
    .map((item) => item.rating)
    .filter((rating) => Number.isFinite(rating) && rating > 0)
  const averageRating = validRatings.length
    ? validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length
    : 0
  const share = snapshot?.totals.revenue ? revenue / snapshot.totals.revenue : 0
  return { revenue, units, avgPrice, averageRating, share }
}

function formatAverageRating(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "n/a"
  return formatRating(value)
}
