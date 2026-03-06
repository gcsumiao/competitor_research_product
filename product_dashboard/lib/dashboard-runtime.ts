import fs from "fs"
import path from "path"

type DeploymentMode = "code_reader_only" | "full"
type NonCodeCategoryId = "dmm" | "borescope" | "thermal_imager" | "night_vision"

const NON_CODE_CATEGORY_DIRS: Record<NonCodeCategoryId, string> = {
  dmm: "DMM",
  borescope: "Borescope",
  thermal_imager: "Thermal Imager",
  night_vision: "Night Vision Monoculars",
}

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
  return path.join(root, NON_CODE_CATEGORY_DIRS[categoryId], ...segments)
}
