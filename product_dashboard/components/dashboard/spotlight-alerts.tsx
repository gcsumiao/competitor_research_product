"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, Info, Radar } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

type SpotlightSeverity = "info" | "watch" | "risk"

type SpotlightAlert = {
  id: string
  severity: SpotlightSeverity
  title: string
  detail: string
}

type SpotlightResponse = {
  categoryId: string
  snapshotDate: string
  alerts: SpotlightAlert[]
}

function iconFor(severity: SpotlightSeverity) {
  if (severity === "risk") return AlertTriangle
  if (severity === "watch") return Radar
  return Info
}

function toneFor(severity: SpotlightSeverity) {
  if (severity === "risk") return "border-red-200 bg-red-50"
  if (severity === "watch") return "border-amber-200 bg-amber-50"
  return "border-border bg-card"
}

export function SpotlightAlerts() {
  const searchParams = useSearchParams()
  const category = searchParams.get("category") ?? ""
  const snapshot = searchParams.get("snapshot") ?? ""

  const key = useMemo(() => `${category}:${snapshot}`, [category, snapshot])
  const [data, setData] = useState<SpotlightResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/spotlight?category=${encodeURIComponent(category)}&snapshot=${encodeURIComponent(snapshot)}`, {
      method: "GET",
    })
      .then((res) => res.json())
      .then((data: SpotlightResponse) => {
        if (cancelled) return
        setData(data)
      })
      .catch(() => {
        if (cancelled) return
        setData(null)
      })
    return () => {
      cancelled = true
    }
  }, [category, snapshot, key])

  const alerts = data?.alerts ?? []
  if (!alerts.length) return null

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-[var(--color-accent)]" />
        <p className="text-sm font-medium">This Month Spotlight</p>
        <p className="text-xs text-muted-foreground">
          {data?.snapshotDate ? `Snapshot ${data.snapshotDate}` : ""}
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {alerts.map((alert) => {
          const Icon = iconFor(alert.severity)
          return (
            <Card
              key={alert.id}
              className={cn(
                "border p-3",
                toneFor(alert.severity)
              )}
            >
              <div className="flex items-start gap-2">
                <Icon className="w-4 h-4 mt-0.5 text-foreground/80" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-5">{alert.title}</p>
                  <p className="text-xs text-muted-foreground leading-5">{alert.detail}</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
