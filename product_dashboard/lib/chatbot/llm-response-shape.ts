import type { ChatResponse, EvidenceItem, ProactiveSuggestion } from "@/lib/chatbot/types"

export type LlmOutputPayload = {
  answer?: unknown
  bullets?: unknown
  evidence?: unknown
  proactive?: unknown
  suggestedQuestions?: unknown
  warnings?: unknown
  sourcesUsed?: unknown
  windowUsed?: unknown
}

export function coerceLlmPayloadToChatResponse(
  payload: LlmOutputPayload,
  fallback: {
    suggestedQuestions: string[]
    warnings?: string[]
  }
): Omit<ChatResponse, "intent"> {
  const answer =
    typeof payload.answer === "string" && payload.answer.trim()
      ? payload.answer.trim()
      : "I could not produce a grounded answer for that question."

  const bullets = asStringArray(payload.bullets, 5)
  const evidence = asEvidenceArray(payload.evidence, 8)
  const proactive = asProactiveArray(payload.proactive, 3)
  const suggestedQuestions =
    asStringArray(payload.suggestedQuestions, 6).length > 0
      ? asStringArray(payload.suggestedQuestions, 6)
      : fallback.suggestedQuestions
  const warnings = unique([
    ...asStringArray(payload.warnings, 8),
    ...(fallback.warnings ?? []),
  ]).slice(0, 8)
  const sourcesUsed = asStringArray(payload.sourcesUsed, 12)
  const windowUsed =
    typeof payload.windowUsed === "string" && payload.windowUsed.trim()
      ? payload.windowUsed.trim()
      : undefined

  return {
    answer,
    bullets,
    evidence,
    proactive,
    suggestedQuestions,
    warnings,
    sourcesUsed,
    windowUsed,
  }
}

function asStringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max)
}

function asEvidenceArray(value: unknown, max: number): EvidenceItem[] {
  if (!Array.isArray(value)) return []
  const items: EvidenceItem[] = []
  for (const row of value) {
    if (!row || typeof row !== "object") continue
    const label = typeof (row as { label?: unknown }).label === "string" ? (row as { label: string }).label.trim() : ""
    const val = typeof (row as { value?: unknown }).value === "string" ? (row as { value: string }).value.trim() : ""
    if (!label || !val) continue
    items.push({ label, value: val })
    if (items.length >= max) break
  }
  return items
}

function asProactiveArray(value: unknown, max: number): ProactiveSuggestion[] {
  if (!Array.isArray(value)) return []
  const out: ProactiveSuggestion[] = []
  for (const row of value) {
    if (!row || typeof row !== "object") continue
    const title = typeof (row as { title?: unknown }).title === "string" ? (row as { title: string }).title.trim() : ""
    const summary =
      typeof (row as { summary?: unknown }).summary === "string"
        ? (row as { summary: string }).summary.trim()
        : ""
    if (!title || !summary) continue
    const severityRaw =
      typeof (row as { severity?: unknown }).severity === "string"
        ? (row as { severity: string }).severity.toLowerCase()
        : "info"
    const severity = severityRaw === "risk" || severityRaw === "watch" ? severityRaw : "info"
    const id =
      typeof (row as { id?: unknown }).id === "string" && (row as { id: string }).id.trim()
        ? (row as { id: string }).id.trim()
        : `llm-suggestion-${out.length + 1}`
    out.push({ id, title, summary, severity })
    if (out.length >= max) break
  }
  return out
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}
