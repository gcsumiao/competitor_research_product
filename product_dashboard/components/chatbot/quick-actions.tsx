"use client"

import { Button } from "@/components/ui/button"

type QuickActionsProps = {
  disabled?: boolean
  onSelect: (prompt: string) => void
}

const ACTIONS = [
  "How did we do this month?",
  "What are competitors doing?",
  "What should I be worried about?",
  "Ask your own question",
]

export function QuickActions({ disabled = false, onSelect }: QuickActionsProps) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {ACTIONS.map((prompt) => (
        <Button
          key={prompt}
          type="button"
          variant="outline"
          className="h-auto justify-start whitespace-normal py-2 text-left text-xs bg-transparent"
          disabled={disabled}
          onClick={() => onSelect(prompt)}
        >
          {prompt}
        </Button>
      ))}
    </div>
  )
}
