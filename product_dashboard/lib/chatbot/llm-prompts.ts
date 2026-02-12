import { categorySuggestedQuestions } from "@/lib/chatbot/question-bank"
import type { ChatIntent } from "@/lib/chatbot/types"
import type { CategoryId } from "@/lib/competitor-data"

const QUICK_ACTIONS = [
  "How did we do this month?",
  "What are competitors doing?",
  "What should I be worried about?",
  "Ask your own question",
]

const CAPABILITIES_FOR_QUESTIONS: ChatIntent[] = [
  "market_size",
  "market_leader",
  "price_range",
  "top_products",
  "product_type_mix",
  "price_volume_tradeoff",
  "brand_comparison",
  "feature_analysis",
  "competitive_gaps",
  "trends_momentum",
  "rating_reviews",
  "market_concentration",
  "self_assessment",
  "competitive_benchmarking",
  "risk_threat",
  "growth_opportunity",
  "data_clarification",
]

export function getStarterQuestions(categoryId: CategoryId) {
  return categorySuggestedQuestions(categoryId, CAPABILITIES_FOR_QUESTIONS).slice(0, 8)
}

export function buildLlmSystemPrompt(input: {
  categoryId: string
  snapshotDate: string
  pathname: string
  targetBrand?: string
  starterQuestions: string[]
}) {
  const starter = input.starterQuestions.map((item) => `- ${item}`).join("\n")
  const quick = QUICK_ACTIONS.map((item) => `- ${item}`).join("\n")
  const targetBrandLine = input.targetBrand
    ? `Target brand context: ${input.targetBrand}`
    : "Target brand context: none"

  return `
You are Stakeholder Copilot for a product analytics dashboard.

Runtime policy:
- Use GPT-5.2 reasoning over tool results only.
- Never invent numbers.
- Always ground all key metrics in tool outputs.
- Read from all available dashboard/normalized/raw tables as needed.
- If user asks for a brand, keep scope strict to that brand.
- If user asks "our", scope to Innova + BLCKTEC unless user overrides.
- If user mentions Innova 5610, map it to ASIN B07Z481NJM.
- Do not expose internal chain-of-thought.

Current request context:
- categoryId: ${input.categoryId}
- snapshotDate: ${input.snapshotDate}
- pathname: ${input.pathname}
- ${targetBrandLine}

Preserve existing UX structure:
Quick actions:
${quick}

Starter question bank:
${starter}

Required response behavior:
1) First sentence: direct conclusion.
2) Then 3-5 short support bullets.
3) Add evidence cards with concrete numbers.
4) Always include snapshot month used.
5) If comparison is requested, include comparison window.
6) For performance questions, include:
   - monthly revenue
   - monthly units
   - rank
   - ASP orientation (price-led / volume-led / balanced)
   - whether movement is price-driven or units-driven.

Return strict JSON with keys:
{
  "answer": string,
  "bullets": string[],
  "evidence": [{"label": string, "value": string}],
  "proactive": [{"id": string, "title": string, "summary": string, "severity": "info"|"watch"|"risk"}],
  "suggestedQuestions": string[],
  "warnings": string[],
  "sourcesUsed": string[],
  "windowUsed": string
}
`.trim()
}
