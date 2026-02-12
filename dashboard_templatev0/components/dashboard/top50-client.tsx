"use client"

import { Calendar, Download, ListOrdered } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { TopProducts } from "@/components/dashboard/top-products"
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
  median,
  percentChange,
  truncateLabel,
} from "@/lib/dashboard-format"

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

  const activeTop = activeSnapshot?.topProducts ?? []
  const activeTop50 = activeTop.slice(0, 50)

  const activeTotals = summarizeTop50(activeTop50, activeSnapshot)
  const previousTotals = summarizeTop50(previousSnapshot?.topProducts?.slice(0, 50) ?? [], previousSnapshot)

  const top50Trend = snapshots.map((snapshot) => {
    const summary = summarizeTop50(snapshot.topProducts.slice(0, 50), snapshot)
    return {
      label: snapshot.label,
      sales: summary.units,
      revenue: summary.revenue,
    }
  })

  const metricCards = [
    {
      title: "Top 50 Revenue",
      value: formatCurrencyCompact(activeTotals.revenue),
      change: formatChangeLabel(percentChange(activeTotals.revenue, previousTotals.revenue)),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: activeTotals.revenue >= previousTotals.revenue,
      icon: ListOrdered,
    },
    {
      title: "Top 50 Units",
      value: formatNumberCompact(activeTotals.units),
      change: formatChangeLabel(percentChange(activeTotals.units, previousTotals.units)),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: activeTotals.units >= previousTotals.units,
      icon: ListOrdered,
    },
    {
      title: "Avg Price (Top 50)",
      value: formatCurrency(activeTotals.avgPrice, 2),
      change: formatChangeLabel(percentChange(activeTotals.avgPrice, previousTotals.avgPrice)),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: activeTotals.avgPrice >= previousTotals.avgPrice,
      icon: ListOrdered,
    },
    {
      title: "Median Reviews",
      value: formatNumberCompact(activeTotals.medianReviews),
      change: previousSnapshot
        ? formatSigned(activeTotals.medianReviews - previousTotals.medianReviews, 0)
        : "n/a",
      changeSuffix: previousSnapshot ? "reviews" : "",
      isPositiveOutcome: activeTotals.medianReviews >= previousTotals.medianReviews,
      icon: ListOrdered,
    },
  ]

  const topProductsCard = activeTop50.slice(0, 4).map((product) => ({
    name: truncateLabel(product.title, 36),
    brand: product.brand,
    priceLabel: product.price ? formatCurrency(product.price, 0) : "n/a",
    revenueLabel: formatCurrencyCompact(product.revenue),
    image: product.imageUrl,
    url: product.url,
  }))

  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | Top 50 share ${formatPercent(activeTotals.share)}`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Top 50 Products" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <ListOrdered className="w-4 h-4" />
              {selectedCategory?.label ?? "Select category"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem
                key={category.id}
                onSelect={() => setCategory(category.id)}
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
            {snapshots.map((snapshot) => (
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
          <Download className="w-4 h-4" />
          Export Top 50
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
            data={top50Trend}
            totalLabel="Top 50 trend"
            totalValue={formatCurrencyCompact(activeTotals.revenue)}
            changeLabel={formatChangeLabel(percentChange(activeTotals.revenue, previousTotals.revenue))}
            highlightIndex={activeIndex >= 0 ? activeIndex : undefined}
          />
        </div>
        <div>
          <TopProducts
            products={topProductsCard}
            title="Top 4 from Top 50"
            subtitle="Highest revenue ASINs"
          />
        </div>
      </div>

      <Card className="bg-card border border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Top 50 list</CardTitle>
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
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Units</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Reviews</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Rating</th>
                </tr>
              </thead>
              <tbody>
                {activeTop50.map((product, index) => (
                  <tr key={product.asin} className="border-b border-border last:border-0">
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
                      {product.price ? formatCurrency(product.price, 0) : "n/a"}
                    </td>
                    <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(product.revenue)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(product.units)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(product.reviewCount)}</td>
                    <td className="py-3 px-2 text-xs text-right">
                      {product.rating ? product.rating.toFixed(1) : "n/a"}
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

function summarizeTop50(products: SnapshotSummary["topProducts"], snapshot?: SnapshotSummary) {
  const revenue = products.reduce((sum, item) => sum + item.revenue, 0)
  const units = products.reduce((sum, item) => sum + item.units, 0)
  const avgPrice = products.length
    ? products.reduce((sum, item) => sum + item.price, 0) / products.length
    : 0
  const medianReviews = median(products.map((item) => item.reviewCount))
  const share = snapshot?.totals.revenue ? revenue / snapshot.totals.revenue : 0
  return { revenue, units, avgPrice, medianReviews, share }
}
