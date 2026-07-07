export const STETHOSCOPE_CATEGORY_ID = "stethoscope"

export type StethoscopeTypeLabel =
  | "Mechanical Stethoscope"
  | "Electronic Stethoscope / Electronic Ear"
  | "Chassis Ear / Multi-channel Noise Finder"
  | "Other Automotive Noise Diagnostic Tool"

export type StethoscopeClassification = {
  includeInCategory: boolean
  typeLabel: StethoscopeTypeLabel
  diagnosticType: string
  isElectronic: boolean
  channelCount: string
  probeCount: string
  vehicleContext: string
}

type StethoscopeInput = {
  title?: string | null
  subcategory?: string | null
  brand?: string | null
}

const EMPTY_CLASSIFICATION: StethoscopeClassification = {
  includeInCategory: false,
  typeLabel: "Other Automotive Noise Diagnostic Tool",
  diagnosticType: "Unknown",
  isElectronic: false,
  channelCount: "Unknown",
  probeCount: "Unknown",
  vehicleContext: "Unknown",
}

const EXCLUDED_DECOR_REGEX =
  /\b(vinyl|decal|sticker|bumper|shirt|t-?shirt|svg|sublimation|cookie cutter|badge|charm|poster|mug|tumbler|water bottle|laptop|notebook|scrub cap|lanyard|ornament|keychain|planner)\b/
const EXCLUDED_MEDICAL_REGEX = /\b(nurse|nurses|nursing|medical|doctor|doctors|physician|rn\b|cardiology|pediatric|patient|hospital|clinic|paramedic|ems)\b/

const AUTOMOTIVE_CONTEXT_REGEX =
  /\b(automotive|auto\b|car|cars|vehicle|vehicles|truck|trucks|motorcycle|engine|chassis|mechanic|mechanics|mechanical|garage|bearing|cylinder|motor)\b/
const DIAGNOSTIC_CONTEXT_REGEX =
  /\b(diagnostic|diagnostics|diagnosis|detect(?:or|ion)?|listening|hearing|tester|monitor|fault|abnormal sound|sound detection|noise finder|noise detection|sonarscope)\b/
const STETHOSCOPE_REGEX = /\b(stethoscope|stethoscopes|stethoscop|stetoskop)\b/
const ELECTRONIC_REGEX = /\b(electronic|electric|wireless|amplifier|amplified|headphones?|earphone|electronic ear|sensor)\b/
const CHASSIS_EAR_REGEX =
  /\b(chassis\s*ear|chassis\s*ears|chassisear|multi[- ]?channel|channel car engine noise|noise finder|sound finder|squeak and rattle finder)\b/
const MECHANICAL_STETHOSCOPE_REGEX = /\b(mechanic(?:s|'s)? stethoscope|engine stethoscope|cylinder stethoscope|automotive stethoscope|auto stethoscope)\b/

export function classifyStethoscopeProduct(input: StethoscopeInput): StethoscopeClassification {
  const title = normalizeText(input.title)
  const subcategory = normalizeText(input.subcategory)
  const brand = normalizeText(input.brand)
  const haystack = [title, subcategory, brand].filter(Boolean).join(" ")

  if (!haystack) return EMPTY_CLASSIFICATION
  if (EXCLUDED_DECOR_REGEX.test(haystack)) return EMPTY_CLASSIFICATION
  if (EXCLUDED_MEDICAL_REGEX.test(haystack) && !AUTOMOTIVE_CONTEXT_REGEX.test(haystack)) return EMPTY_CLASSIFICATION

  const hasStethoscopeSignal = STETHOSCOPE_REGEX.test(haystack)
  const hasAutomotiveContext = AUTOMOTIVE_CONTEXT_REGEX.test(haystack)
  const hasDiagnosticContext = DIAGNOSTIC_CONTEXT_REGEX.test(haystack)
  const isElectronic = ELECTRONIC_REGEX.test(haystack)
  const isChassisEar = CHASSIS_EAR_REGEX.test(haystack)
  const isMechanicalStethoscope = MECHANICAL_STETHOSCOPE_REGEX.test(haystack)

  const includeInCategory =
    isChassisEar ||
    isMechanicalStethoscope ||
    (hasStethoscopeSignal && hasAutomotiveContext && hasDiagnosticContext) ||
    (hasAutomotiveContext && /\b(electronic ear|noise finder|abnormal sound|sound detection)\b/.test(haystack))

  if (!includeInCategory) return EMPTY_CLASSIFICATION

  const typeLabel: StethoscopeTypeLabel = isChassisEar
    ? "Chassis Ear / Multi-channel Noise Finder"
    : isElectronic
      ? "Electronic Stethoscope / Electronic Ear"
      : hasStethoscopeSignal || isMechanicalStethoscope
        ? "Mechanical Stethoscope"
        : "Other Automotive Noise Diagnostic Tool"

  return {
    includeInCategory: true,
    typeLabel,
    diagnosticType: inferDiagnosticType(typeLabel, haystack),
    isElectronic,
    channelCount: inferChannelCount(haystack),
    probeCount: inferProbeCount(haystack),
    vehicleContext: inferVehicleContext(haystack),
  }
}

export function isStethoscopeCategory(categoryId: string | null | undefined) {
  return categoryId === STETHOSCOPE_CATEGORY_ID
}

function inferDiagnosticType(typeLabel: StethoscopeTypeLabel, haystack: string) {
  if (typeLabel === "Chassis Ear / Multi-channel Noise Finder") return "Chassis / Road Noise"
  if (/\b(engine|cylinder|motor|bearing)\b/.test(haystack)) return "Engine / Mechanical Noise"
  if (/\b(chassis|suspension|brake|wheel|road)\b/.test(haystack)) return "Chassis / Road Noise"
  return "General Vehicle Noise"
}

function inferChannelCount(haystack: string) {
  const match = haystack.match(/\b(\d{1,2})\s*[- ]?(?:channel|ch)\b/)
  if (!match) return "N/A"
  return `${match[1]} channel`
}

function inferProbeCount(haystack: string) {
  const match = haystack.match(/\b(\d{1,2})\s*(?:pcs?|pieces?|probes?|sensors?)\b/)
  if (!match) return "Unknown"
  return `${match[1]} probe/sensor`
}

function inferVehicleContext(haystack: string) {
  if (/\b(motorcycle|motorcycles)\b/.test(haystack)) return "Motorcycle"
  if (/\b(truck|trucks)\b/.test(haystack)) return "Truck"
  if (/\b(car|cars|auto\b|automotive|vehicle|vehicles)\b/.test(haystack)) return "Automotive"
  if (/\b(engine|chassis|mechanic|mechanics)\b/.test(haystack)) return "Automotive"
  return "Unknown"
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
