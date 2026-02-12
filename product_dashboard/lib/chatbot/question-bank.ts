import type { CategoryId } from "@/lib/competitor-data"

import type { ChatIntent } from "@/lib/chatbot/types"

type CategoryQuestionMap = Partial<Record<ChatIntent, string[]>>

const DEFAULT_QUESTIONS: string[] = [
  "How big is this market this month and who is leading?",
  "Which products drive the most revenue right now?",
  "What is the biggest competitive risk this month?",
]

const DMM_QUESTIONS: CategoryQuestionMap = {
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

const BORESCOPE_QUESTIONS: CategoryQuestionMap = {
  market_size: ["How large is the borescope market this month?"],
  price_range: ["What is the borescope price range and median price?"],
  product_type_mix: ["How is borescope demand split across articulation vs USB vs handheld types?"],
  feature_analysis: [
    "Is there a measurable premium for 2-way/4-way articulation and larger display sizes?",
  ],
  competitive_gaps: ["Where are the high-revenue borescope clusters with lower competition?"],
}

const THERMAL_QUESTIONS: CategoryQuestionMap = {
  market_size: ["How large is the thermal imager market this month?"],
  product_type_mix: ["How is revenue split across dongle vs handheld thermal tools?"],
  feature_analysis: [
    "What premium do features like laser, Wi-Fi, or visual camera add in thermal imagers?",
    "How does super-resolution availability affect price and revenue share?",
  ],
  brand_comparison: ["Compare TOPDON vs FLIR on share, price, and ratings."],
}

const NIGHT_VISION_QUESTIONS: CategoryQuestionMap = {
  market_size: ["What is the night vision market size and who leads this month?"],
  top_products: ["Which night vision ASINs lead by revenue vs units?"],
  market_concentration: ["How concentrated is the night vision market (top-3 share)?"],
  price_volume_tradeoff: ["Are lower-price products dominating volume in night vision?"],
}

const CODE_READER_QUESTIONS: CategoryQuestionMap = {
  self_assessment: [
    "How did Innova/BLCKTEC perform this month vs last month?",
    "What is our revenue, units, and share trend over the last 6-12 months?",
    "Which of our products grew the most and which declined?",
  ],
  competitive_benchmarking: [
    "Where do we rank in overall revenue and units this month?",
    "Who gained the most market share this month and who lost the most?",
    "Who is the fastest rank mover this month by revenue and by units?",
    "Which competitor is closest to Innova 5610 in price positioning and performance?",
  ],
  risk_threat: [
    "What should we worry about this month?",
    "Did any competitor show unusual breakout growth?",
    "Are we losing share in any category for 3+ consecutive months?",
  ],
  growth_opportunity: [
    "Which price tiers are growing fastest and do we have products there?",
    "Who is the fastest growth brand by revenue and by units?",
    "Which handheld/tablet/dongle segment is growing fastest MoM and YoY?",
    "Which category has growth where our share is still low?",
    "What would it take to move up one market rank?",
  ],
  data_clarification: [
    "Why did our market share jump/drop this month?",
    "What is included in Other brand category?",
    "How is revenue estimated in this report?",
  ],
}

const CATEGORY_BANK: Record<CategoryId, CategoryQuestionMap> = {
  dmm: DMM_QUESTIONS,
  borescope: BORESCOPE_QUESTIONS,
  thermal_imager: THERMAL_QUESTIONS,
  night_vision: NIGHT_VISION_QUESTIONS,
  code_reader_scanner: CODE_READER_QUESTIONS,
}

export function categorySuggestedQuestions(
  categoryId: CategoryId,
  capabilities: ChatIntent[],
  intent?: ChatIntent
) {
  const bank = CATEGORY_BANK[categoryId]
  const selected: string[] = []

  const pushFromIntent = (key: ChatIntent) => {
    if (!capabilities.includes(key)) return
    const items = bank[key] ?? []
    for (const item of items) {
      if (!selected.includes(item)) selected.push(item)
    }
  }

  if (intent && intent !== "unknown") {
    pushFromIntent(intent)
  }

  for (const capability of capabilities) {
    pushFromIntent(capability)
  }

  if (!selected.length) {
    return DEFAULT_QUESTIONS
  }

  return selected.slice(0, 6)
}
