"use client"

import { Download, FileSpreadsheet, FileText, Presentation, ShieldAlert } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { BrandResearchAsset, DeliverableType } from "@/lib/consult-me/types"

const DELIVERABLE_ORDER: Array<{ type: DeliverableType; label: string; icon: typeof FileText }> = [
  { type: "pdf", label: "Research Report PDF", icon: FileText },
  { type: "docx", label: "Executive Summary DOCX", icon: FileText },
  { type: "csv", label: "Competitor Metrics CSV", icon: FileSpreadsheet },
  { type: "pptx", label: "Research Report PPTX", icon: Presentation },
]

export function ResearchOverview({ asset }: { asset: BrandResearchAsset }) {
  return (
    <div className="space-y-4">
      <Card className="border border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            Market Research Overview: {asset.brandLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {asset.executiveSummaryExcerpt ? (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <p className="text-xs font-medium text-foreground">Executive Summary Preview</p>
              <p className="mt-1 text-xs text-muted-foreground">{asset.executiveSummaryExcerpt}...</p>
            </div>
          ) : (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
              Executive summary preview unavailable for this brand.
            </div>
          )}

          {asset.csvOverview ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Metric label="CSV Rows" value={`${asset.csvOverview.rowCount}`} />
              <Metric label="CSV Columns" value={`${asset.csvOverview.columnCount}`} />
              <Metric label="Primary Fields" value={asset.csvOverview.columns.slice(0, 3).join(", ")} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Downloads</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DELIVERABLE_ORDER.map((item) => {
            const file = asset.available.find((entry) => entry.type === item.type)
            const Icon = item.icon
            return (
              <div
                key={item.type}
                className="rounded-md border border-border bg-background/70 p-3"
              >
                <div className="mb-2 flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </div>
                  {!file ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Not available yet
                    </span>
                  ) : null}
                </div>
                {file ? (
                  <a
                    className={buttonVariants({ variant: "default", className: "w-full" })}
                    href={`/api/consult-me/download?brand=${encodeURIComponent(
                      asset.brandKey
                    )}&file=${encodeURIComponent(file.fileName)}`}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </a>
                ) : (
                  <Button type="button" className="w-full" variant="outline" disabled>
                    Not available yet
                  </Button>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background/60 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value || "n/a"}</p>
    </div>
  )
}
