import { buildLlmSystemPrompt, getStarterQuestions } from "@/lib/chatbot/llm-prompts"
import {
  coerceLlmPayloadToChatResponse,
  type LlmOutputPayload,
} from "@/lib/chatbot/llm-response-shape"
import { getSourceExcerptTool } from "@/lib/chatbot/llm-doc-tool"
import { loadLlmDataStore } from "@/lib/chatbot/llm-data-store"
import { describeTableTool, listTablesTool, runSqlTool } from "@/lib/chatbot/llm-sql-tool"
import type { ChatResponse } from "@/lib/chatbot/types"
import type { CategoryId } from "@/lib/competitor-data"

const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions"
const DEFAULT_MODEL = "gpt-5.2"
const MAX_TOOL_ROUNDS = 8

type BrainParams = {
  message: string
  categoryId: string
  snapshotDate: string
  pathname: string
  targetBrand?: string
}

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content?: string
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments?: string }
  }>
  tool_call_id?: string
}

export async function buildLlmOnlyChatResponse(params: BrainParams): Promise<ChatResponse> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    return {
      intent: "unknown",
      answer:
        "Chatbot is configured for GPT-5.2 LLM-only mode, but OPENAI_API_KEY is missing.",
      bullets: ["Set OPENAI_API_KEY and retry."],
      evidence: [],
      proactive: [],
      suggestedQuestions: [
        "How did we do this month?",
        "What are competitors doing?",
        "What should I be worried about?",
      ],
      warnings: ["LLM runtime unavailable because OPENAI_API_KEY is not set."],
    }
  }

  const store = await loadLlmDataStore()
  const starterQuestions = getStarterQuestions(params.categoryId as CategoryId)
  const systemPrompt = buildLlmSystemPrompt({
    categoryId: params.categoryId,
    snapshotDate: params.snapshotDate,
    pathname: params.pathname,
    targetBrand: params.targetBrand,
    starterQuestions,
  })

  const userPrompt = [
    `User question: ${params.message}`,
    `Current category: ${params.categoryId}`,
    `Current snapshot: ${params.snapshotDate}`,
    params.targetBrand ? `Requested brand context: ${params.targetBrand}` : "",
    "Use tools to gather evidence before finalizing the answer.",
  ]
    .filter(Boolean)
    .join("\n")

  const messages: OpenAiMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]

  for (let step = 0; step < MAX_TOOL_ROUNDS; step += 1) {
    const completion = await requestCompletion({
      apiKey,
      messages,
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    })
    if (!completion.ok) {
      return {
        intent: "unknown",
        answer: "I could not complete the GPT-5.2 request.",
        bullets: [],
        evidence: [],
        proactive: [],
        suggestedQuestions: starterQuestions.slice(0, 4),
        warnings: [completion.error ?? "OpenAI request failed."],
      }
    }

    const assistantMessage = completion.message
    if (!assistantMessage) {
      return {
        intent: "unknown",
        answer: "I did not receive a usable model response.",
        bullets: [],
        evidence: [],
        proactive: [],
        suggestedQuestions: starterQuestions.slice(0, 4),
        warnings: ["Model response was empty."],
      }
    }

    const toolCalls = assistantMessage.tool_calls ?? []
    if (!toolCalls.length) {
      const payload = safeParsePayload(assistantMessage.content ?? "")
      const response = coerceLlmPayloadToChatResponse(payload ?? {}, {
        suggestedQuestions: starterQuestions.slice(0, 4),
        warnings: payload ? [] : ["Model did not return strict JSON; applied safe fallback."],
      })
      return {
        intent: "llm_only",
        ...response,
      }
    }

    messages.push({
      role: "assistant",
      content: assistantMessage.content,
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      const toolResult = await executeToolCall(store, call)
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult),
      })
    }
  }

  return {
    intent: "unknown",
    answer: "I reached the tool-call limit before finishing this answer.",
    bullets: [],
    evidence: [],
    proactive: [],
    suggestedQuestions: starterQuestions.slice(0, 4),
    warnings: ["Tool loop limit reached."],
  }
}

async function executeToolCall(
  store: Awaited<ReturnType<typeof loadLlmDataStore>>,
  call: {
    id: string
    type: string
    function: { name: string; arguments?: string }
  }
) {
  const name = call.function.name
  const args = safeParseObject(call.function.arguments ?? "") ?? {}

  if (name === "list_tables") {
    return { ok: true, rows: listTablesTool(store) }
  }
  if (name === "describe_table") {
    const table = typeof args.table === "string" ? args.table : ""
    return describeTableTool(table)
  }
  if (name === "run_sql") {
    const query = typeof args.query === "string" ? args.query : ""
    const limit = typeof args.limit === "number" ? args.limit : undefined
    return runSqlTool(store, query, limit)
  }
  if (name === "get_source_excerpt") {
    const sourceFile = typeof args.source_file === "string" ? args.source_file : ""
    const section = typeof args.section === "string" ? args.section : undefined
    return getSourceExcerptTool(store, sourceFile, section)
  }
  if (name === "get_starter_questions") {
    const category = typeof args.category === "string" ? args.category : "code_reader_scanner"
    return { ok: true, questions: getStarterQuestions(category as CategoryId) }
  }

  return { ok: false, error: `Unknown tool: ${name}` }
}

async function requestCompletion(params: {
  apiKey: string
  model: string
  messages: OpenAiMessage[]
}): Promise<
  | { ok: true; message: { content?: string; tool_calls?: OpenAiMessage["tool_calls"] } }
  | { ok: false; error: string }
> {
  try {
    const response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        temperature: 0.1,
        tool_choice: "auto",
        tools: buildToolDefinitions(),
        messages: params.messages,
      }),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => "")
      return { ok: false, error: `OpenAI error ${response.status}: ${text.slice(0, 280)}` }
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string
          tool_calls?: OpenAiMessage["tool_calls"]
        }
      }>
    }
    const message = payload.choices?.[0]?.message
    if (!message) return { ok: false, error: "No choice message returned." }
    return { ok: true, message }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to call OpenAI",
    }
  }
}

function buildToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "list_tables",
        description: "List all available analytical tables and row counts.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "describe_table",
        description: "Describe a table schema.",
        parameters: {
          type: "object",
          properties: {
            table: { type: "string" },
          },
          required: ["table"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_sql",
        description:
          "Run a read-only SQL query on the data store. SELECT-only with optional WHERE/ORDER BY/LIMIT.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_source_excerpt",
        description: "Get a short excerpt from a source CSV/XLSX/text file for grounding.",
        parameters: {
          type: "object",
          properties: {
            source_file: { type: "string" },
            section: { type: "string" },
          },
          required: ["source_file"],
          additionalProperties: false,
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_starter_questions",
        description: "Get starter questions for a category based on the original question-bank structure.",
        parameters: {
          type: "object",
          properties: {
            category: { type: "string" },
          },
          required: ["category"],
          additionalProperties: false,
        },
      },
    },
  ] as const
}

function safeParsePayload(input: string): LlmOutputPayload | null {
  if (!input) return null
  const direct = tryParse(input)
  if (direct) return direct

  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced?.[1]) {
    const parsed = tryParse(fenced[1])
    if (parsed) return parsed
  }

  const start = input.indexOf("{")
  const end = input.lastIndexOf("}")
  if (start >= 0 && end > start) {
    return tryParse(input.slice(start, end + 1))
  }

  return null
}

function tryParse(value: string): LlmOutputPayload | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as LlmOutputPayload
  } catch {
    return null
  }
}

function safeParseObject(input: string): Record<string, unknown> | null {
  if (!input) return null
  try {
    const parsed = JSON.parse(input) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
