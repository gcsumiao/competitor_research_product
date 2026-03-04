"use client"

import { useEffect, useState } from "react"

import { Clock3, Loader2, SearchCheck } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ResearchConsoleProps = {
  selectedBrand: string
  etaMinutes?: number
  progress: number
  stepsCompleted: number
  totalSteps: number
  sourcesFound: number
  activityFeed: string[]
  stepLabels: string[]
  onCancel?: () => void
  isCancelling?: boolean
}

export function ResearchConsole({
  selectedBrand,
  etaMinutes,
  progress,
  stepsCompleted,
  totalSteps,
  sourcesFound,
  activityFeed,
  stepLabels,
  onCancel,
  isCancelling = false,
}: ResearchConsoleProps) {
  const rawPercent = Math.min(100, Math.max(0, Math.round(progress * 100)))
  const [displayPercent, setDisplayPercent] = useState(rawPercent)
  const isLiveRunning = rawPercent < 100

  useEffect(() => {
    const interval = window.setInterval(() => {
      setDisplayPercent((previous) => {
        if (rawPercent >= 100) return 100
        const baseline = Math.max(previous, rawPercent)
        const safeTotal = Math.max(1, totalSteps)
        const optimisticCap = Math.min(96, Math.max(rawPercent + 45, 70))
        const stageCap = Math.min(
          optimisticCap,
          Math.max(
            rawPercent,
            Math.round(((Math.min(stepsCompleted + 1, safeTotal) / safeTotal) * 100) + 15)
          )
        )
        if (baseline >= stageCap) return baseline
        const step = Math.max(1, Math.round((stageCap - baseline) / 20))
        return Math.min(stageCap, baseline + step)
      })
    }, 700)

    return () => window.clearInterval(interval)
  }, [rawPercent, stepsCompleted, totalSteps])

  const percent = rawPercent >= 100 ? 100 : Math.max(displayPercent, rawPercent)
  const stepFromProgress =
    percent >= 100
      ? totalSteps
      : Math.min(Math.max(0, totalSteps - 1), Math.floor((percent / 100) * totalSteps))
  const shownSteps = Math.max(
    Math.min(totalSteps, stepsCompleted),
    stepFromProgress,
    isLiveRunning ? 1 : 0
  )
  const sourceFloor = Math.floor((percent / 100) * Math.max(sourcesFound, totalSteps * 10))
  const shownSources = Math.max(sourcesFound, sourceFloor)
  const shownActivity = buildAnimatedActivityFeed({
    selectedBrand,
    backendFeed: activityFeed,
    stepLabels,
    shownSteps,
    shownSources,
  })

  return (
    <div className="space-y-4">
      <Card className="border border-emerald-500/40 bg-emerald-500/10">
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-emerald-700">Research In Progress</p>
            <p className="text-xs text-emerald-700">{`${percent}%`}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">{selectedBrand}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {etaMinutes ? `ETA ${etaMinutes} minutes` : "ETA estimating..."}
              </span>
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running
              </span>
            </div>
            <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              Live Research Mode
            </div>
            <div className="mt-2 h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-foreground transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

            <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Steps</p>
              <p className="text-sm font-medium text-foreground">{`${Math.min(shownSteps, totalSteps)} / ${totalSteps}`}</p>
            </div>
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Sources Found</p>
              <p className="text-sm font-medium text-foreground">{shownSources}</p>
            </div>
          </div>

          <div className="space-y-2">
            {stepLabels.map((step, index) => {
              const done = index < shownSteps
              const active = index === shownSteps && shownSteps < totalSteps
              return (
                <div
                  key={step}
                  className={`rounded-md border px-3 py-2 text-xs ${
                    done
                      ? "border-emerald-600/40 bg-emerald-600/10 text-emerald-700"
                      : active
                        ? "border-foreground/40 bg-foreground/5 text-foreground"
                        : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  {`Step ${index + 1}: ${step}`}
                </div>
              )
            })}
          </div>

          <details className="rounded-md border border-border bg-background/70">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {`Activity Feed  ${shownSteps} steps, ${shownSources} sources`}
            </summary>
            <div className="space-y-2 border-t border-border px-3 py-3">
              {shownActivity.map((activity, index) => (
                <div key={`${activity}-${index}`} className="flex items-start gap-2 text-xs">
                  <SearchCheck className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{activity}</span>
                </div>
              ))}
            </div>
          </details>

          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={isCancelling}
              className="rounded-md border border-border px-3 py-2 text-sm"
            >
              {isCancelling ? "Cancelling..." : "Cancel Research"}
            </button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function buildAnimatedActivityFeed({
  selectedBrand,
  backendFeed,
  stepLabels,
  shownSteps,
  shownSources,
}: {
  selectedBrand: string
  backendFeed: string[]
  stepLabels: string[]
  shownSteps: number
  shownSources: number
}) {
  const targetCount = Math.max(1, Math.min(stepLabels.length, shownSteps + 1))
  if (backendFeed.length >= targetCount) {
    return backendFeed.slice(0, targetCount)
  }

  const fallback: string[] = []
  for (let i = 0; i < targetCount; i += 1) {
    const step = stepLabels[i] ?? `Step ${i + 1}`
    const sourceMark = Math.max(1, Math.round((shownSources / Math.max(1, targetCount)) * (i + 1)))
    fallback.push(`${selectedBrand}: ${step} (${sourceMark} sources reviewed)`)
  }
  return fallback
}
