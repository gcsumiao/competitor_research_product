import golden from "@/lib/chatbot/evals/golden-questions.json"
import { buildLlmOnlyChatResponse } from "@/lib/chatbot/llm-brain"
import { loadDashboardData } from "@/lib/competitor-data"

type GoldenItem = {
  id: string
  categoryId: string
  question: string
  checks: string[]
}

type EvalResult = {
  id: string
  categoryId: string
  question: string
  checks: string[]
  ok: boolean
  answer: string
  warnings: string[]
  evidenceCount: number
  sourcesUsedCount: number
}

export async function runGoldenEvals() {
  const dashboard = await loadDashboardData()
  const cases = golden as GoldenItem[]
  const results: EvalResult[] = []

  for (const item of cases) {
    const category = dashboard.categories.find((c) => c.id === item.categoryId)
    const snapshot = category?.snapshots[category.snapshots.length - 1]
    if (!category || !snapshot) {
      results.push({
        id: item.id,
        categoryId: item.categoryId,
        question: item.question,
        checks: item.checks,
        ok: false,
        answer: "Missing category or snapshot.",
        warnings: ["No snapshot found for eval case."],
        evidenceCount: 0,
        sourcesUsedCount: 0,
      })
      continue
    }

    const response = await buildLlmOnlyChatResponse({
      message: item.question,
      categoryId: item.categoryId,
      snapshotDate: snapshot.date,
      pathname: "/evals",
    })

    results.push({
      id: item.id,
      categoryId: item.categoryId,
      question: item.question,
      checks: item.checks,
      ok: response.answer.trim().length > 0 && response.warnings.length < 3,
      answer: response.answer,
      warnings: response.warnings,
      evidenceCount: response.evidence.length,
      sourcesUsedCount: response.sourcesUsed?.length ?? 0,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  }
}
