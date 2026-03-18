export const ALL_DASHBOARD_PATHS = [
  "/",
  "/sales",
  "/customers",
  "/orders",
  "/reports",
  "/specs",
  "/consult-me",
] as const

export const CODE_READER_REVALIDATE_PATHS = [
  "/",
  "/sales",
  "/customers",
  "/orders",
  "/reports",
  "/consult-me",
] as const

export const NON_CODE_REVALIDATE_PATHS = [...ALL_DASHBOARD_PATHS] as const

export const REPORTS_REVALIDATE_PATHS = ["/reports"] as const

export const TYPES_REVALIDATE_PATHS = ["/specs"] as const
