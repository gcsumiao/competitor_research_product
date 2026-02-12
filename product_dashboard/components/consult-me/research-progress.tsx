"use client"

import { CheckCircle2, Clock3 } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type ResearchProgressProps = {
  etaMinutes: number
  progress: number
  currentStepIndex: number
  isComplete: boolean
}

const STEPS = [
  "Scope Alignment",
  "Source Discovery",
  "Competitor Benchmark Matrix",
  "Strategic Synthesis",
  "Deliverable Packaging",
]

export function ResearchProgress({
  etaMinutes,
  progress,
  currentStepIndex,
  isComplete,
}: ResearchProgressProps) {
  const percent = Math.min(100, Math.max(0, Math.round(progress * 100)))

  return (
    <Card className="border border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">Deep Research Progress</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              ETA {etaMinutes} min
            </span>
            <span>{isComplete ? "Completed" : `${percent}%`}</span>
          </div>
          <div className="mt-2 h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-foreground transition-all duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          {STEPS.map((step, index) => {
            const done = isComplete || index < currentStepIndex
            const active = !isComplete && index === currentStepIndex
            return (
              <div
                key={step}
                className={`flex items-center justify-between rounded-md border px-3 py-2 text-xs ${
                  done
                    ? "border-emerald-600/40 bg-emerald-600/10"
                    : active
                      ? "border-foreground/40 bg-foreground/5"
                      : "border-border bg-background"
                }`}
              >
                <span>{`Step ${index + 1}: ${step}`}</span>
                {done ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Done
                  </span>
                ) : active ? (
                  <span className="text-foreground">In progress</span>
                ) : (
                  <span className="text-muted-foreground">Pending</span>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
