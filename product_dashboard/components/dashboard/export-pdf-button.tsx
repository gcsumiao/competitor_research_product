"use client"

import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function ExportPdfButton({ children }: { children: ReactNode }) {
  const printPage = () => {
    window.print()
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="flex items-center gap-2 bg-transparent"
      aria-label="Export page as PDF"
      onClick={printPage}
    >
      {children}
    </Button>
  )
}
