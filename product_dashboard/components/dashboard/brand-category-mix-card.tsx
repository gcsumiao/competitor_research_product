import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SnapshotSummary } from "@/lib/competitor-data"
import {
  buildBrandCategoryMixView,
  formatMixChange,
  formatMixMonthLabel,
  formatMixShare,
} from "@/lib/brand-category-mix"
import { formatCurrency, formatCurrencyCompact, formatInteger } from "@/lib/dashboard-format"
import { cn } from "@/lib/utils"

export const BRAND_CATEGORY_MIX_UNAVAILABLE =
  "Category mix is not available for this snapshot (ingested before the price-tier breakdown)"

const HEAD_CELL = "py-3 px-2 text-xs font-medium text-muted-foreground"

/** The selected brand's own category mix: the per-brand rows of the raw summary.xlsx Sheet1. */
export function BrandCategoryMixCard({
  snapshot,
  brand,
}: {
  snapshot: Pick<SnapshotSummary, "date" | "typeBreakdowns"> | undefined
  brand: string
}) {
  const view = buildBrandCategoryMixView(snapshot, brand)
  const monthLabel = snapshot ? formatMixMonthLabel(snapshot.date) : "n/a"

  return (
    <Card className="bg-card border border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Category mix</CardTitle>
        <p className="text-xs text-muted-foreground">
          Brand&apos;s revenue and units by price tier · {monthLabel}
        </p>
      </CardHeader>
      <CardContent>
        {view.status === "unavailable" ? (
          <p className="text-sm text-muted-foreground">{BRAND_CATEGORY_MIX_UNAVAILABLE}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={cn(HEAD_CELL, "text-left")}>Category</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Avg price</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Units</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Units %</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Revenue</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Rev %</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Rev MoM</th>
                  <th className={cn(HEAD_CELL, "text-right")}>Rev YoY</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((row) => {
                  const { metric } = row
                  const cell = cn("py-2 px-2 text-xs text-right tabular-nums", row.isTotal && "font-semibold")
                  return (
                    <tr
                      key={row.key}
                      data-row-key={row.key}
                      className={cn("border-b border-border last:border-0", row.isTotal && "bg-muted/30")}
                    >
                      <td
                        className={cn(
                          "py-2 px-2 text-xs whitespace-nowrap",
                          row.depth === 1 ? "pl-6 text-muted-foreground" : "text-foreground",
                          row.isTotal && "font-semibold"
                        )}
                      >
                        {row.label}
                      </td>
                      <td className={cell}>
                        {metric.units > 0 && metric.avgPrice > 0 ? formatCurrency(metric.avgPrice) : "n/a"}
                      </td>
                      <td className={cell}>{formatInteger(metric.units)}</td>
                      <td className={cell}>{formatMixShare(metric.unitsShare)}</td>
                      <td className={cell}>{formatCurrencyCompact(metric.revenue)}</td>
                      <td className={cell}>{formatMixShare(metric.revenueShare)}</td>
                      <td className={cell}>{formatMixChange(metric.revenueMoM)}</td>
                      <td className={cell}>{formatMixChange(metric.revenueYoY)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
