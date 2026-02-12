"use client"

import { Clock3, Loader2, SearchCheck } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ResearchConsoleProps = {
  selectedBrand: string
  etaMinutes: number
  progress: number
  stepsCompleted: number
  totalSteps: number
  sourcesFound: number
  activityFeed: string[]
  stepLabels: string[]
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
}: ResearchConsoleProps) {
  const percent = Math.min(100, Math.max(0, Math.round(progress * 100)))

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
                ETA {etaMinutes} minutes
              </span>
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Running
              </span>
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
              <p className="text-sm font-medium text-foreground">{`${Math.min(stepsCompleted, totalSteps)} / ${totalSteps}`}</p>
            </div>
            <div className="rounded-md border border-border bg-background/60 px-3 py-2">
              <p className="text-[11px] text-muted-foreground">Sources Found</p>
              <p className="text-sm font-medium text-foreground">{sourcesFound}</p>
            </div>
          </div>

          <div className="space-y-2">
            {stepLabels.map((step, index) => {
              const done = index < stepsCompleted
              const active = index === stepsCompleted && stepsCompleted < totalSteps
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
              {`Activity Feed  ${stepsCompleted} steps, ${sourcesFound} sources`}
            </summary>
            <div className="space-y-2 border-t border-border px-3 py-3">
              {activityFeed.map((activity, index) => (
                <div key={`${activity}-${index}`} className="flex items-start gap-2 text-xs">
                  <SearchCheck className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">{activity}</span>
                </div>
              ))}
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
