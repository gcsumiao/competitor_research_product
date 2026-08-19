"use client"

import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"

export function ExportPdfButton({
  children,
  dataGuide,
}: {
  children: ReactNode
  dataGuide?: string
}) {
  const printPage = () => {
    window.print()
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="flex items-center gap-2 bg-transparent"
      aria-label="Export page as PDF"
      data-guide={dataGuide}
      onClick={printPage}
    >
      {children}
    </Button>
  )
}
