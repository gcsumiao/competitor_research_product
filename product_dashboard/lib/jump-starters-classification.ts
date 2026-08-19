export const JUMP_STARTERS_CATEGORY_ID = "jump_starters"
export const JUMP_STARTERS_ACCESSORY_TYPE_LABEL = "Accessory / Adapter"

export type JumpStarterTypeLabel =
  | typeof JUMP_STARTERS_ACCESSORY_TYPE_LABEL
  | "Super Capacitor"
  | "Heavy-duty / Professional"
  | "Jump Starter + Inflator"
  | "Jump Starter"

export type JumpStarterClassification = {
  includeInCategory: boolean
  typeLabel: JumpStarterTypeLabel
  isAccessory: boolean
  accessoryType: string
  hasInflator: boolean
  hasPowerStation: boolean
  voltageClass: string
  excludeFromAvgPrice: boolean
}

type JumpStarterInput = {
  title?: string | null
  subcategory?: string | null
  brand?: string | null
}

type PriceCarrier = {
  price?: number | null
  toolType?: string | null
  typeLabel?: string | null
  excludeFromAvgPrice?: boolean | null
}

const EMPTY_CLASSIFICATION: JumpStarterClassification = {
  includeInCategory: false,
  typeLabel: "Jump Starter",
  isAccessory: false,
  accessoryType: "Not accessory",
  hasInflator: false,
  hasPowerStation: false,
  voltageClass: "12V",
  excludeFromAvgPrice: false,
}

const ACCESSORY_NOUN_REGEX =
  /\b(case|bag|charger(?: cable| cord)?|charging cable|charging cord|power adapter|power cord|adapter|adaptor|replacement|clamp(?:s)?|terminal|jump post|booster cable(?:s)?|jumper cable(?:s)?|cord|plug|kit|cover)\b/

const ACCESSORY_TARGET_REGEX =
  /\b(for|compatible with|fits?|replacement for|works with)\b/

const JUMP_STARTER_TARGET_REGEX =
  /\b(jump starter|jump box|jump pack|jumpstart(?:er)?|battery booster|booster pack|booster pak|jumper starter|jump-n-carry|noco boost|boost x)\b/

const MODEL_TARGET_REGEX = /\b(gb\d{2,3}\+?|gbx\d{2,3}|jnc\d{3,4}|dsr\d{3}|sc\d{3,4}|pprh[\da-z]+)\b/

const CORE_DEVICE_REGEX =
  /\b(jump starter|jump box|jump pack|jumper starter|battery booster|booster pack|booster pak|jumpstart(?:er)?|car starter|battery starter)\b/

const DEVICE_SIGNAL_REGEX =
  /\b(portable|battery pack|power bank|lithium|ultrasafe|roadside|emergency|display|led light|flashlight|storage case|smart jumper cables?|smart clamp|jump cables?|power supply)\b/

const CAPACITY_SIGNAL_REGEX =
  /\b\d{3,5}\s*(?:a|amp|amps)\b|\b\d+(?:\.\d+)?\s*l\b|\b\d+(?:\.\d+)?\s*psi\b|\b\d+(?:\.\d+)?\s*wh\b|\b\d{4,6}\s*mah\b/

const INFLATOR_REGEX =
  /\b(inflator|air compressor|tire inflator|air pump|inflate(?:&| and )? deflate|inflates tires|air blower)\b/

const POWER_STATION_REGEX = /\b(ac outlet|inverter|power station|auxiliary port|camping)\b/

const SUPER_CAPACITOR_REGEX = /\b(super ?capacitor|batteryless)\b/

const HEAVY_DUTY_REGEX =
  /\b(12\/24v|24v|heavy[- ]duty|wheeled|professional|commercial|proseries|jump-n-carry|engine starter|booster pak|kwikstart|rescue jump pack)\b/

const HEAVY_DUTY_BRAND_MODEL_REGEX = /\b(jnc\d{3,4}|dsr\d{3}|booster pak|jump-n-carry)\b/

export function classifyJumpStarterProduct(input: JumpStarterInput): JumpStarterClassification {
  const title = normalizeText(input.title)
  const subcategory = normalizeText(input.subcategory)
  const brand = normalizeText(input.brand)
  const haystack = [title, subcategory, brand].filter(Boolean).join(" ")

  if (!haystack) return EMPTY_CLASSIFICATION

  const targetsJumpStarter =
    JUMP_STARTER_TARGET_REGEX.test(haystack) || MODEL_TARGET_REGEX.test(haystack) || /\bnoco\b/.test(haystack)

  const hasAccessoryNoun = ACCESSORY_NOUN_REGEX.test(haystack)
  const hasAccessoryTarget = ACCESSORY_TARGET_REGEX.test(haystack)
  const hasInflator = INFLATOR_REGEX.test(haystack)
  const hasPowerStation = POWER_STATION_REGEX.test(haystack)
  const isSuperCapacitor = SUPER_CAPACITOR_REGEX.test(haystack)

  const isHeavyDutyDevice =
    HEAVY_DUTY_REGEX.test(haystack) ||
    HEAVY_DUTY_BRAND_MODEL_REGEX.test(haystack) ||
    /\b(engine starter|peak amp)\b/.test(haystack)

  const isStandaloneDevice =
    isSuperCapacitor ||
    isHeavyDutyDevice ||
    (CORE_DEVICE_REGEX.test(haystack) &&
      (CAPACITY_SIGNAL_REGEX.test(haystack) ||
        DEVICE_SIGNAL_REGEX.test(haystack) ||
        /\b(all gas|diesel|up to)\b/.test(haystack)))

  const isAccessory =
    !isStandaloneDevice &&
    targetsJumpStarter &&
    (
      (hasAccessoryNoun && hasAccessoryTarget) ||
      /\b(eva (?:protection )?case|protection case|charging cable|charging cord|power adapter|power cord)\b/.test(haystack) ||
      /\b(jump post|terminal|post cover)\b/.test(haystack) ||
      /\b(booster|jumper|jump start).{0,24}cables?\b/.test(haystack) ||
      /\baccessories?\b/.test(haystack)
    )

  const isRelevantDevice =
    isStandaloneDevice ||
    hasInflator ||
    /\b(diehard jumpstarter|emergency starter|professional emergency starter)\b/.test(haystack)

  if (!isAccessory && !isRelevantDevice) {
    return EMPTY_CLASSIFICATION
  }

  const typeLabel = isAccessory
    ? JUMP_STARTERS_ACCESSORY_TYPE_LABEL
    : isSuperCapacitor
      ? "Super Capacitor"
      : isHeavyDutyDevice
        ? "Heavy-duty / Professional"
        : hasInflator
          ? "Jump Starter + Inflator"
          : "Jump Starter"

  return {
    includeInCategory: true,
    typeLabel,
    isAccessory,
    accessoryType: classifyAccessoryType(haystack, isAccessory),
    hasInflator: isAccessory ? false : hasInflator,
    hasPowerStation: isAccessory ? false : hasPowerStation,
    voltageClass: classifyVoltageClass(haystack, isAccessory),
    excludeFromAvgPrice: isAccessory,
  }
}

export function isJumpStartersCategory(categoryId: string | null | undefined) {
  return categoryId === JUMP_STARTERS_CATEGORY_ID
}

export function isJumpStarterAccessoryTypeLabel(value: string | null | undefined) {
  return value?.trim().toLowerCase() === JUMP_STARTERS_ACCESSORY_TYPE_LABEL.toLowerCase()
}

export function shouldExcludeAvgPriceForCategory(
  categoryId: string | null | undefined,
  item: PriceCarrier
) {
  if (!isJumpStartersCategory(categoryId)) return false
  if (item.excludeFromAvgPrice === true) return true
  return isJumpStarterAccessoryTypeLabel(item.toolType ?? item.typeLabel)
}

// Revenue-weighted average price over the (category-filtered) rows:
// sum of monthly revenue divided by sum of monthly units — matching the
// report's Top 50 overview math, which never averages the price column.
export function weightedAveragePriceForCategory(
  categoryId: string | null | undefined,
  items: Array<PriceCarrier & { revenue?: number | null; units?: number | null }>
) {
  let revenue = 0
  let units = 0
  for (const item of items) {
    if (shouldExcludeAvgPriceForCategory(categoryId, item)) continue
    const itemRevenue = Number(item.revenue ?? 0)
    const itemUnits = Number(item.units ?? 0)
    if (!Number.isFinite(itemRevenue) || !Number.isFinite(itemUnits)) continue
    revenue += itemRevenue
    units += itemUnits
  }
  return units > 0 ? revenue / units : 0
}

export function averagePriceForCategory(
  categoryId: string | null | undefined,
  items: PriceCarrier[]
) {
  const prices = items
    .filter((item) => {
      const price = Number(item.price ?? 0)
      return Number.isFinite(price) && price > 0 && !shouldExcludeAvgPriceForCategory(categoryId, item)
    })
    .map((item) => Number(item.price ?? 0))

  if (!prices.length) return 0
  return prices.reduce((sum, value) => sum + value, 0) / prices.length
}

function classifyAccessoryType(haystack: string, isAccessory: boolean) {
  if (!isAccessory) return "Not accessory"
  if (/\b(case|bag|cover)\b/.test(haystack)) return "Case"
  if (/\b(jump post|terminal|post cover)\b/.test(haystack)) return "Jump Post / Terminal"
  if (/\b(adapter|adaptor|charger|charging cable|charging cord|power adapter|power cord|usb-c)\b/.test(haystack)) {
    return "Adapter / Charger"
  }
  if (/\b(replacement|spare)\b/.test(haystack)) return "Replacement Part"
  if (/\b(cable|cord|clamp|booster cable|jumper cable)\b/.test(haystack)) return "Cable / Clamp"
  return "Accessory / Other"
}

function classifyVoltageClass(haystack: string, isAccessory: boolean) {
  if (isAccessory) return "N/A"
  if (/\b(6\/12v|12\/24v|24\/12v)\b/.test(haystack)) return "12V/24V"
  if (/\b24v\b/.test(haystack)) return "24V"
  return "12V"
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
