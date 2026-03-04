type CanonicalCompanyEntry = {
  key: string
  display: string
  subject: string
  aliases: string[]
}

const CANONICAL_COMPANIES: CanonicalCompanyEntry[] = [
  {
    key: "launch",
    display: "Launch",
    subject: "Launch TEC Vehicle diagnostic",
    aliases: [
      "launch",
      "launch tech",
      "launch tec",
      "launchtech",
      "launchtec",
      "launch tech usa",
      "launch tec usa",
      "launch tec vehicle diagnostic",
    ],
  },
]

const ALIAS_TO_KEY = new Map<string, string>()
for (const entry of CANONICAL_COMPANIES) {
  for (const alias of entry.aliases) {
    ALIAS_TO_KEY.set(normalizeCompanyKey(alias), entry.key)
  }
  ALIAS_TO_KEY.set(normalizeCompanyKey(entry.display), entry.key)
  ALIAS_TO_KEY.set(normalizeCompanyKey(entry.subject), entry.key)
}

const KEY_TO_ENTRY = new Map<string, CanonicalCompanyEntry>(
  CANONICAL_COMPANIES.map((entry) => [entry.key, entry])
)

export function normalizeCompanyKey(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim()
}

export function resolveCanonicalCompanySubject(input: string): string | null {
  const normalized = normalizeCompanyKey(input)
  if (!normalized) return null
  const key = ALIAS_TO_KEY.get(normalized) ?? normalized
  const entry = KEY_TO_ENTRY.get(key)
  return entry?.subject ?? null
}

export function resolveResearchSubjectForCompany(input: string) {
  const canonical = resolveCanonicalCompanySubject(input)
  if (canonical) return canonical

  const display = resolveDisplayCompanyLabel(input)
  if (!display) return "Vehicle diagnostic"
  return `${display} vehicle diagnostic`
}

export function resolveDisplayCompanyLabel(input: string) {
  const normalized = normalizeCompanyKey(input)
  if (!normalized) return ""

  const key = ALIAS_TO_KEY.get(normalized) ?? normalized
  const canonical = KEY_TO_ENTRY.get(key)
  if (canonical) return canonical.display

  return titleCase(cleanDisplayInput(input))
}

function cleanDisplayInput(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
}

function titleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}

