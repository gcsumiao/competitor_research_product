import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function Loading() {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0 flex-1">
          <Bar className="h-7 w-56 mb-1" />
          <Bar className="h-5 w-80" />
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <Bar className="h-9 w-44" />
          <Bar className="h-9 w-40" />
          <Bar className="h-9 w-32" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="bg-card border border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-2">
                <Bar className="h-5 w-32" />
                <Bar className="w-8 h-8 rounded-lg" />
              </div>
              <div className="mb-1 h-9 flex items-center">
                <Bar className="h-7 w-12" />
              </div>
              <div className="mb-2" />
              <Bar className="h-4 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="bg-card border border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <Bar className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between h-5">
                  <div className="flex items-center gap-2">
                    <Bar className="w-4 h-4" />
                    <Bar className="h-5 w-24" />
                  </div>
                  <Bar className="h-5 w-6" />
                </div>
                <Bar className="h-2 w-full rounded-full" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <Bar className="h-6 w-40" />
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex items-center justify-between h-5">
                <Bar className="h-5 w-32" />
                <Bar className="h-5 w-20" />
              </div>
            ))}
            <Bar className="h-9 w-full" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="bg-card border border-border lg:col-span-2">
          <CardHeader className="pb-2">
            <Bar className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Bar className="h-4 w-24" />
                  <Bar className="h-9 w-full" />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} className="space-y-2">
                  <Bar className="h-4 w-28" />
                  <Bar className="h-9 w-full" />
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Bar className="h-4 w-24" />
              <Bar className="h-16 w-full" />
            </div>

            <div className="flex flex-wrap gap-2">
              <Bar className="h-9 w-32" />
              <Bar className="h-9 w-28" />
              <Bar className="h-9 w-28" />
              <Bar className="h-9 w-36" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border border-border">
          <CardHeader className="pb-2">
            <Bar className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index}>
                <Bar className="h-4 w-20" />
                <Bar className="h-5 w-40" />
              </div>
            ))}
            <Bar className="h-9 w-full" />
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Bar({ className }: { className: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted max-w-full", className)} />
}
