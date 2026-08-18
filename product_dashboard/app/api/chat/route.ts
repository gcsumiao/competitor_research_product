import { NextResponse } from "next/server"

import { buildDeterministicChatResponse } from "@/lib/chatbot/insights"
import { detectIntent } from "@/lib/chatbot/intents"
import type { ChatRequest, ChatResponse } from "@/lib/chatbot/types"
import { resolveSnapshotTimeRange } from "@/lib/chatbot/time-resolver"
import { loadDashboardDataForCategory } from "@/lib/competitor-data"
import { normalizeSnapshotDate } from "@/lib/snapshot-date"

const CACHE_TTL_MS = 15_000
const MESSAGE_MAX_LENGTH = 1200
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
const OPENAI_TIMEOUT_MS = 8_000
const dashboardCache = new Map<
  string,
  {
    loadedAt: number
    data: Awaited<ReturnType<typeof loadDashboardDataForCategory>>
  }
>()

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<ChatRequest>
    const validationError = validatePayload(payload)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const message = payload.message!.trim()
    const categoryId = payload.categoryId!
    const snapshotDate = payload.snapshotDate!
    const normalizedSnapshotDate = normalizeSnapshotDate(snapshotDate)
    const targetBrand =
      typeof payload.targetBrand === "string" && payload.targetBrand.trim()
        ? payload.targetBrand.trim()
        : undefined

    const data = await loadDashboardDataCached(categoryId)
    const category = data.categories.find((item) => item.id === categoryId)
    if (!category) {
      return NextResponse.json({ error: `Unknown category: ${categoryId}` }, { status: 400 })
    }

    const timeResolution = resolveSnapshotTimeRange({
      message,
      availableSnapshotDates: category.snapshots.map((item) => item.date),
      fallbackSnapshotDate: snapshotDate,
    })

    let snapshotWarning: string | undefined
    const snapshot =
      category.snapshots.find((item) => item.date === timeResolution.primarySnapshotDate) ??
      category.snapshots.find((item) => item.date === snapshotDate) ??
      category.snapshots.find((item) => item.date === normalizedSnapshotDate) ??
      category.snapshots.at(-1)

    if (!snapshot) {
      return NextResponse.json(
        { error: `Unknown snapshot date for category ${categoryId}: ${snapshotDate}` },
        { status: 400 }
      )
    }

    if (
      snapshot.date !== snapshotDate &&
      snapshot.date !== normalizedSnapshotDate &&
      snapshot.date !== timeResolution.primarySnapshotDate
    ) {
      snapshotWarning = `Requested snapshot ${snapshotDate} was unavailable. Using latest ${snapshot.date}.`
    }

    const deterministic = await buildDeterministicChatResponse({
      message,
      category,
      snapshot,
      snapshots: category.snapshots,
      targetBrand,
      resolvedTime: timeResolution,
    })

    const deterministicWithSnapshotWarning = snapshotWarning
      ? {
          ...deterministic,
          warnings: [snapshotWarning, ...(deterministic.warnings ?? [])].slice(0, 6),
        }
      : deterministic

    const deterministicWithTime = {
      ...deterministicWithSnapshotWarning,
      snapshotUsed: deterministicWithSnapshotWarning.snapshotUsed ?? snapshot.date,
      compareSnapshotUsed:
        deterministicWithSnapshotWarning.compareSnapshotUsed ?? timeResolution.compareSnapshotDate,
      windowUsed:
        deterministicWithSnapshotWarning.windowUsed ??
        (timeResolution.resolvedWindow ? windowToLabel(timeResolution.resolvedWindow) : undefined),
      warnings: [
        ...(timeResolution.warnings ?? []),
        ...(deterministicWithSnapshotWarning.warnings ?? []),
      ].slice(0, 6),
    }

    const enhanced = await maybeEnhanceWithLlm(message, deterministicWithTime)
    const finalResponse = addSnapshotPrefix(enhanced ?? deterministicWithTime)
    return NextResponse.json(toClientResponse(finalResponse))
  } catch {
    return NextResponse.json(
      {
        intent: "unknown",
        answer: "I could not process that request safely. Please retry with a shorter question.",
        bullets: [],
        evidence: [],
        proactive: [],
        suggestedQuestions: [
          "How did we do this month?",
          "What are competitors doing?",
          "What should I be worried about?",
          "What are the Rolling 12 month grand total revenue and units?",
        ],
        warnings: ["The chat service encountered an unexpected parsing error."],
      } satisfies ChatResponse,
      { status: 200 }
    )
  }
}

function validatePayload(payload: Partial<ChatRequest>) {
  if (!payload || typeof payload !== "object") {
    return "Malformed JSON body."
  }
  if (!payload.message || typeof payload.message !== "string") {
    return "Missing message."
  }
  if (payload.message.trim().length === 0) {
    return "Message cannot be empty."
  }
  if (payload.message.length > MESSAGE_MAX_LENGTH) {
    return `Message too long. Limit is ${MESSAGE_MAX_LENGTH} characters.`
  }
  if (!payload.categoryId || typeof payload.categoryId !== "string") {
    return "Missing categoryId."
  }
  if (!payload.snapshotDate || typeof payload.snapshotDate !== "string") {
    return "Missing snapshotDate."
  }
  if (!payload.pathname || typeof payload.pathname !== "string") {
    return "Missing pathname."
  }
  return null
}

async function maybeEnhanceWithLlm(
  question: string,
  deterministic: ChatResponse
): Promise<ChatResponse | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const intentInfo = detectIntent(question)
  const confidence = deterministic.confidence ?? intentInfo.confidence
  const shouldUseLlm =
    deterministic.intent === "unknown" ||
    confidence < 0.55 ||
    (deterministic.wantsLlmSynthesis === true &&
      (deterministic.confidence ?? 1) < 0.8)
  if (!shouldUseLlm) return null

  try {
    const explicitBrands = extractExplicitBrands(question)
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an analytics analyst. Answer the user's question directly in 1-3 plain sentences plus up to 5 concise evidence bullets. Use only facts in factPack; never infer or invent a metric. If factPack warnings are present, lead with the material caveat. Do not use Markdown syntax. Return strict JSON with keys answer, bullets, suggestedQuestions.",
          },
          {
            role: "user",
            content: JSON.stringify({
              question,
              factPack: {
                ...(deterministic.factPack ?? {
                  intent: deterministic.intent,
                  evidence: deterministic.evidence,
                  snapshotUsed: deterministic.snapshotUsed,
                  compareSnapshotUsed: deterministic.compareSnapshotUsed,
                }),
                warnings: deterministic.warnings ?? [],
              },
            }),
          },
        ],
      }),
    })

    if (!response.ok) return null
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) return null

    const parsed = safeParseJson(content)
    if (!parsed) return null

    const answer = typeof parsed.answer === "string" ? cleanPlainText(parsed.answer) : ""
    if (!answer) return null

    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets
          .filter((item): item is string => typeof item === "string")
          .map(cleanPlainText)
          .filter(Boolean)
          .slice(0, 5)
      : deterministic.bullets

    const suggestedQuestions = Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions
          .filter((item): item is string => typeof item === "string")
          .map(cleanPlainText)
          .filter(Boolean)
          .slice(0, 4)
      : deterministic.suggestedQuestions

    // Guardrail: if question explicitly asks for a brand, keep deterministic scope fidelity.
    if (explicitBrands.length && !containsAllBrands(answer, explicitBrands)) {
      return null
    }

    return {
      ...deterministic,
      answer,
      bullets,
      suggestedQuestions,
    }
  } catch {
    return null
  }
}

function cleanPlainText(value: string) {
  return value
    .trim()
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`]/g, "")
    .trim()
}

function toClientResponse(response: ChatResponse) {
  const output = { ...response }
  delete output.factPack
  delete output.wantsLlmSynthesis
  return output
}

function safeParseJson(content: string): Record<string, unknown> | null {
  const direct = tryParse(content)
  if (direct) return direct

  const fencedMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fencedMatch?.[1]) {
    return tryParse(fencedMatch[1])
  }

  const start = content.indexOf("{")
  const end = content.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return tryParse(content.slice(start, end + 1))
  }

  return null
}

function tryParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function extractExplicitBrands(question: string) {
  const normalized = question.toLowerCase()
  const brands: string[] = []
  if (/\binnova\b/.test(normalized)) brands.push("innova")
  if (/\bblcktec\b|\bblck\s*tek\b|\bblacktec\b/.test(normalized)) brands.push("blcktec")
  return brands
}

function containsAllBrands(text: string, brands: string[]) {
  const normalized = text.toLowerCase()
  return brands.every((brand) => normalized.includes(brand))
}

async function loadDashboardDataCached(categoryId: string) {
  const now = Date.now()
  const cached = dashboardCache.get(categoryId)
  if (cached && now - cached.loadedAt <= CACHE_TTL_MS) {
    return cached.data
  }

  const data = await loadDashboardDataForCategory(categoryId)
  dashboardCache.set(categoryId, {
    loadedAt: now,
    data,
  })
  return data
}

function windowToLabel(value: "1m" | "3m" | "6m" | "12m" | "all") {
  if (value === "1m") return "Last 1 month"
  if (value === "3m") return "Last 3 months"
  if (value === "6m") return "Last 6 months"
  if (value === "12m") return "Last 12 months"
  return "Full history"
}

function addSnapshotPrefix(response: ChatResponse): ChatResponse {
  if (!response.snapshotUsed) return response
  if (response.answer.startsWith("(Snapshot used:")) return response
  return {
    ...response,
    answer: `(Snapshot used: ${response.snapshotUsed}) ${response.answer}`,
  }
}
