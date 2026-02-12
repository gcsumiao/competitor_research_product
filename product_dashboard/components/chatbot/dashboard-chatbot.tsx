"use client"

import { MessageSquare } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { ChatPanel } from "@/components/chatbot/chat-panel"
import type { ChatPanelMessage } from "@/components/chatbot/chat-message"
import { Button } from "@/components/ui/button"
import type { ChatResponse } from "@/lib/chatbot/types"

const ASK_OWN_QUESTION = "Ask your own question"
const SELF_ASSESSMENT_ACTION = "How did we do this month?"
const BRAND_OPTIONS = ["Innova", "BLCKTEC"]

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

  const categoryId = searchParams.get("category") ?? "code_reader_scanner"
  const snapshotDate = searchParams.get("snapshot") ?? ""

  const storageKey = useMemo(
    () => `dashboard-chat:${categoryId}:${snapshotDate || "unspecified"}`,
    [categoryId, snapshotDate]
  )

  const [open, setOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [inputValue, setInputValue] = useState("")
  const [messages, setMessages] = useState<ChatPanelMessage[]>([buildGreetingMessage()])
  const [pendingBrandSelection, setPendingBrandSelection] = useState(false)

  useEffect(() => {
    const raw = window.sessionStorage.getItem(storageKey)
    if (!raw) {
      setMessages([buildGreetingMessage()])
      setPendingBrandSelection(false)
      return
    }

    try {
      const parsed = JSON.parse(raw) as ChatPanelMessage[]
      setMessages(Array.isArray(parsed) && parsed.length > 0 ? parsed : [buildGreetingMessage()])
      setPendingBrandSelection(false)
    } catch {
      setMessages([buildGreetingMessage()])
      setPendingBrandSelection(false)
    }
  }, [storageKey])

  useEffect(() => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(messages))
  }, [messages, storageKey])

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
      setPendingBrandSelection(false)
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
      setPendingBrandSelection(true)
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

    if (pendingBrandSelection) {
      const normalized = text.toLowerCase()
      if (normalized === "innova" || normalized === "blcktec") {
        targetBrand = normalized
        effectiveMessage = `How did ${text} do this month?`
        setPendingBrandSelection(false)
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
    }

    appendMessage({
      id: createMessageId(),
      role: "user",
      content: text,
    })

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
        appendMessage({
          id: createMessageId(),
          role: "assistant",
          content: payload?.error ?? "Chat request failed. Please retry.",
        })
        setIsLoading(false)
        return
      }

      const payload = (await response.json()) as ChatResponse
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: payload.answer,
        response: payload,
      })
    } catch {
      appendMessage({
        id: createMessageId(),
        role: "assistant",
        content: "Network error while contacting chat service. Please retry.",
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <ChatPanel
        open={open}
        inputValue={inputValue}
        isLoading={isLoading}
        messages={messages}
        onClose={() => setOpen(false)}
        onInputChange={setInputValue}
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
