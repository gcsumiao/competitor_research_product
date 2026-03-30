export const THERMAL_PHONE_ADAPTED_TYPE_LABEL =
  "USB / USB-C / phone adapted thermal imager"

export const THERMAL_PHONE_ADAPTED_YES_LABEL = "Yes"
export const THERMAL_PHONE_ADAPTED_NO_LABEL = "No"

const PHONE_ADAPTED_ASIN_OVERRIDES = new Set([
  "B0B7LMB22Q",
  "B0DX1PQCZR",
])

const PHONE_ADAPTED_POSITIVE_REGEXES = [
  /\busb(?:-c)?\b/i,
  /\btype-c\b/i,
  /\blightning\b/i,
  /\bandroid\b/i,
  /\biphone\b/i,
  /\bios\b/i,
  /\bsmartphone(?:s)?\b/i,
  /\bphone adapted\b/i,
  /\bplug[- ]?and[- ]?play\b/i,
]

const PHONE_ADAPTED_PAIRING_REGEXES = [
  /\bthermal (?:camera|imager).*\bfor (?:android|iphone|ios|smartphone)/i,
  /\bfor (?:android|iphone|ios|smartphone).*\bthermal (?:camera|imager)/i,
  /\bworks? for smartphones?(?: and tablets?)?/i,
  /\bfor phones?(?: and tablets?)?/i,
]

const THERMAL_PRODUCT_REGEXES = [
  /\bthermal (?:camera|imager|imaging camera)\b/i,
  /\binfrared (?:camera|imager)\b/i,
  /\bir (?:camera|imager)\b/i,
]

const ACCESSORY_TOKEN_REGEX =
  /\b(adapter|extender|cable|charger|case|pouch|cover|replacement)\b/i

const ACCESSORY_DOMINANT_REGEXES = [
  /\b(adapter|extender|cable|charger|case|pouch|cover|replacement)\b.*\bfor\b.*\bthermal (?:camera|imager|imaging camera)\b/i,
  /^(?:[^-]{0,80})\b(adapter|extender|cable|charger|case|pouch|cover|replacement)\b/i,
]

function normalizeText(value: string | null | undefined) {
  return `${value ?? ""}`.trim().toLowerCase()
}

export function isThermalPhoneAccessoryTitle(title: string) {
  const normalizedTitle = `${title ?? ""}`.trim()
  if (!normalizedTitle) return false
  const hasThermalProductSignal = THERMAL_PRODUCT_REGEXES.some((pattern) => pattern.test(normalizedTitle))
  if (!ACCESSORY_TOKEN_REGEX.test(normalizedTitle)) return false
  if (!hasThermalProductSignal) return true
  return ACCESSORY_DOMINANT_REGEXES.some((pattern) => pattern.test(normalizedTitle))
}

export function isPhoneAdaptedThermalImager(input: { asin?: string | null; title?: string | null }) {
  const asin = `${input.asin ?? ""}`.trim().toUpperCase()
  if (PHONE_ADAPTED_ASIN_OVERRIDES.has(asin)) return true

  const title = `${input.title ?? ""}`.trim()
  if (!title) return false
  const hasThermalProductSignal = THERMAL_PRODUCT_REGEXES.some((pattern) => pattern.test(title))
  if (!hasThermalProductSignal) return false
  if (isThermalPhoneAccessoryTitle(title)) return false

  const hasPositiveSignal = PHONE_ADAPTED_POSITIVE_REGEXES.some((pattern) => pattern.test(title))
  const hasPairingSignal = PHONE_ADAPTED_PAIRING_REGEXES.some((pattern) => pattern.test(title))
  return hasPositiveSignal || hasPairingSignal
}

export function inferThermalTypeLabel(input: { asin?: string | null; title?: string | null }) {
  const title = normalizeText(input.title)
  if (isPhoneAdaptedThermalImager(input)) return THERMAL_PHONE_ADAPTED_TYPE_LABEL
  if (/\bhandheld\b/i.test(title)) return "Handheld"
  if (/\bwireless\b/i.test(title)) return "Wireless"
  if (/\bpocket\b/i.test(title)) return "Pocket size"
  if (/\blandscape\b/i.test(title)) return "Landscape"
  return "-"
}

export function inferThermalPhoneAdaptedLabel(input: { asin?: string | null; title?: string | null }) {
  return isPhoneAdaptedThermalImager(input)
    ? THERMAL_PHONE_ADAPTED_YES_LABEL
    : THERMAL_PHONE_ADAPTED_NO_LABEL
}
