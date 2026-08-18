"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

import { formatCurrencyCompact, formatPercent } from "@/lib/dashboard-format"

export type SalesMapItem = {
  label: string
  value: number
  color: string
  revenueShare?: number
  unitsShare?: number
}

export type SalesMapControl = {
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}

interface SalesMapProps {
  title: string
  subtitle: string
  items: SalesMapItem[]
  topLabel: string
  topValue: string
  growthLabel: string
  growthValue: string
  growthSubLabel?: string
  growthSecondaryValue?: string
  growthSecondaryLabel?: string
  growthValueClassName?: string
  growthSecondaryValueClassName?: string
  totalLabel: string
  totalValue: string
  valueFormatter?: (value: number) => string
  toggleControl?: SalesMapControl
  primaryControl?: SalesMapControl
  secondaryControl?: SalesMapControl
  topDisplayOrder?: "value-first" | "label-first"
  growthDisplay?: "default" | "paired"
  highlightPrimaryControl?: boolean
}

const CustomTooltip = ({
  active,
  payload,
  formatValue,
}: {
  active?: boolean
  payload?: Array<{ payload: SalesMapItem }>
  formatValue: (value: number) => string
}) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload
    return (
      <div className="bg-card px-3 py-2 rounded-lg shadow-lg text-xs font-medium border border-border">
        <p className="font-semibold">{data.label}</p>
        <p style={{ color: data.color }}>{formatValue(data.value)}</p>
        {typeof data.revenueShare === "number" ? (
          <p className="text-muted-foreground">Revenue %: {formatPercent(data.revenueShare)}</p>
        ) : null}
        {typeof data.unitsShare === "number" ? (
          <p className="text-muted-foreground">Units %: {formatPercent(data.unitsShare)}</p>
        ) : null}
      </div>
    )
  }
  return null
}

export function SalesMap({
  title,
  subtitle,
  items,
  topLabel,
  topValue,
  growthLabel,
  growthValue,
  growthSubLabel,
  growthSecondaryValue,
  growthSecondaryLabel,
  growthValueClassName,
  growthSecondaryValueClassName,
  totalLabel,
  totalValue,
  valueFormatter,
  toggleControl,
  primaryControl,
  secondaryControl,
  topDisplayOrder = "value-first",
  growthDisplay = "default",
  highlightPrimaryControl = false,
}: SalesMapProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const formatValue = valueFormatter ?? formatCurrencyCompact

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {toggleControl || primaryControl || secondaryControl ? (
          <div className="flex items-center gap-2">
            {toggleControl ? (
              <div className="flex items-center rounded-full border border-border bg-background/40 p-0.5">
                {toggleControl.options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => toggleControl.onChange(option.value)}
                    className={[
                      "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
                      toggleControl.value === option.value
                        ? "bg-[var(--color-accent)] text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}

            {primaryControl ? (
              <Select
                value={primaryControl.value}
                onValueChange={(value) => {
                  if (value) primaryControl.onChange(value)
                }}
              >
                <SelectTrigger
                  size="sm"
                  className={[
                    "h-7 min-w-[124px] text-xs",
                    highlightPrimaryControl
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)] font-medium text-foreground hover:bg-[var(--color-accent)]"
                      : "",
                  ].join(" ")}
                >
                  <SelectValue>
                    {primaryControl.options.find(
                      (option) => option.value === primaryControl.value
                    )?.label ?? primaryControl.value}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {primaryControl.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {secondaryControl ? (
              <Select
                value={secondaryControl.value}
                onValueChange={(value) => {
                  if (value) secondaryControl.onChange(value)
                }}
              >
                <SelectTrigger size="sm" className="h-7 min-w-[124px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {secondaryControl.options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          {/* Stats panel */}
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Top tier</p>
              {topDisplayOrder === "label-first" ? (
                <>
                  <p className="text-2xl font-semibold">{topLabel}</p>
                  <p className="text-xs text-muted-foreground">{topValue}</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-semibold">{topValue}</p>
                  <p className="text-xs text-muted-foreground">{topLabel}</p>
                </>
              )}
            </div>
            {growthDisplay === "paired" ? (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {growthSubLabel ?? "MoM change"}
                  </p>
                  <p
                    className={[
                      "mt-1 text-base font-semibold",
                      growthValueClassName ?? "text-[var(--color-positive)]",
                    ].join(" ")}
                  >
                    {growthValue}
                  </p>
                </div>
                {growthSecondaryValue ? (
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {growthSecondaryLabel ?? "YoY change"}
                    </p>
                    <p
                      className={[
                        "mt-1 text-base font-semibold",
                        growthSecondaryValueClassName ?? "text-[var(--color-positive)]",
                      ].join(" ")}
                    >
                      {growthSecondaryValue}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <p className="text-xs text-muted-foreground">{growthLabel}</p>
                <p className={["text-2xl font-semibold", growthValueClassName ?? "text-[var(--color-positive)]"].join(" ")}>
                  {growthValue}
                </p>
                <p className="text-xs text-muted-foreground">{growthSubLabel ?? "MoM change"}</p>
                {growthSecondaryValue ? (
                  <>
                    <p
                      className={[
                        "text-base font-semibold mt-1",
                        growthSecondaryValueClassName ?? "text-[var(--color-positive)]",
                      ].join(" ")}
                    >
                      {growthSecondaryValue}
                    </p>
                    <p className="text-xs text-muted-foreground">{growthSecondaryLabel ?? "YoY change"}</p>
                  </>
                ) : null}
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">{totalLabel}</p>
              <p className="text-2xl font-semibold">{totalValue || formatCurrencyCompact(total)}</p>
            </div>
          </div>

          {/* Pie Chart */}
          <div className="flex flex-col">
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={items}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {items.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip formatValue={formatValue} />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            
            {/* Legend */}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {items.map((item) => (
                <div key={item.label} className="flex items-center gap-2">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-xs text-muted-foreground truncate">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
