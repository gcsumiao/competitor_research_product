"use client"

import { Brain, Building2, Factory, LineChart, Search } from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { resolveResearchSubjectForCompany } from "@/lib/consult-me/company-subjects"
import type { ResearchType } from "@/lib/consult-me/types"
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
  researchType: ResearchType
  onResearchTypeChange: (value: ResearchType) => void
  researchSubject: string
  onResearchSubjectChange: (value: string) => void
  researchFocus: string
  onResearchFocusChange: (value: string) => void
  isSubmitting?: boolean
  onDeepSearch: () => void
}

const RESEARCH_TYPES = [
  {
    id: "company",
    label: "Company",
    description: "Comprehensive analysis of a specific company.",
    icon: Building2,
    enabled: true,
    comingSoon: false,
  },
  {
    id: "market",
    label: "Market",
    description: "Market sizing, trends, and growth structure.",
    icon: LineChart,
    enabled: true,
    comingSoon: true,
  },
  {
    id: "competitive",
    label: "Competitive",
    description: "Positioning and share movement across rivals.",
    icon: LineChart,
    enabled: true,
    comingSoon: true,
  },
  {
    id: "industry",
    label: "Industry",
    description: "Macro and segment trends across the industry.",
    icon: Factory,
    enabled: true,
    comingSoon: true,
  },
  {
    id: "custom",
    label: "Custom",
    description: "Free-form strategic research objective.",
    icon: Search,
    enabled: true,
    comingSoon: true,
  },
] as const satisfies Array<{
  id: ResearchType
  label: string
  description: string
  icon: LucideIcon
  enabled: boolean
  comingSoon: boolean
}>

const RESEARCH_TYPE_CONFIG: Record<
  ResearchType,
  {
    subjectLabel: string
    subjectPlaceholder: string
    helperText: string
    exampleTerms: string[]
  }
> = {
  company: {
    subjectLabel: "",
    subjectPlaceholder: "",
    helperText: "",
    exampleTerms: [],
  },
  market: {
    subjectLabel: "Market / Segment",
    subjectPlaceholder: "e.g., AI Market, Automotive Market",
    helperText: "Market sizing, trends, and growth analysis.",
    exampleTerms: ["AI Market", "Automotive Market", "OBD Scanner Market", "EV Diagnostics Market"],
  },
  competitive: {
    subjectLabel: "Research Subject",
    subjectPlaceholder: "e.g., TOPDON vs Autel in tablet scanners",
    helperText: "Competitive landscape and strategic positioning analysis.",
    exampleTerms: [
      "TOPDON vs Autel",
      "Innova vs XTOOL",
      "Foxwell vs ANCEL",
      "OBDLink vs BlueDriver",
    ],
  },
  industry: {
    subjectLabel: "Research Subject",
    subjectPlaceholder: "e.g., Automotive diagnostics industry",
    helperText: "Industry-level structure, trends, and strategic implications.",
    exampleTerms: [
      "Automotive diagnostics industry",
      "Aftermarket repair tools industry",
      "Connected diagnostics trends",
      "DIY scanner adoption",
    ],
  },
  custom: {
    subjectLabel: "Research Topic",
    subjectPlaceholder: "Describe your research topic...",
    helperText: "Any business research question or topic.",
    exampleTerms: [],
  },
}

export function BrandLauncher({
  brands,
  selectedBrand,
  searchQuery,
  onSearchQueryChange,
  onSelectBrand,
  researchType,
  onResearchTypeChange,
  researchSubject,
  onResearchSubjectChange,
  researchFocus,
  onResearchFocusChange,
  isSubmitting = false,
  onDeepSearch,
}: BrandLauncherProps) {
  const selected = brands.find((brand) => brand.brand === selectedBrand)
  const mode = RESEARCH_TYPE_CONFIG[researchType]
  const isCompanyMode = researchType === "company"
  const isMarketMode = researchType === "market"
  const previewSubject = isCompanyMode
    ? resolveResearchSubjectForCompany(searchQuery.trim() || selectedBrand || researchSubject)
    : ""
  const canSubmit = isCompanyMode
    ? Boolean((researchSubject.trim() || selectedBrand || searchQuery.trim()).trim())
    : false
  const isFrozenMode = !isCompanyMode

  function handleSelectCompany(companyName: string) {
    onSelectBrand(companyName)
    onSearchQueryChange(companyName)
    onResearchSubjectChange(resolveResearchSubjectForCompany(companyName))
  }

  function handleSelectResearchType(nextType: ResearchType) {
    onResearchTypeChange(nextType)
    // Keep each research mode fully independent: clear shared fields when switching modes.
    onResearchSubjectChange("")
    onResearchFocusChange("")
  }

  return (
    <div className="space-y-4">
      <Card className="border border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Select Research Topic</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Research Type</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {RESEARCH_TYPES.map((item) => {
                const Icon = item.icon
                const active = researchType === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={!item.enabled}
                    onClick={() => handleSelectResearchType(item.id)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-all",
                      item.enabled && active
                        ? "border-foreground/60 bg-foreground/10"
                        : item.enabled
                          ? "border-border bg-background hover:border-foreground/35"
                          : "border-border bg-background text-muted-foreground"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="h-4 w-4" />
                      {item.label}
                      {item.comingSoon ? (
                        <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Coming Soon
                        </span>
                      ) : null}
                    </span>
                    <p className="mt-1 text-[11px]">{item.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {isCompanyMode ? (
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wide text-muted-foreground">Company Search</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => {
                    onSearchQueryChange(event.target.value)
                    onResearchSubjectChange(event.target.value)
                  }}
                  placeholder="Search company..."
                  className="pl-9"
                />
              </div>
              <p className="text-xs text-muted-foreground">Top suggested competitors:</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {brands.map((brand, index) => {
                  const active = brand.brand === selectedBrand
                  return (
                    <button
                      key={`${brand.rank}-${brand.brand}`}
                      type="button"
                      onClick={() => handleSelectCompany(brand.brand)}
                      className={cn(
                        "animate-in fade-in zoom-in-95 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-all duration-300",
                        active
                          ? "border-foreground/45 bg-foreground/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                      )}
                      style={{
                        animationDelay: `${Math.min(index, 12) * 30}ms`,
                        animationFillMode: "both",
                      }}
                    >
                      <span>{formatCompanyName(brand.brand)}</span>
                    </button>
                  )
                })}
              </div>
              {brands.length === 0 ? (
                <p className="text-xs text-muted-foreground">No company matched your current search.</p>
              ) : null}
              {previewSubject ? (
                <p className="text-xs text-muted-foreground">{`Research subject: ${previewSubject}`}</p>
              ) : null}
            </div>
          ) : null}

          {isMarketMode ? (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">Market sizing, trends, and growth analysis</p>
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  {mode.subjectLabel}
                </label>
                <Input
                  value={researchSubject}
                  onChange={(event) => onResearchSubjectChange(event.target.value)}
                  placeholder={mode.subjectPlaceholder}
                  disabled={isFrozenMode}
                />
                <div className="flex flex-wrap gap-2">
                  {mode.exampleTerms.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => onResearchSubjectChange(term)}
                      disabled={isFrozenMode}
                      className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">Research Focus</label>
                <textarea
                  value={researchFocus}
                  onChange={(event) => onResearchFocusChange(event.target.value)}
                  placeholder="Focus on TAM/SAM/SOM, growth drivers, segment concentration, and entry opportunities."
                  disabled={isFrozenMode}
                  className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </>
          ) : null}

          {!isCompanyMode && !isMarketMode ? (
            <>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  {mode.subjectLabel}
                </label>
                <Input
                  value={researchSubject}
                  onChange={(event) => onResearchSubjectChange(event.target.value)}
                  placeholder={mode.subjectPlaceholder}
                  disabled={isFrozenMode}
                />
                <p className="text-xs text-muted-foreground">{mode.helperText}</p>
                <div className="flex flex-wrap gap-2">
                  {mode.exampleTerms.map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() => onResearchSubjectChange(term)}
                      disabled={isFrozenMode}
                      className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Research Focus (Optional)
                </label>
                <textarea
                  value={researchFocus}
                  onChange={(event) => onResearchFocusChange(event.target.value)}
                  placeholder="Specify particular aspects to focus on, e.g., 'Focus on their AI capabilities and recent acquisitions' or 'Emphasize regulatory landscape and barriers to entry'"
                  disabled={isFrozenMode}
                  className="min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-amber-700">
                {`${researchType.charAt(0).toUpperCase() + researchType.slice(1)} research is coming soon. Company research is currently enabled.`}
              </p>
            </>
          ) : null}

          {isCompanyMode && selected ? (
            <div className="animate-in fade-in zoom-in-95 rounded-lg border border-foreground/30 bg-foreground/5 p-4 duration-300">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Selected Company</p>
              <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold text-foreground">
                <Building2 className="h-4 w-4" />
                {`#${selected.rank} ${selected.brand}`}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {`Rolling 12mo Revenue ${formatCurrencyCompact(selected.grandTotal)}`}
              </p>
            </div>
          ) : null}

          <Button type="button" className="w-full sm:w-auto" onClick={onDeepSearch} disabled={isSubmitting || !canSubmit}>
            <Brain className="mr-2 h-4 w-4" />
            {isCompanyMode ? (isSubmitting ? "Starting..." : "Deep Search") : "Coming Soon"}
          </Button>
        </CardContent>
      </Card>
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

function formatCompanyName(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}
