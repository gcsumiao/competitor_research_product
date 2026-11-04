"use client"

import { ArrowRight, Download, ExternalLink, Sparkles } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import type { BriefThreatLevel, ResearchBrief } from "@/lib/consult-me/types"

type BriefHeroCardProps = {
  brief: ResearchBrief
  /** Latest code-reader snapshot date (YYYY-MM-DD), used for the "newer data" hint. */
  snapshotDate?: string
  onOpen: () => void
}

const THREAT_STYLES: Record<BriefThreatLevel, { label: string; className: string }> = {
  high: { label: "Threat level: high", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  medium: {
    label: "Threat level: medium",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  low: {
    label: "Threat level: low",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
}

/**
 * Lead card for an analyst brief: the "so what for Innova" that sits ahead of the
 * source research deliverables. "Open brief" opens the embedded viewer below.
 */
export function BriefHeroCard({ brief, snapshotDate, onOpen }: BriefHeroCardProps) {
  const threat = THREAT_STYLES[brief.threatLevel]
  const hasHtml = brief.assets.includes("html")
  const hasPdf = brief.assets.includes("pdf")
  const newerData = isNewerMonth(snapshotDate, brief.dataThrough)

  return (
    <section
      aria-labelledby="consult-brief-title"
      className="rounded-xl border-2 border-primary/70 bg-card p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
          {`Innova analyst brief · Amazon data through ${formatMonth(brief.dataThrough)}`}
        </p>
        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${threat.className}`}>
          {threat.label}
        </span>
      </div>

      <h2 id="consult-brief-title" className="font-display mt-2 text-lg font-semibold leading-snug text-foreground">
        {brief.title}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{brief.summary}</p>

      {brief.highlights.length ? (
        <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {brief.highlights.map((item) => (
            <div key={item.label} className="rounded-lg bg-muted/60 px-3 py-2.5">
              <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
              <dd className="font-display mt-0.5 text-xl font-semibold text-foreground">{item.value}</dd>
              <dd className="text-[11px] text-muted-foreground">{item.note}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {newerData ? (
        <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          {`Newer Amazon data is available (${formatMonth(snapshotDate ?? "")}). This brief's figures run through ${formatMonth(brief.dataThrough)}.`}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {hasHtml ? (
          <button type="button" className={buttonVariants({ variant: "default" })} onClick={onOpen}>
            Open brief
            <ArrowRight aria-hidden="true" />
          </button>
        ) : null}
        {hasPdf ? (
          <a className={buttonVariants({ variant: "outline" })} href={briefAssetUrl(brief, "pdf", "attachment")}>
            <Download aria-hidden="true" />
            Download PDF
          </a>
        ) : null}
        {hasHtml ? (
          <a
            className={buttonVariants({ variant: "ghost" })}
            href={briefAssetUrl(brief, "html", "inline")}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink aria-hidden="true" />
            Open in new tab
          </a>
        ) : null}
      </div>
    </section>
  )
}

export function briefAssetUrl(
  brief: Pick<ResearchBrief, "seedId">,
  kind: "html" | "pdf",
  disposition: "inline" | "attachment",
  extra?: Record<string, string>
) {
  const params = new URLSearchParams({ seedId: brief.seedId, brief: kind, disposition, ...extra })
  return `/api/consult-me/download?${params.toString()}`
}

function formatMonth(isoDate: string) {
  const [year, month] = isoDate.split("-").map(Number)
  if (!year || !month) return isoDate
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** True when `latest` falls in a later calendar month than `through`. */
export function isNewerMonth(latest: string | undefined, through: string) {
  if (!latest) return false
  return latest.slice(0, 7) > through.slice(0, 7)
}
