import { createHash } from "crypto"

import { queryDb } from "@/lib/db/client"

type DbQueryOptions = {
  direct?: boolean
}

export type SourceArtifactInput = {
  artifactPath: string
  categoryId?: string
  monthKey?: string
  snapshotDate?: string
  artifactKind: string
  fileName: string
  mediaType?: string
  modifiedAt?: string | null
  content: Buffer
  metadata?: Record<string, unknown>
}

export type SourceArtifactRecord = {
  artifactPath: string
  categoryId: string | null
  monthKey: string | null
  snapshotDate: string | null
  artifactKind: string
  fileName: string
  mediaType: string
  modifiedAt: string | null
  content: Buffer
  metadata: Record<string, unknown>
}

export async function upsertSourceArtifact(input: SourceArtifactInput, options?: DbQueryOptions) {
  const sha256 = createHash("sha256").update(input.content).digest("hex")
  await queryDb(
    `
      INSERT INTO source_artifacts (
        artifact_path,
        category_id,
        month_key,
        snapshot_date,
        artifact_kind,
        file_name,
        media_type,
        byte_size,
        sha256,
        modified_at,
        content,
        metadata,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
      ON CONFLICT (artifact_path)
      DO UPDATE SET
        category_id = EXCLUDED.category_id,
        month_key = EXCLUDED.month_key,
        snapshot_date = EXCLUDED.snapshot_date,
        artifact_kind = EXCLUDED.artifact_kind,
        file_name = EXCLUDED.file_name,
        media_type = EXCLUDED.media_type,
        byte_size = EXCLUDED.byte_size,
        sha256 = EXCLUDED.sha256,
        modified_at = EXCLUDED.modified_at,
        content = EXCLUDED.content,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      input.artifactPath,
      input.categoryId ?? null,
      input.monthKey ?? null,
      input.snapshotDate ?? null,
      input.artifactKind,
      input.fileName,
      input.mediaType ?? "application/octet-stream",
      input.content.byteLength,
      sha256,
      input.modifiedAt ?? null,
      input.content,
      JSON.stringify(input.metadata ?? {}),
    ]
    ,
    { direct: options?.direct }
  )
}

export async function getSourceArtifactByPath(artifactPath: string) {
  const result = await queryDb<{
    artifact_path: string
    category_id: string | null
    month_key: string | null
    snapshot_date: string | null
    artifact_kind: string
    file_name: string
    media_type: string
    modified_at: Date | string | null
    content: Buffer
    metadata: Record<string, unknown> | string | null
  }>(
    `
      SELECT
        artifact_path,
        category_id,
        month_key,
        snapshot_date::text,
        artifact_kind,
        file_name,
        media_type,
        modified_at,
        content,
        metadata
      FROM source_artifacts
      WHERE artifact_path = $1
    `,
    [artifactPath]
  )

  const row = result.rows[0]
  if (!row) return null
  return {
    artifactPath: row.artifact_path,
    categoryId: row.category_id,
    monthKey: row.month_key,
    snapshotDate: row.snapshot_date,
    artifactKind: row.artifact_kind,
    fileName: row.file_name,
    mediaType: row.media_type,
    modifiedAt:
      row.modified_at instanceof Date ? row.modified_at.toISOString() : row.modified_at ?? null,
    content: row.content,
    metadata: parseJsonObject(row.metadata),
  } satisfies SourceArtifactRecord
}

export async function listSourceArtifactRefs() {
  const result = await queryDb<{
    artifact_path: string
    updated_at: Date | string
  }>(
    `
      SELECT artifact_path, updated_at
      FROM source_artifacts
      ORDER BY artifact_path ASC
    `
  )

  return result.rows.map((row) => ({
    artifactPath: row.artifact_path,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }))
}

export async function deleteSourceArtifactsByPrefix(prefix: string, options?: DbQueryOptions) {
  await queryDb(
    `
      DELETE FROM source_artifacts
      WHERE artifact_path LIKE $1
    `,
    [`${prefix}%`],
    { direct: options?.direct }
  )
}

function parseJsonObject(value: unknown) {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return {}
    } catch {
      return {}
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}
