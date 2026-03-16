import type { PoolClient } from "pg"

import type { ProductSummary, SnapshotSummary } from "@/lib/competitor-data"
import { queryDb, withDbTransaction } from "@/lib/db/client"
import { upsertSourceArtifact, type SourceArtifactInput } from "@/lib/db/source-artifacts"

type JsonRecord = Record<string, unknown>

export type SnapshotRowInput = {
  rowSource: string
  asin?: string
  title?: string
  brand?: string
  typeLabel?: string
  price?: number
  revenue?: number
  units?: number
  reviewCount?: number
  rating?: number
  fulfillment?: string
  sizeTier?: string
  subcategory?: string
  url?: string
  imageUrl?: string
  monthlyRevenue?: number
  monthlyUnits?: number
  estimatedRevenue12mo?: number
  estimatedUnits12mo?: number
  rankRevenue?: number
  rankUnits?: number
  metadata?: JsonRecord
}

export type SnapshotIngestInput = {
  sourceName: string
  categoryId: string
  label: string
  snapshotDate: string
  monthKey: string
  sourceMode?: string
  snapshotPayload: SnapshotSummary
  metadata?: JsonRecord
  rowRecords?: SnapshotRowInput[]
  artifacts?: SourceArtifactInput[]
}

type SnapshotRowRecord = {
  id: number
}

export async function ingestSnapshotData(input: SnapshotIngestInput) {
  const ingestionRun = await queryDb<{ id: number }>(
    `
      INSERT INTO ingestion_runs (
        source_name,
        category_id,
        month_key,
        snapshot_date,
        status,
        details
      )
      VALUES ($1, $2, $3, $4, 'running', $5::jsonb)
      RETURNING id
    `,
    [
      input.sourceName,
      input.categoryId,
      input.monthKey,
      input.snapshotDate,
      JSON.stringify({
        label: input.label,
        sourceMode: input.sourceMode ?? null,
      }),
    ],
    { direct: true }
  )

  const runId = ingestionRun.rows[0]?.id
  if (!runId) {
    throw new Error("Failed to create ingestion run.")
  }

  try {
    const result = await withDbTransaction(async (client) => {
      const upsertResult = await client.query<SnapshotRowRecord>(
        `
          INSERT INTO category_snapshots (
            category_id,
            label,
            month_key,
            snapshot_date,
            source_mode,
            totals_revenue,
            totals_units,
            totals_asin_count,
            snapshot_payload,
            metadata,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, NOW())
          ON CONFLICT (category_id, snapshot_date)
          DO UPDATE SET
            label = EXCLUDED.label,
            month_key = EXCLUDED.month_key,
            source_mode = EXCLUDED.source_mode,
            totals_revenue = EXCLUDED.totals_revenue,
            totals_units = EXCLUDED.totals_units,
            totals_asin_count = EXCLUDED.totals_asin_count,
            snapshot_payload = EXCLUDED.snapshot_payload,
            metadata = EXCLUDED.metadata,
            updated_at = NOW()
          RETURNING id
        `,
        [
          input.categoryId,
          input.label,
          input.monthKey,
          input.snapshotDate,
          input.sourceMode ?? null,
          safeNumber(input.snapshotPayload.totals.revenue),
          safeNumber(input.snapshotPayload.totals.units),
          safeNumber(input.snapshotPayload.totals.asinCount),
          JSON.stringify(input.snapshotPayload),
          JSON.stringify(input.metadata ?? {}),
        ]
      )

      const snapshotId = upsertResult.rows[0]?.id
      if (!snapshotId) {
        throw new Error("Failed to upsert category snapshot.")
      }

      await clearSnapshotChildren(client, snapshotId)
      await insertSnapshotRows(client, snapshotId, input.rowRecords ?? [])
      await insertSnapshotProducts(client, snapshotId, input.snapshotPayload)
      await insertBrandTotals(client, snapshotId, input.snapshotPayload)
      await insertPriceTiers(client, snapshotId, input.snapshotPayload)
      await insertRolling12(client, snapshotId, input.snapshotPayload)
      await insertTypeBreakdowns(client, snapshotId, input.snapshotPayload)
      await insertCategoryBrandMix(client, snapshotId, input.snapshotPayload)
      await insertFeaturePremiums(client, snapshotId, input.metadata)

      return { snapshotId }
    }, { direct: true })

    for (const artifact of input.artifacts ?? []) {
      await upsertSourceArtifact(artifact, { direct: true })
    }

    await queryDb(
      `
        UPDATE ingestion_runs
        SET status = 'completed', completed_at = NOW()
        WHERE id = $1
      `,
      [runId],
      { direct: true }
    )

    return result
  } catch (error) {
    await queryDb(
      `
        UPDATE ingestion_runs
        SET status = 'failed', completed_at = NOW(), details = jsonb_set(details, '{error}', to_jsonb($2::text), true)
        WHERE id = $1
      `,
      [runId, error instanceof Error ? error.message : "Unknown ingestion error"],
      { direct: true }
    )
    throw error
  }
}

async function clearSnapshotChildren(
  client: PoolClient,
  snapshotId: number
) {
  const tables = [
    "snapshot_rows",
    "snapshot_products",
    "snapshot_brand_totals",
    "snapshot_price_tiers",
    "snapshot_rolling_12",
    "snapshot_type_breakdowns",
    "snapshot_category_brand_mix",
    "snapshot_feature_premiums",
  ]
  for (const table of tables) {
    await client.query(`DELETE FROM ${table} WHERE snapshot_id = $1`, [snapshotId])
  }
}

async function insertSnapshotRows(
  client: PoolClient,
  snapshotId: number,
  rowRecords: SnapshotRowInput[]
) {
  for (const row of rowRecords) {
    await client.query(
      `
        INSERT INTO snapshot_rows (
          snapshot_id,
          row_source,
          asin,
          title,
          brand,
          type_label,
          price,
          revenue,
          units,
          review_count,
          rating,
          fulfillment,
          size_tier,
          subcategory,
          url,
          image_url,
          monthly_revenue,
          monthly_units,
          estimated_revenue_12mo,
          estimated_units_12mo,
          rank_revenue,
          rank_units,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23::jsonb
        )
      `,
      [
        snapshotId,
        row.rowSource,
        row.asin ?? null,
        row.title ?? null,
        row.brand ?? null,
        row.typeLabel ?? null,
        safeNullableNumber(row.price),
        safeNullableNumber(row.revenue),
        safeNullableNumber(row.units),
        safeNullableNumber(row.reviewCount),
        safeNullableNumber(row.rating),
        row.fulfillment ?? null,
        row.sizeTier ?? null,
        row.subcategory ?? null,
        row.url ?? null,
        row.imageUrl ?? null,
        safeNullableNumber(row.monthlyRevenue),
        safeNullableNumber(row.monthlyUnits),
        safeNullableNumber(row.estimatedRevenue12mo),
        safeNullableNumber(row.estimatedUnits12mo),
        row.rankRevenue ?? null,
        row.rankUnits ?? null,
        JSON.stringify(row.metadata ?? {}),
      ]
    )
  }
}

async function insertSnapshotProducts(
  client: PoolClient,
  snapshotId: number,
  snapshot: SnapshotSummary
) {
  await insertProductGroup(client, snapshotId, "top_revenue", snapshot.topProducts)
  await insertProductGroup(client, snapshotId, "top_units", snapshot.top50ByUnits ?? [])

  for (const listing of snapshot.brandListings ?? []) {
    await insertProductGroup(client, snapshotId, "brand_listing", listing.products, listing.brand)
  }
  for (const listing of snapshot.brandSheetListings ?? []) {
    await insertProductGroup(client, snapshotId, "brand_sheet_listing", listing.products, listing.brand)
  }
}

async function insertProductGroup(
  client: PoolClient,
  snapshotId: number,
  productGroup: string,
  products: ProductSummary[],
  brandSheet?: string
) {
  for (const [index, product] of products.entries()) {
    await client.query(
      `
        INSERT INTO snapshot_products (
          snapshot_id,
          product_group,
          rank_position,
          brand_sheet,
          asin,
          title,
          brand,
          price,
          revenue,
          units,
          review_count,
          rating,
          tool_type,
          avg_price,
          estimated_revenue_12mo,
          monthly_revenue,
          estimated_units_12mo,
          monthly_units,
          tool_rating,
          fulfillment,
          size_tier,
          subcategory,
          url,
          image_url,
          metadata
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25::jsonb
        )
      `,
      [
        snapshotId,
        productGroup,
        index + 1,
        brandSheet ?? null,
        product.asin ?? null,
        product.title ?? null,
        product.brand ?? null,
        safeNullableNumber(product.price),
        safeNullableNumber(product.revenue),
        safeNullableNumber(product.units),
        safeNullableNumber(product.reviewCount),
        safeNullableNumber(product.rating),
        product.toolType ?? null,
        safeNullableNumber(product.avgPrice),
        safeNullableNumber(product.estimatedRevenue12mo),
        safeNullableNumber(product.monthlyRevenue),
        safeNullableNumber(product.estimatedUnits12mo),
        safeNullableNumber(product.monthlyUnits),
        safeNullableNumber(product.toolRating),
        product.fulfillment ?? null,
        product.sizeTier ?? null,
        product.subcategory ?? null,
        product.url ?? null,
        product.imageUrl ?? null,
        JSON.stringify({}),
      ]
    )
  }
}

async function insertBrandTotals(
  client: PoolClient,
  snapshotId: number,
  snapshot: SnapshotSummary
) {
  for (const row of snapshot.brandTotals) {
    await client.query(
      `
        INSERT INTO snapshot_brand_totals (
          snapshot_id,
          brand,
          revenue,
          units,
          share,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        snapshotId,
        row.brand,
        safeNumber(row.revenue),
        safeNumber(row.units),
        safeNumber(row.share),
        JSON.stringify({}),
      ]
    )
  }
}

async function insertPriceTiers(
  client: PoolClient,
  snapshotId: number,
  snapshot: SnapshotSummary
) {
  for (const tier of snapshot.priceTiers) {
    await client.query(
      `
        INSERT INTO snapshot_price_tiers (
          snapshot_id,
          scope_key,
          label,
          revenue,
          revenue_share,
          units,
          units_share,
          revenue_mom,
          revenue_yoy,
          units_mom,
          units_yoy,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, 0, 0, NULL, NULL, NULL, NULL, $6::jsonb)
      `,
      [
        snapshotId,
        normalizeTierKey(tier.label),
        tier.label,
        safeNumber(tier.revenue),
        safeNumber(tier.share),
        JSON.stringify({}),
      ]
    )
  }
}

async function insertRolling12(
  client: PoolClient,
  snapshotId: number,
  snapshot: SnapshotSummary
) {
  const metrics = [
    ["revenue", snapshot.rolling12?.revenue],
    ["units", snapshot.rolling12?.units],
  ] as const

  for (const [metricName, metric] of metrics) {
    if (!metric) continue
    for (const brandRow of metric.brands ?? []) {
      await client.query(
        `
          INSERT INTO snapshot_rolling_12 (
            snapshot_id,
            metric_name,
            brand,
            rank,
            monthly,
            grand_total,
            month_labels,
            current_month_label,
            market_series,
            market_total_monthly,
            overall_total_monthly,
            metadata
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12::jsonb
          )
        `,
        [
          snapshotId,
          metricName,
          brandRow.brand,
          brandRow.rank,
          safeNullableNumber(brandRow.monthly),
          safeNullableNumber(brandRow.grandTotal),
          JSON.stringify(metric.monthLabels ?? []),
          metric.currentMonthLabel ?? null,
          JSON.stringify(metric.marketSeries ?? []),
          safeNullableNumber(metric.marketTotalMonthly),
          safeNullableNumber(metric.overallTotalMonthly),
          JSON.stringify({}),
        ]
      )
    }
  }
}

async function insertTypeBreakdowns(
  client: PoolClient,
  snapshotId: number,
  snapshot: SnapshotSummary
) {
  const metrics = [
    ["all_asins", snapshot.typeBreakdowns?.allAsins ?? []],
    ["top50", snapshot.typeBreakdowns?.top50 ?? []],
  ] as const

  for (const [metricSet, rows] of metrics) {
    for (const row of rows) {
      await client.query(
        `
          INSERT INTO snapshot_type_breakdowns (
            snapshot_id,
            metric_set,
            scope_key,
            label,
            avg_price,
            avg_price_mom,
            avg_price_yoy,
            units,
            units_share,
            units_mom,
            units_yoy,
            revenue,
            revenue_share,
            revenue_mom,
            revenue_yoy,
            source_kind,
            metadata
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb
          )
        `,
        [
          snapshotId,
          metricSet,
          row.scopeKey,
          row.label,
          safeNumber(row.avgPrice),
          safeNullableNumber(row.avgPriceMoM),
          safeNullableNumber(row.avgPriceYoY),
          safeNumber(row.units),
          safeNumber(row.unitsShare),
          safeNullableNumber(row.unitsMoM),
          safeNullableNumber(row.unitsYoY),
          safeNumber(row.revenue),
          safeNumber(row.revenueShare),
          safeNullableNumber(row.revenueMoM),
          safeNullableNumber(row.revenueYoY),
          snapshot.typeBreakdowns?.source ?? null,
          JSON.stringify({}),
        ]
      )
    }
  }
}

async function insertCategoryBrandMix(
  client: PoolClient,
  snapshotId: number,
  snapshot: SnapshotSummary
) {
  for (const row of snapshot.typeBreakdowns?.categoryBrandMix ?? []) {
    await client.query(
      `
        INSERT INTO snapshot_category_brand_mix (
          snapshot_id,
          scope_key,
          scope_label,
          brand,
          avg_price,
          units,
          units_share,
          revenue,
          revenue_share,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      `,
      [
        snapshotId,
        row.scopeKey,
        row.scopeLabel,
        row.brand,
        safeNumber(row.avgPrice),
        safeNumber(row.units),
        safeNumber(row.unitsShare),
        safeNumber(row.revenue),
        safeNumber(row.revenueShare),
        JSON.stringify({}),
      ]
    )
  }
}

async function insertFeaturePremiums(
  client: PoolClient,
  snapshotId: number,
  metadata?: JsonRecord
) {
  const normalizedCategoryData = asRecord(metadata?.normalizedCategoryData)
  const featurePremiums = Array.isArray(normalizedCategoryData?.featurePremiums)
    ? normalizedCategoryData.featurePremiums
    : []

  for (const feature of featurePremiums) {
    const value = asRecord(feature)
    if (!value) continue
    await client.query(
      `
        INSERT INTO snapshot_feature_premiums (
          snapshot_id,
          feature,
          with_feature_avg_price,
          without_feature_avg_price,
          premium_pct,
          with_feature_revenue_share,
          with_feature_unit_share,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        snapshotId,
        String(value.feature ?? ""),
        safeNumber(value.withFeatureAvgPrice),
        safeNumber(value.withoutFeatureAvgPrice),
        safeNumber(value.premiumPct),
        safeNumber(value.withFeatureRevenueShare),
        safeNumber(value.withFeatureUnitShare),
        JSON.stringify({}),
      ]
    )
  }
}

function safeNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function safeNullableNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function normalizeTierKey(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")
}

function asRecord(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonRecord
  }
  return null
}
