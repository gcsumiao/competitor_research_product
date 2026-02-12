"use client"

import { useEffect, useMemo, useState } from "react"
import {
  Calendar,
  ClipboardList,
  ExternalLink,
  Play,
  Target,
  Upload,
  Pencil,
  Archive,
  Clock,
  CheckCircle2,
} from "lucide-react"

import { MetricCard } from "@/components/dashboard/metric-card"
import { PageHeader } from "@/components/dashboard/page-header"
import { useDashboardFilters } from "@/components/dashboard/use-dashboard-filters"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import type { DashboardData, ProductSummary } from "@/lib/competitor-data"

const STATUS_COLORS = ["bg-emerald-500", "bg-amber-500", "bg-blue-500", "bg-slate-400"]

export function SurveysClient({ data }: { data: DashboardData }) {
  const {
    categories,
    selectedCategory,
    selectedSnapshot,
    snapshots,
    setCategory,
    setSnapshot,
  } = useDashboardFilters(data)

  const activeSnapshot = selectedSnapshot

  const productTypes = useMemo(
    () => buildProductTypeOptions(activeSnapshot?.topProducts ?? []),
    [activeSnapshot]
  )
  const [selectedType, setSelectedType] = useState(productTypes[0] ?? "All types")

  useEffect(() => {
    if (!productTypes.length) return
    if (!productTypes.includes(selectedType)) {
      setSelectedType(productTypes[0])
    }
  }, [productTypes, selectedType])

  const surveyStatus = [
    { label: "Launched", count: 1, icon: Play, color: STATUS_COLORS[0] },
    { label: "In progress", count: 1, icon: Clock, color: STATUS_COLORS[1] },
    { label: "Active", count: 1, icon: CheckCircle2, color: STATUS_COLORS[2] },
    { label: "Archived", count: 0, icon: Archive, color: STATUS_COLORS[3] },
  ]

  const maxStatus = Math.max(1, ...surveyStatus.map((status) => status.count))

  const metricCards = [
    {
      title: "Surveys launched",
      value: "1",
      change: "DMM design",
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: Play,
    },
    {
      title: "In progress",
      value: "1",
      change: "Fielding",
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: Clock,
    },
    {
      title: "Active",
      value: "1",
      change: "Fillout",
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: CheckCircle2,
    },
    {
      title: "Archived",
      value: "0",
      change: "n/a",
      changeSuffix: "",
      isPositiveOutcome: true,
      icon: Archive,
    },
  ]

  const headerDescription = activeSnapshot
    ? `Snapshot ${activeSnapshot.date} | Survey control center`
    : "Survey control center"

  return (
    <>
      <PageHeader title="Market Survey" description={headerDescription}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <ClipboardList className="w-4 h-4" />
              {selectedCategory?.label ?? "Select category"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {categories.map((category) => (
              <DropdownMenuItem key={category.id} onSelect={() => setCategory(category.id)}>
                {category.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="flex items-center gap-2 bg-transparent text-sm">
              <Calendar className="w-4 h-4" />
              {selectedSnapshot?.date ?? "Snapshot"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {snapshots.map((snapshot) => (
              <DropdownMenuItem key={snapshot.date} onSelect={() => setSnapshot(snapshot.date)}>
                {snapshot.date}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="outline" className="flex items-center gap-2 bg-transparent">
          <Upload className="w-4 h-4" />
          Sync Fillout
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {metricCards.map((metric) => (
          <MetricCard
            key={metric.title}
            title={metric.title}
            value={metric.value}
            change={metric.change}
            changeSuffix={metric.changeSuffix}
            isPositiveOutcome={metric.isPositiveOutcome}
            icon={metric.icon}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="bg-card border border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Survey status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {surveyStatus.map((status) => (
              <div key={status.label} className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <status.icon className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium">{status.label}</span>
                  </div>
                  <span className="text-muted-foreground">{status.count}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div
                    className={`h-2 rounded-full ${status.color}`}
                    style={{ width: `${(status.count / maxStatus) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Survey highlights</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>DMM design round</span>
              <span className="font-medium">1 active</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Target responses</span>
              <span className="font-medium">120</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Last sync</span>
              <span className="font-medium">Manual</span>
            </div>
            <Button variant="outline" className="w-full gap-2 bg-transparent">
              <ExternalLink className="w-4 h-4" />
              Open Fillout results
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-card border border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Survey control center</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Product type</p>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between bg-transparent">
                      <span>{selectedType}</span>
                      <Calendar className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {productTypes.map((type) => (
                      <DropdownMenuItem key={type} onSelect={() => setSelectedType(type)}>
                        {type}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Start date</p>
                <Input type="date" />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">End date</p>
                <Input type="date" />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Target audience</p>
                <Input placeholder="Pro technicians, DIYers, field teams" />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Survey status</p>
                <Input defaultValue="Round 1 - DMM design" />
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Survey notes</p>
              <Textarea placeholder="Document hypothesis, pricing guardrails, or key research questions." />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button className="gap-2">
                <Play className="w-4 h-4" />
                Launch survey
              </Button>
              <Button variant="outline" className="gap-2 bg-transparent">
                <ExternalLink className="w-4 h-4" />
                View results
              </Button>
              <Button variant="outline" className="gap-2 bg-transparent">
                <Pencil className="w-4 h-4" />
                Edit survey
              </Button>
              <Button variant="outline" className="gap-2 bg-transparent">
                <Target className="w-4 h-4" />
                Choose audience
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Active survey</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Program</p>
              <p className="font-medium">DMM Design Concepts</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Platform</p>
              <p className="font-medium">Fillout</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Audience</p>
              <p className="font-medium">Pro technicians + DIY testers</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Responses</p>
              <p className="font-medium">Use Fillout export</p>
            </div>
            <Button variant="outline" className="w-full gap-2 bg-transparent">
              <ExternalLink className="w-4 h-4" />
              Open Fillout results
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function buildProductTypeOptions(products: ProductSummary[]) {
  const types = new Set<string>()
  for (const product of products.slice(0, 50)) {
    const label = product.subcategory?.trim()
    if (label) types.add(label)
  }
  return ["All types", ...Array.from(types).sort()]
}
