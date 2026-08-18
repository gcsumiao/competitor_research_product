"use client"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { LucideIcon } from "lucide-react"
import Image from "next/image"

export type MetricCardLogo = {
  src: string
  alt: string
  width: number
  height: number
  chipClassName?: string
}

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
  logo?: MetricCardLogo
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
  logo,
  valueClassName,
  secondaryValueClassName,
  changeClassName,
  showChange = true,
}: MetricCardProps) {
  return (
    <Card className="bg-card border border-border cursor-pointer hover:shadow-md transition-shadow">
      <CardContent className="p-5">
        {logo ? (
          <div className="flex items-center mb-3">
            <span
              className={cn(
                "inline-flex h-9 max-w-full items-center overflow-hidden rounded-lg px-2",
                logo.chipClassName
              )}
            >
              <Image
                src={logo.src}
                alt={logo.alt}
                width={logo.width}
                height={logo.height}
                className="h-6 w-auto max-w-full object-contain"
              />
            </span>
          </div>
        ) : null}
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
