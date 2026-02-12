"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { MoreHorizontal } from "lucide-react"

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
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {products.map((product, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden">
                {product.url ? (
                  <a href={product.url} target="_blank" rel="noreferrer" aria-label={`View ${product.name}`}>
                    <img
                      src={product.image || "/placeholder.svg"}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </a>
                ) : (
                  <img
                    src={product.image || "/placeholder.svg"}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                )}
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
