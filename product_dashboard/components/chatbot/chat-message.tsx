"use client"

import { AlertTriangle, Lightbulb } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { ChatResponse } from "@/lib/chatbot/types"

export type ChatPanelMessage = {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  response?: ChatResponse
}

type ChatMessageProps = {
  message: ChatPanelMessage
  onSuggestedQuestion: (question: string) => void
}

export function ChatMessage({ message, onSuggestedQuestion }: ChatMessageProps) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-foreground px-4 py-2 text-xs text-background">
          {message.content}
        </div>
      </div>
    )
  }

  const response = message.response
  const body = response?.answer ?? message.content
  const bullets = response?.bullets ?? []
  const evidence = response?.evidence ?? []
  const proactive = response?.proactive ?? []
  const warnings = response?.warnings ?? []
  const suggestedQuestions = response?.suggestedQuestions ?? []

  return (
    <div className="flex justify-start">
      <Card className="w-full border border-border bg-card">
        <CardContent className="space-y-3 p-3">
          <p className="text-xs text-foreground">{body}</p>

          {bullets.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {bullets.map((bullet, index) => (
                <li key={`${message.id}-bullet-${index}`}>- {bullet}</li>
              ))}
            </ul>
          ) : null}

          {evidence.length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {evidence.map((item) => (
                <div key={`${message.id}-${item.label}`} className="rounded-md border border-border bg-background/60 px-2 py-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</p>
                  <p className="text-xs font-medium text-foreground">{item.value}</p>
                </div>
              ))}
            </div>
          ) : null}

          {proactive.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Proactive Suggestions</p>
              {proactive.map((item) => (
                <div key={`${message.id}-${item.id}`} className="rounded-md border border-border bg-background/40 px-2 py-2">
                  <div className="flex items-center gap-1 text-xs font-medium text-foreground">
                    <Lightbulb className="h-3.5 w-3.5" />
                    <span>{item.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.summary}</p>
                </div>
              ))}
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-2">
              <div className="mb-1 flex items-center gap-1 text-xs font-medium text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>Warnings</span>
              </div>
              <ul className="space-y-1 text-xs text-amber-700">
                {warnings.map((warning, index) => (
                  <li key={`${message.id}-warning-${index}`}>- {warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {suggestedQuestions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Suggested For This Category</p>
              <div className="flex flex-wrap gap-2">
                {suggestedQuestions.map((question) => (
                  <Button
                    key={`${message.id}-${question}`}
                    type="button"
                    variant="outline"
                    className="h-auto px-2 py-1 text-[11px] bg-transparent"
                    onClick={() => onSuggestedQuestion(question)}
                  >
                    {question}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
