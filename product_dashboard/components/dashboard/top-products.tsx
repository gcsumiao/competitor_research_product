"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import Image from "next/image"

export type TopProduct = {
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
}

export function TopProducts({ products, title = "Top Products", subtitle = "Revenue leaders in this snapshot" }: TopProductsProps) {
  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {products.map((product, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden">
                <TopProductImage product={product} />
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
        ))}
      </CardContent>
    </Card>
  )
}

function TopProductImage({ product }: { product: TopProduct }) {
  const initialSrc = useMemo(() => resolveImageSrc(product), [product])
  const [src, setSrc] = useState(initialSrc)

  const image = (
    <Image
      src={src}
      alt={product.name}
      width={48}
      height={48}
      className="w-full h-full object-cover"
      unoptimized
      onError={() => {
        if (src !== "/placeholder.svg") {
          setSrc("/placeholder.svg")
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

function resolveImageSrc(product: TopProduct) {
  if (product.image && product.image.trim()) {
    return product.image.trim()
  }

  const asin = extractAsin(product.url)
  if (asin) {
    return `https://m.media-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`
  }

  return "/placeholder.svg"
}

function extractAsin(url?: string) {
  if (!url) return null
  const direct = url.trim().match(/^[A-Z0-9]{10}$/i)
  if (direct) return direct[0].toUpperCase()

  const match = url.match(/(?:\/dp\/|\/gp\/product\/)([A-Z0-9]{10})/i)
  return match?.[1]?.toUpperCase() ?? null
}
