"use client"

import { useEffect, useState } from "react"
import { Calendar } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { BrandLauncher } from "@/components/consult-me/brand-launcher"
import { ResearchConsole } from "@/components/consult-me/research-console"
import { ResultsWorkspace } from "@/components/consult-me/results-workspace"
import { PageHeader } from "@/components/dashboard/page-header"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { BrandResearchAsset, BrandResearchAssetMap } from "@/lib/consult-me/types"
import type { DashboardData } from "@/lib/competitor-data"
import { cn } from "@/lib/utils"

type RankedBrand = {
  brand: string
  rank: number
  grandTotal: number
}

type RunStage = "idle" | "running" | "completed"

type PersistedRunState = {
  stage: RunStage
  startedAt: number
  etaMinutes: number
  durationMs: number
  sourceTarget: number
  currentStep: number
  sourcesFound: number
  notifyLater: boolean
  completedAt?: number
}

const STEP_LABELS = [
  "Scope Alignment",
  "Source Discovery",
  "Competitor Benchmark Matrix",
  "Strategic Synthesis",
  "Deliverable Packaging",
]

const TOTAL_STEPS = STEP_LABELS.length

export function ConsultMeClient({
  data,
  researchAssets,
}: {
  data: DashboardData
  researchAssets: BrandResearchAssetMap
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const codeReaderCategory = data.categories.find((item) => item.id === "code_reader_scanner")
  const snapshots = codeReaderCategory?.snapshots ?? []
  const snapshotParam = searchParams.get("snapshot")
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.date === snapshotParam) ?? snapshots[snapshots.length - 1]

  const topBrands = (selectedSnapshot?.rolling12?.revenue?.brands ?? []).slice(0, 25)

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedBrandOverride, setSelectedBrandOverride] = useState("")

  const filteredBrands = (() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return topBrands
    return topBrands.filter((brand) => brand.brand.toLowerCase().includes(query))
  })()

  const selectedBrand = filteredBrands.some((brand) => brand.brand === selectedBrandOverride)
    ? selectedBrandOverride
    : (filteredBrands[0]?.brand ?? "")
  const selectedBrandKey = normalizeBrandKey(selectedBrand)
  const selectedAsset = selectedBrandKey ? researchAssets[selectedBrandKey] : undefined

  const runStorageKey = `consult-me:${selectedSnapshot?.date ?? "none"}:${selectedBrandKey || "none"}`

  if (!codeReaderCategory || !selectedSnapshot) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        Code Reader snapshot data is unavailable for Consult Me.
      </div>
    )
  }

  return (
    <>
      <PageHeader
        title="Consult Me — Market Deep Research"
        description={`Code Reader deep research console | Snapshot ${selectedSnapshot.date}`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex items-center gap-2 bg-transparent text-sm"
            )}
          >
            <Calendar className="w-4 h-4" />
            {selectedSnapshot.date}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {snapshots.map((snapshot) => (
              <DropdownMenuItem
                key={snapshot.date}
                onClick={() => {
                  const params = new URLSearchParams(searchParams)
                  params.set("snapshot", snapshot.date)
                  router.replace(`${pathname}?${params.toString()}`, { scroll: false })
                }}
              >
                {snapshot.date}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      <ConsultMeSession
        key={runStorageKey}
        selectedBrand={selectedBrand}
        selectedAsset={selectedAsset}
        brands={filteredBrands}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onSelectBrand={setSelectedBrandOverride}
        runStorageKey={runStorageKey}
      />
    </>
  )
}

function ConsultMeSession({
  selectedBrand,
  selectedAsset,
  brands,
  searchQuery,
  onSearchQueryChange,
  onSelectBrand,
  runStorageKey,
}: {
  selectedBrand: string
  selectedAsset?: BrandResearchAsset
  brands: RankedBrand[]
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onSelectBrand: (brand: string) => void
  runStorageKey: string
}) {
  const [runState, setRunState] = useState<PersistedRunState>(() => readRunState(runStorageKey))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (typeof window === "undefined") return
    window.localStorage.setItem(runStorageKey, JSON.stringify(runState))
  }, [runState, runStorageKey])

  useEffect(() => {
    if (runState.stage !== "running") return

    const timer = window.setInterval(() => {
      const currentNow = Date.now()
      setNow(currentNow)
      setRunState((current) => {
        if (current.stage !== "running") return current
        const progress = Math.min(1, Math.max(0, (currentNow - current.startedAt) / current.durationMs))
        const nextStep = Math.min(TOTAL_STEPS, Math.floor(progress * TOTAL_STEPS))
        const nextSources = Math.max(1, Math.floor(current.sourceTarget * progress))
        if (progress >= 1) {
          return {
            ...current,
            stage: "completed",
            currentStep: TOTAL_STEPS,
            sourcesFound: current.sourceTarget,
            completedAt: currentNow,
          }
        }
        return {
          ...current,
          currentStep: nextStep,
          sourcesFound: nextSources,
        }
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [runState.stage])

  const progress = runState.stage === "idle"
    ? 0
    : Math.min(1, Math.max(0, (now - runState.startedAt) / runState.durationMs))
  const stepsCompleted = runState.stage === "idle"
    ? 0
    : Math.min(TOTAL_STEPS, runState.currentStep)
  const sourcesFound = runState.stage === "idle" ? 0 : runState.sourcesFound

  const activityFeed = buildActivityFeed({
    selectedBrand,
    stepLabels: selectedAsset?.activityTemplate ?? defaultActivityTemplate(selectedBrand),
    stepsCompleted,
    sourcesFound,
  })

  const startResearch = () => {
    if (!selectedBrand) return
    const etaMinutes = randomInt(10, 20)
    const sourceTarget = selectedAsset?.defaultSources ?? (42 + (stringHash(normalizeBrandKey(selectedBrand)) % 40))
    const startedAt = Date.now()
    setNow(startedAt)
    setRunState({
      stage: "running",
      startedAt,
      etaMinutes,
      durationMs: etaMinutes * 60_000,
      sourceTarget,
      currentStep: 0,
      sourcesFound: 0,
      notifyLater: false,
    })
  }

  const startNewResearch = () => {
    startResearch()
  }

  const toggleNotify = () => {
    setRunState((current) => ({
      ...current,
      notifyLater: !current.notifyLater,
    }))
  }

  if (runState.stage === "idle") {
    return (
      <BrandLauncher
        brands={brands}
        selectedBrand={selectedBrand}
        searchQuery={searchQuery}
        onSearchQueryChange={onSearchQueryChange}
        onSelectBrand={onSelectBrand}
        onDeepSearch={startResearch}
      />
    )
  }

  if (runState.stage === "running") {
    return (
      <ResearchConsole
        selectedBrand={selectedBrand}
        etaMinutes={runState.etaMinutes}
        progress={progress}
        stepsCompleted={stepsCompleted}
        totalSteps={TOTAL_STEPS}
        sourcesFound={sourcesFound}
        activityFeed={activityFeed}
        stepLabels={STEP_LABELS}
      />
    )
  }

  return (
    <ResultsWorkspace
      selectedBrand={selectedBrand}
      asset={selectedAsset}
      stepsCompleted={TOTAL_STEPS}
      sourcesFound={runState.sourceTarget}
      activityFeed={activityFeed}
      notifyLater={runState.notifyLater}
      onToggleNotify={toggleNotify}
      onStartNewResearch={startNewResearch}
    />
  )
}

function readRunState(storageKey: string): PersistedRunState {
  if (typeof window === "undefined") {
    return {
      stage: "idle",
      startedAt: 0,
      etaMinutes: 10,
      durationMs: 10 * 60_000,
      sourceTarget: 50,
      currentStep: 0,
      sourcesFound: 0,
      notifyLater: false,
    }
  }

  const raw = window.localStorage.getItem(storageKey)
  if (!raw) {
    return {
      stage: "idle",
      startedAt: 0,
      etaMinutes: 10,
      durationMs: 10 * 60_000,
      sourceTarget: 50,
      currentStep: 0,
      sourcesFound: 0,
      notifyLater: false,
    }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedRunState>
    if (
      parsed.stage !== "idle" &&
      parsed.stage !== "running" &&
      parsed.stage !== "completed"
    ) {
      throw new Error("Invalid stage")
    }
    return {
      stage: parsed.stage,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : 0,
      etaMinutes: typeof parsed.etaMinutes === "number" ? parsed.etaMinutes : 10,
      durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 10 * 60_000,
      sourceTarget: typeof parsed.sourceTarget === "number" ? parsed.sourceTarget : 50,
      currentStep: typeof parsed.currentStep === "number" ? parsed.currentStep : 0,
      sourcesFound: typeof parsed.sourcesFound === "number" ? parsed.sourcesFound : 0,
      notifyLater: Boolean(parsed.notifyLater),
      completedAt: typeof parsed.completedAt === "number" ? parsed.completedAt : undefined,
    }
  } catch {
    return {
      stage: "idle",
      startedAt: 0,
      etaMinutes: 10,
      durationMs: 10 * 60_000,
      sourceTarget: 50,
      currentStep: 0,
      sourcesFound: 0,
      notifyLater: false,
    }
  }
}

function buildActivityFeed({
  selectedBrand,
  stepLabels,
  stepsCompleted,
  sourcesFound,
}: {
  selectedBrand: string
  stepLabels: string[]
  stepsCompleted: number
  sourcesFound: number
}) {
  const lines: string[] = []
  const labelPrefix = selectedBrand || "Selected company"
  const count = Math.max(1, Math.min(stepLabels.length, stepsCompleted + 1))
  for (let i = 0; i < count; i += 1) {
    const stepLabel = stepLabels[i] ?? STEP_LABELS[i] ?? "Analysis Step"
    const sourceMark = Math.max(1, Math.round((sourcesFound / Math.max(1, count)) * (i + 1)))
    lines.push(`${labelPrefix}: ${stepLabel} (${sourceMark} sources reviewed)`)
  }
  return lines
}

function defaultActivityTemplate(brand: string) {
  return [
    `Initiated deep market research for ${brand}.`,
    "Validated scope and benchmark dimensions.",
    "Expanded discovery across market and competitor sources.",
    "Compiled comparative metrics and strategic signals.",
    "Packaged deliverables for stakeholder review.",
  ]
}

function normalizeBrandKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function stringHash(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}
