"use client"

import * as React from "react"
import Image, { type ImageProps } from "next/image"

import { cn } from "@/lib/utils"

function Avatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar"
      className={cn(
        "relative flex size-10 shrink-0 overflow-hidden rounded-full",
        className
      )}
      {...props}
    />
  )
}

function AvatarImage({
  className,
  alt = "",
  sizes = "40px",
  ...props
}: Omit<ImageProps, "alt" | "fill"> & { alt?: string }) {
  return (
    <Image
      data-slot="avatar-image"
      fill
      sizes={sizes}
      alt={alt}
      className={cn("aspect-square size-full object-cover", className)}
      unoptimized
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-fallback"
      className={cn(
        "bg-muted text-muted-foreground flex size-full items-center justify-center rounded-full text-sm font-medium",
        className
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarImage, AvatarFallback }
