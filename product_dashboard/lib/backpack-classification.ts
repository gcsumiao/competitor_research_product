export const BACKPACK_CATEGORY_ID = "backpack"

export type BackpackTypeLabel =
  | "Rolling Tool Backpack"
  | "Welder / Specialty Trade Backpack"
  | "Tech / Laptop Tool Backpack"
  | "Tool Backpack"

export type BackpackTradeFocus =
  | "Welder / Ironworker"
  | "HVAC"
  | "Electrician"
  | "Mechanic / Technician"
  | "Cleanroom / ESD"
  | "General"

export type BackpackBaseStyle = "Molded / Hard Bottom" | "Soft Bottom" | "Unknown"
export type BackpackBand = "<16\"" | "16\"-19\"" | "19\"+" | "Unknown"
export type BackpackWeightBand = "<4 lb" | "4-7 lb" | "7+ lb" | "Unknown"
export type BackpackSeason = "Q1" | "Q2" | "Q3" | "Q4" | "Unknown"
export type BackpackBsrTier = "Top 10k" | "10k-50k" | "50k-200k" | "200k+" | "Unknown"

export type BackpackClassification = {
  includeInCategory: boolean
  typeLabel: BackpackTypeLabel
  tradeFocus: BackpackTradeFocus
  isRolling: boolean
  hasLaptopCompartment: boolean
  baseStyle: BackpackBaseStyle
  shippingTier: string
  heightBand: BackpackBand
  weightBand: BackpackWeightBand
  bestSalesSeason: BackpackSeason
  bsrTier: BackpackBsrTier
}

type BackpackInput = {
  title?: string | null
  subcategory?: string | null
  brand?: string | null
  shippingDetails?: string | null
  height?: number | null
  weight?: number | null
  bsr?: number | null
  bestSalesPeriod?: string | null
}

const EMPTY_CLASSIFICATION: BackpackClassification = {
  includeInCategory: false,
  typeLabel: "Tool Backpack",
  tradeFocus: "General",
  isRolling: false,
  hasLaptopCompartment: false,
  baseStyle: "Unknown",
  shippingTier: "Unknown",
  heightBand: "Unknown",
  weightBand: "Unknown",
  bestSalesSeason: "Unknown",
  bsrTier: "Unknown",
}

const BACKPACK_SHAPE_REGEX = /\b(backpack|back pack)\b/
const BACKPACK_PRODUCT_REGEX =
  /\b(tool backpack|backpack tool bag|tool bag backpack|jobsite backpack|welder backpack|electrician backpack|rolling tool backpack|backpack on wheels|tech pac)\b/
const TRADE_CONTEXT_REGEX =
  /\b(jobsite|tradesman|electrician|electrical|hvac|mechanic|technician|repairman|contractor|construction|plumber|maintenance|welder|welding|ironworker|cleanroom|esd)\b/
const ACCESSORY_NOISE_REGEX =
  /\b(pouch|accessories|accessory|mesh zipper pouch|storage case|moving bags?|packing bags?|tote bag|set of 2)\b/
const SLING_NOISE_REGEX = /\b(sling bag|crossbody|shoulder bag|chest backpack)\b/
const GENERIC_DAYPACK_NOISE_REGEX =
  /\b(daypack|rucksack|hiking|camping|backpacking|travel)\b/
const PLAIN_TACTICAL_NOISE_REGEX = /\b(edc|concealed carry|molle system)\b/
const MOVING_STORAGE_NOISE_REGEX = /\b(moving bags?|storage totes?|dorm storage|bedding|blankets)\b/
const ROLLING_REGEX =
  /\b(rolling|on wheels|with wheels|wheeled|roller tool bag|telescoping handle|retractable handle)\b/
const WELDER_REGEX = /\b(welder|welding|ironworker|helmet|hard hat|fire resistant)\b/
const HVAC_REGEX = /\bhvac\b/
const ELECTRICIAN_REGEX = /\b(electrician|electrical)\b/
const CLEANROOM_REGEX = /\b(cleanroom|anti-static|esd)\b/
const MECHANIC_REGEX = /\b(mechanic|technician|repairman|maintenance|plumber|contractor)\b/
const TECH_REGEX = /\b(laptop|charging port|tablet sleeve|tablet compartment|tech tool|tech pac)\b/
const HARD_BASE_REGEX =
  /\b(molded bottom|moulded bottom|molded base|moulded base|hard bottom|hard base|rigid base|waterproof base|molded waterproof base|hard shell|hardshell)\b/
const SOFT_BASE_REGEX = /\b(canvas|waxed canvas|nylon|leather|polyester|fabric|soft-sided|soft bottom)\b/

export function classifyBackpackProduct(input: BackpackInput): BackpackClassification {
  const title = normalizeText(input.title)
  const subcategory = normalizeText(input.subcategory)
  const brand = normalizeText(input.brand)
  const shippingDetails = normalizeLabel(input.shippingDetails)
  const haystack = [title, subcategory, brand].filter(Boolean).join(" ")

  if (!haystack) return EMPTY_CLASSIFICATION

  const hasBackpackShape = BACKPACK_SHAPE_REGEX.test(haystack)
  const hasBackpackProductSignal = BACKPACK_PRODUCT_REGEX.test(haystack)
  const hasTradeContext = TRADE_CONTEXT_REGEX.test(haystack)
  const isRolling = ROLLING_REGEX.test(haystack)
  const isWelder = WELDER_REGEX.test(haystack)
  const hasLaptopCompartment = TECH_REGEX.test(haystack)
  const isAccessoryNoise = ACCESSORY_NOISE_REGEX.test(haystack) && !hasBackpackShape
  const isSlingNoise = SLING_NOISE_REGEX.test(haystack) && !hasTradeContext && !hasBackpackProductSignal
  const isMovingStorageNoise = MOVING_STORAGE_NOISE_REGEX.test(haystack)
  const isGenericDaypackNoise =
    (GENERIC_DAYPACK_NOISE_REGEX.test(haystack) || PLAIN_TACTICAL_NOISE_REGEX.test(haystack)) &&
    !hasTradeContext &&
    !hasBackpackProductSignal &&
    !isWelder

  if (isAccessoryNoise || isSlingNoise || isMovingStorageNoise || isGenericDaypackNoise) {
    return EMPTY_CLASSIFICATION
  }

  const includeInCategory =
    hasBackpackShape &&
    (
      hasBackpackProductSignal ||
      hasTradeContext ||
      isRolling ||
      isWelder
    )

  if (!includeInCategory) {
    return EMPTY_CLASSIFICATION
  }

  const typeLabel: BackpackTypeLabel = isRolling
    ? "Rolling Tool Backpack"
    : isWelder
      ? "Welder / Specialty Trade Backpack"
      : hasLaptopCompartment
        ? "Tech / Laptop Tool Backpack"
        : "Tool Backpack"

  return {
    includeInCategory: true,
    typeLabel,
    tradeFocus: classifyTradeFocus(haystack),
    isRolling,
    hasLaptopCompartment,
    baseStyle: classifyBaseStyle(haystack),
    shippingTier: shippingDetails,
    heightBand: classifyHeightBand(input.height),
    weightBand: classifyWeightBand(input.weight),
    bestSalesSeason: classifyBestSalesSeason(input.bestSalesPeriod),
    bsrTier: classifyBsrTier(input.bsr),
  }
}

export function isBackpackCategory(categoryId: string | null | undefined) {
  return categoryId === BACKPACK_CATEGORY_ID
}

function classifyTradeFocus(haystack: string): BackpackTradeFocus {
  if (WELDER_REGEX.test(haystack)) return "Welder / Ironworker"
  if (CLEANROOM_REGEX.test(haystack)) return "Cleanroom / ESD"
  if (HVAC_REGEX.test(haystack)) return "HVAC"
  if (ELECTRICIAN_REGEX.test(haystack)) return "Electrician"
  if (MECHANIC_REGEX.test(haystack)) return "Mechanic / Technician"
  return "General"
}

function classifyBaseStyle(haystack: string): BackpackBaseStyle {
  if (HARD_BASE_REGEX.test(haystack)) return "Molded / Hard Bottom"
  if (SOFT_BASE_REGEX.test(haystack)) return "Soft Bottom"
  return "Unknown"
}

function classifyHeightBand(value: number | null | undefined): BackpackBand {
  if (!Number.isFinite(value) || value === undefined || value === null || value <= 0) return "Unknown"
  if (value < 16) return "<16\""
  if (value < 19) return "16\"-19\""
  return "19\"+"
}

function classifyWeightBand(value: number | null | undefined): BackpackWeightBand {
  if (!Number.isFinite(value) || value === undefined || value === null || value <= 0) return "Unknown"
  if (value < 4) return "<4 lb"
  if (value < 7) return "4-7 lb"
  return "7+ lb"
}

function classifyBestSalesSeason(value: string | null | undefined): BackpackSeason {
  const match = `${value ?? ""}`.trim().match(/^(\d{1,2})\//)
  const month = match ? Number(match[1]) : Number.NaN
  if (!Number.isFinite(month)) return "Unknown"
  if (month >= 1 && month <= 3) return "Q1"
  if (month >= 4 && month <= 6) return "Q2"
  if (month >= 7 && month <= 9) return "Q3"
  if (month >= 10 && month <= 12) return "Q4"
  return "Unknown"
}

function classifyBsrTier(value: number | null | undefined): BackpackBsrTier {
  if (!Number.isFinite(value) || value === undefined || value === null || value <= 0) return "Unknown"
  if (value < 10_000) return "Top 10k"
  if (value < 50_000) return "10k-50k"
  if (value < 200_000) return "50k-200k"
  return "200k+"
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

function normalizeLabel(value: string | null | undefined) {
  const normalized = `${value ?? ""}`.trim()
  if (!normalized || /^n\/a$/i.test(normalized)) return "Unknown"
  return normalized
}
