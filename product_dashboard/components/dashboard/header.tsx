"use client"

import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { ChevronDown, CircleHelp, X } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DashboardUser } from "@/lib/cloudflare-access-core"

const navItems = [
  { label: "Dashboard", href: "/" },
  { label: "Brands", href: "/customers" },
  { label: "Top 50", href: "/sales" },
  { label: "Types", href: "/specs" },
  { label: "Consult Me", href: "/consult-me" },
  { label: "Market Survey", href: "/orders" },
]

export function Header({ user }: { user: DashboardUser }) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryString = searchParams.toString()
  const [menuOpen, setMenuOpen] = useState(false)

  const buildHref = (href: string) => (queryString ? `${href}?${queryString}` : href)

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/"
    return pathname.startsWith(href)
  }

  useEffect(() => {
    if (!menuOpen) return

    const previousOverflow = document.documentElement.style.overflow
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false)
    }

    document.documentElement.style.overflow = "hidden"
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.documentElement.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [menuOpen])

  return (
    <header data-print-hidden className="flex items-center justify-between mb-8">
      <div className="flex items-center gap-2 md:hidden">
        <button
          type="button"
          className="md:hidden"
          aria-label="Open page menu"
          aria-expanded={menuOpen}
          data-guide="menu"
          onClick={() => setMenuOpen(true)}
        >
          <div className="flex flex-col gap-1">
            <div className="w-5 h-0.5 bg-foreground" />
            <div className="w-5 h-0.5 bg-foreground" />
            <div className="w-3 h-0.5 bg-foreground" />
          </div>
        </button>
        <Link href="/" className="md:hidden">
          <span className="text-xl font-semibold">Product Market Research Dashboard</span>
        </Link>
      </div>

      <Link href="/" className="hidden md:flex items-center gap-2">
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
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Replay page guide"
          title="Page guide"
          data-guide-anchor
          onClick={() => window.dispatchEvent(new CustomEvent("quick-guide:replay"))}
        >
          <CircleHelp className="w-5 h-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 cursor-pointer">
            <Avatar className="h-9 w-9">
              <AvatarFallback>{initialsFor(user.displayName, user.email)}</AvatarFallback>
            </Avatar>
            <div className="hidden sm:block text-left">
              <p className="max-w-40 truncate text-sm font-medium">{user.displayName}</p>
              <p className="text-xs capitalize text-muted-foreground">{user.role}</p>
            </div>
            <ChevronDown className="w-4 h-4 text-muted-foreground hidden sm:block" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => router.push(buildHref("/profile"))}>
              Profile
            </DropdownMenuItem>
            {user.role === "admin" ? <DropdownMenuItem>Settings</DropdownMenuItem> : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => window.location.assign("/cdn-cgi/access/logout")}
            >
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {menuOpen ? (
        <div className="md:hidden">
          <div
            className="fixed inset-0 z-50 bg-black/40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 z-50 w-72 max-w-[80vw] bg-card border-r border-border p-4 flex flex-col gap-1 shadow-xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-muted-foreground">Pages</span>
              <button type="button" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={buildHref(item.href)}
                className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive(item.href)
                    ? "bg-[var(--color-accent)] text-foreground"
                    : "text-muted-foreground"
                }`}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </header>
  )
}

function initialsFor(name: string, email: string) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
  return initials || email.charAt(0).toUpperCase() || "U"
}
