"use client"

import { Brain, Building2, Factory, LineChart, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type RankedBrand = {
  brand: string
  rank: number
  grandTotal: number
}

type BrandLauncherProps = {
  brands: RankedBrand[]
  selectedBrand: string
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onSelectBrand: (brand: string) => void
  onDeepSearch: () => void
}

const RESEARCH_TYPES = [
  {
    id: "company",
    label: "Company",
    description: "Comprehensive analysis of a specific company.",
    icon: Building2,
    enabled: true,
  },
  {
    id: "market",
    label: "Market",
    description: "Cross-competitor market structure and movement.",
    icon: LineChart,
    enabled: false,
  },
  {
    id: "industry",
    label: "Industry",
    description: "Macro and segment trends across the industry.",
    icon: Factory,
    enabled: false,
  },
] as const

export function BrandLauncher({
  brands,
  selectedBrand,
  searchQuery,
  onSearchQueryChange,
  onSelectBrand,
  onDeepSearch,
}: BrandLauncherProps) {
  const selected = brands.find((brand) => brand.brand === selectedBrand)

  return (
    <div className="space-y-4">
      <Card className="border border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            Select Company For Deep Market Research
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Research Type</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {RESEARCH_TYPES.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.enabled}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-all",
                      item.enabled
                        ? "border-foreground/40 bg-foreground/5"
                        : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </span>
                    <p className="mt-1 text-[11px]">{item.description}</p>
                    {!item.enabled ? (
                      <p className="mt-1 text-[10px] uppercase tracking-wide">Coming soon</p>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search company..."
              className="pl-9"
            />
          </div>

          {selected ? (
            <div className="animate-in fade-in zoom-in-95 rounded-lg border border-foreground/30 bg-foreground/5 p-4 duration-300">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected Company</p>
              <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                <Building2 className="h-4 w-4" />
                {`#${selected.rank} ${selected.brand}`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {`Rolling 12mo Revenue ${formatCurrencyCompact(selected.grandTotal)}`}
              </p>
              <Button type="button" className="mt-3" onClick={onDeepSearch}>
                <Brain className="mr-2 h-4 w-4" />
                Deep Search
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {brands.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {brands.map((brand, index) => {
            const active = brand.brand === selectedBrand
            return (
              <button
                key={`${brand.rank}-${brand.brand}`}
                type="button"
                onClick={() => onSelectBrand(brand.brand)}
                className={cn(
                  "animate-in fade-in zoom-in-95 rounded-lg border p-3 text-left transition-all duration-300",
                  active
                    ? "border-foreground/50 bg-foreground/5 shadow-sm"
                    : "border-border bg-card hover:border-foreground/35 hover:bg-muted/20"
                )}
                style={{
                  animationDelay: `${Math.min(index, 12) * 35}ms`,
                  animationFillMode: "both",
                }}
              >
                <p className="text-xs font-medium text-muted-foreground">{`Company #${brand.rank}`}</p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  {brand.brand}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{formatCurrencyCompact(brand.grandTotal)}</p>
              </button>
            )
          })}
        </div>
      ) : (
        <Card className="border border-border bg-card">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No companies matched your search. Try another keyword.
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function formatCurrencyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}
