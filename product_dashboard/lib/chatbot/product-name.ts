type ProductNameInput = {
  asin?: string | null
  title?: string | null
  brand?: string | null
}

const DISPLAY_NAME_MAX_LENGTH = 64
const DISPLAY_NAME_MEMO = new Map<string, string>()
const GENERIC_MODEL_TOKENS = new Set([
  "OBD",
  "OBD2",
  "OBDII",
  "CAN",
  "USB",
  "WIFI",
  "BLUETOOTH",
])
const MODEL_TOKEN_STOPLIST = new Set([
  "BMW",
  "AUDI",
  "VW",
  "VAG",
  "BENZ",
  "FORD",
  "GM",
  "TOYOTA",
  "HONDA",
  "ABS",
  "SRS",
  "TPMS",
  "DPF",
  "EPB",
  "SAS",
  "OBD",
  "OBD2",
  "OBDII",
])

export function displayProductName(product: ProductNameInput): string {
  const memoKey = compact(product.asin).toUpperCase()
  const memoized = memoKey ? DISPLAY_NAME_MEMO.get(memoKey) : undefined
  if (memoized) return memoized

  const displayName = buildDisplayProductName(product)
  if (memoKey) DISPLAY_NAME_MEMO.set(memoKey, displayName)
  return displayName
}

function buildDisplayProductName(product: ProductNameInput): string {
  const title = compact(product.title)
  const brand = compact(product.brand)
  const brandDisplay = formatBrandDisplay(brand)

  if (!brandDisplay) {
    return truncate(title || compact(product.asin) || "Unknown product")
  }

  const titleWithoutBrand = stripLeadingBrand(title, brand)
  const tokens = stripRepeatedLeadingBrandTokens(tokenize(titleWithoutBrand), brandDisplay)
  const mixedModelStart = tokens.findIndex(
    (token) => hasLettersAndDigits(token) && isSelectableModelToken(token, brandDisplay)
  )
  const modelStart = mixedModelStart >= 0
    ? mixedModelStart
    : tokens.findIndex((token) => isSelectableModelToken(token, brandDisplay))
  if (modelStart >= 0) {
    const modelTokens = [tokens[modelStart]]
    const next = tokens[modelStart + 1]
    if (next && isAdditionalModelToken(next, brandDisplay)) modelTokens.push(next)
    return truncate(`${brandDisplay} ${modelTokens.join(" ")}`)
  }

  const fallbackWords = tokens.slice(0, 2)
  if (fallbackWords.length) {
    return truncate(`${brandDisplay} ${fallbackWords.join(" ")}`)
  }

  return truncate(title || brandDisplay)
}

function isSelectableModelToken(token: string, brandDisplay: string) {
  const upper = token.toUpperCase()
  if (GENERIC_MODEL_TOKENS.has(upper) || MODEL_TOKEN_STOPLIST.has(upper)) return false
  if (isYearToken(token) || isRepeatedBrandToken(token, brandDisplay)) return false
  return isModelToken(token)
}

function isAdditionalModelToken(token: string, brandDisplay: string) {
  const upper = token.toUpperCase()
  if (GENERIC_MODEL_TOKENS.has(upper) || MODEL_TOKEN_STOPLIST.has(upper)) return false
  if (isYearToken(token) || isRepeatedBrandToken(token, brandDisplay)) return false
  return isModelToken(token)
}

export function stripDisplayNameSuffix(name: string) {
  return name.replace(/\s*\((?:…|\$)[^)]*\)$/u, "")
}

function isModelToken(token: string) {
  return /\d/.test(token) || (/^[A-Z0-9-]+$/.test(token) && token.replace(/[^A-Z]/g, "").length >= 3)
}

function hasLettersAndDigits(token: string) {
  return /[A-Za-z]/.test(token) && /\d/.test(token)
}

function isYearToken(token: string) {
  const digitRuns = token.match(/\d+/g)
  if (!digitRuns || digitRuns.length === 0) return false
  const isYearRun = (run: string) => {
    if (run.length !== 4) return false
    const year = Number(run)
    return year >= 1900 && year <= 2100
  }
  // Reject tokens whose digits are exclusively year runs ("2026", "1996-2019",
  // "Genius(2005") while keeping real model codes like "NT510" or "X431".
  return digitRuns.every(isYearRun)
}

function stripRepeatedLeadingBrandTokens(tokens: string[], brandDisplay: string) {
  let firstProductToken = 0
  while (
    firstProductToken < tokens.length &&
    isRepeatedBrandToken(tokens[firstProductToken], brandDisplay)
  ) {
    firstProductToken += 1
  }
  return tokens.slice(firstProductToken)
}

function isRepeatedBrandToken(token: string, brandDisplay: string) {
  const normalizedToken = normalizeToken(token)
  const normalizedBrand = normalizeToken(brandDisplay)
  return Boolean(normalizedToken && normalizedBrand.includes(normalizedToken))
}

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function tokenize(value: string) {
  return value
    .split(/\s+/g)
    .map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9-]+$/g, ""))
    .filter(Boolean)
}

function stripLeadingBrand(title: string, brand: string) {
  if (!title || !brand) return title
  const escapedBrand = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return title.replace(new RegExp(`^${escapedBrand}(?:\\s+|[-:|]\\s*)`, "i"), "").trim()
}

function formatBrandDisplay(value: string) {
  if (!value) return ""
  return value
    .split(/\s+/g)
    .map((token) => {
      if (/\d/.test(token) || token.length <= 3) return token
      if (token === token.toUpperCase() || token === token.toLowerCase()) {
        return `${token.charAt(0).toUpperCase()}${token.slice(1).toLowerCase()}`
      }
      return token
    })
    .join(" ")
}

function compact(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim()
}

function truncate(value: string) {
  if (value.length <= DISPLAY_NAME_MAX_LENGTH) return value
  return `${value.slice(0, DISPLAY_NAME_MAX_LENGTH - 1).trimEnd()}…`
}
