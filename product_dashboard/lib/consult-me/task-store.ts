import { assertValyuApiKeyConfigured } from "@/lib/consult-me/mode"
import {
  normalizeCompanyKey,
  resolveDisplayCompanyLabel,
} from "@/lib/consult-me/company-subjects"
import { getSeedReportByTaskId } from "@/lib/consult-me/seed-reports"
import {
  cancelValyuResearch,
  createValyuResearch,
  getValyuResearchStatus,
} from "@/lib/consult-me/valyu-client"
import { upsertConsultMeHistoryRecord } from "@/lib/consult-me/history-store"
import type {
  CreateResearchRequest,
  CreateResearchResponse,
  ResearchStatusResponse,
} from "@/lib/consult-me/types"

const DEFAULT_TOTAL_STEPS = 5

export async function createResearchTask(
  request: CreateResearchRequest
): Promise<CreateResearchResponse> {
  assertValyuApiKeyConfigured()

  const created = await createValyuResearch(request)
  const companyKey = normalizeCompanyKey(request.brandKey || request.researchSubject)
  await upsertConsultMeHistoryRecord({
    taskId: created.externalTaskId,
    companyKey,
    companyLabel: resolveDisplayCompanyLabel(request.brandKey || request.researchSubject),
    researchType: request.researchType,
    researchSubject: request.researchSubject,
    status: created.status,
    hasReport: false,
    deliverables: [],
  })

  return {
    taskId: created.externalTaskId,
    status: created.status,
    mode: "self_hosted",
  }
}

export async function getResearchTaskStatus(taskId: string): Promise<ResearchStatusResponse> {
  const seedReport = await getSeedReportByTaskId(taskId)
  if (seedReport) {
    return {
      taskId: seedReport.taskId,
      status: "completed",
      mode: "self_hosted",
      researchType: "company",
      researchSubject: seedReport.researchSubject,
      progress: 1,
      etaMinutes: 0,
      stepsCompleted: DEFAULT_TOTAL_STEPS,
      totalSteps: DEFAULT_TOTAL_STEPS,
      sourcesFound: seedReport.sourcesFound,
      activityFeed: ["Research task completed."],
      outputText: undefined,
      executiveSummaryExcerpt: undefined,
      csvPreview: undefined,
      deliverables: seedReport.deliverables,
      sources: seedReport.sources,
    }
  }

  assertValyuApiKeyConfigured()

  const status = await getValyuResearchStatus(taskId)
  const hasReport = status.status === "completed" && status.deliverables.length > 0
  const companyKey = normalizeCompanyKey(status.researchType === "company" ? status.researchSubject : "")
  await upsertConsultMeHistoryRecord({
    taskId,
    companyKey,
    companyLabel: resolveDisplayCompanyLabel(status.researchSubject),
    researchType: status.researchType,
    researchSubject: status.researchSubject,
    status: status.status,
    hasReport,
    deliverables: status.deliverables,
    completedAt: hasReport ? new Date().toISOString() : undefined,
  })

  return {
    taskId,
    status: status.status,
    mode: "self_hosted",
    researchType: status.researchType,
    researchSubject: status.researchSubject,
    progress: status.progress,
    etaMinutes: status.etaMinutes,
    stepsCompleted: Math.max(0, status.stepsCompleted),
    totalSteps: Math.max(1, status.totalSteps || DEFAULT_TOTAL_STEPS),
    sourcesFound: Math.max(0, status.sourcesFound),
    activityFeed: status.activityFeed.slice(0, 30),
    outputText: status.outputText,
    executiveSummaryExcerpt: status.executiveSummaryExcerpt,
    csvPreview: status.csvPreview,
    deliverables: status.deliverables,
    sources: status.sources,
    usage: status.usage,
    warning: status.warning,
    error: status.error,
  }
}

export async function cancelResearchTask(taskId: string): Promise<ResearchStatusResponse> {
  assertValyuApiKeyConfigured()

  const cancelled = await cancelValyuResearch(taskId)
  try {
    const latest = await getValyuResearchStatus(taskId)
    return {
      taskId,
      status: latest.status,
      mode: "self_hosted",
      researchType: latest.researchType,
      researchSubject: latest.researchSubject,
      progress: latest.progress,
      etaMinutes: latest.etaMinutes,
      stepsCompleted: Math.max(0, latest.stepsCompleted),
      totalSteps: Math.max(1, latest.totalSteps || DEFAULT_TOTAL_STEPS),
      sourcesFound: Math.max(0, latest.sourcesFound),
      activityFeed: latest.activityFeed.slice(0, 30),
      outputText: latest.outputText,
      executiveSummaryExcerpt: latest.executiveSummaryExcerpt,
      csvPreview: latest.csvPreview,
      deliverables: latest.deliverables,
      sources: latest.sources,
      usage: latest.usage,
      warning: cancelled.message || latest.warning,
      error: latest.error,
    }
  } catch {
    // Fall back to cancellation response when status refresh is unavailable.
  }

  await upsertConsultMeHistoryRecord({
    taskId,
    status: cancelled.status,
  })

  return {
    taskId,
    status: cancelled.status,
    mode: "self_hosted",
    researchType: "custom",
    researchSubject: "Cancelled research task",
    progress: cancelled.status === "cancelled" ? 0 : 1,
    stepsCompleted: 0,
    totalSteps: DEFAULT_TOTAL_STEPS,
    sourcesFound: 0,
    activityFeed: [cancelled.message || "Research task cancelled."],
    deliverables: [],
    sources: [],
    warning: cancelled.message,
  }
}
