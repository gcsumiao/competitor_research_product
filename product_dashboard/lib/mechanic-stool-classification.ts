export const MECHANIC_STOOL_CATEGORY_ID = "mechanic_stool"

export type MechanicStoolTypeLabel =
  | "Creeper Seat / Z-Creeper"
  | "Tall Shop Stool"
  | "Low-Profile Rolling Stool"
  | "Rolling Mechanic Stool + Backrest"
  | "Rolling Mechanic Stool"

export type MechanicStoolClassification = {
  includeInCategory: boolean
  typeLabel: MechanicStoolTypeLabel
  isAdjustableHeight: boolean
  hasBackrest: boolean
  storageType: "Drawer" | "Tool Tray" | "Tool Tray + Drawer" | "Magnetic Holder" | "No Storage"
  materialLabel: "Steel / Metal" | "Plastic" | "Vinyl / PVC / PU" | "Unspecified"
}

type MechanicStoolInput = {
  title?: string | null
  subcategory?: string | null
  brand?: string | null
}

const EMPTY_CLASSIFICATION: MechanicStoolClassification = {
  includeInCategory: false,
  typeLabel: "Rolling Mechanic Stool",
  isAdjustableHeight: false,
  hasBackrest: false,
  storageType: "No Storage",
  materialLabel: "Unspecified",
}

const STOOL_OR_SEAT_REGEX = /\b(stool|seat|roller seat|rolling seat|creeper)\b/
const CHAIR_REGEX = /\bchair\b/
const ROLLING_REGEX = /\b(rolling|roller|casters?|wheels?|swivel)\b/
const MECHANIC_CONTEXT_REGEX =
  /\b(mechanic|garage|shop|workshop|work bench|workbench|automotive|repair|detailing)\b/
const CREEPER_REGEX =
  /\b(z[- ]?creeper|creeper seat|rolling creeper|garage\/shop seat|garage shop seat|shop creeper|lay[- ]down creeper|foldable z)\b/
const TALL_SIGNAL_REGEX =
  /\b(tall|bar stool|counter stool|drafting stool|workbench stool|work bench stool|bench height)\b/
const LOW_PROFILE_REGEX = /\b(low[- ]profile|low profile|low[- ]height|low height|short|mini)\b/
const BACKREST_REGEX = /\b(backrest|with back|back support|with back support)\b/
const ADJUSTABLE_HEIGHT_REGEX = /\b(adjustable|height adjustable|adjustable height|pneumatic|hydraulic|lift)\b/
const DRAWER_REGEX = /\b(drawer|pull[- ]out)\b/
const TOOL_TRAY_REGEX = /\b(tool tray|storage tray|tray table|tool organizer|tool storage)\b/
const MAGNETIC_REGEX = /\b(magnetic|magnetized|magnetic parts)\b/
const STEEL_METAL_REGEX = /\b(steel|metal|iron|aluminum|aluminium|chrome)\b/
const PLASTIC_REGEX = /\b(plastic|polypropylene|polyethylene|abs|pp)\b/
const VINYL_PVC_PU_REGEX = /\b(vinyl|pvc|pu\b|pu leather|polyurethane|faux leather)\b/
const EXCLUDED_FURNITURE_REGEX =
  /\b(ottoman|loveseat|sectional|recliner|dining chair|accent chair|vanity chair|bench seat)\b/

export function classifyMechanicStoolProduct(
  input: MechanicStoolInput
): MechanicStoolClassification {
  const title = normalizeText(input.title)
  const subcategory = normalizeText(input.subcategory)
  const brand = normalizeText(input.brand)
  const haystack = [title, subcategory, brand].filter(Boolean).join(" ")

  if (!haystack) return EMPTY_CLASSIFICATION
  if (EXCLUDED_FURNITURE_REGEX.test(haystack)) return EMPTY_CLASSIFICATION

  const isCreeperSubcategory = /\bcreepers?\b/.test(subcategory)
  const isRollerSeatSubcategory = /\broller seats?\b/.test(subcategory)
  const hasCreeperSignal = isCreeperSubcategory || CREEPER_REGEX.test(haystack)
  const hasMechanicContext = MECHANIC_CONTEXT_REGEX.test(haystack)
  const hasRollingSignal = ROLLING_REGEX.test(haystack)
  const hasSeatSignal = STOOL_OR_SEAT_REGEX.test(haystack)
  const hasChairSignal = CHAIR_REGEX.test(haystack)
  const hasStorageSignal = DRAWER_REGEX.test(haystack) || TOOL_TRAY_REGEX.test(haystack) || MAGNETIC_REGEX.test(haystack)
  const hasBackrest = BACKREST_REGEX.test(haystack)
  const hasTallSignal = TALL_SIGNAL_REGEX.test(haystack)
  const hasLowProfileSignal = LOW_PROFILE_REGEX.test(haystack)
  const isAdjustableHeight = ADJUSTABLE_HEIGHT_REGEX.test(haystack)

  const includeInCategory =
    hasCreeperSignal ||
    isRollerSeatSubcategory ||
    (hasSeatSignal &&
      (hasMechanicContext || hasRollingSignal || hasStorageSignal || hasBackrest || hasTallSignal || hasLowProfileSignal)) ||
    (hasChairSignal && hasMechanicContext && (hasRollingSignal || hasBackrest || hasTallSignal))

  if (!includeInCategory) return EMPTY_CLASSIFICATION

  const typeLabel: MechanicStoolTypeLabel = hasCreeperSignal
    ? "Creeper Seat / Z-Creeper"
    : hasTallSignal && (hasMechanicContext || isRollerSeatSubcategory || /\bshop stool\b/.test(haystack))
      ? "Tall Shop Stool"
      : hasLowProfileSignal && (hasSeatSignal || hasRollingSignal)
        ? "Low-Profile Rolling Stool"
        : hasBackrest
          ? "Rolling Mechanic Stool + Backrest"
          : "Rolling Mechanic Stool"

  return {
    includeInCategory: true,
    typeLabel,
    isAdjustableHeight,
    hasBackrest,
    storageType: inferStorageType(haystack),
    materialLabel: inferMaterialLabel(haystack),
  }
}

export function isMechanicStoolCategory(categoryId: string | null | undefined) {
  return categoryId === MECHANIC_STOOL_CATEGORY_ID
}

function inferStorageType(haystack: string): MechanicStoolClassification["storageType"] {
  const hasDrawer = DRAWER_REGEX.test(haystack)
  const hasToolTray = TOOL_TRAY_REGEX.test(haystack)
  const hasMagnetic = MAGNETIC_REGEX.test(haystack)

  if (hasDrawer && hasToolTray) return "Tool Tray + Drawer"
  if (hasDrawer) return "Drawer"
  if (hasMagnetic) return "Magnetic Holder"
  if (hasToolTray) return "Tool Tray"
  return "No Storage"
}

function inferMaterialLabel(haystack: string): MechanicStoolClassification["materialLabel"] {
  if (STEEL_METAL_REGEX.test(haystack)) return "Steel / Metal"
  if (PLASTIC_REGEX.test(haystack)) return "Plastic"
  if (VINYL_PVC_PU_REGEX.test(haystack)) return "Vinyl / PVC / PU"
  return "Unspecified"
}

function normalizeText(value: string | null | undefined) {
  return `${value ?? ""}`
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[–-]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}
