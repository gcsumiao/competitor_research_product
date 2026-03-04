"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"

interface MetricCardProps {
  title: string
  value: string
  valueBadgeText?: string
  valueBadgeClassName?: string
  secondaryValue?: string
  change: string
  isPositiveOutcome: boolean
  icon: LucideIcon
  changeSuffix?: string
  valueClassName?: string
  secondaryValueClassName?: string
  changeClassName?: string
  showChange?: boolean
}

export function MetricCard({
  title,
  value,
  valueBadgeText,
  valueBadgeClassName,
  secondaryValue,
  change,
  isPositiveOutcome,
  icon: Icon,
  changeSuffix = "",
  valueClassName,
  secondaryValueClassName,
  changeClassName,
  showChange = true,
}: MetricCardProps) {
  return (
    <Card className="bg-card border border-border cursor-pointer hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-2">
          <span className="text-sm text-muted-foreground">{title}</span>
          <div className="p-2 bg-muted rounded-lg">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        </div>
        <div className="mb-1 flex items-center gap-2">
          <p className={cn("text-3xl font-semibold", valueClassName)}>{value}</p>
          {valueBadgeText ? (
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
                valueBadgeClassName
              )}
            >
              {valueBadgeText}
            </span>
          ) : null}
        </div>
        {secondaryValue ? (
          <p className={cn("text-xs text-muted-foreground mb-2", secondaryValueClassName)}>
            {secondaryValue}
          </p>
        ) : (
          <div className="mb-2" />
        )}
        {showChange ? (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-xs font-medium",
                isPositiveOutcome ? "text-[var(--color-positive)]" : "text-[var(--color-negative)]",
                changeClassName
              )}
            >
              {changeSuffix && change !== "n/a" ? `${change} ${changeSuffix}` : change}
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
