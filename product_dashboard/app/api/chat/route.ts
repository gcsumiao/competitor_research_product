import { NextResponse } from "next/server"

import { buildDeterministicChatResponse } from "@/lib/chatbot/insights"
import { detectIntent } from "@/lib/chatbot/intents"
import type { ChatRequest, ChatResponse } from "@/lib/chatbot/types"
import { loadDashboardData } from "@/lib/competitor-data"

const CACHE_TTL_MS = 60_000
const MESSAGE_MAX_LENGTH = 1200
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
let dashboardCache:
  | {
      loadedAt: number
      data: Awaited<ReturnType<typeof loadDashboardData>>
    }
  | null = null

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
    const targetBrand =
      typeof payload.targetBrand === "string" && payload.targetBrand.trim()
        ? payload.targetBrand.trim()
        : undefined

    const data = await loadDashboardDataCached()
    const category = data.categories.find((item) => item.id === categoryId)
    if (!category) {
      return NextResponse.json({ error: `Unknown category: ${categoryId}` }, { status: 400 })
    }

    const snapshot = category.snapshots.find((item) => item.date === snapshotDate)
    if (!snapshot) {
      return NextResponse.json(
        { error: `Unknown snapshot date for category ${categoryId}: ${snapshotDate}` },
        { status: 400 }
      )
    }

    const deterministic = await buildDeterministicChatResponse({
      message,
      category,
      snapshot,
      snapshots: category.snapshots,
      targetBrand,
    })

    const enhanced = await maybeEnhanceWithLlm(message, deterministic)
    return NextResponse.json(enhanced ?? deterministic)
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
  const shouldUseLlm = deterministic.intent === "unknown" || intentInfo.confidence < 0.55
  if (!shouldUseLlm) return null

  try {
    const explicitBrands = extractExplicitBrands(question)
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are rephrasing an analytics answer. Keep numbers and facts consistent with provided deterministic data. Return strict JSON with keys answer, bullets, suggestedQuestions.",
          },
          {
            role: "user",
            content: JSON.stringify({
              question,
              deterministic,
              instruction:
                "Rewrite to be concise and stakeholder-friendly. Do not invent metrics. Keep bullets <= 5.",
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

    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : ""
    if (!answer) return null

    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets.filter((item): item is string => typeof item === "string").slice(0, 5)
      : deterministic.bullets

    const suggestedQuestions = Array.isArray(parsed.suggestedQuestions)
      ? parsed.suggestedQuestions.filter((item): item is string => typeof item === "string").slice(0, 4)
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

async function loadDashboardDataCached() {
  const now = Date.now()
  if (dashboardCache && now - dashboardCache.loadedAt <= CACHE_TTL_MS) {
    return dashboardCache.data
  }

  const data = await loadDashboardData()
  dashboardCache = {
    loadedAt: now,
    data,
  }
  return data
}
