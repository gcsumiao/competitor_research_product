"use client"

import { Calendar, Gauge, Layers, Zap } from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { ProfitChart } from "@/components/dashboard/profit-chart"
import { CustomerOrders } from "@/components/dashboard/customer-orders"
import { SalesMap } from "@/components/dashboard/sales-map"
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
import type { DashboardData, ProductSummary } from "@/lib/competitor-data"
import type { CategoryTypeSummary } from "@/lib/type-summaries"
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

const SPEC_COLORS = ["#3b82f6", "#22c55e", "#8b5cf6", "#f97316"]

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

  const activeTop = activeSnapshot?.topProducts.slice(0, 50) ?? []
  const previousTop = previousSnapshot?.topProducts.slice(0, 50) ?? []

  const activeTypes = buildTypeTotals(activeTop)
  const previousTypes = buildTypeTotals(previousTop)

  const topType = activeTypes[0]
  const prevTopType = topType
    ? previousTypes.find((type) => type.label === topType.label)
    : undefined
  const topTypeShareChange = previousSnapshot && topType
    ? pointChange(topType.share, prevTopType?.share ?? 0)
    : null
  const typeCountChange = previousSnapshot ? activeTypes.length - previousTypes.length : null

  const highestPricedType = [...activeTypes].sort((a, b) => b.avgPrice - a.avgPrice)[0]
  const topTypeRevenueChange = previousSnapshot && topType
    ? percentChange(topType.revenue, prevTopType?.revenue ?? 0)
    : null

  const metricCards = [
    {
      title: "Top product type",
      value: topType?.label ?? "n/a",
      change: topTypeShareChange === null ? "n/a" : `${formatSigned(topTypeShareChange, 1)}pt`,
      changeSuffix: "",
      isPositiveOutcome: topTypeShareChange === null ? true : topTypeShareChange >= 0,
      icon: Layers,
    },
    {
      title: "Active product types",
      value: `${activeTypes.length}`,
      change: typeCountChange === null ? "n/a" : formatSigned(typeCountChange, 0),
      changeSuffix: typeCountChange === null ? "" : "types",
      isPositiveOutcome: (typeCountChange ?? 0) >= 0,
      icon: Gauge,
    },
    {
      title: "Highest priced type",
      value: highestPricedType?.label ?? "n/a",
      change: highestPricedType ? formatCurrency(highestPricedType.avgPrice, 0) : "n/a",
      changeSuffix: highestPricedType ? "avg" : "",
      isPositiveOutcome: true,
      icon: Zap,
    },
    {
      title: "Top type revenue",
      value: formatCurrencyCompact(topType?.revenue ?? 0),
      change: topTypeRevenueChange === null ? "n/a" : formatChangeLabel(topTypeRevenueChange),
      changeSuffix: previousSnapshot ? "MoM" : "",
      isPositiveOutcome: topTypeRevenueChange === null ? true : topTypeRevenueChange >= 0,
      icon: Layers,
    },
  ]

  const typeChartData = activeTypes.slice(0, 6).map((type) => ({
    label: truncateLabel(type.label, 20),
    sales: type.units,
    revenue: type.revenue,
  }))

  const typeTrend = snapshots.map((snapshot) => ({
    label: snapshot.label,
    value: buildTypeTotals(snapshot.topProducts.slice(0, 50)).length,
  }))

  const typeShareItems = activeTypes.slice(0, 4).map((type, index) => ({
    label: type.label,
    value: type.revenue,
    share: type.share,
    color: SPEC_COLORS[index % SPEC_COLORS.length],
  }))

  const topTypeProducts = (topType
    ? activeTop.filter((product) => product.subcategory === topType.label)
    : activeTop
  )
    .slice(0, 4)
    .map((product) => ({
      name: truncateLabel(product.title, 36),
      brand: product.brand,
      priceLabel: product.price ? formatCurrency(product.price, 0) : "n/a",
      revenueLabel: formatCurrencyCompact(product.revenue),
      image: product.imageUrl,
      url: product.url,
    }))

  const summaryForCategory = selectedCategory ? summaries[selectedCategory.id] : null
  const summaryLabel = summaryForCategory?.fileName ? ` | Source ${summaryForCategory.fileName}` : ""

  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | ${formatNumberCompact(activeTop.length)} Top 50 listings${summaryLabel}`
    : "No snapshot data available"

  return (
    <>
      <PageHeader title="Types" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <Layers className="w-4 h-4" />
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
            data={typeChartData}
            totalLabel="Product type mix"
            totalValue={formatCurrencyCompact(topType?.revenue ?? 0)}
            changeLabel={formatChangeLabel(
              percentChange(topType?.revenue ?? 0, prevTopType?.revenue ?? 0)
            )}
            highlightIndex={0}
          />
        </div>
        <div>
          <TopProducts
            products={topTypeProducts}
            title={topType ? `${topType.label} leaders` : "Top ASINs"}
            subtitle="Top listings inside the top product type"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="h-full">
          <CustomerOrders
            title="Product type diversity"
            subtitle="How many product types appear in Top 50"
            totalLabel="Active types"
            totalValue={formatNumberCompact(activeTypes.length)}
            changeLabel={typeCountChange === null ? "n/a" : formatSigned(typeCountChange, 0)}
            changeValueLabel=""
            data={typeTrend}
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <SalesMap
            title="Top product types"
            subtitle="Revenue share across top types"
            items={typeShareItems}
            topLabel={topType?.label ?? "n/a"}
            topValue={formatCurrencyCompact(topType?.revenue ?? 0)}
            growthLabel="Top type share"
            growthValue={topType ? formatPercent(topType.share, 1) : "n/a"}
            totalLabel="Top 50 revenue"
            totalValue={formatCurrencyCompact(activeTop.reduce((sum, item) => sum + item.revenue, 0))}
          />
        </div>
      </div>

      <Card className="bg-card border border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Product type breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-2 text-xs font-medium text-muted-foreground">Type</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Revenue</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Share</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Units</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Avg price</th>
                  <th className="text-right py-3 px-2 text-xs font-medium text-muted-foreground">Listings</th>
                </tr>
              </thead>
              <tbody>
                {activeTypes.slice(0, 12).map((type) => (
                  <tr key={type.label} className="border-b border-border last:border-0">
                    <td className="py-3 px-2 text-xs font-medium">{type.label}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatCurrencyCompact(type.revenue)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatPercent(type.share, 1)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(type.units)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatCurrency(type.avgPrice, 0)}</td>
                    <td className="py-3 px-2 text-xs text-right">{formatNumberCompact(type.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
                            <td key={`${section.title}-cell-${rowIndex}-${colIndex}`} className="py-3 px-2 text-xs">
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

function buildTypeTotals(products: ProductSummary[]) {
  const totals = new Map<string, { revenue: number; units: number; count: number; priceSum: number }>()

  for (const product of products) {
    const label = product.subcategory?.trim() || "Unspecified"
    const current = totals.get(label) ?? { revenue: 0, units: 0, count: 0, priceSum: 0 }
    current.revenue += product.revenue
    current.units += product.units
    current.count += 1
    current.priceSum += product.price
    totals.set(label, current)
  }

  const totalRevenue = products.reduce((sum, item) => sum + item.revenue, 0)

  return Array.from(totals.entries())
    .map(([label, values]) => ({
      label,
      revenue: values.revenue,
      units: values.units,
      count: values.count,
      avgPrice: values.count ? values.priceSum / values.count : 0,
      share: totalRevenue ? values.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}
