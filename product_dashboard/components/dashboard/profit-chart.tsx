"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"

export type ProfitChartDatum = {
  label: string
  sales: number
  revenue: number
}

interface ProfitChartProps {
  data: ProfitChartDatum[]
  totalLabel: string
  totalValue: string
  changeLabel: string
  highlightIndex?: number
  leaders?: Array<{ label: string; value: string; sublabel: string; tone?: "green" | "orange" }>
}

export function ProfitChart({
  data,
  totalLabel,
  totalValue,
  changeLabel,
  highlightIndex,
  leaders,
}: ProfitChartProps) {
  const changeDirection = changeLabel.trim().startsWith("-") ? "down" : "up"
  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{totalLabel}</CardTitle>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-3xl font-semibold">{totalValue}</span>
            <span className="text-xs bg-[var(--color-accent)]/30 text-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
              {changeLabel}
              {changeLabel === "n/a" ? null : <span className="text-[10px]">{changeDirection}</span>}
            </span>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[var(--color-chart-gray)]" />
            <span className="text-xs text-muted-foreground">Total Units</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[var(--color-chart-orange)]" />
            <span className="text-xs text-muted-foreground">Total Revenue</span>
          </div>
          {leaders && leaders.length > 0 ? (
            <div className="ml-auto flex items-center gap-4">
              {leaders.map((leader) => (
                <div key={leader.label} className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded ${
                      leader.tone === "orange" ? "bg-orange-100" : "bg-green-100"
                    } flex items-center justify-center`}
                  >
                    <span
                      className={`text-[10px] ${
                        leader.tone === "orange" ? "text-orange-600" : "text-green-600"
                      } font-bold`}
                    >
                      {leader.label.slice(0, 1)}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs font-medium">{leader.label}</p>
                    <p className="text-[10px] text-muted-foreground">{leader.sublabel}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#737373" }} />
              <YAxis
                yAxisId="left"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#737373" }}
                tickFormatter={(value) => `$${Math.round(value / 1000)}k`}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#737373" }}
                tickFormatter={(value) => `${Math.round(value / 1000)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a1a",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "#fff" }}
                itemStyle={{ color: "#fff" }}
                formatter={(value: number, name: string) => [
                  name === "sales" ? value.toLocaleString() : `$${value.toLocaleString()}`,
                  name === "sales" ? "Units" : "Revenue",
                ]}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="sales" yAxisId="right" radius={[4, 4, 0, 0]} maxBarSize={20}>
                {data.map((entry, index) => (
                  <Cell
                    key={`sales-${index}`}
                    fill={index === highlightIndex ? "#d4d4d4" : "#e5e5e5"}
                  />
                ))}
              </Bar>
              <Bar dataKey="revenue" yAxisId="left" radius={[4, 4, 0, 0]} maxBarSize={20}>
                {data.map((entry, index) => (
                  <Cell
                    key={`revenue-${index}`}
                    fill={index === highlightIndex ? "#f97316" : "#fdba74"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
