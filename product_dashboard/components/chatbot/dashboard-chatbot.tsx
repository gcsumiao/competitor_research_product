"use client"

import { MessageSquare } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { ChatPanel } from "@/components/chatbot/chat-panel"
import type { ChatPanelMessage } from "@/components/chatbot/chat-message"
import { Button } from "@/components/ui/button"
import type { ChatResponse } from "@/lib/chatbot/types"
import { normalizeSnapshotDate } from "@/lib/snapshot-date"

const ASK_OWN_QUESTION = "Ask your own question"
const SELF_ASSESSMENT_ACTION = "How did we do this month?"
const BRAND_OPTIONS = ["Innova", "BLCKTEC"]
const BRAND_ROLLING12_ACTION = "What are the Rolling 12 month grand total revenue and units?"
type PendingSelectionMode = "self_assessment" | "rolling12_brand" | null

function buildGreetingMessage(): ChatPanelMessage {
  return {
    id: createMessageId(),
    role: "assistant",
    content:
      "Select a quick action to start, or ask a question about performance, competitors, risk, or data definitions.",
  }
}

export function DashboardChatbot() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const resolvedCategoryId = searchParams.get("category")?.trim() ?? ""
  const categoryId = resolvedCategoryId || "code_reader_scanner"
  const snapshotDate = normalizeSnapshotDate(searchParams.get("snapshot") ?? "")
  const selectedBrand = searchParams.get("brand")?.trim() ?? ""
  const quickActions = useMemo(() => {
    if (categoryId === "code_reader_scanner") {
      return [
        SELF_ASSESSMENT_ACTION,
        "What are competitors doing?",
        "What should I be worried about?",
        BRAND_ROLLING12_ACTION,
        ASK_OWN_QUESTION,
      ]
    }

    return [
      SELF_ASSESSMENT_ACTION,
      "What are competitors doing?",
      "What should I be worried about?",
      ASK_OWN_QUESTION,
    ]
  }, [categoryId])

  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<ChatPanelMessage[]>([buildGreetingMessage()])
  const [pendingSelectionMode, setPendingSelectionMode] = useState<PendingSelectionMode>(null)
  const conversationIdRef = useRef(0)
  const lastCategoryIdRef = useRef("")
  const lastSnapshotDateRef = useRef("")

  const resetConversation = useCallback(() => {
    conversationIdRef.current += 1
    setMessages([buildGreetingMessage()])
    setPendingSelectionMode(null)
    setInputValue("")
    setIsLoading(false)
  }, [])

  useEffect(() => {
    let shouldReset = false

    if (resolvedCategoryId) {
      if (
        lastCategoryIdRef.current &&
        lastCategoryIdRef.current !== resolvedCategoryId
      ) {
        shouldReset = true
      }
      lastCategoryIdRef.current = resolvedCategoryId
    }

    if (snapshotDate) {
      if (
        lastSnapshotDateRef.current &&
        lastSnapshotDateRef.current !== snapshotDate
      ) {
        shouldReset = true
      }
      lastSnapshotDateRef.current = snapshotDate
    }

    if (shouldReset) {
      resetConversation()
    }
  }, [resolvedCategoryId, resetConversation, snapshotDate])

  const appendMessage = (message: ChatPanelMessage) => {
    setMessages((current) => [...current, message])
  }

  const sendMessage = async (customMessage?: string) => {
    if (isLoading) return

    const text = (customMessage ?? inputValue).trim()
    if (!text) return

    if (text === ASK_OWN_QUESTION) {
      setOpen(true)
      setInputValue("")
      setPendingSelectionMode(null)
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: "Type your question below and I will analyze the selected snapshot.",
      })
      return
    }

    if (text === SELF_ASSESSMENT_ACTION && categoryId === "code_reader_scanner") {
      setOpen(true)
      setInputValue("")
      setPendingSelectionMode("self_assessment")
      appendMessage({
        id: createMessageId(),
        role: "user",
        content: text,
      })
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: "Please choose which brand summary you want.",
        response: {
          intent: "self_assessment",
          answer: "Please choose which brand summary you want.",
          bullets: [],
          evidence: [],
          proactive: [],
          suggestedQuestions: BRAND_OPTIONS,
          warnings: [],
        },
      })
      return
    }

    let effectiveMessage = text
    let targetBrand: string | undefined

    if (pendingSelectionMode === "self_assessment") {
      const normalized = text.toLowerCase()
      if (normalized === "innova" || normalized === "blcktec") {
        targetBrand = normalized
        effectiveMessage = `How did ${text} do this month?`
        setPendingSelectionMode(null)
      } else {
        appendMessage({
          id: createMessageId(),
          role: "assistant",
          content: "Please select Innova or BLCKTEC for this summary.",
          response: {
            intent: "self_assessment",
            answer: "Please select Innova or BLCKTEC for this summary.",
            bullets: [],
            evidence: [],
            proactive: [],
            suggestedQuestions: BRAND_OPTIONS,
            warnings: [],
          },
        })
        return
      }
    } else if (pendingSelectionMode === "rolling12_brand") {
      targetBrand = text
      effectiveMessage = BRAND_ROLLING12_ACTION
      setPendingSelectionMode(null)
    }

    const shouldInheritSelectedBrand =
      categoryId === "code_reader_scanner" &&
      Boolean(selectedBrand) &&
      text !== BRAND_ROLLING12_ACTION &&
      pendingSelectionMode !== "rolling12_brand"

    if (!targetBrand && shouldInheritSelectedBrand) {
      targetBrand = selectedBrand
    }

    appendMessage({
      id: createMessageId(),
      role: "user",
      content: text,
    })

    const conversationId = conversationIdRef.current
    setInputValue("")
    setIsLoading(true)

    if (!snapshotDate) {
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: "Snapshot is still loading. Please retry in a second.",
      })
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: effectiveMessage,
          categoryId,
          snapshotDate,
          pathname,
          targetBrand,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (conversationId !== conversationIdRef.current) return
        appendMessage({
          id: createMessageId(),
          role: "assistant",
          content: payload?.error ?? "Chat request failed. Please retry.",
        })
        setIsLoading(false)
        return
      }

      const payload = (await response.json()) as ChatResponse
      if (conversationId !== conversationIdRef.current) return
      if (text === BRAND_ROLLING12_ACTION && !targetBrand && payload.suggestedQuestions.length > 0) {
        setPendingSelectionMode("rolling12_brand")
      }
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: payload.answer,
        response: payload,
      })
    } catch {
      if (conversationId !== conversationIdRef.current) return
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: "Network error while contacting chat service. Please retry.",
      })
    } finally {
      if (conversationId === conversationIdRef.current) {
        setIsLoading(false)
      }
    }
  }

  return (
    <>
      <ChatPanel
        open={open}
        inputValue={inputValue}
        isLoading={isLoading}
        messages={messages}
        quickActions={quickActions}
        onClose={() => setOpen(false)}
        onInputChange={setInputValue}
        onStartOver={resetConversation}
        onSubmit={() => void sendMessage()}
        onQuickAction={(prompt) => void sendMessage(prompt)}
      />

      <Button
        type="button"
        className="fixed bottom-4 right-4 z-50 rounded-full px-4 shadow-lg"
        onClick={() => setOpen((current) => !current)}
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        Chat
      </Button>
    </>
  )
}

function createMessageId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
