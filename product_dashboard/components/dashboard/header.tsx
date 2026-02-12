"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Bell, ChevronDown } from "lucide-react"
import { useState } from "react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Brands", href: "/customers" },
  { label: "Top 50", href: "/sales" },
  { label: "Types", href: "/specs" },
  { label: "Market Survey", href: "/orders" },
  { label: "Consult Me", href: "/consult-me" },
]

export function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const [optimisticNav, setOptimisticNav] = useState<{ href: string; fromPath: string } | null>(null)

  const buildHref = (href: string) => (queryString ? `${href}?${queryString}` : href)

  const isActive = (href: string) => {
    if (optimisticNav && optimisticNav.fromPath === pathname) {
      if (optimisticNav.href === "/") return href === "/"
      return optimisticNav.href.startsWith(href)
    }
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  return (
    <header className="flex items-center justify-between mb-8">
      <Link href="/" className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <div className="w-5 h-0.5 bg-foreground" />
          <div className="w-5 h-0.5 bg-foreground" />
          <div className="w-3 h-0.5 bg-foreground" />
        </div>
        <span className="text-xl font-semibold">Product Market Research Dashboard</span>
      </Link>

      <nav className="hidden md:flex items-center bg-card rounded-full px-2 py-1.5 border border-border">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={buildHref(item.href)}
            onClick={() => setOptimisticNav({ href: item.href, fromPath: pathname })}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              isActive(item.href)
                ? "bg-[var(--color-accent)] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-full">
          <Bell className="w-5 h-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 cursor-pointer">
            <Avatar className="h-9 w-9">
              <AvatarImage src="/favicon.ico" />
              <AvatarFallback>OS</AvatarFallback>
            </Avatar>
            <div className="hidden sm:block text-left">
              <p className="text-sm font-medium">Ginny Chen</p>
              <p className="text-xs text-muted-foreground">Admin</p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground hidden sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(buildHref("/profile"))}>
              Profile
            </DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
