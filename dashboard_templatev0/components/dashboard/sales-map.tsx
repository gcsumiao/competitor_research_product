"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts"

export type SalesMapItem = {
  label: string
  value: number
  color: string
}

interface SalesMapProps {
  title: string
  subtitle: string
  items: SalesMapItem[]
  topLabel: string
  topValue: string
  growthLabel: string
  growthValue: string
  totalLabel: string
  totalValue: string
  valueFormatter?: (value: number) => string
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
  totalLabel,
  totalValue,
  valueFormatter,
}: SalesMapProps) {
  const total = items.reduce((sum, item) => sum + item.value, 0)
  const formatValue = valueFormatter ?? ((value: number) => `$${value.toLocaleString()}`)

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs bg-transparent">
            All ASINs <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs bg-transparent">
            Price Tiers <ChevronDown className="w-3 h-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          {/* Stats panel */}
          <div className="space-y-4">
            <div>
              <p className="text-xs text-muted-foreground">Top tier</p>
              <p className="text-2xl font-semibold">{topValue}</p>
              <p className="text-xs text-muted-foreground">{topLabel}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{growthLabel}</p>
              <p className="text-2xl font-semibold text-[var(--color-positive)]">{growthValue}</p>
              <p className="text-xs text-muted-foreground">MoM change</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{totalLabel}</p>
              <p className="text-2xl font-semibold">{totalValue || `$${total.toLocaleString()}`}</p>
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
