import golden from "@/lib/chatbot/evals/golden-questions.json"
import { buildCodeReaderDataMart } from "@/lib/chatbot/code-reader-index"
import { resolveEntities } from "@/lib/chatbot/entity-resolver"
import { buildDeterministicChatResponse } from "@/lib/chatbot/insights"
import { detectIntent } from "@/lib/chatbot/intents"
import { routeIntent } from "@/lib/chatbot/intent-router"
import { parseQuery } from "@/lib/chatbot/query-parser"
import { resolveSnapshotTimeRange } from "@/lib/chatbot/time-resolver"
import { loadDashboardData } from "@/lib/competitor-data"

type GoldenItem = {
  id: string
  categoryId: string
  question: string
  checks?: string[]
  mustMatch: string[]
  mustNotMatch: string[]
  answerMustMatch?: string[]
  answerMustNotMatch?: string[]
  minBullets?: number
  proactiveMin?: number
  proactiveMax?: number
}

type EvalResult = {
  id: string
  categoryId: string
  question: string
  intent: string
  ok: boolean
  failures: string[]
  answer: string
  headline: string
  answerRest: string
  bullets: string[]
  warnings: string[]
  evidenceCount: number
  proactiveCount: number
  suggestedQuestionCount: number
}

export async function runGoldenEvals() {
  const dashboard = await loadDashboardData()
  const cases = golden as GoldenItem[]
  const results: EvalResult[] = []

  for (const item of cases) {
    const category = dashboard.categories.find((candidate) => candidate.id === item.categoryId)
    if (!category) {
      results.push({
        id: item.id,
        categoryId: item.categoryId,
        question: item.question,
        intent: "missing_snapshot",
        ok: false,
        failures: ["No category or snapshot found."],
        answer: "Missing category or snapshot.",
        headline: "",
        answerRest: "",
        bullets: [],
        warnings: ["No snapshot found for eval case."],
        evidenceCount: 0,
        proactiveCount: 0,
        suggestedQuestionCount: 0,
      })
      continue
    }
    const orderedSnapshots = category.snapshots
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
    const latestSnapshot = orderedSnapshots.at(-1)
    if (!latestSnapshot) {
      results.push({
        id: item.id,
        categoryId: item.categoryId,
        question: item.question,
        intent: "missing_snapshot",
        ok: false,
        failures: ["No snapshot found."],
        answer: "Missing snapshot.",
        headline: "",
        answerRest: "",
        bullets: [],
        warnings: ["No snapshot found for eval case."],
        evidenceCount: 0,
        proactiveCount: 0,
        suggestedQuestionCount: 0,
      })
      continue
    }

    const timeResolution = resolveSnapshotTimeRange({
      message: item.question,
      availableSnapshotDates: orderedSnapshots.map((snapshot) => snapshot.date),
      fallbackSnapshotDate: latestSnapshot.date,
    })
    const snapshot =
      orderedSnapshots.find((candidate) => candidate.date === timeResolution.primarySnapshotDate) ??
      latestSnapshot
    const response = await buildDeterministicChatResponse({
      message: item.question,
      category,
      snapshot,
      snapshots: orderedSnapshots,
      resolvedTime: timeResolution,
    })

    const answer = response.answer
    const assertionText = [answer, ...response.bullets].join("\n")
    const failures: string[] = []
    const headline = response.headline?.trim() ?? ""
    if (!headline) {
      failures.push("headline must be non-empty")
    } else {
      if (headline.startsWith("(")) {
        failures.push("headline must not start with (")
      }
      if (/Snapshot used/i.test(headline)) {
        failures.push("headline must not contain Snapshot used")
      }
    }
    if (response.answer.startsWith("(Snapshot used:")) {
      failures.push("answer must not start with (Snapshot used:")
    }
    for (const pattern of item.mustMatch) {
      const regex = compileRegex(pattern)
      if (!regex.test(assertionText)) {
        failures.push(`mustMatch /${pattern}/`)
      }
    }
    for (const pattern of item.mustNotMatch) {
      const regex = compileRegex(pattern)
      if (regex.test(assertionText)) {
        failures.push(`mustNotMatch /${pattern}/`)
      }
    }
    for (const pattern of item.answerMustMatch ?? []) {
      const regex = compileRegex(pattern)
      if (!regex.test(answer)) {
        failures.push(`answerMustMatch /${pattern}/`)
      }
    }
    for (const pattern of item.answerMustNotMatch ?? []) {
      const regex = compileRegex(pattern)
      if (regex.test(answer)) {
        failures.push(`answerMustNotMatch /${pattern}/`)
      }
    }
    if (item.minBullets !== undefined && response.bullets.length < item.minBullets) {
      failures.push(`minBullets ${item.minBullets} (received ${response.bullets.length})`)
    }
    if (response.bullets.length > 4) {
      failures.push(`maxBullets 4 (received ${response.bullets.length})`)
    }
    if (response.evidence.length > 5) {
      failures.push(`maxEvidence 5 (received ${response.evidence.length})`)
    }
    if (response.suggestedQuestions.length !== 3) {
      failures.push(`suggestedQuestions exactly 3 (received ${response.suggestedQuestions.length})`)
    }
    if (
      response.intent !== "brand_health" &&
      response.intent !== "self_assessment" &&
      response.proactive.length > 0
    ) {
      failures.push(`proactive must be empty for ${response.intent}`)
    }
    if (category.id === "code_reader_scanner" && /\bB0[A-Z0-9]{8}\b/.test(assertionText)) {
      failures.push("bare ASIN found outside evidence chips")
    }
    if (item.proactiveMin !== undefined && response.proactive.length < item.proactiveMin) {
      failures.push(`proactiveMin ${item.proactiveMin} (received ${response.proactive.length})`)
    }
    if (item.proactiveMax !== undefined && response.proactive.length > item.proactiveMax) {
      failures.push(`proactiveMax ${item.proactiveMax} (received ${response.proactive.length})`)
    }
    const mart = buildCodeReaderDataMart(category, snapshot.date)
    if (mart && category.id === "code_reader_scanner") {
      for (const suggestion of response.suggestedQuestions) {
        const suggestedQuery = parseQuery(suggestion, category.id)
        const suggestedEntities = resolveEntities(suggestion, mart, {
          parsedQuery: suggestedQuery,
        })
        const suggestedRoute = routeIntent(suggestedQuery, suggestedEntities)
        if (suggestedRoute.analyzer === "unknown") {
          failures.push(`suggestedQuestion routes to unknown: ${JSON.stringify(suggestion)}`)
        }
      }
    } else {
      for (const suggestion of response.suggestedQuestions) {
        if (detectIntent(suggestion, category.id).intent === "unknown") {
          failures.push(`suggestedQuestion routes to unknown: ${JSON.stringify(suggestion)}`)
        }
      }
    }

    results.push({
      id: item.id,
      categoryId: item.categoryId,
      question: item.question,
      intent: response.intent,
      ok: failures.length === 0,
      failures,
      answer: response.answer,
      headline,
      answerRest: response.answerRest ?? "",
      bullets: response.bullets,
      warnings: response.warnings,
      evidenceCount: response.evidence.length,
      proactiveCount: response.proactive.length,
      suggestedQuestionCount: response.suggestedQuestions.length,
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  }
}

function compileRegex(pattern: string) {
  try {
    return new RegExp(pattern, "im")
  } catch (error) {
    throw new Error(`Invalid golden eval regex ${JSON.stringify(pattern)}: ${String(error)}`)
  }
}

async function main() {
  const summary = await runGoldenEvals()
  console.table(
    summary.results.map((result) => ({
      id: result.id,
      category: result.categoryId,
      intent: result.intent,
      bullets: result.bullets.length,
      evidence: result.evidenceCount,
      proactive: result.proactiveCount,
      suggestions: result.suggestedQuestionCount,
      result: result.ok ? "PASS" : "FAIL",
      failures: result.failures.join("; "),
    }))
  )
  console.log(`Golden chatbot evals: ${summary.passed}/${summary.total} passed; ${summary.failed} failed.`)

  for (const result of summary.results.filter((candidate) => !candidate.ok)) {
    console.error(`\n[${result.id}] ${result.question}`)
    console.error(result.answer)
    for (const failure of result.failures) console.error(`- ${failure}`)
  }

  if (summary.failed > 0) process.exitCode = 1
}

if (process.argv[1]?.endsWith("run-evals.ts")) {
  void main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
