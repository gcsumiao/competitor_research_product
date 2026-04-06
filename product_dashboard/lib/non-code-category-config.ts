export type FileLocator =
  | {
      mode: "exact"
      relativePath: string
    }
  | {
      mode: "latest_match" | "all_matches"
      relativeDir?: string
      filePattern: RegExp
    }

export type SpecsMode = "generic" | "target_dimensions"
export type TargetDimensionPreset = "borescope" | "thermal_imager"

export type NonCodeCategoryConfig = {
  id: string
  label: string
  folderName: string
  sourceWorkbook?: FileLocator
  typeSummarySources?: readonly FileLocator[]
  visibleReports: readonly FileLocator[]
  starterQuestions?: Partial<Record<string, readonly string[]>>
  specsMode: SpecsMode
  targetDimensionPreset?: TargetDimensionPreset
}

const DMM_QUESTIONS = {
  market_size: ["What is the total DMM market size this month (revenue + units)?"],
  market_leader: ["Which DMM brand leads in revenue share this month?"],
  top_products: ["Which DMM SKUs are top by revenue and top by units?"],
  feature_analysis: [
    "What premium is associated with true-RMS or automotive-targeted DMM features?",
    "Do rechargeable DMM products command higher prices?",
  ],
  brand_comparison: ["Compare Innova vs Fluke performance this month."],
  rating_reviews: ["Which DMM brands have strong ratings but weak price realization?"],
}

const BORESCOPE_QUESTIONS = {
  market_size: ["How large is the borescope market this month?"],
  price_range: ["What is the borescope price range and median price?"],
  product_type_mix: ["How is borescope demand split across articulation vs USB vs handheld types?"],
  feature_analysis: [
    "Is there a measurable premium for 2-way/4-way articulation and larger display sizes?",
  ],
  competitive_gaps: ["Where are the high-revenue borescope clusters with lower competition?"],
}

const THERMAL_QUESTIONS = {
  market_size: ["How large is the thermal imager market this month?"],
  product_type_mix: ["How is revenue split across phone-adapted vs non-phone thermal imagers?"],
  feature_analysis: [
    "What premium do features like phone connectivity, laser, Wi-Fi, or visual camera add in thermal imagers?",
    "How does super-resolution availability affect price and revenue share?",
  ],
  brand_comparison: ["Compare TOPDON vs FLIR on share, price, and ratings."],
}

const NIGHT_VISION_QUESTIONS = {
  market_size: ["What is the night vision market size and who leads this month?"],
  top_products: ["Which night vision ASINs lead by revenue vs units?"],
  market_concentration: ["How concentrated is the night vision market (top-3 share)?"],
  price_volume_tradeoff: ["Are lower-price products dominating volume in night vision?"],
}

const SMOKE_MACHINE_QUESTIONS = {
  market_size: ["How large is the smoke machine market this month?"],
  market_leader: ["Which smoke machine brand leads in revenue share this month?"],
  top_products: ["Which smoke machine SKUs lead by revenue and by units?"],
  product_type_mix: ["How is demand split across leak detector kits, high-volume machines, accessories, and fluids?"],
  feature_analysis: ["Do built-in air pump smoke machines command a price premium?"],
  competitive_gaps: ["Where are the strongest smoke machine whitespace opportunities right now?"],
}

const JUMP_STARTERS_QUESTIONS = {
  market_size: ["How large is the jump starters market this month?"],
  product_type_mix: [
    "How is revenue split across jump starters, jump starter + inflator models, heavy-duty starters, and accessories?",
  ],
  feature_analysis: [
    "What price premium do jump starter + inflator products command versus standard jump starters?",
    "How much revenue share comes from accessory and adapter products versus standalone jump starter devices?",
  ],
  brand_comparison: ["Compare NOCO, GOOLOO, and WOLFBOX on share, pricing, and type mix."],
  competitive_gaps: ["Where are the best whitespace opportunities across portable, heavy-duty, and combo jump starter products?"],
}

const MECHANIC_STOOL_QUESTIONS = {
  market_size: ["How large is the mechanic stool market this month?"],
  product_type_mix: [
    "How is revenue split across rolling mechanic stools, backrest stools, creeper seats, low-profile stools, and tall shop stools?",
  ],
  feature_analysis: [
    "What price premium do backrest mechanic stools command versus standard rolling stools?",
    "How much of the market uses adjustable height, tool trays or drawers, and which material mix is winning?",
  ],
  brand_comparison: ["Compare FreekyFit, FREEKYROCK, VEVOR, and WEN on share, pricing, and type mix."],
  competitive_gaps: ["Where are the best whitespace opportunities across mechanic stool types and storage-feature combinations?"],
}

export const NON_CODE_CATEGORY_CONFIGS = [
  {
    id: "dmm",
    label: "DMM / Automotive",
    folderName: "DMM",
    sourceWorkbook: {
      mode: "exact",
      relativePath: "outputs/DMM_market_research_summary.xlsx",
    },
    typeSummarySources: [
      {
        mode: "exact",
        relativePath: "outputs/DMM_market_research_summary.xlsx",
      },
    ],
    visibleReports: [
      {
        mode: "exact",
        relativePath: "outputs/DMM_market_research_summary.xlsx",
      },
    ],
    starterQuestions: DMM_QUESTIONS,
    specsMode: "generic",
  },
  {
    id: "borescope",
    label: "Borescope",
    folderName: "Borescope",
    sourceWorkbook: {
      mode: "latest_match",
      relativeDir: "outputs",
      filePattern: /^Borescope_Market_Analysis.*\.xlsx$/i,
    },
    typeSummarySources: [
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Borescope.*\.xlsx$/i,
      },
      {
        mode: "exact",
        relativePath: "25-11-25 Borescope V4.xlsx",
      },
    ],
    visibleReports: [
      {
        mode: "all_matches",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Borescope.*\.xlsx$/i,
      },
    ],
    starterQuestions: BORESCOPE_QUESTIONS,
    specsMode: "target_dimensions",
    targetDimensionPreset: "borescope",
  },
  {
    id: "thermal_imager",
    label: "Thermal Imager",
    folderName: "Thermal Imager",
    sourceWorkbook: {
      mode: "latest_match",
      filePattern: /^TI_Market_Analysis.*\.xlsx$/i,
    },
    typeSummarySources: [
      {
        mode: "latest_match",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Thermal Imager.*\.xlsx$/i,
      },
      {
        mode: "exact",
        relativePath: "25-11-25 Thermal Imager V4.xlsx",
      },
    ],
    visibleReports: [
      {
        mode: "all_matches",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Thermal Imager.*\.xlsx$/i,
      },
    ],
    starterQuestions: THERMAL_QUESTIONS,
    specsMode: "target_dimensions",
    targetDimensionPreset: "thermal_imager",
  },
  {
    id: "night_vision",
    label: "Night Vision",
    folderName: "Night Vision Monoculars",
    sourceWorkbook: {
      mode: "latest_match",
      relativeDir: "outputs",
      filePattern: /^Night_Vision_Monoculars_top50.*\.xlsx$/i,
    },
    typeSummarySources: [
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^Night_Vision_Monoculars_top50.*\.xlsx$/i,
      },
    ],
    visibleReports: [
      {
        mode: "all_matches",
        relativeDir: "outputs",
        filePattern: /^Night_Vision_Monoculars_top50.*\.xlsx$/i,
      },
    ],
    starterQuestions: NIGHT_VISION_QUESTIONS,
    specsMode: "generic",
  },
  {
    id: "smoke_machine",
    label: "Smoke Machine",
    folderName: "Smoke Machine",
    sourceWorkbook: {
      mode: "latest_match",
      relativeDir: "outputs",
      filePattern: /^Smoke_Machine_Market_Analysis.*\.xlsx$/i,
    },
    typeSummarySources: [
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Smoke Machine.*\.xlsx$/i,
      },
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^Smoke_Machine_Market_Analysis.*\.xlsx$/i,
      },
    ],
    visibleReports: [
      {
        mode: "all_matches",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Smoke Machine.*\.xlsx$/i,
      },
    ],
    starterQuestions: SMOKE_MACHINE_QUESTIONS,
    specsMode: "generic",
  },
  {
    id: "jump_starters",
    label: "Jump Starters",
    folderName: "JumpStarters",
    sourceWorkbook: {
      mode: "latest_match",
      relativeDir: "outputs",
      filePattern: /^Jump_Starters_Market_Analysis.*\.xlsx$/i,
    },
    typeSummarySources: [
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Jump Starters.*\.xlsx$/i,
      },
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^Jump_Starters_Market_Analysis.*\.xlsx$/i,
      },
    ],
    visibleReports: [
      {
        mode: "all_matches",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Jump Starters.*\.xlsx$/i,
      },
    ],
    starterQuestions: JUMP_STARTERS_QUESTIONS,
    specsMode: "generic",
  },
  {
    id: "mechanic_stool",
    label: "Mechanic Stool",
    folderName: "MechanicStool",
    sourceWorkbook: {
      mode: "latest_match",
      relativeDir: "outputs",
      filePattern: /^Mechanic_Stool_Market_Analysis.*\.xlsx$/i,
    },
    typeSummarySources: [
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Mechanic Stool.*\.xlsx$/i,
      },
      {
        mode: "latest_match",
        relativeDir: "outputs",
        filePattern: /^Mechanic_Stool_Market_Analysis.*\.xlsx$/i,
      },
    ],
    visibleReports: [
      {
        mode: "all_matches",
        relativeDir: "outputs",
        filePattern: /^\d{2}-\d{2}-\d{2} .*Mechanic Stool.*\.xlsx$/i,
      },
    ],
    starterQuestions: MECHANIC_STOOL_QUESTIONS,
    specsMode: "generic",
  },
] as const satisfies readonly NonCodeCategoryConfig[]

export type NonCodeCategoryId = (typeof NON_CODE_CATEGORY_CONFIGS)[number]["id"]

const NON_CODE_CATEGORY_CONFIG_MAP = new Map<NonCodeCategoryId, (typeof NON_CODE_CATEGORY_CONFIGS)[number]>(
  NON_CODE_CATEGORY_CONFIGS.map((config) => [config.id, config])
)

export function listNonCodeCategoryConfigs() {
  return NON_CODE_CATEGORY_CONFIGS
}

export function listNonCodeCategoryIds(): NonCodeCategoryId[] {
  return NON_CODE_CATEGORY_CONFIGS.map((config) => config.id)
}

export function getNonCodeCategoryConfig(categoryId: NonCodeCategoryId) {
  return NON_CODE_CATEGORY_CONFIG_MAP.get(categoryId)
}

export function isNonCodeCategoryId(value: string | null | undefined): value is NonCodeCategoryId {
  return Boolean(value) && NON_CODE_CATEGORY_CONFIG_MAP.has(value as NonCodeCategoryId)
}

export function findNonCodeCategoryByFolder(relativePath: string) {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase()
  return (
    NON_CODE_CATEGORY_CONFIGS.find((config) => normalized.startsWith(`${config.folderName.toLowerCase()}/`)) ?? null
  )
}

export function isTargetDimensionCategory(categoryId: string | null | undefined) {
  if (!isNonCodeCategoryId(categoryId)) return false
  return getNonCodeCategoryConfig(categoryId)?.specsMode === "target_dimensions"
}

export function getTargetDimensionPreset(categoryId: string | null | undefined): TargetDimensionPreset | null {
  if (!isNonCodeCategoryId(categoryId)) return null
  const config = getNonCodeCategoryConfig(categoryId)
  return config?.specsMode === "target_dimensions" ? (config.targetDimensionPreset ?? null) : null
}

export function isConfiguredVisibleReport(categoryId: NonCodeCategoryId, relativePathFromRoot: string) {
  const config = getNonCodeCategoryConfig(categoryId)
  if (!config) return false

  const normalized = relativePathFromRoot.replace(/\\/g, "/")
  const prefix = `${config.folderName}/`
  if (!normalized.startsWith(prefix)) return false
  const relativePath = normalized.slice(prefix.length)
  const fileName = relativePath.split("/").pop() ?? relativePath

  return config.visibleReports.some((locator) => {
    if (locator.mode === "exact") {
      return normalizePath(locator.relativePath) === normalizePath(relativePath)
    }

    const relativeDir = normalizePath(("relativeDir" in locator ? locator.relativeDir : "") ?? "")
    const candidateDir = normalizePath(relativePath.split("/").slice(0, -1).join("/"))
    if (relativeDir && relativeDir !== candidateDir) return false
    return locator.filePattern.test(fileName)
  })
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "").toLowerCase()
}
