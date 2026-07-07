export const OIL_CATEGORY_ID = "oil"

export type OilTypeLabel =
  | "Motor Oils"
  | "Gear Oils"
  | "Hydraulic Oils"
  | "Air Conditioning Oils"
  | "Transmission Fluids"
  | "Additives"
  | "Antifreezes & Coolants"
  | "Cleaners"
  | "Flushes"
  | "Greases & Lubricants"
  | "Brake Fluids"
  | "Power Steering Fluids"
  | "Radiator Conditioners & Protectants"
  | "Refrigerants"
  | "Winter Products"
  | "Windshield Washer Fluids"
  | "Corrosion & Rust Inhibitors"
  | "Other"

export type OilClassification = {
  includeInCategory: boolean
  typeLabel: OilTypeLabel
  rawSubcategory: string
  productFamily: string
  fluidApplication: string
  viscosityGrade: string
  packSize: string
  seasonalUse: string
}

type OilInput = {
  title?: string | null
  subcategory?: string | null
  brand?: string | null
}

const EMPTY_CLASSIFICATION: OilClassification = {
  includeInCategory: true,
  typeLabel: "Other",
  rawSubcategory: "",
  productFamily: "Other",
  fluidApplication: "General / Other",
  viscosityGrade: "Unknown",
  packSize: "Unknown",
  seasonalUse: "All-season / Unknown",
}

const SPECIFIC_SUBCATEGORY_MAP: Record<string, OilTypeLabel> = {
  "air conditioning oils": "Air Conditioning Oils",
  "antifreezes & coolants": "Antifreezes & Coolants",
  "brake fluids": "Brake Fluids",
  "gear oils": "Gear Oils",
  "hydraulic oils": "Hydraulic Oils",
  "motor oils": "Motor Oils",
  "power steering fluids": "Power Steering Fluids",
  "refrigerants": "Refrigerants",
  "transmission fluids": "Transmission Fluids",
  "windshield washer fluids": "Windshield Washer Fluids",
}

const ADDITIVE_SUBCATEGORY_REGEX =
  /\b(additives?|diesel additives?|fuel additives?|octane boosters?|starting fluids?)\b/
const CLEANER_SUBCATEGORY_REGEX = /\b(cleaners?|brake cleaners?|fuel system cleaners?|carburetor|throttle body|degreasers?|electrical cleaners?)\b/
const LUBE_SUBCATEGORY_REGEX =
  /\b(lithium|graphite|assembly|lubricants?|anti-seize|wheel bearing|caliper|grease|greases)\b/
const CORROSION_SUBCATEGORY_REGEX = /\b(corrosion|rust inhibitors?)\b/
const RADIATOR_SUBCATEGORY_REGEX = /\b(radiator|cooling system|sealants?)\b/

const MOTOR_OIL_REGEX =
  /\b(motor oil|engine oil|synthetic oil|conventional oil|high mileage|full synthetic|sae\s*\d|0w-?\d{2}|5w-?\d{2}|10w-?\d{2}|15w-?\d{2}|20w-?\d{2})\b/
const GEAR_OIL_REGEX = /\b(gear oil|gear lube|gear lubricant|differential fluid|diff fluid|75w-?\d{2,3}|80w-?\d{2,3}|85w-?\d{2,3}|90w)\b/
const HYDRAULIC_REGEX = /\b(hydraulic oil|hydraulic fluid|hydraulic tractor fluid|hydrostatic)\b/
const AC_OIL_REGEX = /\b(pag oil|ester oil|a\/c oil|ac oil|air conditioning oil|compressor oil)\b/
const TRANSMISSION_REGEX = /\b(transmission fluid|atf\b|cvt fluid|dct fluid|dual clutch|trans fluid)\b/
const ADDITIVE_REGEX = /\b(additive|treatment|stabilizer|stabiliser|octane booster|cetane|anti-gel|fuel injector|diesel treatment|fuel system treatment|stop leak)\b/
const COOLANT_REGEX = /\b(antifreeze|anti-freeze|coolant|ethylene glycol|propylene glycol|dex-cool)\b/
const CLEANER_REGEX = /\b(cleaner|cleaning|degreaser|brake clean|carburetor cleaner|throttle body cleaner|electrical cleaner)\b/
const FLUSH_REGEX = /\b(flush|flushing)\b/
const LUBE_REGEX = /\b(grease|lubricant|lube|anti-seize|assembly lube|wheel bearing|caliper grease|white lithium|graphite)\b/
const BRAKE_FLUID_REGEX = /\b(brake fluid|dot\s*[345](?:\.\d)?)\b/
const POWER_STEERING_REGEX = /\b(power steering)\b/
const RADIATOR_REGEX = /\b(radiator|water wetter|cooling system treatment|cooling system additive|radiator protector|radiator conditioner)\b/
const REFRIGERANT_REGEX = /\b(r-?134a|r-?1234yf|r-?12\b|refrigerant|freon)\b/
const WINTER_REGEX = /\b(winter|de-icer|deicer|ice melt|anti-gel|snow|low temp|sub-zero|subzero)\b/
const WASHER_REGEX = /\b(windshield washer|washer fluid|wiper fluid)\b/
const CORROSION_REGEX = /\b(corrosion|rust inhibitor|rust prevent|rust reformer|fluid film)\b/

export function classifyOilProduct(input: OilInput): OilClassification {
  const title = normalizeText(input.title)
  const subcategory = normalizeText(input.subcategory)
  const brand = normalizeText(input.brand)
  const haystack = [title, subcategory, brand].filter(Boolean).join(" ")
  const rawSubcategory = normalizeLabel(input.subcategory)

  if (!haystack) return { ...EMPTY_CLASSIFICATION, rawSubcategory }

  const typeLabel = classifyType(subcategory, haystack)

  return {
    includeInCategory: true,
    typeLabel,
    rawSubcategory,
    productFamily: classifyProductFamily(typeLabel),
    fluidApplication: classifyFluidApplication(typeLabel, haystack),
    viscosityGrade: inferViscosityGrade(haystack),
    packSize: inferPackSize(haystack),
    seasonalUse: classifySeasonalUse(typeLabel, haystack),
  }
}

export function isOilCategory(categoryId: string | null | undefined) {
  return categoryId === OIL_CATEGORY_ID
}

function classifyType(subcategory: string, haystack: string): OilTypeLabel {
  const mapped = SPECIFIC_SUBCATEGORY_MAP[subcategory]
  if (mapped) return mapped

  if (WASHER_REGEX.test(haystack)) return "Windshield Washer Fluids"
  if (REFRIGERANT_REGEX.test(haystack)) return "Refrigerants"
  if (BRAKE_FLUID_REGEX.test(haystack)) return "Brake Fluids"
  if (POWER_STEERING_REGEX.test(haystack)) return "Power Steering Fluids"
  if (TRANSMISSION_REGEX.test(haystack)) return "Transmission Fluids"
  if (AC_OIL_REGEX.test(haystack)) return "Air Conditioning Oils"
  if (HYDRAULIC_REGEX.test(haystack)) return "Hydraulic Oils"
  if (GEAR_OIL_REGEX.test(haystack)) return "Gear Oils"
  if (MOTOR_OIL_REGEX.test(haystack)) return "Motor Oils"
  if (COOLANT_REGEX.test(haystack)) return "Antifreezes & Coolants"
  if (FLUSH_REGEX.test(haystack)) return "Flushes"
  if (CLEANER_REGEX.test(haystack) || CLEANER_SUBCATEGORY_REGEX.test(subcategory)) return "Cleaners"
  if (RADIATOR_REGEX.test(haystack) || RADIATOR_SUBCATEGORY_REGEX.test(subcategory)) {
    return "Radiator Conditioners & Protectants"
  }
  if (WINTER_REGEX.test(haystack)) return "Winter Products"
  if (CORROSION_REGEX.test(haystack) || CORROSION_SUBCATEGORY_REGEX.test(subcategory)) {
    return "Corrosion & Rust Inhibitors"
  }
  if (LUBE_REGEX.test(haystack) || LUBE_SUBCATEGORY_REGEX.test(subcategory)) return "Greases & Lubricants"
  if (ADDITIVE_REGEX.test(haystack) || ADDITIVE_SUBCATEGORY_REGEX.test(subcategory)) return "Additives"

  return "Other"
}

function classifyProductFamily(typeLabel: OilTypeLabel) {
  switch (typeLabel) {
    case "Motor Oils":
      return "Engine Oil"
    case "Gear Oils":
    case "Transmission Fluids":
      return "Drivetrain Fluid"
    case "Hydraulic Oils":
      return "Hydraulic Fluid"
    case "Air Conditioning Oils":
    case "Refrigerants":
      return "HVAC Fluid"
    case "Antifreezes & Coolants":
    case "Radiator Conditioners & Protectants":
      return "Cooling System"
    case "Brake Fluids":
    case "Power Steering Fluids":
      return "Chassis / Control Fluid"
    case "Additives":
      return "Additive / Treatment"
    case "Cleaners":
    case "Flushes":
      return "Cleaner / Flush"
    case "Greases & Lubricants":
    case "Corrosion & Rust Inhibitors":
      return "Grease / Lubricant / Protectant"
    case "Winter Products":
    case "Windshield Washer Fluids":
      return "Seasonal / Visibility Fluid"
    default:
      return "Other"
  }
}

function classifyFluidApplication(typeLabel: OilTypeLabel, haystack: string) {
  switch (typeLabel) {
    case "Motor Oils":
      return "Engine"
    case "Gear Oils":
      return /\b(marine|outboard|sterndrive|lower unit)\b/.test(haystack)
        ? "Gear / Marine Drivetrain"
        : "Gear / Differential"
    case "Hydraulic Oils":
      return "Hydraulic System"
    case "Air Conditioning Oils":
    case "Refrigerants":
      return "A/C System"
    case "Transmission Fluids":
      return "Transmission"
    case "Antifreezes & Coolants":
    case "Radiator Conditioners & Protectants":
      return "Cooling System / Radiator"
    case "Brake Fluids":
      return "Brake System"
    case "Power Steering Fluids":
      return "Power Steering System"
    case "Additives":
      return /\b(diesel|fuel|gasoline|octane|cetane|injector)\b/.test(haystack)
        ? "Fuel System"
        : "Engine / General Treatment"
    case "Cleaners":
      return /\b(brake)\b/.test(haystack)
        ? "Brake System"
        : /\b(electrical|electronics)\b/.test(haystack)
          ? "Electrical"
          : "Cleaning / Degreasing"
    case "Flushes":
      return "System Flush"
    case "Greases & Lubricants":
      return "Lubrication Points"
    case "Winter Products":
      return "Winter Operation"
    case "Windshield Washer Fluids":
      return "Windshield / Visibility"
    case "Corrosion & Rust Inhibitors":
      return "Rust / Corrosion Protection"
    default:
      return "General / Other"
  }
}

function inferViscosityGrade(haystack: string) {
  const grade = haystack.match(/\b(?:sae\s*)?(?:0w|5w|10w|15w|20w|25w)-?\d{2}\b|\b(?:75w|80w|85w)-?\d{2,3}\b|\bsae\s*\d{2,3}\b|\biso\s*vg\s*\d{2,3}\b|\baw\s*\d{2,3}\b|\bdot\s*[345](?:\.\d)?\b/i)
  if (!grade) return "Unknown"
  return grade[0].toUpperCase().replace(/\s+/g, " ")
}

function inferPackSize(haystack: string) {
  const packMatch = haystack.match(/\b(?:case of|pack of|x)\s*(\d{1,3})\b/i)
  const sizeMatch = haystack.match(/\b(\d+(?:\.\d+)?)\s*(quart|qt|gallon|gal|liter|litre|l|ounce|oz|fluid ounce|fl oz|lb|pound)\b/i)
  const containerMatch = haystack.match(/\b(\d+(?:\.\d+)?)\s*(?:-|\s)?(?:pack|pk)\b/i)

  const parts: string[] = []
  if (packMatch) parts.push(`${packMatch[1]} pack`)
  if (containerMatch && !parts.length) parts.push(`${containerMatch[1]} pack`)
  if (sizeMatch) parts.push(`${trimNumber(sizeMatch[1])} ${normalizeUnit(sizeMatch[2])}`)

  return parts.length ? parts.join(" / ") : "Unknown"
}

function classifySeasonalUse(typeLabel: OilTypeLabel, haystack: string) {
  if (typeLabel === "Winter Products" || WINTER_REGEX.test(haystack)) return "Winter"
  if (typeLabel === "Antifreezes & Coolants" || COOLANT_REGEX.test(haystack)) return "Cold-weather / Cooling"
  if (typeLabel === "Refrigerants" || typeLabel === "Air Conditioning Oils") return "Warm-weather / A/C"
  return "All-season / Unknown"
}

function normalizeUnit(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === "qt" || normalized === "quart") return "qt"
  if (normalized === "gal" || normalized === "gallon") return "gal"
  if (normalized === "l" || normalized === "liter" || normalized === "litre") return "L"
  if (normalized === "ounce" || normalized === "oz" || normalized === "fluid ounce" || normalized === "fl oz") return "oz"
  if (normalized === "lb" || normalized === "pound") return "lb"
  return value
}

function trimNumber(value: string) {
  const numberValue = Number(value)
  return Number.isFinite(numberValue) && Number.isInteger(numberValue) ? String(numberValue) : value
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
  return normalized || "Unknown"
}
