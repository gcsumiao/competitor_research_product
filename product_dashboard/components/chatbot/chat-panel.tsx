"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useRef } from "react"

import { ChatMessage, type ChatPanelMessage } from "@/components/chatbot/chat-message"
import { QuickActions } from "@/components/chatbot/quick-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ChatPanelProps = {
  open: boolean
  inputValue: string
  isLoading: boolean
  messages: ChatPanelMessage[]
  onClose: () => void
  onInputChange: (value: string) => void
  onSubmit: () => void
  onQuickAction: (prompt: string) => void
}

export function ChatPanel({
  open,
  inputValue,
  isLoading,
  messages,
  onClose,
  onInputChange,
  onSubmit,
  onQuickAction,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages, open, isLoading])

  if (!open) return null

  return (
    <div className="fixed bottom-20 right-4 z-50 w-[min(440px,calc(100vw-2rem))] rounded-xl border border-border bg-background shadow-xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Stakeholder Copilot</p>
          <p className="text-[11px] text-muted-foreground">Category-aware intelligence chat</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div ref={scrollRef} className="max-h-[62vh] space-y-3 overflow-y-auto px-3 py-3">
        <div className="sticky top-0 z-10 -mx-3 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
          <QuickActions disabled={isLoading} onSelect={onQuickAction} />
        </div>

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} onSuggestedQuestion={onQuickAction} />
        ))}

        {isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Analyzing latest snapshot...</span>
          </div>
        ) : null}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="flex gap-2">
          <Input
            placeholder="Ask about performance, competitors, risks..."
            value={inputValue}
            onChange={(event) => onInputChange(event.target.value)}
            disabled={isLoading}
          />
          <Button type="submit" disabled={isLoading || inputValue.trim().length === 0}>
            Send
          </Button>
        </div>
      </form>
    </div>
  )
}
