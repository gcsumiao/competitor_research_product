"use client"

import type { ReactNode } from "react"
import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from "next/image"

export type TopProduct = {
  asin?: string
  name: string
  brand: string
  priceLabel: string
  revenueLabel: string
  image?: string
  url?: string
}

interface TopProductsProps {
  products: TopProduct[]
  title?: string
  subtitle?: string
  headerRight?: ReactNode
}

export function TopProducts({
  products,
  title = "Top Products",
  subtitle = "Revenue leaders in this snapshot",
  headerRight,
}: TopProductsProps) {
  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {headerRight}
      </CardHeader>
      <CardContent className="space-y-4">
        {products.map((product, index) => {
          const rowKey = getProductRowKey(product, index)
          return (
            <div key={rowKey} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden">
                  <TopProductImage key={`image-${rowKey}`} product={product} />
                </div>
                <div>
                  <p className="text-sm font-medium">{product.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {product.brand} | {product.priceLabel}
                  </p>
                </div>
              </div>
              <span className="text-sm font-medium">{product.revenueLabel}</span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

function TopProductImage({ product }: { product: TopProduct }) {
  const candidates = useMemo(() => resolveImageCandidates(product), [product])
  const [candidateIndex, setCandidateIndex] = useState(0)
  const safeIndex = Math.min(candidateIndex, candidates.length - 1)
  const src = candidates[safeIndex] ?? "/placeholder.svg"

  const image = (
    <Image
      src={src}
      alt={product.name}
      width={48}
      height={48}
      className="w-full h-full object-cover"
      unoptimized
      onError={() => {
        if (candidateIndex < candidates.length - 1) {
          setCandidateIndex((current) => current + 1)
        }
      }}
    />
  )

  if (product.url) {
    return (
      <a href={product.url} target="_blank" rel="noreferrer" aria-label={`View ${product.name}`}>
        {image}
      </a>
    )
  }

  return image
}

function resolveImageCandidates(product: TopProduct) {
  const values: string[] = []
  const image = product.image?.trim()
  if (image) {
    values.push(image)
  }

  const asin = product.asin?.trim().toUpperCase() || extractAsin(product.url)
  if (asin) {
    values.push(`https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`)
    values.push(`https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`)
    values.push(`https://m.media-amazon.com/images/P/${asin}.01._SL160_.jpg`)
    values.push(`https://m.media-amazon.com/images/P/${asin}.01._AC_UL160_.jpg`)
  }

  values.push("/placeholder.svg")

  const unique: string[] = []
  for (const value of values) {
    if (!unique.includes(value)) unique.push(value)
  }
  return unique
}

function extractAsin(url?: string) {
  if (!url) return null
  const direct = url.trim().match(/^[A-Z0-9]{10}$/i)
  if (direct) return direct[0].toUpperCase()

  const match = url.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/i)
  return match?.[1]?.toUpperCase() ?? null
}

function getProductRowKey(product: TopProduct, index: number) {
  const asin = product.asin?.trim().toUpperCase() || extractAsin(product.url)
  if (asin) return `${asin}-${index}`
  if (product.url) return `${product.url}-${index}`
  return `${product.brand}-${product.name}-${index}`
}
