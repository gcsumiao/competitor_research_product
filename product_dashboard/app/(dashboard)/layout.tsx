import type { ReactNode } from "react"
import { Suspense } from "react"
import { DashboardChatbot } from "@/components/chatbot/dashboard-chatbot"
import { Header } from "@/components/dashboard/header"
import { SpotlightAlerts } from "@/components/dashboard/spotlight-alerts"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="max-w-[1400px] mx-auto">
        <Suspense fallback={null}>
          <Header />
        </Suspense>
        <Suspense fallback={null}>
          <SpotlightAlerts />
        </Suspense>
        {children}
        <Suspense fallback={null}>
          <DashboardChatbot />
        </Suspense>
      </div>
    </div>
  )
}
