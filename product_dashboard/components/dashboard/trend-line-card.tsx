"use client"

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type TrendLineDatum = {
  label: string
  value: number
}

export function TrendLineCard({
  title,
  subtitle,
  totalLabel,
  totalValue,
  changeLabel,
  changeValueLabel,
  data,
  color,
  formatter,
}: {
  title: string
  subtitle: string
  totalLabel: string
  totalValue: string
  changeLabel: string
  changeValueLabel: string
  data: TrendLineDatum[]
  color: string
  formatter?: (value: number) => string
}) {
  const formatValue = formatter ?? ((value: number) => value.toLocaleString())

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <p className="text-xs text-muted-foreground">{totalLabel}</p>
          <p className="text-3xl font-semibold">{totalValue}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs bg-[var(--color-accent)]/30 text-foreground px-2 py-0.5 rounded-full">
              {changeLabel}
            </span>
            <span className="text-xs text-muted-foreground">{changeValueLabel}</span>
          </div>
        </div>
        <div className="h-[140px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#737373" }} />
              <YAxis hide />
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
                formatter={(value: number) => [formatValue(value), title]}
              />
              <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
