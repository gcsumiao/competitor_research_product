"use client"

import { useEffect, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import type { DashboardData, CategorySummary, SnapshotSummary } from "@/lib/competitor-data"

export type DashboardFilters = {
  categories: CategorySummary[]
  selectedCategory: CategorySummary | undefined
  selectedSnapshot: SnapshotSummary | undefined
  snapshots: SnapshotSummary[]
  setCategory: (id: string) => void
  setSnapshot: (date: string) => void
}

export function useDashboardFilters(data: DashboardData): DashboardFilters {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const categories = useMemo(
    () =>
      [...data.categories]
        .filter((category) => category.snapshots.length > 0)
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data]
  )
  const defaultCategory = categories[0]

  const paramCategory = searchParams.get("category")
  const selectedCategory = useMemo(() => {
    if (!categories.length) return undefined
    return categories.find((category) => category.id === paramCategory) ?? defaultCategory
  }, [categories, defaultCategory, paramCategory])

  const snapshots = useMemo(
    () => selectedCategory?.snapshots ?? [],
    [selectedCategory]
  )
  const defaultSnapshot = snapshots[snapshots.length - 1]
  const paramSnapshot = searchParams.get("snapshot")

  const selectedSnapshot = useMemo(() => {
    if (!snapshots.length) return undefined
    return snapshots.find((snapshot) => snapshot.date === paramSnapshot) ?? defaultSnapshot
  }, [defaultSnapshot, paramSnapshot, snapshots])

  useEffect(() => {
    if (!selectedCategory || !selectedSnapshot) return

    const params = new URLSearchParams(searchParams)
    const nextCategory = selectedCategory.id
    const nextSnapshot = selectedSnapshot.date
    const needsUpdate =
      params.get("category") !== nextCategory || params.get("snapshot") !== nextSnapshot

    if (needsUpdate) {
      params.set("category", nextCategory)
      params.set("snapshot", nextSnapshot)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }, [pathname, router, searchParams, selectedCategory, selectedSnapshot])

  const setCategory = (id: string) => {
    const nextCategory = categories.find((category) => category.id === id) ?? defaultCategory
    if (!nextCategory) return
    const nextSnapshot = nextCategory.snapshots[nextCategory.snapshots.length - 1]
    const params = new URLSearchParams(searchParams)
    params.set("category", nextCategory.id)
    if (nextSnapshot) {
      params.set("snapshot", nextSnapshot.date)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const setSnapshot = (date: string) => {
    const params = new URLSearchParams(searchParams)
    if (selectedCategory) {
      params.set("category", selectedCategory.id)
    }
    params.set("snapshot", date)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return {
    categories,
    selectedCategory,
    selectedSnapshot,
    snapshots,
    setCategory,
    setSnapshot,
  }
}
