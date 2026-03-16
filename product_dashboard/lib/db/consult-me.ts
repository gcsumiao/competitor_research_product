import type {
  ConsultMeHistoryRecord,
  DeliverableFile,
} from "@/lib/consult-me/types"
import { queryDb } from "@/lib/db/client"

export async function loadConsultMeHistoryRecordsFromDb() {
  const recordsResult = await queryDb<{
    task_id: string
    company_key: string
    company_label: string
    research_type: string
    research_subject: string
    status: string
    has_report: boolean
    deliverables: DeliverableFile[] | string | null
    created_at: Date | string
    updated_at: Date | string
    completed_at: Date | string | null
  }>(
    `
      SELECT
        task_id,
        company_key,
        company_label,
        research_type,
        research_subject,
        status,
        has_report,
        deliverables,
        created_at,
        updated_at,
        completed_at
      FROM consult_me_history_records
      ORDER BY updated_at DESC
    `
  )

  const hiddenSeedResult = await queryDb<{ task_id: string }>(
    `
      SELECT task_id
      FROM consult_me_hidden_seed_tasks
    `
  )

  const records = recordsResult.rows.map((row) => ({
    taskId: row.task_id,
    companyKey: row.company_key,
    companyLabel: row.company_label,
    researchType: row.research_type as ConsultMeHistoryRecord["researchType"],
    researchSubject: row.research_subject,
    status: row.status as ConsultMeHistoryRecord["status"],
    hasReport: row.has_report,
    deliverables: parseDeliverables(row.deliverables),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    completedAt: row.completed_at ? toIsoString(row.completed_at) : undefined,
  }))

  return {
    records,
    hiddenSeedTaskIds: hiddenSeedResult.rows.map((row) => row.task_id.toLowerCase()),
  }
}

export async function upsertConsultMeHistoryRecordInDb(record: {
  taskId: string
  companyKey: string
  companyLabel: string
  researchType: string
  researchSubject: string
  status: string
  hasReport: boolean
  deliverables: DeliverableFile[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}) {
  await queryDb(
    `
      INSERT INTO consult_me_history_records (
        task_id,
        company_key,
        company_label,
        research_type,
        research_subject,
        status,
        has_report,
        deliverables,
        created_at,
        updated_at,
        completed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
      ON CONFLICT (task_id)
      DO UPDATE SET
        company_key = EXCLUDED.company_key,
        company_label = EXCLUDED.company_label,
        research_type = EXCLUDED.research_type,
        research_subject = EXCLUDED.research_subject,
        status = EXCLUDED.status,
        has_report = EXCLUDED.has_report,
        deliverables = EXCLUDED.deliverables,
        created_at = EXCLUDED.created_at,
        updated_at = EXCLUDED.updated_at,
        completed_at = EXCLUDED.completed_at
    `,
    [
      record.taskId,
      record.companyKey,
      record.companyLabel,
      record.researchType,
      record.researchSubject,
      record.status,
      record.hasReport,
      JSON.stringify(record.deliverables),
      record.createdAt,
      record.updatedAt,
      record.completedAt ?? null,
    ]
  )
}

export async function deleteConsultMeHistoryByTaskInDb(taskId: string) {
  await queryDb(`DELETE FROM consult_me_history_records WHERE task_id = $1`, [taskId])
}

export async function deleteConsultMeHistoryByCompanyInDb(companyKey: string) {
  await queryDb(`DELETE FROM consult_me_history_records WHERE company_key = $1`, [companyKey])
}

export async function hideSeedTaskInDb(taskId: string) {
  await queryDb(
    `
      INSERT INTO consult_me_hidden_seed_tasks (task_id)
      VALUES ($1)
      ON CONFLICT (task_id) DO NOTHING
    `,
    [taskId.toLowerCase()]
  )
}

function parseDeliverables(value: DeliverableFile[] | string | null) {
  if (!value) return [] as DeliverableFile[]
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      return Array.isArray(parsed) ? (parsed as DeliverableFile[]) : []
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value : []
}

function toIsoString(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
