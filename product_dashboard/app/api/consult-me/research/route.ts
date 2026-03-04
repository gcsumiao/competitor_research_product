import { NextResponse } from "next/server"

import { createResearchTask } from "@/lib/consult-me/task-store"
import type { CreateResearchRequest, ResearchType } from "@/lib/consult-me/types"

const MAX_TEXT_LENGTH = 4_000
const ALLOWED_TYPES = new Set<ResearchType>([
  "company",
  "market",
  "competitive",
  "industry",
  "custom",
])

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<CreateResearchRequest>
    const validation = validateRequest(body)
    if (validation) {
      return NextResponse.json({ error: validation }, { status: 400 })
    }
    if (body.researchType !== "company") {
      return NextResponse.json(
        { error: "Market, Industry, Competitive, and Custom research are coming soon. Company research only for now." },
        { status: 403 }
      )
    }

    const created = await createResearchTask({
      researchType: body.researchType!,
      researchSubject: body.researchSubject!.trim(),
      researchFocus: cleanOptional(body.researchFocus),
      clientContext: cleanOptional(body.clientContext),
      specificQuestions: cleanOptional(body.specificQuestions),
      brandKey: cleanOptional(body.brandKey),
      snapshotDate: cleanOptional(body.snapshotDate),
    })

    return NextResponse.json(created)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create consult-me task" },
      { status: 500 }
    )
  }
}

function validateRequest(body: Partial<CreateResearchRequest>) {
  if (!body || typeof body !== "object") return "Malformed JSON body."
  if (!body.researchType || !ALLOWED_TYPES.has(body.researchType)) {
    return "Invalid researchType."
  }
  if (!body.researchSubject || typeof body.researchSubject !== "string") {
    return "Missing researchSubject."
  }
  if (!body.researchSubject.trim()) {
    return "researchSubject cannot be empty."
  }
  if (body.researchSubject.length > 200) {
    return "researchSubject is too long."
  }

  const fields = [body.researchFocus, body.clientContext, body.specificQuestions]
  for (const value of fields) {
    if (value !== undefined && typeof value !== "string") {
      return "Optional text fields must be strings."
    }
    if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
      return "One or more optional fields are too long."
    }
  }
  return null
}

function cleanOptional(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
