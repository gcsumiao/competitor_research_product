import type { ChatIntent, IntentDetection } from "@/lib/chatbot/types"
import type { CategoryId } from "@/lib/competitor-data"

type IntentRule = {
  intent: ChatIntent
  keywords: string[]
}

const INTENT_RULES: IntentRule[] = [
  {
    intent: "fastest_mover",
    keywords: [
      "fastest mover",
      "fast mover",
      "moving fastest",
      "biggest mover",
      "fastest growth",
      "grew the most",
      "highest mom",
      "highest yoy",
      "growth leader",
    ],
  },
  {
    intent: "asin_history",
    keywords: ["asin history", "top asins", "past performance", "historical performance", "history"],
  },
  {
    intent: "brand_archetype",
    keywords: ["why is", "performing well", "high price low units", "low price high units", "archetype"],
  },
  {
    intent: "price_vs_volume_explainer",
    keywords: ["price vs volume", "price-led", "volume-led", "high price", "low price", "units sold"],
  },
  {
    intent: "market_size",
    keywords: [
      "market size",
      "total market",
      "how big",
      "total revenue",
      "total units",
      "tam",
    ],
  },
  {
    intent: "market_leader",
    keywords: ["leader", "leading brand", "who is first", "top brand", "rank 1"],
  },
  {
    intent: "price_range",
    keywords: [
      "price range",
      "average price",
      "median price",
      "asp range",
      "pricing band",
    ],
  },
  {
    intent: "top_products",
    keywords: [
      "top asin",
      "top asins",
      "top 1",
      "top one",
      "top product",
      "top products",
      "best seller",
      "top 50",
      "top by revenue",
      "top by units",
    ],
  },
  {
    intent: "product_type_mix",
    keywords: [
      "type mix",
      "product type",
      "segment mix",
      "tablet vs handheld",
      "dongle",
      "articulation",
    ],
  },
  {
    intent: "price_volume_tradeoff",
    keywords: ["price volume", "tradeoff", "value segment", "volume share", "revenue share"],
  },
  {
    intent: "brand_comparison",
    keywords: [
      "compare brand",
      "brand comparison",
      "vs",
      "versus",
      "benchmark",
    ],
  },
  {
    intent: "feature_analysis",
    keywords: [
      "feature",
      "premium",
      "with vs without",
      "laser",
      "wifi",
      "visual camera",
      "true rms",
      "auto-ranging",
      "magnification",
      "articulation",
    ],
  },
  {
    intent: "competitive_gaps",
    keywords: [
      "gap",
      "whitespace",
      "opportunity cluster",
      "under served",
      "low competition",
      "opening",
    ],
  },
  {
    intent: "trends_momentum",
    keywords: ["trend", "momentum", "mom", "yoy", "month over month", "moving"],
  },
  {
    intent: "rating_reviews",
    keywords: ["rating", "reviews", "star", "review velocity", "quality"],
  },
  {
    intent: "market_concentration",
    keywords: ["concentration", "fragmented", "top 3 share", "top 5 share", "dominance"],
  },
  {
    intent: "self_assessment",
    keywords: [
      "how did we do",
      "how are we doing",
      "innova",
      "blcktec",
      "our performance",
      "trend",
      "asp",
      "1p",
      "3p",
      "top sku",
    ],
  },
  {
    intent: "competitive_benchmarking",
    keywords: [
      "compare",
      "competitor",
      "competitors",
      "what are competitors doing",
      "competitors doing",
      "competition",
      "rank",
      "who gained",
      "who lost",
      "autel",
      "topdon",
      "ancel",
      "price move",
      "benchmark",
      "fastest rank mover",
      "rank moved most",
      "biggest rank jump",
    ],
  },
  {
    intent: "risk_threat",
    keywords: [
      "risk",
      "worry",
      "worried",
      "concern",
      "concerned",
      "what should i be worried about",
      "unusual",
      "alert",
      "threat",
      "losing share",
      "declining",
      "erosion",
      "slowing",
      "new entrant",
    ],
  },
  {
    intent: "growth_opportunity",
    keywords: [
      "opportunity",
      "grow",
      "growth",
      "launch",
      "price tier",
      "addressable market",
      "move up one rank",
      "opening",
      "strategy",
    ],
  },
  {
    intent: "data_clarification",
    keywords: [
      "why",
      "what's included",
      "what is included",
      "difference",
      "how is revenue estimated",
      "actual or estimate",
      "adjusted report",
      "explain this number",
      "definition",
    ],
  },
]

const SUGGESTED_QUESTIONS: Record<ChatIntent, string[]> = {
  fastest_mover: [
    "Who is the fastest growth brand this month (MoM)?",
    "Who is the fastest growth brand this month (YoY)?",
    "Who is the fastest rank mover this month?",
  ],
  asin_history: [
    "Show OTOFIX top ASINs and past performance.",
    "Give me ASIN history for Innova 5610.",
  ],
  brand_archetype: [
    "Why is OTOFIX performing well?",
    "Is BLCKTEC more price-led or volume-led this month?",
  ],
  price_vs_volume_explainer: [
    "Which brands win from high price but low units?",
    "Which brands win from low price but high units?",
    "Is XTOOL growth driven by more units or higher ASP?",
  ],
  product_competitor: [
    "What is Innova 5610's biggest competitor this month?",
    "Which products are closest to BLCKTEC's top SKU?",
  ],
  product_trend: [
    "How did Innova 5610 perform vs last month?",
    "Show trend for a specific ASIN.",
  ],
  brand_health: [
    "How did Innova do this month?",
    "How did BLCKTEC do this month?",
  ],
  market_shift: [
    "Which competitors moved share the most this month?",
    "What changed in market ranking this month?",
  ],
  risk_signal: [
    "What is our biggest risk right now?",
    "Which product is most at risk this month?",
  ],
  opportunity_signal: [
    "Where is the highest-growth opportunity right now?",
    "Which segment has low own share but high market weight?",
  ],
  market_size: [
    "How big is the market this month in revenue and units?",
    "What is the annualized run rate from this snapshot?",
  ],
  market_leader: [
    "Who is the market leader this month?",
    "What share does the #1 brand hold?",
  ],
  price_range: [
    "What is the market price range and median price?",
    "Which price tiers contribute most revenue?",
  ],
  top_products: [
    "Show the top products by revenue.",
    "Show the top products by units.",
  ],
  product_type_mix: [
    "How is revenue split by product type?",
    "Which type leads in units vs revenue?",
  ],
  price_volume_tradeoff: [
    "Where is volume high but revenue share low?",
    "Which types have premium pricing but low unit share?",
  ],
  brand_comparison: [
    "Compare the top two brands on share, units, and pricing.",
    "Which brand is closing the gap fastest?",
  ],
  feature_analysis: [
    "What feature premium is visible this month?",
    "Do feature-rich products outperform in revenue share?",
  ],
  competitive_gaps: [
    "Which clusters are high-revenue with lower competition?",
    "Where is the best whitespace opportunity?",
  ],
  trends_momentum: [
    "What changed most versus last month?",
    "Are we seeing trend acceleration or reversal?",
  ],
  rating_reviews: [
    "Which products have strong ratings and strong revenue?",
    "Any price-quality mismatch by brand?",
  ],
  market_concentration: [
    "How concentrated is this market right now?",
    "What is top-3 and top-5 share?",
  ],
  self_assessment: [
    "How did Innova and BLCKTEC perform this month vs last month?",
    "What percentage of our revenue comes from the top 3 SKUs?",
    "How does our ASP compare with the market average?",
  ],
  competitive_benchmarking: [
    "Who gained the most market share this month?",
    "Where do we rank in revenue and units this month?",
    "Did any competitor make aggressive price moves in our core segments?",
  ],
  risk_threat: [
    "What is our biggest risk right now?",
    "Are we losing share in any category for 3+ consecutive months?",
    "Did any competitor show breakout growth this month?",
  ],
  growth_opportunity: [
    "Which category is growing fastest where we have low share?",
    "Which price tiers are growing fastest right now?",
    "What would it take to move up one market rank?",
  ],
  data_clarification: [
    "How is revenue estimated in this dashboard?",
    "Why did market share move while revenue stayed flat?",
    "What's included in the Other category?",
  ],
  unknown: [
    "How did we do this month?",
    "What are competitors doing?",
    "What should I be worried about?",
    "Ask your own question",
  ],
}

const CATEGORY_KEYWORD_BOOSTS: Partial<Record<CategoryId, Array<{ intent: ChatIntent; terms: string[] }>>> = {
  dmm: [
    { intent: "feature_analysis", terms: ["true rms", "auto ranging", "automotive targeted"] },
    { intent: "product_type_mix", terms: ["multimeter", "analyzer"] },
  ],
  borescope: [
    { intent: "feature_analysis", terms: ["2-way", "4-way", "lens", "display", "cable length"] },
    { intent: "product_type_mix", terms: ["articulation", "usb", "handheld"] },
  ],
  thermal_imager: [
    { intent: "feature_analysis", terms: ["resolution", "super resolution", "laser", "wi-fi", "visual camera"] },
    { intent: "product_type_mix", terms: ["dongle", "handheld"] },
  ],
  night_vision: [
    { intent: "feature_analysis", terms: ["magnification", "night vision", "thermal monocular"] },
    { intent: "price_range", terms: ["price point", "budget"] },
  ],
}

export function detectIntent(message: string, categoryId?: CategoryId): IntentDetection {
  const normalized = message.toLowerCase().trim()
  if (!normalized) {
    return { intent: "unknown", confidence: 0 }
  }

  const scores = new Map<ChatIntent, number>()
  for (const rule of INTENT_RULES) {
    let score = 0
    for (const keyword of rule.keywords) {
      if (normalized.includes(keyword)) {
        score += keyword.length > 5 ? 2 : 1
      }
    }
    scores.set(rule.intent, score)
  }

  const boosts = categoryId ? CATEGORY_KEYWORD_BOOSTS[categoryId] ?? [] : []
  for (const boost of boosts) {
    let extra = 0
    for (const term of boost.terms) {
      if (normalized.includes(term)) {
        extra += 2
      }
    }
    if (extra > 0) {
      scores.set(boost.intent, (scores.get(boost.intent) ?? 0) + extra)
    }
  }

  // Heuristics for common stakeholder phrasing that can miss strict keyword matching.
  if (/\btop\b(?:\s*\d+)?\b/.test(normalized) && /\b(product|products|asin|asins|sku|scanner)\b/.test(normalized)) {
    scores.set("top_products", (scores.get("top_products") ?? 0) + 4)
  }
  if (/\bwhat\s+are\s+competitors?\s+doing\b/.test(normalized)) {
    scores.set("competitive_benchmarking", (scores.get("competitive_benchmarking") ?? 0) + 4)
  }
  if (/\b(what\s+should\s+i\s+be\s+worried\s+about|worried|concerned)\b/.test(normalized)) {
    scores.set("risk_threat", (scores.get("risk_threat") ?? 0) + 4)
  }
  if (/\b(fastest mover|moving fastest|biggest mover)\b/.test(normalized)) {
    scores.set("fastest_mover", (scores.get("fastest_mover") ?? 0) + 5)
  }
  if (/\b(fastest growth|grew the most|highest mom|highest yoy|growth leader)\b/.test(normalized)) {
    scores.set("fastest_mover", (scores.get("fastest_mover") ?? 0) + 5)
  }
  if (/\b(fastest rank mover|rank moved most|biggest rank jump|rank improvement)\b/.test(normalized)) {
    scores.set("competitive_benchmarking", (scores.get("competitive_benchmarking") ?? 0) + 4)
  }
  if (
    /\b(due to price|due to units|driven by price|driven by units|price or units|unit driven|price driven)\b/.test(
      normalized
    )
  ) {
    scores.set("price_vs_volume_explainer", (scores.get("price_vs_volume_explainer") ?? 0) + 5)
  }
  if (/\b(top asins|asin history|past performance|historical performance)\b/.test(normalized)) {
    scores.set("asin_history", (scores.get("asin_history") ?? 0) + 5)
  }
  if (/\b(high price.*low units|low price.*high units|price.?led|volume.?led|price vs volume)\b/.test(normalized)) {
    scores.set("price_vs_volume_explainer", (scores.get("price_vs_volume_explainer") ?? 0) + 5)
  }
  if (/\b(why is .*performing|performing well)\b/.test(normalized)) {
    scores.set("brand_archetype", (scores.get("brand_archetype") ?? 0) + 4)
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1])
  const [topIntent, topScore] = ranked[0] ?? ["unknown", 0]
  const [, secondScore] = ranked[1] ?? ["unknown", 0]

  if (topScore <= 0) {
    return { intent: "unknown", confidence: 0 }
  }

  const confidence = Math.min(1, topScore / Math.max(1, topScore + secondScore))
  return { intent: topIntent as ChatIntent, confidence }
}

export function suggestedQuestionsForIntent(intent: ChatIntent): string[] {
  return SUGGESTED_QUESTIONS[intent] ?? SUGGESTED_QUESTIONS.unknown
}
