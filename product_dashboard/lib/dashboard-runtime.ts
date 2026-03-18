import fs from "fs"
import path from "path"

import {
  getNonCodeCategoryConfig,
  type NonCodeCategoryId,
} from "@/lib/non-code-category-config"

type DeploymentMode = "code_reader_only" | "full"
export type DashboardDataSource = "file" | "postgres"

export function getDashboardDeploymentMode(): DeploymentMode {
  const configured = (process.env.DASHBOARD_DEPLOYMENT_MODE ?? "").trim().toLowerCase()
  if (configured === "code_reader_only" || configured === "full") {
    return configured
  }

  // Keep existing Vercel deployments safe unless they explicitly opt into full mode.
  return process.env.VERCEL ? "code_reader_only" : "full"
}

export function isFullDashboardEnabled() {
  return getDashboardDeploymentMode() === "full"
}

export function getDashboardDataSource(): DashboardDataSource {
  const configured = (process.env.DASHBOARD_DATA_SOURCE ?? "").trim().toLowerCase()
  if (configured === "postgres" || configured === "file") {
    return configured
  }
  return "file"
}

export function isPostgresDashboardSource() {
  return getDashboardDataSource() === "postgres"
}

export function getDashboardRevalidateSecret() {
  return (process.env.DASHBOARD_REVALIDATE_SECRET ?? "").trim()
}

export function getLegacyCodeReaderRedirectBaseUrl() {
  return (process.env.LEGACY_CODE_READER_REDIRECT_BASE_URL ?? "").trim()
}

export function resolveAppRoot() {
  const cwd = process.cwd()
  return path.basename(cwd) === "product_dashboard" ? cwd : path.resolve(cwd, "product_dashboard")
}

export function resolveCodeReaderDataDir(...segments: string[]) {
  return path.join(resolveAppRoot(), "data", "code_reader_scanner", ...segments)
}

export function resolveNonCodeDataRoot() {
  const appLocal = path.join(resolveAppRoot(), "data", "non_code_categories")
  if (fs.existsSync(appLocal)) return appLocal

  const legacyRoot = path.resolve(resolveAppRoot(), "..", "NewProductCategory")
  if (fs.existsSync(legacyRoot)) return legacyRoot

  return null
}

export function resolveNonCodeCategoryDir(categoryId: NonCodeCategoryId, ...segments: string[]) {
  const root = resolveNonCodeDataRoot()
  if (!root) return null
  const config = getNonCodeCategoryConfig(categoryId)
  if (!config) return null
  return path.join(root, config.folderName, ...segments)
}
