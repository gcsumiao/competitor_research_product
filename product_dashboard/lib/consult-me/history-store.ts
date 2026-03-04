import { mkdir, readFile, rename, writeFile } from "fs/promises"
import path from "path"

import { resolveDisplayCompanyLabel } from "@/lib/consult-me/company-subjects"
import { listSeedReports } from "@/lib/consult-me/seed-reports"
import type {
  ConsultMeCompanyHistory,
  ConsultMeHistoryRecord,
  ConsultMeHistoryResponse,
  DeliverableFile,
  DeliverableType,
  ResearchTaskStatus,
  ResearchType,
} from "@/lib/consult-me/types"

const HISTORY_FILE = path.resolve(process.cwd(), "data", "consult-me-history.json")
const HISTORY_VERSION = 2
const MAX_RECENT_RECORDS = 80

type HistoryFileShape = {
  version: number
  records: ConsultMeHistoryRecord[]
  hiddenSeedTaskIds?: string[]
}

type HistoryUpsertPatch = {
  taskId: string
  companyKey?: string
  companyLabel?: string
  researchType?: ResearchType
  researchSubject?: string
  status?: ResearchTaskStatus
  hasReport?: boolean
  deliverables?: DeliverableFile[]
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

export async function upsertConsultMeHistoryRecord(patch: HistoryUpsertPatch) {
  const now = new Date().toISOString()
  const { records, hiddenSeedTaskIds } = await readHistoryState()
  const index = records.findIndex((record) => record.taskId === patch.taskId)
  const existing = index >= 0 ? records[index] : null

  const next: ConsultMeHistoryRecord = {
    taskId: patch.taskId,
    companyKey: patch.companyKey ?? existing?.companyKey ?? "",
    companyLabel: patch.companyLabel ?? existing?.companyLabel ?? "",
    researchType: patch.researchType ?? existing?.researchType ?? "custom",
    researchSubject: patch.researchSubject ?? existing?.researchSubject ?? "",
    status: patch.status ?? existing?.status ?? "queued",
    hasReport: patch.hasReport ?? existing?.hasReport ?? false,
    deliverables: sanitizeDeliverables(patch.deliverables ?? existing?.deliverables ?? []),
    createdAt: existing?.createdAt ?? patch.createdAt ?? now,
    updatedAt: patch.updatedAt ?? now,
    completedAt: patch.completedAt ?? existing?.completedAt,
  }

  if (next.status === "completed" && next.hasReport && !next.completedAt) {
    next.completedAt = next.updatedAt
  }

  if (index >= 0) {
    records[index] = next
  } else {
    records.push(next)
  }

  await writeHistoryState({ records, hiddenSeedTaskIds })
  return next
}

export async function listConsultMeHistory(): Promise<ConsultMeHistoryResponse> {
  const { records, hiddenSeedTaskIds } = await readHistoryState()
  const hiddenSeedSet = new Set(hiddenSeedTaskIds.map((item) => item.toLowerCase()))
  const seedRecords = await listSeedReports()
  const visibleSeedRecords: ConsultMeHistoryRecord[] = seedRecords
    .filter((item) => !hiddenSeedSet.has(item.taskId.toLowerCase()))
    .map((item) => ({
      taskId: item.taskId,
      companyKey: item.companyKey,
      companyLabel: item.companyLabel,
      researchType: "company",
      researchSubject: item.researchSubject,
      status: "completed",
      hasReport: item.deliverables.length > 0,
      deliverables: item.deliverables,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      completedAt: item.completedAt,
    }))

  const merged = [...records, ...visibleSeedRecords]
  const sorted = merged
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))

  const companies = summarizeCompanies(sorted)
  return {
    companies,
    recent: sorted.slice(0, MAX_RECENT_RECORDS),
  }
}

export async function deleteConsultMeHistoryByCompany(companyKey: string) {
  const normalized = normalizeCompanyKey(companyKey)
  if (!normalized) return { deletedCount: 0 }
  const { records, hiddenSeedTaskIds } = await readHistoryState()
  const seedReports = await listSeedReports()
  const filtered = records.filter((record) => normalizeCompanyKey(record.companyKey) !== normalized)
  const deletedRuntimeCount = records.length - filtered.length

  const nextHidden = new Set(hiddenSeedTaskIds.map((item) => item.toLowerCase()))
  let hiddenSeedCount = 0
  for (const seed of seedReports) {
    if (normalizeCompanyKey(seed.companyKey) !== normalized) continue
    const lowerTaskId = seed.taskId.toLowerCase()
    if (!nextHidden.has(lowerTaskId)) {
      nextHidden.add(lowerTaskId)
      hiddenSeedCount += 1
    }
  }

  const deletedCount = deletedRuntimeCount + hiddenSeedCount
  if (deletedCount > 0) {
    await writeHistoryState({ records: filtered, hiddenSeedTaskIds: Array.from(nextHidden) })
  }
  return { deletedCount }
}

export async function deleteConsultMeHistoryByTask(taskId: string) {
  const normalized = taskId.trim()
  if (!normalized) return { deletedCount: 0 }
  const { records, hiddenSeedTaskIds } = await readHistoryState()
  const normalizedLower = normalized.toLowerCase()
  if (normalizedLower.startsWith("seed:")) {
    const hidden = new Set(hiddenSeedTaskIds.map((item) => item.toLowerCase()))
    if (hidden.has(normalizedLower)) {
      return { deletedCount: 0 }
    }
    hidden.add(normalizedLower)
    await writeHistoryState({ records, hiddenSeedTaskIds: Array.from(hidden) })
    return { deletedCount: 1 }
  }

  const filtered = records.filter((record) => record.taskId !== normalized)
  const deletedCount = records.length - filtered.length
  if (deletedCount > 0) {
    await writeHistoryState({ records: filtered, hiddenSeedTaskIds })
  }
  return { deletedCount }
}

function summarizeCompanies(records: ConsultMeHistoryRecord[]): ConsultMeCompanyHistory[] {
  const map = new Map<string, ConsultMeCompanyHistory>()
  for (const record of records) {
    if (!record.companyKey) continue
    if (record.researchType !== "company") continue

    const current = map.get(record.companyKey)
    if (!current) {
      map.set(record.companyKey, {
        companyKey: record.companyKey,
        companyLabel: record.companyLabel || record.researchSubject || record.companyKey,
        latestTaskId: record.taskId,
        latestStatus: record.status,
        latestUpdatedAt: record.updatedAt,
        hasReportAvailable: record.hasReport,
        availableTaskId: record.hasReport ? record.taskId : undefined,
        availableUpdatedAt: record.hasReport ? record.updatedAt : undefined,
        reportCount: record.hasReport ? 1 : 0,
        availableDeliverableTypes: record.hasReport
          ? collectDeliverableTypes(record.deliverables)
          : [],
      })
      continue
    }

    if (record.hasReport) {
      current.reportCount += 1
      if (!current.hasReportAvailable) current.hasReportAvailable = true
      if (!current.availableTaskId) {
        current.availableTaskId = record.taskId
        current.availableUpdatedAt = record.updatedAt
        current.availableDeliverableTypes = collectDeliverableTypes(record.deliverables)
      }
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.hasReportAvailable !== b.hasReportAvailable) {
      return a.hasReportAvailable ? -1 : 1
    }
    return Date.parse(b.latestUpdatedAt) - Date.parse(a.latestUpdatedAt)
  })
}

function collectDeliverableTypes(deliverables: DeliverableFile[]): DeliverableType[] {
  return Array.from(new Set(deliverables.map((item) => item.type)))
}

function sanitizeDeliverables(deliverables: DeliverableFile[]) {
  return deliverables
    .filter((item) => {
      if (item.source === "seed_local") {
        return Boolean(item.seedId && item.localPath)
      }
      return Boolean(item.remoteUrl)
    })
    .map((item) =>
      item.source === "seed_local"
        ? {
            ...item,
            source: "seed_local" as const,
            relativePath: item.relativePath ?? "",
          }
        : {
            ...item,
            source: "remote" as const,
            relativePath: item.relativePath ?? "",
          }
    )
}

async function readHistoryState() {
  try {
    const content = await readFile(HISTORY_FILE, "utf8")
    const parsed = JSON.parse(content) as HistoryFileShape
    if (!parsed || !Array.isArray(parsed.records)) {
      return { records: [], hiddenSeedTaskIds: [] }
    }
    const records = parsed.records
      .filter((record) => Boolean(record?.taskId))
      .map((record) => normalizeLegacyRecord(record as ConsultMeHistoryRecord))
    const hiddenSeedTaskIds = Array.isArray(parsed.hiddenSeedTaskIds)
      ? parsed.hiddenSeedTaskIds
          .map((item) => String(item).trim().toLowerCase())
          .filter((item) => item.startsWith("seed:"))
      : []
    return { records, hiddenSeedTaskIds }
  } catch {
    return { records: [], hiddenSeedTaskIds: [] }
  }
}

async function writeHistoryState(state: {
  records: ConsultMeHistoryRecord[]
  hiddenSeedTaskIds: string[]
}) {
  const dir = path.dirname(HISTORY_FILE)
  await mkdir(dir, { recursive: true })
  const temp = `${HISTORY_FILE}.tmp`
  const payload: HistoryFileShape = {
    version: HISTORY_VERSION,
    records: state.records,
    hiddenSeedTaskIds: Array.from(
      new Set(state.hiddenSeedTaskIds.map((item) => item.trim().toLowerCase()))
    ),
  }
  await writeFile(temp, JSON.stringify(payload, null, 2), "utf8")
  await rename(temp, HISTORY_FILE)
}

function normalizeCompanyKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function normalizeLegacyRecord(record: ConsultMeHistoryRecord): ConsultMeHistoryRecord {
  const parsed = parseLegacyStructuredSubject(record.researchSubject)
  const researchType = normalizeResearchType(record.researchType, parsed.researchType)
  const researchSubject = parsed.researchSubject ?? record.researchSubject

  let companyKey = record.companyKey
  let companyLabel = record.companyLabel
  if (researchType === "company") {
    const subjectForCompany = researchSubject || record.companyLabel || ""
    if (!companyKey) {
      companyKey = normalizeCompanyKey(subjectForCompany)
    }
    if (!companyLabel || /^Research\s*Type:/i.test(companyLabel)) {
      companyLabel = resolveDisplayCompanyLabel(subjectForCompany)
    }
  }

  return {
    ...record,
    researchType,
    researchSubject,
    companyKey,
    companyLabel,
  }
}

function parseLegacyStructuredSubject(value: string) {
  const text = value ?? ""
  if (!/^Research\s*Type:/i.test(text)) {
    return { researchType: undefined, researchSubject: undefined }
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  let researchType: string | undefined
  let researchSubject: string | undefined
  for (const line of lines) {
    const typeMatch = line.match(/^Research\s*Type:\s*(.+)$/i)
    if (typeMatch?.[1]) {
      researchType = typeMatch[1].trim().toLowerCase()
      continue
    }
    const subjectMatch = line.match(/^Research\s*Subject:\s*(.+)$/i)
    if (subjectMatch?.[1]) {
      researchSubject = subjectMatch[1].trim()
    }
  }
  return { researchType, researchSubject }
}

function normalizeResearchType(current: ResearchType, parsed: string | undefined): ResearchType {
  const candidate = (parsed ?? current ?? "").trim().toLowerCase()
  if (
    candidate === "company" ||
    candidate === "market" ||
    candidate === "competitive" ||
    candidate === "industry" ||
    candidate === "custom"
  ) {
    return candidate
  }
  return "custom"
}
