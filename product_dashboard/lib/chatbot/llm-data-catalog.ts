export type LlmTableSchema = {
  name: LlmTableName
  description: string
  columns: Array<{ name: string; type: "string" | "number" | "boolean" | "json" }>
}

export type LlmTableName =
  | "categories"
  | "snapshots"
  | "products_monthly"
  | "brands_monthly"
  | "market_monthly"
  | "type_breakdowns"
  | "raw_rows_csv"
  | "code_reader_workbook_rows"

export const LLM_TABLE_SCHEMAS: LlmTableSchema[] = [
  {
    name: "categories",
    description: "Dashboard category list.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "label", type: "string" },
    ],
  },
  {
    name: "snapshots",
    description: "Snapshot metadata per category and month.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "snapshot_label", type: "string" },
      { name: "source_type", type: "string" },
      { name: "source_file", type: "string" },
    ],
  },
  {
    name: "products_monthly",
    description: "Normalized product-level monthly metrics.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "asin", type: "string" },
      { name: "title", type: "string" },
      { name: "brand", type: "string" },
      { name: "type", type: "string" },
      { name: "price", type: "number" },
      { name: "revenue", type: "number" },
      { name: "units", type: "number" },
      { name: "review_count", type: "number" },
      { name: "rating", type: "number" },
      { name: "rank_revenue", type: "number" },
      { name: "rank_units", type: "number" },
      { name: "source_type", type: "string" },
      { name: "source_file", type: "string" },
    ],
  },
  {
    name: "brands_monthly",
    description: "Brand-level monthly metrics and ranks.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "brand", type: "string" },
      { name: "revenue", type: "number" },
      { name: "units", type: "number" },
      { name: "share", type: "number" },
      { name: "rank_revenue", type: "number" },
      { name: "rank_units", type: "number" },
      { name: "source_type", type: "string" },
      { name: "source_file", type: "string" },
    ],
  },
  {
    name: "market_monthly",
    description: "Category-level market totals and quality counters.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "revenue", type: "number" },
      { name: "units", type: "number" },
      { name: "asin_count", type: "number" },
      { name: "avg_price", type: "number" },
      { name: "rating_avg", type: "number" },
      { name: "brand_count", type: "number" },
      { name: "source_type", type: "string" },
      { name: "source_file", type: "string" },
    ],
  },
  {
    name: "type_breakdowns",
    description: "Type/segment scope metrics per month.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "scope_key", type: "string" },
      { name: "scope_label", type: "string" },
      { name: "metric_set", type: "string" },
      { name: "avg_price", type: "number" },
      { name: "units", type: "number" },
      { name: "units_share", type: "number" },
      { name: "revenue", type: "number" },
      { name: "revenue_share", type: "number" },
      { name: "source_type", type: "string" },
      { name: "source_file", type: "string" },
    ],
  },
  {
    name: "raw_rows_csv",
    description: "Raw CSV rows from raw_data folders (flattened).",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "source_file", type: "string" },
      { name: "asin", type: "string" },
      { name: "title", type: "string" },
      { name: "brand", type: "string" },
      { name: "price", type: "number" },
      { name: "asin_sales", type: "number" },
      { name: "asin_revenue", type: "number" },
      { name: "review_count", type: "number" },
      { name: "rating", type: "number" },
      { name: "fulfillment", type: "string" },
      { name: "subcategory", type: "string" },
      { name: "url", type: "string" },
    ],
  },
  {
    name: "code_reader_workbook_rows",
    description: "Code Reader workbook-derived rows from parsed snapshots.",
    columns: [
      { name: "category_id", type: "string" },
      { name: "snapshot_date", type: "string" },
      { name: "sheet_type", type: "string" },
      { name: "brand", type: "string" },
      { name: "asin", type: "string" },
      { name: "title", type: "string" },
      { name: "metric_name", type: "string" },
      { name: "metric_value", type: "number" },
      { name: "source_file", type: "string" },
    ],
  },
]

export function getTableSchema(name: string) {
  return LLM_TABLE_SCHEMAS.find((schema) => schema.name === name)
}

export function listTableSchemas() {
  return LLM_TABLE_SCHEMAS
}
