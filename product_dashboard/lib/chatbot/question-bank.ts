import type { CategoryId } from "@/lib/competitor-data"
import {
  getNonCodeCategoryConfig,
  isNonCodeCategoryId,
} from "@/lib/non-code-category-config"

import type { ChatIntent } from "@/lib/chatbot/types"

type CategoryQuestionMap = Partial<Record<ChatIntent, string[]>>

const DEFAULT_QUESTIONS: string[] = [
  "How big is this market this month and who is leading?",
  "How big was this market in Jan 2026 and who was leading?",
  "Which products drive the most revenue right now?",
  "What is the biggest competitive risk this month?",
]

const CODE_READER_QUESTIONS: CategoryQuestionMap = {
  self_assessment: [
    "How did Innova/BLCKTEC perform this month vs last month?",
    "How did Innova/BLCKTEC perform in Jan 2026?",
    "What is our revenue, units, and share trend over the last 6-12 months?",
    "Which of our products grew the most and which declined?",
  ],
  competitive_benchmarking: [
    "Where do we rank in overall revenue and units this month?",
    "Where did we rank in Jan 2026?",
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

export function categorySuggestedQuestions(
  categoryId: CategoryId,
  capabilities: ChatIntent[],
  intent?: ChatIntent
) {
  const bank = getCategoryBank(categoryId)
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

function getCategoryBank(categoryId: CategoryId): CategoryQuestionMap {
  if (categoryId === "code_reader_scanner") {
    return CODE_READER_QUESTIONS
  }

  if (!isNonCodeCategoryId(categoryId)) {
    return {}
  }

  const starterQuestions = getNonCodeCategoryConfig(categoryId)?.starterQuestions ?? {}
  const bank: CategoryQuestionMap = {}
  for (const [key, value] of Object.entries(starterQuestions) as Array<[ChatIntent, readonly string[]]>) {
    bank[key] = [...value]
  }
  return bank
}
