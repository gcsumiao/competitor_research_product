"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { CheckCircle2, ExternalLink, Loader2, X } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"
import type { ResearchStatusResponse } from "@/lib/consult-me/types"
import {
  CONSULT_ME_ACTIVE_SUBJECT_KEY,
  CONSULT_ME_ACTIVE_TASK_ID_KEY,
} from "@/lib/consult-me/storage-keys"

const POLL_MS = 4000

type CompletionNotice = {
  taskId: string
  subject: string
  status: "completed" | "failed" | "cancelled"
}

export function ConsultMeResearchNotifier() {
  const [activeTaskId, setActiveTaskId] = useState("")
  const [activeSubject, setActiveSubject] = useState("")
  const [progress, setProgress] = useState(0)
  const [notice, setNotice] = useState<CompletionNotice | null>(null)
  const completionNotifiedRef = useRef<string>("")

  useEffect(() => {
    if (typeof window === "undefined") return

    const refreshFromStorage = () => {
      const taskId = window.localStorage.getItem(CONSULT_ME_ACTIVE_TASK_ID_KEY) ?? ""
      const subject = window.localStorage.getItem(CONSULT_ME_ACTIVE_SUBJECT_KEY) ?? ""
      setActiveTaskId(taskId)
      setActiveSubject(subject)
      if (!taskId) {
        setProgress(0)
      }
    }

    refreshFromStorage()
    const syncTimer = window.setInterval(refreshFromStorage, 1200)

    const onStorage = () => refreshFromStorage()
    window.addEventListener("storage", onStorage)
    return () => {
      window.clearInterval(syncTimer)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  useEffect(() => {
    if (!activeTaskId) return
    let cancelled = false

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/consult-me/public-status?taskId=${encodeURIComponent(activeTaskId)}`
        )
        if (!response.ok) {
          if (response.status === 404 && typeof window !== "undefined") {
            window.localStorage.removeItem(CONSULT_ME_ACTIVE_TASK_ID_KEY)
            window.localStorage.removeItem(CONSULT_ME_ACTIVE_SUBJECT_KEY)
            setActiveTaskId("")
            setActiveSubject("")
            setProgress(0)
          }
          return
        }
        const payload = (await response.json()) as ResearchStatusResponse
        if (cancelled) return

        const pct = Math.max(0, Math.min(100, Math.round(payload.progress * 100)))
        setProgress((prev) => {
          if (pct >= 100) return 100
          return Math.max(prev, pct)
        })

        if (payload.status === "queued" || payload.status === "running") {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(CONSULT_ME_ACTIVE_TASK_ID_KEY, payload.taskId)
            window.localStorage.setItem(CONSULT_ME_ACTIVE_SUBJECT_KEY, payload.researchSubject)
          }
          return
        }

        if (typeof window !== "undefined") {
          window.localStorage.removeItem(CONSULT_ME_ACTIVE_TASK_ID_KEY)
          window.localStorage.removeItem(CONSULT_ME_ACTIVE_SUBJECT_KEY)
        }
        setActiveTaskId("")
        setActiveSubject("")
        setProgress(100)

        if (completionNotifiedRef.current === payload.taskId) return
        completionNotifiedRef.current = payload.taskId
        const nextNotice: CompletionNotice = {
          taskId: payload.taskId,
          subject: payload.researchSubject,
          status: payload.status === "completed" ? "completed" : payload.status,
        }
        setNotice(nextNotice)
        fireBrowserNotification(nextNotice)
      } catch {
        // Keep silent on network hiccups.
      }
    }

    void poll()
    const timer = window.setInterval(() => {
      void poll()
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeTaskId])

  if (!activeTaskId && !notice) return null

  return (
    <>
      {activeTaskId ? (
        <div className="fixed bottom-6 right-6 z-40 w-[300px] rounded-lg border border-border bg-card p-3 shadow-lg">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Research running
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{activeSubject || "Current task"}</p>
          <div className="mt-2 h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-foreground transition-all duration-500"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{`${Math.max(5, progress)}%`}</p>
            <Link href={`/consult-me?taskId=${encodeURIComponent(activeTaskId)}`} className="text-xs underline">
              View task
            </Link>
          </div>
        </div>
      ) : null}

      {notice ? (
        <div className="fixed top-20 right-6 z-50 w-[360px] rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                {notice.status === "completed" ? "Research completed" : `Research ${notice.status}`}
              </p>
              <p className="mt-1 text-xs text-emerald-900/90">{notice.subject}</p>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
              className="rounded p-1 text-emerald-800 hover:bg-emerald-500/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <Link
              href={`/consult-me?taskId=${encodeURIComponent(notice.taskId)}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              View Deliverables
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : null}
    </>
  )
}

function fireBrowserNotification(notice: CompletionNotice) {
  if (typeof window === "undefined" || typeof Notification === "undefined") return
  if (Notification.permission !== "granted") return
  const title =
    notice.status === "completed"
      ? "Consult Me research completed"
      : `Consult Me research ${notice.status}`
  const notification = new Notification(title, {
    body: notice.subject,
    icon: "/favicon.ico",
  })
  notification.onclick = () => {
    window.focus()
    window.location.href = `/consult-me?taskId=${encodeURIComponent(notice.taskId)}`
  }
}
