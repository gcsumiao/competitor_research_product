import type { ReactNode } from "react"
import { DashboardChatbot } from "@/components/chatbot/dashboard-chatbot"
import { Header } from "@/components/dashboard/header"

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="max-w-[1400px] mx-auto">
        <Header />
        {children}
        <DashboardChatbot />
      </div>
    </div>
  )
}
