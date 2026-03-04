"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCircle2, Clock3, FileSearch, Trash2, XCircle } from "lucide-react"

import { BrandLauncher } from "@/components/consult-me/brand-launcher"
import { ResearchConsole } from "@/components/consult-me/research-console"
import { ResultsWorkspace } from "@/components/consult-me/results-workspace"
import { PageHeader } from "@/components/dashboard/page-header"
import {
  resolveDisplayCompanyLabel,
  resolveResearchSubjectForCompany,
} from "@/lib/consult-me/company-subjects"
import type {
  ConsultMeCompanyHistory,
  ConsultMeHistoryRecord,
  ConsultMeHistoryResponse,
  CreateResearchRequest,
  CreateResearchResponse,
  ResearchStatusResponse,
  ResearchTaskStatus,
  ResearchType,
} from "@/lib/consult-me/types"
import type { DashboardData } from "@/lib/competitor-data"
import {
  CONSULT_ME_ACTIVE_SUBJECT_KEY,
  CONSULT_ME_ACTIVE_TASK_ID_KEY,
  CONSULT_ME_LAST_COMPLETED_SUBJECT_KEY,
  CONSULT_ME_LAST_COMPLETED_TASK_ID_KEY,
} from "@/lib/consult-me/storage-keys"

type RankedBrand = {
  brand: string
  rank: number
  grandTotal: number
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
}: {
  data: DashboardData
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const codeReaderCategory = data.categories.find((item) => item.id === "code_reader_scanner")
  const snapshots = codeReaderCategory?.snapshots ?? []
  const selectedSnapshot = snapshots[snapshots.length - 1]

  const topBrands = (selectedSnapshot?.rolling12?.revenue?.brands ?? []).slice(0, 25)
  const brandByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const brand of topBrands) {
      map.set(normalizeBrandKey(brand.brand), brand.brand)
    }
    return map
  }, [topBrands])

  const [searchQuery, setSearchQuery] = useState("")
  const [selectedBrandOverride, setSelectedBrandOverride] = useState("")
  const [researchType, setResearchType] = useState<ResearchType>("company")
  const [researchSubject, setResearchSubject] = useState("")
  const [researchFocus, setResearchFocus] = useState("")
  const [clientContext] = useState("")
  const [specificQuestions] = useState("")
  const [taskId, setTaskId] = useState("")
  const [taskStatus, setTaskStatus] = useState<ResearchStatusResponse | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [statusError, setStatusError] = useState("")
  const [externalTaskIdToLoad, setExternalTaskIdToLoad] = useState("")
  const [history, setHistory] = useState<ConsultMeHistoryResponse | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [deletingHistoryKey, setDeletingHistoryKey] = useState("")
  const queryTaskId = searchParams.get("taskId")?.trim() ?? ""

  const filteredBrands = (() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return topBrands
    return topBrands.filter((brand) => brand.brand.toLowerCase().includes(query))
  })()

  const selectedBrand = filteredBrands.some((brand) => brand.brand === selectedBrandOverride)
    ? selectedBrandOverride
    : (filteredBrands[0]?.brand ?? "")

  const runStorageKey = `consult-me-task:${selectedSnapshot?.date ?? "none"}:${normalizeBrandKey(selectedBrand) || "none"}`

  async function refreshHistory() {
    setHistoryLoading(true)
    try {
      const response = await fetch("/api/consult-me/history")
      if (!response.ok) return
      const payload = (await response.json()) as ConsultMeHistoryResponse
      setHistory(payload)
    } catch {
      // Keep latest successful snapshot if request fails.
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    void refreshHistory()
    const timer = window.setInterval(() => {
      void refreshHistory()
    }, 10000)
    return () => {
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!queryTaskId) return
    setExternalTaskIdToLoad(queryTaskId)
  }, [queryTaskId])

  if (!codeReaderCategory || !selectedSnapshot) {
    return (
      <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground">
        Code Reader snapshot data is unavailable for Consult Me.
      </div>
    )
  }

  function handleOpenHistoryItem(item: ConsultMeCompanyHistory) {
    const preferredTaskId = item.availableTaskId ?? item.latestTaskId
    const brandLabel =
      brandByKey.get(item.companyKey) ?? resolveDisplayCompanyLabel(item.companyLabel || item.companyKey)

    setSelectedBrandOverride(brandLabel)
    setSearchQuery(brandLabel)
    setResearchType("company")
    setResearchSubject(resolveResearchSubjectForCompany(brandLabel))
    setTaskStatus(null)
    setStatusError("")
    setExternalTaskIdToLoad(preferredTaskId)
  }

  function handleOpenHistoryRecord(record: ConsultMeHistoryRecord) {
    const normalized = normalizeBrandKey(record.researchSubject)
    const brandLabel =
      brandByKey.get(normalized) ??
      resolveDisplayCompanyLabel(record.companyLabel || record.researchSubject)
    setSelectedBrandOverride(brandLabel)
    setSearchQuery(brandLabel)
    setResearchType(record.researchType)
    setResearchSubject(
      record.researchType === "company"
        ? resolveResearchSubjectForCompany(brandLabel)
        : record.researchSubject
    )
    setTaskStatus(null)
    setStatusError("")
    setExternalTaskIdToLoad(record.taskId)
  }

  async function handleDeleteCompanyHistory(item: ConsultMeCompanyHistory) {
    if (typeof window !== "undefined") {
      const approved = window.confirm(`Delete all saved history for ${item.companyLabel}?`)
      if (!approved) return
    }
    const key = `company:${item.companyKey}`
    setDeletingHistoryKey(key)
    try {
      const response = await fetch(
        `/api/consult-me/history?companyKey=${encodeURIComponent(item.companyKey)}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setStatusError(payload?.error ?? "Failed to delete company history.")
        return
      }
      if (typeof window !== "undefined") {
        clearAllCachedConsultMeTasks(window.localStorage)
      }
      if (normalizeBrandKey(selectedBrand) === normalizeBrandKey(item.companyLabel || item.companyKey)) {
        setTaskStatus(null)
        setTaskId("")
        setExternalTaskIdToLoad("")
      }
      router.replace(pathname, { scroll: false })
      await refreshHistory()
    } catch {
      setStatusError("Network error while deleting company history.")
    } finally {
      setDeletingHistoryKey("")
    }
  }

  async function handleDeleteHistoryRecord(record: ConsultMeHistoryRecord) {
    if (typeof window !== "undefined") {
      const approved = window.confirm(`Delete saved report from ${record.companyLabel}?`)
      if (!approved) return
    }
    const key = `task:${record.taskId}`
    setDeletingHistoryKey(key)
    try {
      const response = await fetch(
        `/api/consult-me/history?taskId=${encodeURIComponent(record.taskId)}`,
        { method: "DELETE" }
      )
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        setStatusError(payload?.error ?? "Failed to delete report history.")
        return
      }
      if (typeof window !== "undefined") {
        clearAllCachedConsultMeTasks(window.localStorage)
      }
      if (taskId === record.taskId) {
        setTaskStatus(null)
        setTaskId("")
        setExternalTaskIdToLoad("")
      }
      router.replace(pathname, { scroll: false })
      await refreshHistory()
    } catch {
      setStatusError("Network error while deleting report history.")
    } finally {
      setDeletingHistoryKey("")
    }
  }

  return (
    <>
      <PageHeader
        title="Consult Me — AI Consultant"
        description="Deep Market Resaerch across all Company/ Market/ Industry"
      />

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <ConsultMeHistorySidebar
          selectedBrand={selectedBrand}
          history={history}
          historyLoading={historyLoading}
          deletingHistoryKey={deletingHistoryKey}
          onOpenHistoryItem={handleOpenHistoryItem}
          onOpenHistoryRecord={handleOpenHistoryRecord}
          onDeleteCompanyHistory={handleDeleteCompanyHistory}
          onDeleteHistoryRecord={handleDeleteHistoryRecord}
        />

        <ConsultMeSession
          key={runStorageKey}
          selectedBrand={selectedBrand}
          brands={filteredBrands}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSelectBrand={setSelectedBrandOverride}
          researchType={researchType}
          onResearchTypeChange={setResearchType}
          researchSubject={researchSubject}
          onResearchSubjectChange={setResearchSubject}
          researchFocus={researchFocus}
          onResearchFocusChange={setResearchFocus}
          clientContext={clientContext}
          specificQuestions={specificQuestions}
          taskId={taskId}
          taskStatus={taskStatus}
          onTaskStatusChange={setTaskStatus}
          isStarting={isStarting}
          onIsStartingChange={setIsStarting}
          isCancelling={isCancelling}
          onIsCancellingChange={setIsCancelling}
          statusError={statusError}
          onStatusErrorChange={setStatusError}
          onTaskIdChange={setTaskId}
          runStorageKey={runStorageKey}
          snapshotDate={selectedSnapshot.date}
          externalTaskIdToLoad={externalTaskIdToLoad}
          onExternalTaskLoaded={() => setExternalTaskIdToLoad("")}
        />
      </div>
    </>
  )
}

function ConsultMeHistorySidebar({
  selectedBrand,
  history,
  historyLoading,
  deletingHistoryKey,
  onOpenHistoryItem,
  onOpenHistoryRecord,
  onDeleteCompanyHistory,
  onDeleteHistoryRecord,
}: {
  selectedBrand: string
  history: ConsultMeHistoryResponse | null
  historyLoading: boolean
  deletingHistoryKey: string
  onOpenHistoryItem: (item: ConsultMeCompanyHistory) => void
  onOpenHistoryRecord: (item: ConsultMeHistoryRecord) => void
  onDeleteCompanyHistory: (item: ConsultMeCompanyHistory) => void
  onDeleteHistoryRecord: (item: ConsultMeHistoryRecord) => void
}) {
  const availableReports = (history?.recent ?? []).filter((record) => record.hasReport).slice(0, 30)

  return (
    <aside className="rounded-lg border border-border bg-card p-3">
      <div className="mb-3">
        <p className="text-sm font-semibold text-foreground">Report Memory</p>
        <p className="text-xs text-muted-foreground">
          Companies with previous runs and available deliverables.
        </p>
      </div>

      {historyLoading && !history ? (
        <p className="text-xs text-muted-foreground">Loading history...</p>
      ) : null}

      {!history?.companies?.length ? (
        <p className="text-xs text-muted-foreground">No report history yet.</p>
      ) : (
        <div className="space-y-2">
          {history.companies.map((item) => {
            const active = normalizeBrandKey(selectedBrand) === item.companyKey
            const status = formatStatus(item.latestStatus, item.hasReportAvailable)
            const deleting = deletingHistoryKey === `company:${item.companyKey}`
            return (
              <div
                key={item.companyKey}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-foreground/40 bg-foreground/5"
                    : "border-border bg-background/70 hover:border-foreground/25"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpenHistoryItem(item)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{item.companyLabel}</p>
                      <StatusPill status={status} />
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {`Updated ${formatDateTime(item.latestUpdatedAt)}`}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {item.reportCount > 0
                        ? `${item.reportCount} saved report${item.reportCount > 1 ? "s" : ""}`
                        : "No completed report yet"}
                    </p>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${item.companyLabel} history`}
                    onClick={() => onDeleteCompanyHistory(item)}
                    disabled={deleting}
                    className="rounded border border-border px-1.5 py-1 text-muted-foreground hover:text-red-700 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {availableReports.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Available Reports
          </p>
          <div className="mt-2 space-y-1.5">
            {availableReports.map((record) => {
              const deleting = deletingHistoryKey === `task:${record.taskId}`
              return (
                <div
                  key={`${record.taskId}:${record.updatedAt}`}
                  className="rounded-md border border-border bg-background/70 px-2.5 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenHistoryRecord(record)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-xs font-medium text-foreground">{record.companyLabel}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {`Completed ${formatDateTime(record.updatedAt)}`}
                      </p>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete report for ${record.companyLabel}`}
                      onClick={() => onDeleteHistoryRecord(record)}
                      disabled={deleting}
                      className="rounded border border-border px-1.5 py-1 text-muted-foreground hover:text-red-700 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </aside>
  )
}

function StatusPill({ status }: { status: "available" | "running" | "failed" | "other" }) {
  if (status === "available") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700">
        <CheckCircle2 className="h-3 w-3" />
        Available
      </span>
    )
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700">
        <Clock3 className="h-3 w-3" />
        Running
      </span>
    )
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-700">
        <XCircle className="h-3 w-3" />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
      <FileSearch className="h-3 w-3" />
      {`Status`}
    </span>
  )
}

function ConsultMeSession({
  selectedBrand,
  brands,
  searchQuery,
  onSearchQueryChange,
  onSelectBrand,
  researchType,
  onResearchTypeChange,
  researchSubject,
  onResearchSubjectChange,
  researchFocus,
  onResearchFocusChange,
  clientContext,
  specificQuestions,
  taskId,
  taskStatus,
  onTaskStatusChange,
  isStarting,
  onIsStartingChange,
  isCancelling,
  onIsCancellingChange,
  statusError,
  onStatusErrorChange,
  onTaskIdChange,
  runStorageKey,
  snapshotDate,
  externalTaskIdToLoad,
  onExternalTaskLoaded,
}: {
  selectedBrand: string
  brands: RankedBrand[]
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  onSelectBrand: (brand: string) => void
  researchType: ResearchType
  onResearchTypeChange: (value: ResearchType) => void
  researchSubject: string
  onResearchSubjectChange: (value: string) => void
  researchFocus: string
  onResearchFocusChange: (value: string) => void
  clientContext: string
  specificQuestions: string
  taskId: string
  taskStatus: ResearchStatusResponse | null
  onTaskStatusChange: (value: ResearchStatusResponse | null) => void
  isStarting: boolean
  onIsStartingChange: (value: boolean) => void
  isCancelling: boolean
  onIsCancellingChange: (value: boolean) => void
  statusError: string
  onStatusErrorChange: (value: string) => void
  onTaskIdChange: (value: string) => void
  runStorageKey: string
  snapshotDate: string
  externalTaskIdToLoad: string
  onExternalTaskLoaded: () => void
}) {
  function clearPersistedTask() {
    onTaskStatusChange(null)
    onTaskIdChange("")
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(runStorageKey)
      window.localStorage.removeItem(CONSULT_ME_ACTIVE_TASK_ID_KEY)
      window.localStorage.removeItem(CONSULT_ME_ACTIVE_SUBJECT_KEY)
    }
  }

  useEffect(() => {
    if (researchType === "company" && !researchSubject.trim() && selectedBrand) {
      onResearchSubjectChange(selectedBrand)
    }
  }, [onResearchSubjectChange, researchSubject, researchType, selectedBrand])

  useEffect(() => {
    if (typeof window === "undefined") return
    const savedTaskId = window.localStorage.getItem(runStorageKey)
    if (!savedTaskId) return
    onTaskIdChange(savedTaskId)
    void fetchStatus(savedTaskId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runStorageKey])

  useEffect(() => {
    if (!externalTaskIdToLoad) return
    onTaskIdChange(externalTaskIdToLoad)
    if (typeof window !== "undefined") {
      window.localStorage.setItem(runStorageKey, externalTaskIdToLoad)
    }
    void fetchStatus(externalTaskIdToLoad)
    onExternalTaskLoaded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTaskIdToLoad, onExternalTaskLoaded, runStorageKey])

  useEffect(() => {
    const active = taskStatus?.status === "queued" || taskStatus?.status === "running"
    if (!active || !taskId) return
    const timer = window.setInterval(() => {
      void fetchStatus(taskId)
    }, 3000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, taskStatus?.status])

  async function fetchStatus(currentTaskId: string) {
    try {
      const response = await fetch(`/api/consult-me/status?taskId=${encodeURIComponent(currentTaskId)}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (response.status === 404) {
          clearPersistedTask()
          onStatusErrorChange("Previous task expired. Please start a new research run.")
          return
        }
        onStatusErrorChange(payload?.error ?? "Failed to load research status.")
        return
      }
      const payload = (await response.json()) as ResearchStatusResponse
      onTaskStatusChange(payload)
      onStatusErrorChange("")
      syncGlobalTaskMarkers(currentTaskId, payload.researchSubject, payload.status)
    } catch {
      onStatusErrorChange("Network error while loading research status.")
    }
  }

  async function startResearch() {
    if (researchType !== "company") {
      onStatusErrorChange("Market, Industry, Competitive, and Custom research are coming soon. Please use Company research.")
      return
    }
    const resolvedSubject =
      researchType === "company"
        ? resolveCompanySubject({
            researchSubject,
            selectedBrand,
            searchQuery,
          })
        : cleanOptional(researchSubject)
    if (!resolvedSubject) return
    onIsStartingChange(true)
    onStatusErrorChange("")
    try {
      const requestBody: CreateResearchRequest = {
        researchType,
        researchSubject: resolvedSubject,
        researchFocus: cleanOptional(researchFocus),
        clientContext: cleanOptional(clientContext),
        specificQuestions: cleanOptional(specificQuestions),
        brandKey: selectedBrand ? normalizeBrandKey(selectedBrand) : undefined,
        snapshotDate,
      }
      const response = await fetch("/api/consult-me/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      })
      const payload = (await response.json().catch(() => null)) as
        | CreateResearchResponse
        | { error?: string }
        | null
      if (!response.ok || !payload || !("taskId" in payload)) {
        onStatusErrorChange((payload as { error?: string } | null)?.error ?? "Failed to start deep research.")
        return
      }

      onTaskIdChange(payload.taskId)
      if (typeof window !== "undefined") {
        window.localStorage.setItem(runStorageKey, payload.taskId)
        window.localStorage.setItem(CONSULT_ME_ACTIVE_TASK_ID_KEY, payload.taskId)
        window.localStorage.setItem(CONSULT_ME_ACTIVE_SUBJECT_KEY, resolvedSubject)
      }
      await fetchStatus(payload.taskId)
    } catch {
      onStatusErrorChange("Network error while starting research.")
    } finally {
      onIsStartingChange(false)
    }
  }

  async function cancelResearch() {
    if (!taskId) return
    onIsCancellingChange(true)
    try {
      const response = await fetch("/api/consult-me/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        onStatusErrorChange(payload?.error ?? "Failed to cancel research.")
        return
      }
      const payload = (await response.json()) as ResearchStatusResponse
      onTaskStatusChange(payload)
      syncGlobalTaskMarkers(taskId, payload.researchSubject, payload.status)
    } catch {
      onStatusErrorChange("Network error while cancelling research.")
    } finally {
      onIsCancellingChange(false)
    }
  }

  function startNewResearch() {
    clearPersistedTask()
    onStatusErrorChange("")
  }

  const currentStatus: ResearchTaskStatus | "idle" = taskStatus?.status ?? "idle"
  if (currentStatus === "idle") {
    return (
      <div className="space-y-3">
        {statusError ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
            {statusError}
          </div>
        ) : null}
        <BrandLauncher
          brands={brands}
          selectedBrand={selectedBrand}
          searchQuery={searchQuery}
          onSearchQueryChange={onSearchQueryChange}
          onSelectBrand={onSelectBrand}
          researchType={researchType}
          onResearchTypeChange={onResearchTypeChange}
          researchSubject={researchSubject}
          onResearchSubjectChange={onResearchSubjectChange}
          researchFocus={researchFocus}
          onResearchFocusChange={onResearchFocusChange}
          isSubmitting={isStarting}
          onDeepSearch={() => void startResearch()}
        />
      </div>
    )
  }

  if (currentStatus === "queued" || currentStatus === "running") {
    return (
      <div className="space-y-3">
        {statusError ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
            {statusError}
          </div>
        ) : null}
        <ResearchConsole
          selectedBrand={selectedBrand || researchSubject}
          etaMinutes={taskStatus?.etaMinutes}
          progress={taskStatus?.progress ?? 0}
          stepsCompleted={taskStatus?.stepsCompleted ?? 0}
          totalSteps={taskStatus?.totalSteps ?? TOTAL_STEPS}
          sourcesFound={taskStatus?.sourcesFound ?? 0}
          activityFeed={taskStatus?.activityFeed ?? []}
          stepLabels={STEP_LABELS}
          onCancel={() => void cancelResearch()}
          isCancelling={isCancelling}
        />
      </div>
    )
  }

  const completedLike =
    currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled"
  if (!completedLike) return null

  return (
    <div className="space-y-3">
      {statusError ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
          {statusError}
        </div>
      ) : null}
      {taskStatus?.status === "failed" ? (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          {taskStatus.error ?? "Research task failed."}
        </div>
      ) : null}
      {taskStatus?.status === "cancelled" ? (
        <div className="rounded-md border border-slate-500/40 bg-slate-500/10 p-3 text-sm text-slate-700">
          Research task cancelled.
        </div>
      ) : null}

      <ResultsWorkspace
        selectedBrand={selectedBrand || researchSubject}
        result={taskStatus ?? undefined}
        stepsCompleted={taskStatus?.stepsCompleted ?? TOTAL_STEPS}
        sourcesFound={taskStatus?.sourcesFound ?? 0}
        activityFeed={taskStatus?.activityFeed ?? []}
        onStartNewResearch={startNewResearch}
      />
    </div>
  )
}

function formatStatus(status: ResearchTaskStatus, hasReportAvailable: boolean) {
  if (hasReportAvailable) return "available" as const
  if (status === "queued" || status === "running") return "running" as const
  if (status === "failed") return "failed" as const
  return "other" as const
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function normalizeBrandKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function cleanOptional(value: string) {
  const trimmed = value.trim()
  return trimmed || undefined
}

function resolveCompanySubject({
  researchSubject,
  selectedBrand,
  searchQuery,
}: {
  researchSubject: string
  selectedBrand: string
  searchQuery: string
}) {
  const candidate =
    cleanOptional(searchQuery) ?? cleanOptional(selectedBrand) ?? cleanOptional(researchSubject)
  if (!candidate) return undefined
  return resolveResearchSubjectForCompany(candidate)
}

function syncGlobalTaskMarkers(taskId: string, subject: string, status: ResearchTaskStatus) {
  if (typeof window === "undefined") return

  const isActive = status === "queued" || status === "running"
  if (isActive) {
    window.localStorage.setItem(CONSULT_ME_ACTIVE_TASK_ID_KEY, taskId)
    window.localStorage.setItem(CONSULT_ME_ACTIVE_SUBJECT_KEY, subject)
    return
  }

  window.localStorage.removeItem(CONSULT_ME_ACTIVE_TASK_ID_KEY)
  window.localStorage.removeItem(CONSULT_ME_ACTIVE_SUBJECT_KEY)
  if (status === "completed") {
    window.localStorage.setItem(CONSULT_ME_LAST_COMPLETED_TASK_ID_KEY, taskId)
    window.localStorage.setItem(CONSULT_ME_LAST_COMPLETED_SUBJECT_KEY, subject)
  }
}

function clearAllCachedConsultMeTasks(storage: Storage) {
  const keysToRemove: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key || !key.startsWith("consult-me-task:")) continue
    keysToRemove.push(key)
  }
  for (const key of keysToRemove) {
    storage.removeItem(key)
  }
  storage.removeItem(CONSULT_ME_ACTIVE_TASK_ID_KEY)
  storage.removeItem(CONSULT_ME_ACTIVE_SUBJECT_KEY)
  storage.removeItem(CONSULT_ME_LAST_COMPLETED_TASK_ID_KEY)
  storage.removeItem(CONSULT_ME_LAST_COMPLETED_SUBJECT_KEY)
}
