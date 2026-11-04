"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { CheckCircle2, Download, ExternalLink, Eye, Maximize2, Minimize2, Presentation } from "lucide-react"

import { BriefHeroCard, briefAssetUrl } from "@/components/consult-me/brief-hero-card"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type {
  DeliverableFile,
  DeliverableType,
  ResearchBrief,
  ResearchStatusResponse,
} from "@/lib/consult-me/types"

type ResultsWorkspaceProps = {
  selectedBrand: string
  result?: ResearchStatusResponse
  stepsCompleted: number
  sourcesFound: number
  activityFeed: string[]
  onStartNewResearch: () => void
  /** Latest code-reader snapshot date, for the brief's "newer data available" hint. */
  snapshotDate?: string
  /** Deep link (`?view=brief`): open the brief viewer and scroll to it on load. */
  initialView?: "brief"
}

type ViewKey = "brief" | DeliverableType

const VIEW_LABELS: Record<ViewKey, string> = {
  brief: "Threat brief",
  pdf: "Research PDF",
  docx: "Summary",
  csv: "Data",
  pptx: "Deck",
}

const DELIVERABLES: Array<{ type: DeliverableType; title: string; subtitle: string }> = [
  { type: "pdf", title: "Full Research Report", subtitle: "PDF File" },
  { type: "csv", title: "Data & Comparisons", subtitle: "CSV File" },
  { type: "docx", title: "Executive Summary", subtitle: "DOCX File" },
  { type: "pptx", title: "Presentation", subtitle: "PPTX File" },
]

export function ResultsWorkspace({
  selectedBrand,
  result,
  stepsCompleted,
  sourcesFound,
  activityFeed,
  onStartNewResearch,
  snapshotDate,
  initialView,
}: ResultsWorkspaceProps) {
  // null = automatic: the brief when there is one, else the research PDF (the DOCX
  // view is a dead end for seed reports, which carry no inline summary text).
  const [selectedView, setSelectedView] = useState<ViewKey | null>(initialView ?? null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const brief = result?.brief?.assets.includes("html") ? result.brief : undefined

  const deliverablesByType = new Map<DeliverableType, DeliverableFile>()
  for (const file of result?.deliverables ?? []) {
    if (file.source === "seed_local" && file.seedId) {
      deliverablesByType.set(file.type, { ...file, source: "seed_local" })
      continue
    }
    if (file.remoteUrl) {
      deliverablesByType.set(file.type, { ...file, source: "remote" })
    }
  }

  const hasAnyAsset = deliverablesByType.size > 0 || Boolean(brief)
  const viewOptions: ViewKey[] = [
    ...(brief ? (["brief"] as const) : []),
    ...(["pdf", "docx", "csv", "pptx"] as const).filter((type) => deliverablesByType.has(type)),
  ]
  const defaultView: ViewKey = brief ? "brief" : deliverablesByType.has("pdf") ? "pdf" : "docx"
  const activeView: ViewKey =
    selectedView && (selectedView !== "brief" || brief) ? selectedView : defaultView

  function openView(view: ViewKey) {
    setSelectedView(view)
    viewerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  useEffect(() => {
    if (initialView === "brief" && brief) {
      viewerRef.current?.scrollIntoView({ block: "start" })
    }
    // Only on first arrival of the brief for a deep link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(brief)])

  return (
    <div className="space-y-4">
      {brief ? (
        <BriefHeroCard brief={brief} snapshotDate={snapshotDate} onOpen={() => openView("brief")} />
      ) : null}

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

      {result?.usage?.totalCost !== undefined ? (
        <Card className="border border-border bg-card">
          <CardContent className="py-3 text-sm text-muted-foreground">
            Usage cost: <span className="font-medium text-foreground">{formatCurrency(result.usage.totalCost)}</span>
          </CardContent>
        </Card>
      ) : null}

      {hasAnyAsset ? (
        <>
          {brief ? (
            <SourceResearchRow
              deliverablesByType={deliverablesByType}
              sourcesFound={sourcesFound}
              onView={openView}
            />
          ) : (
          <Card className="border border-border bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-medium">Deliverables</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {DELIVERABLES.map((item) => {
                const file = deliverablesByType.get(item.type)
                const baseUrl = file ? buildDownloadUrl(file) : ""

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
                          onClick={() => openView(item.type)}
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
                          Not available yet
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
          )}

          <div ref={viewerRef} className="scroll-mt-24">
            <Card className="border border-border bg-card">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                <CardTitle className="text-base font-medium">Report viewer</CardTitle>
                {viewOptions.length > 1 ? (
                  <div role="tablist" aria-label="Report views" className="inline-flex flex-wrap rounded-md border border-border bg-background/70 p-0.5">
                    {viewOptions.map((view) => (
                      <button
                        key={view}
                        type="button"
                        role="tab"
                        aria-selected={activeView === view}
                        onClick={() => setSelectedView(view)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                          activeView === view
                            ? "bg-[var(--color-accent)] text-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {VIEW_LABELS[view]}
                      </button>
                    ))}
                  </div>
                ) : null}
              </CardHeader>
              <CardContent>
                {activeView === "brief" && brief ? (
                  <BriefViewer brief={brief} />
                ) : (
                  renderView({ activeView: activeView === "brief" ? "pdf" : activeView, result, deliverablesByType })
                )}
              </CardContent>
            </Card>
          </div>

          {result?.sources?.length ? (
            <Card className="border border-border bg-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-medium">Sources</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {result.sources.map((source, index) => (
                  <a
                    key={`${source.url}-${index}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-md border border-border bg-background/70 px-3 py-2 text-xs"
                  >
                    <p className="font-medium text-foreground">{source.title ?? source.url}</p>
                    {source.snippet ? <p className="mt-1 text-muted-foreground">{source.snippet}</p> : null}
                  </a>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <Card className="border border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Deliverables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {`No downloadable files are available yet for ${selectedBrand}.`}
            </p>
          </CardContent>
        </Card>
      )}

      <Button type="button" variant="outline" onClick={onStartNewResearch}>
        Start New Research
      </Button>
    </div>
  )
}

function SourceResearchRow({
  deliverablesByType,
  sourcesFound,
  onView,
}: {
  deliverablesByType: Map<DeliverableType, DeliverableFile>
  sourcesFound: number
  onView: (view: ViewKey) => void
}) {
  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Source research{" "}
          <span className="text-sm font-normal text-muted-foreground">
            {`· Valyu DeepResearch${sourcesFound ? `, ${sourcesFound} sources` : ""}`}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {DELIVERABLES.map((item) => {
          const file = deliverablesByType.get(item.type)
          if (!file) return null
          return (
            <div
              key={item.type}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-background/70 px-2.5 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">{item.subtitle}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`View ${item.title}`}
                  title="View"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                  onClick={() => onView(item.type)}
                >
                  <Eye aria-hidden="true" />
                </button>
                <a
                  aria-label={`Download ${item.title}`}
                  title="Download"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
                  href={`${buildDownloadUrl(file)}&disposition=attachment`}
                >
                  <Download aria-hidden="true" />
                </a>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function BriefViewer({ brief }: { brief: ResearchBrief }) {
  const [expanded, setExpanded] = useState(false)
  // The dashboard toggles dark mode with a `.dark` class; pass it on so the embedded
  // brief (which follows prefers-color-scheme by default) matches the page. null on the
  // server, so the iframe only mounts client-side with the right theme.
  const theme = useSyncExternalStore(subscribeToThemeClass, readThemeClass, () => null)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Interactive brief: hover the charts for exact values.</p>
        <div className="flex gap-1">
          <button
            type="button"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            {expanded ? "Collapse" : "Expand"}
          </button>
          <a
            className={buttonVariants({ variant: "ghost", size: "sm" })}
            href={briefAssetUrl(brief, "html", "inline")}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            New tab
          </a>
        </div>
      </div>
      {theme ? (
        <iframe
          title={brief.title}
          src={briefAssetUrl(brief, "html", "inline", { embed: "1", theme })}
          // No sandbox attribute on purpose: the download route serves the brief with a
          // `Content-Security-Policy: sandbox` header, which gives the document the same
          // opaque-origin isolation however it is loaded (iframe or new tab), and some
          // embedded browsers refuse to navigate attribute-sandboxed frames at all.
          className={`w-full rounded-md border border-border bg-background transition-[height] ${
            expanded ? "h-[1400px]" : "h-[760px]"
          }`}
        />
      ) : (
        <div className="h-[760px] rounded-md border border-border bg-background/70" />
      )}
    </div>
  )
}

function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

function readThemeClass(): "light" | "dark" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function renderView({
  activeView,
  result,
  deliverablesByType,
}: {
  activeView: DeliverableType
  result?: ResearchStatusResponse
  deliverablesByType: Map<DeliverableType, DeliverableFile>
}) {
  if (activeView === "pdf") {
    const file = deliverablesByType.get("pdf")
    if (!file) return <UnavailableView />
    const url = `${buildDownloadUrl(file)}&disposition=inline`
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
    const csvPreview = result?.csvPreview
    if (!csvPreview) {
      const file = deliverablesByType.get("csv")
      if (!file) return <UnavailableView />
      const url = `${buildDownloadUrl(file)}&disposition=inline`
      return (
        <div className="rounded-md border border-border bg-background/70 p-3 text-sm text-muted-foreground">
          <p className="mb-2">CSV preview table is not available for this report.</p>
          <a className={buttonVariants({ variant: "default" })} href={url} target="_blank" rel="noreferrer">
            <Eye className="mr-2 h-4 w-4" />
            Open CSV
          </a>
        </div>
      )
    }
    return (
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {csvPreview.columns.slice(0, 12).map((column) => (
                <th key={column} className="px-2 py-2 text-left font-medium text-muted-foreground">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {csvPreview.rows.map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`} className="border-b border-border last:border-0">
                {csvPreview.columns.slice(0, 12).map((_, colIndex) => (
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
    const reportText = result?.outputText || result?.executiveSummaryExcerpt
    if (!reportText) {
      const file = deliverablesByType.get("docx")
      if (!file) return <UnavailableView />
      const url = `${buildDownloadUrl(file)}&disposition=attachment`
      return (
        <div className="rounded-md border border-border bg-background/70 p-3 text-sm text-muted-foreground">
          <p className="mb-2">Inline DOCX text preview is not available for this report.</p>
          <a className={buttonVariants({ variant: "default" })} href={url} target="_blank" rel="noreferrer">
            <Eye className="mr-2 h-4 w-4" />
            Open DOCX
          </a>
        </div>
      )
    }
    return (
      <div className="max-h-[520px] overflow-auto rounded-md border border-border bg-background/70 p-3">
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
          {reportText || "No DOCX text preview available."}
        </p>
      </div>
    )
  }

  if (activeView === "pptx") {
    const file = deliverablesByType.get("pptx")
    if (!file) return <UnavailableView />
    const url = `${buildDownloadUrl(file)}&disposition=attachment`
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

function buildDownloadUrl(file: DeliverableFile) {
  if (file.source === "seed_local" && file.seedId) {
    const seedId = encodeURIComponent(file.seedId)
    const type = encodeURIComponent(file.type)
    return `/api/consult-me/download?seedId=${seedId}&type=${type}`
  }
  const remote = encodeURIComponent(file.remoteUrl ?? "")
  const type = encodeURIComponent(file.type)
  return `/api/consult-me/download?remoteUrl=${remote}&type=${type}`
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}
