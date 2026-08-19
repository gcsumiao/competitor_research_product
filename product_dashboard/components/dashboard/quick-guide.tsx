"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, ArrowUp } from "lucide-react"

export type QuickGuideStep = {
  id: string
  text: string
  placement?: "bottom" | "left"
}

type CalloutEntry = {
  step: QuickGuideStep
  target: HTMLElement
  left: number
  top: number
  arrowOffset: number
  status: "visible" | "fading"
  flyX: number
  flyY: number
}

type OverlayState = {
  runId: number
  kind: "intro" | "peek"
  phase: "entering" | "visible" | "retracting"
  entries: CalloutEntry[]
  reducedMotion: boolean
  flyToAnchor: boolean
}

const INTRO_DELAY_MS = 700
const INTRO_VISIBLE_MS = 5500
const FLY_DURATION_MS = 600
const STAGGER_MS = 90
const TARGET_GAP_PX = 8
const VIEWPORT_PADDING_PX = 8
const MAX_CALLOUT_WIDTH_PX = 224
const ESTIMATED_CALLOUT_HEIGHT_PX = 40

export function QuickGuide({
  pageKey,
  steps,
}: {
  pageKey: string
  steps: QuickGuideStep[]
}) {
  const stepsSignature = JSON.stringify(steps)
  const stableSteps = useMemo<QuickGuideStep[]>(
    () => [
      { id: "menu", text: "Tap here to switch pages", placement: "bottom" },
      ...steps,
    ],
    [stepsSignature]
  )
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)
  const [overlay, setOverlay] = useState<OverlayState | null>(null)
  const overlayRef = useRef<OverlayState | null>(null)
  const calloutNodesRef = useRef(new Map<string, HTMLDivElement>())
  const nextRunIdRef = useRef(0)

  overlayRef.current = overlay

  useEffect(() => {
    setPortalNode(document.body)
  }, [])

  useEffect(() => {
    if (!portalNode) return

    const timers = new Set<number>()
    let introListenerCleanups: Array<() => void> = []
    let peekListenerCleanups: Array<() => void> = []

    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        timers.delete(timer)
        callback()
      }, delay)
      timers.add(timer)
      return timer
    }

    const clearTimers = () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }

    const storageKey = (id: string) =>
      id === "menu" ? "quick-guide:menu" : `quick-guide:${pageKey}:${id}`

    const isDone = (id: string) => {
      try {
        return window.sessionStorage.getItem(storageKey(id)) === "done"
      } catch {
        return false
      }
    }

    const markDone = (id: string) => {
      try {
        window.sessionStorage.setItem(storageKey(id), "done")
      } catch {
        // The guide remains usable when session storage is unavailable.
      }
    }

    const findTargets = () =>
      stableSteps.flatMap((step) => {
        const target = document.querySelector<HTMLElement>(`[data-guide="${step.id}"]`)
        if (!target) return []

        const targetRect = target.getBoundingClientRect()
        return targetRect.width === 0 && targetRect.height === 0 ? [] : [{ step, target }]
      })

    const removeIntroListeners = () => {
      introListenerCleanups.forEach((cleanup) => cleanup())
      introListenerCleanups = []
    }

    const removePeekListeners = () => {
      peekListenerCleanups.forEach((cleanup) => cleanup())
      peekListenerCleanups = []
    }

    const hidePeek = (runId: number, id: string, duration = 150) => {
      setOverlay((current) => {
        if (!current || current.runId !== runId || current.kind !== "peek") return current
        return {
          ...current,
          entries: current.entries.map((entry) =>
            entry.step.id === id ? { ...entry, status: "fading" } : entry
          ),
        }
      })
      schedule(() => {
        setOverlay((current) => {
          if (!current || current.runId !== runId || current.kind !== "peek") return current
          return null
        })
      }, duration)
    }

    const showPeek = (step: QuickGuideStep, target: HTMLElement) => {
      if (isDone(step.id)) return
      const runId = ++nextRunIdRef.current
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      setOverlay({
        runId,
        kind: "peek",
        phase: "entering",
        reducedMotion,
        flyToAnchor: false,
        entries: [createInitialEntry(step, target)],
      })
    }

    const attachPeekListeners = () => {
      removePeekListeners()

      for (const { step, target } of findTargets()) {
        if (isDone(step.id)) continue

        let listening = true
        const handleMouseEnter = () => showPeek(step, target)
        const handleMouseLeave = () => {
          const current = overlayRef.current
          if (current?.kind === "peek" && current.entries[0]?.step.id === step.id) {
            hidePeek(current.runId, step.id)
          }
        }
        const cleanup = () => {
          if (!listening) return
          listening = false
          target.removeEventListener("mouseenter", handleMouseEnter)
          target.removeEventListener("mouseleave", handleMouseLeave)
          target.removeEventListener("click", handleClick, true)
        }
        const handleClick = () => {
          markDone(step.id)
          cleanup()
          const current = overlayRef.current
          if (current?.kind === "peek" && current.entries[0]?.step.id === step.id) {
            hidePeek(current.runId, step.id, 200)
          }
        }

        target.addEventListener("mouseenter", handleMouseEnter)
        target.addEventListener("mouseleave", handleMouseLeave)
        target.addEventListener("click", handleClick, { capture: true, once: true })
        peekListenerCleanups.push(cleanup)
      }
    }

    const finishIntro = (runId: number) => {
      const current = overlayRef.current
      if (current?.runId === runId) setOverlay(null)
      removeIntroListeners()
      attachPeekListeners()
    }

    const retractIntro = (runId: number) => {
      const current = overlayRef.current
      if (!current || current.runId !== runId || current.kind !== "intro") return

      const anchorRect = document
        .querySelector<HTMLElement>("[data-guide-anchor]")
        ?.getBoundingClientRect()
      const anchorX = anchorRect ? anchorRect.left + anchorRect.width / 2 : null
      const anchorY = anchorRect ? anchorRect.top + anchorRect.height / 2 : null
      const entries = current.entries.map((entry) => ({
        ...entry,
        flyX: anchorX === null ? 0 : anchorX - entry.left,
        flyY: anchorY === null ? 0 : anchorY - entry.top,
      }))

      setOverlay({
        ...current,
        phase: "retracting",
        entries,
        flyToAnchor: Boolean(anchorRect),
      })

      const lastDelay = Math.max(0, entries.length - 1) * STAGGER_MS
      const fadeDuration = current.reducedMotion ? 200 : FLY_DURATION_MS
      schedule(() => finishIntro(runId), lastDelay + fadeDuration)
    }

    const runIntro = (includeDone: boolean) => {
      clearTimers()
      removeIntroListeners()
      removePeekListeners()
      setOverlay(null)

      const matches = findTargets().filter(({ step }) => includeDone || !isDone(step.id))
      if (!matches.length) {
        attachPeekListeners()
        return false
      }

      const runId = ++nextRunIdRef.current
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      setOverlay({
        runId,
        kind: "intro",
        phase: "entering",
        reducedMotion,
        flyToAnchor: false,
        entries: matches.map(({ step, target }) => createInitialEntry(step, target)),
      })

      for (const { step, target } of matches) {
        const handleClick = () => {
          markDone(step.id)
          setOverlay((current) => {
            if (!current || current.runId !== runId) return current
            return {
              ...current,
              entries: current.entries.map((entry) =>
                entry.step.id === step.id ? { ...entry, status: "fading" } : entry
              ),
            }
          })
          schedule(() => {
            setOverlay((current) => {
              if (!current || current.runId !== runId) return current
              return {
                ...current,
                entries: current.entries.filter((entry) => entry.step.id !== step.id),
              }
            })
          }, 200)
        }

        target.addEventListener("click", handleClick, { capture: true, once: true })
        introListenerCleanups.push(() => target.removeEventListener("click", handleClick, true))
      }

      schedule(() => retractIntro(runId), INTRO_VISIBLE_MS)
      return true
    }

    const replayGuide = () => runIntro(true)
    const runAutoIntro = () => {
      const isMobile = window.matchMedia("(max-width: 767px)").matches
      const autoStorageKey = `quick-guide:auto:${pageKey}`

      if (isMobile) {
        try {
          if (window.sessionStorage.getItem(autoStorageKey) === "1") return
        } catch {
          // The guide remains usable when session storage is unavailable.
        }
      }

      const didRender = runIntro(false)
      if (isMobile && didRender) {
        try {
          window.sessionStorage.setItem(autoStorageKey, "1")
        } catch {
          // The guide remains usable when session storage is unavailable.
        }
      }
    }

    window.addEventListener("quick-guide:replay", replayGuide)
    schedule(runAutoIntro, INTRO_DELAY_MS)

    return () => {
      clearTimers()
      removeIntroListeners()
      removePeekListeners()
      window.removeEventListener("quick-guide:replay", replayGuide)
      setOverlay(null)
    }
  }, [pageKey, portalNode, stableSteps])

  useEffect(() => {
    if (!overlay || overlay.phase === "retracting") return

    const { runId, phase } = overlay
    let showFrame = 0
    let positionFrame = window.requestAnimationFrame(() => {
      setOverlay((current) => {
        if (!current || current.runId !== runId || current.phase === "retracting") return current

        const entries = current.entries.map((entry) => {
          const callout = calloutNodesRef.current.get(entry.step.id)
          const calloutRect = callout?.getBoundingClientRect()
          return {
            ...entry,
            ...positionCallout(
              entry.step,
              entry.target.getBoundingClientRect(),
              calloutRect?.width ?? MAX_CALLOUT_WIDTH_PX,
              calloutRect?.height ?? ESTIMATED_CALLOUT_HEIGHT_PX,
              window.innerWidth,
              window.innerHeight
            ),
          }
        })
        return { ...current, entries }
      })

      if (phase === "entering") {
        showFrame = window.requestAnimationFrame(() => {
          setOverlay((current) =>
            current?.runId === runId ? { ...current, phase: "visible" } : current
          )
        })
      }
    })

    const reposition = () => {
      setOverlay((current) => {
        if (!current || current.runId !== runId || current.phase === "retracting") return current
        const entries = current.entries.map((entry) => {
          const callout = calloutNodesRef.current.get(entry.step.id)
          const calloutRect = callout?.getBoundingClientRect()
          return {
            ...entry,
            ...positionCallout(
              entry.step,
              entry.target.getBoundingClientRect(),
              calloutRect?.width ?? MAX_CALLOUT_WIDTH_PX,
              calloutRect?.height ?? ESTIMATED_CALLOUT_HEIGHT_PX,
              window.innerWidth,
              window.innerHeight
            ),
          }
        })
        return { ...current, entries }
      })
    }

    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, { passive: true })

    return () => {
      window.cancelAnimationFrame(positionFrame)
      window.cancelAnimationFrame(showFrame)
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition)
    }
  }, [overlay?.phase, overlay?.runId])

  if (!portalNode || !overlay) return null

  return createPortal(
    <div data-print-hidden className="pointer-events-none fixed inset-0 z-40">
      <style>{`
        @keyframes quick-guide-bob-up {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes quick-guide-bob-right {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(3px); }
        }
      `}</style>
      {overlay.entries.map((entry, index) => {
        const placement = entry.step.placement ?? "bottom"
        const retracting = overlay.phase === "retracting"
        const entering = overlay.phase === "entering"
        const fadeDuration = overlay.kind === "peek" ? 150 : 200
        const transitionDelay = retracting ? index * STAGGER_MS : 0
        const transform = retracting && !overlay.reducedMotion && overlay.flyToAnchor
          ? `translate(${entry.flyX}px, ${entry.flyY}px) scale(0.15)`
          : entering && !overlay.reducedMotion
            ? "scale(0.96)"
            : "none"
        const opacity = retracting || entering || entry.status === "fading" ? 0 : 1
        const transition = retracting
          ? `transform ${overlay.reducedMotion ? 200 : FLY_DURATION_MS}ms ease-in ${transitionDelay}ms, opacity ${overlay.reducedMotion ? 200 : FLY_DURATION_MS}ms ease-in ${transitionDelay}ms`
          : `opacity ${fadeDuration}ms ease-out, transform ${fadeDuration}ms ease-out`

        return (
          <div
            key={`${overlay.runId}:${entry.step.id}`}
            ref={(node) => {
              if (node) calloutNodesRef.current.set(entry.step.id, node)
              else calloutNodesRef.current.delete(entry.step.id)
            }}
            className="pointer-events-none fixed w-max max-w-56 rounded-lg border bg-card px-3 py-2 text-xs shadow-lg"
            style={{
              left: entry.left,
              top: entry.top,
              maxWidth: "min(14rem, calc(100vw - 16px))",
              opacity,
              transform,
              transformOrigin: "top left",
              transition,
            }}
          >
            {overlay.kind === "intro" ? (
              <span
                className={
                  placement === "bottom"
                    ? "pointer-events-none absolute -top-3 h-4 w-4 text-foreground"
                    : "pointer-events-none absolute -right-3 h-4 w-4 text-foreground"
                }
                style={arrowStyle(placement, entry.arrowOffset, overlay.reducedMotion)}
                aria-hidden="true"
              >
                {placement === "bottom" ? (
                  <ArrowUp className="h-4 w-4" />
                ) : (
                  <ArrowLeft className="h-4 w-4 rotate-180" />
                )}
              </span>
            ) : null}
            {entry.step.text}
          </div>
        )
      })}
    </div>,
    portalNode
  )
}

function createInitialEntry(step: QuickGuideStep, target: HTMLElement): CalloutEntry {
  return {
    step,
    target,
    left: VIEWPORT_PADDING_PX,
    top: VIEWPORT_PADDING_PX,
    arrowOffset: 16,
    status: "visible",
    flyX: 0,
    flyY: 0,
  }
}

function positionCallout(
  step: QuickGuideStep,
  targetRect: DOMRect,
  calloutWidth: number,
  calloutHeight: number,
  viewportWidth: number,
  viewportHeight: number
) {
  const placement = step.placement ?? "bottom"
  const targetCenterX = targetRect.left + targetRect.width / 2
  const targetCenterY = targetRect.top + targetRect.height / 2
  const maxLeft = Math.max(VIEWPORT_PADDING_PX, viewportWidth - calloutWidth - VIEWPORT_PADDING_PX)
  const maxTop = Math.max(VIEWPORT_PADDING_PX, viewportHeight - calloutHeight - VIEWPORT_PADDING_PX)

  if (placement === "left") {
    const left = clamp(
      targetRect.left - TARGET_GAP_PX - calloutWidth,
      VIEWPORT_PADDING_PX,
      maxLeft
    )
    const top = clamp(
      targetCenterY - calloutHeight / 2,
      VIEWPORT_PADDING_PX,
      maxTop
    )
    return {
      left,
      top,
      arrowOffset: clamp(targetCenterY - top - 8, 8, Math.max(8, calloutHeight - 24)),
    }
  }

  const left = clamp(
    targetCenterX - calloutWidth / 2,
    VIEWPORT_PADDING_PX,
    maxLeft
  )
  const top = clamp(
    targetRect.bottom + TARGET_GAP_PX,
    VIEWPORT_PADDING_PX,
    maxTop
  )
  return {
    left,
    top,
    arrowOffset: clamp(targetCenterX - left - 8, 8, Math.max(8, calloutWidth - 24)),
  }
}

function arrowStyle(
  placement: "bottom" | "left",
  offset: number,
  reducedMotion: boolean
): CSSProperties {
  if (placement === "left") {
    return {
      top: offset,
      animation: reducedMotion ? "none" : "quick-guide-bob-right 1s ease-in-out infinite",
    }
  }

  return {
    left: offset,
    animation: reducedMotion ? "none" : "quick-guide-bob-up 1s ease-in-out infinite",
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
