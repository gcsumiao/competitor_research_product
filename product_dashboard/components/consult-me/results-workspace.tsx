"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, Download, Eye, Presentation } from "lucide-react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { BrandResearchAsset, DeliverableType } from "@/lib/consult-me/types"

type ResultsWorkspaceProps = {
  selectedBrand: string
  asset?: BrandResearchAsset
  stepsCompleted: number
  sourcesFound: number
  activityFeed: string[]
  notifyLater: boolean
  onToggleNotify: () => void
  onStartNewResearch: () => void
}

const DELIVERABLES: Array<{ type: DeliverableType; title: string; subtitle: string }> = [
  { type: "pdf", title: "Full Research Report", subtitle: "PDF File" },
  { type: "csv", title: "Data & Comparisons", subtitle: "CSV File" },
  { type: "docx", title: "Executive Summary", subtitle: "DOCX File" },
  { type: "pptx", title: "Presentation", subtitle: "PPTX File" },
]

export function ResultsWorkspace({
  selectedBrand,
  asset,
  stepsCompleted,
  sourcesFound,
  activityFeed,
  notifyLater,
  onToggleNotify,
  onStartNewResearch,
}: ResultsWorkspaceProps) {
  const [activeView, setActiveView] = useState<DeliverableType>("docx")

  const deliverablesByType = useMemo(() => {
    const map = new Map<DeliverableType, { fileName: string }>()
    for (const file of asset?.available ?? []) {
      map.set(file.type, { fileName: file.fileName })
    }
    return map
  }, [asset])

  const hasAnyAsset = Boolean(asset?.available.length)

  return (
    <div className="space-y-4">
      <Card className="border border-emerald-500/40 bg-emerald-500/10">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Research Complete
            </p>
            <p className="text-xs text-emerald-700">100%</p>
          </div>
        </CardContent>
      </Card>

      <details className="rounded-md border border-border bg-card">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
          {`Activity Feed  ${stepsCompleted} steps, ${sourcesFound} sources`}
        </summary>
        <div className="space-y-2 border-t border-border px-3 py-3">
          {activityFeed.map((item, index) => (
            <p key={`${item}-${index}`} className="text-xs text-muted-foreground">{item}</p>
          ))}
        </div>
      </details>

      {hasAnyAsset && asset ? (
        <>
          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Deliverables</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {DELIVERABLES.map((item) => {
                const file = deliverablesByType.get(item.type)
                const baseUrl = file
                  ? `/api/consult-me/download?brand=${encodeURIComponent(
                    asset!.brandKey
                  )}&file=${encodeURIComponent(file.fileName)}`
                  : ""

                return (
                  <div key={item.type} className="rounded-md border border-border bg-background/70 p-3">
                    <div className="mb-3">
                      <p className="text-sm font-medium text-foreground">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.subtitle}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {file ? (
                        <button
                          type="button"
                          className={buttonVariants({ variant: "outline", className: "w-full" })}
                          onClick={() => setActiveView(item.type)}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </button>
                      ) : (
                        <Button type="button" variant="outline" disabled>
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </Button>
                      )}
                      {file ? (
                        <a
                          className={buttonVariants({ variant: "default", className: "w-full" })}
                          href={`${baseUrl}&disposition=attachment`}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </a>
                      ) : (
                        <Button type="button" disabled>
                          <Download className="mr-2 h-4 w-4" />
                          Not available
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Full Report</CardTitle>
            </CardHeader>
            <CardContent>
              {renderView({ activeView, asset, deliverablesByType })}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card className="border border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Research Queue Notice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {`Deep research for ${selectedBrand} is queued. Deliverables are not ready yet. Please come back later.`}
            </p>
            <Button type="button" variant={notifyLater ? "default" : "outline"} onClick={onToggleNotify}>
              {notifyLater ? "Notification Saved" : "Notify Me Later"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Button type="button" variant="outline" onClick={onStartNewResearch}>
        Start New Research
      </Button>
    </div>
  )
}

function renderView({
  activeView,
  asset,
  deliverablesByType,
}: {
  activeView: DeliverableType
  asset: BrandResearchAsset
  deliverablesByType: Map<DeliverableType, { fileName: string }>
}) {
  if (activeView === "pdf") {
    const file = deliverablesByType.get("pdf")
    if (!file) return <UnavailableView />
    const url = `/api/consult-me/download?brand=${encodeURIComponent(
      asset.brandKey
    )}&file=${encodeURIComponent(file.fileName)}&disposition=inline`
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">PDF preview</p>
        <iframe
          title="PDF Preview"
          src={url}
          className="h-[520px] w-full rounded-md border border-border"
        />
      </div>
    )
  }

  if (activeView === "csv") {
    if (!asset.csvPreview) return <UnavailableView />
    return (
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {asset.csvPreview.columns.slice(0, 12).map((column) => (
                <th key={column} className="px-2 py-2 text-left font-medium text-muted-foreground">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {asset.csvPreview.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="border-b border-border last:border-0">
                {asset.csvPreview!.columns.slice(0, 12).map((_, colIndex) => (
                  <td key={`cell-${rowIndex}-${colIndex}`} className="px-2 py-2 text-muted-foreground">
                    {row[colIndex] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (activeView === "docx") {
    return (
      <div className="max-h-[520px] overflow-auto rounded-md border border-border bg-background/70 p-3">
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {asset.fullReportText || asset.executiveSummaryExcerpt || "No DOCX text preview available."}
        </p>
      </div>
    )
  }

  if (activeView === "pptx") {
    const file = deliverablesByType.get("pptx")
    if (!file) return <UnavailableView />
    const url = `/api/consult-me/download?brand=${encodeURIComponent(
      asset.brandKey
    )}&file=${encodeURIComponent(file.fileName)}&disposition=attachment`
    return (
      <div className="rounded-md border border-border bg-background/70 p-3 text-sm text-muted-foreground">
        <p className="mb-2">PPTX preview is not supported inline in this workspace.</p>
        <a className={buttonVariants({ variant: "default" })} href={url} target="_blank" rel="noreferrer">
          <Presentation className="mr-2 h-4 w-4" />
          Open Presentation
        </a>
      </div>
    )
  }

  return <UnavailableView />
}

function UnavailableView() {
  return (
    <div className="rounded-md border border-border bg-background/70 p-3 text-sm text-muted-foreground">
      Selected deliverable is not available.
    </div>
  )
}
