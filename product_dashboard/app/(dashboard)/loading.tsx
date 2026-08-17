import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export default function Loading() {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0 flex-1">
          <Bar className="h-7 w-72 mb-1" />
          <Bar className="h-5 w-96" />
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <Bar className="h-9 w-44" />
          <Bar className="h-9 w-40" />
          <Bar className="h-9 w-36" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="bg-card border border-border">
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-2">
                <Bar className="h-5 w-36" />
                <Bar className="w-8 h-8 rounded-lg" />
              </div>
              <div className="mb-1 h-9 flex items-center">
                <Bar className="h-7 w-24" />
              </div>
              <Bar className="h-4 w-28 mb-2" />
              <Bar className="h-4 w-44" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <Card className="bg-card border-border h-full">
            <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Bar className="h-5 w-40 mb-1" />
                <Bar className="h-4 w-56" />
              </div>
              <Bar className="h-7 w-36 rounded-full" />
            </CardHeader>
            <CardContent>
              <div className="mb-3 grid grid-cols-2 gap-4">
                {Array.from({ length: 2 }, (_, index) => (
                  <div key={index}>
                    <Bar className="h-4 w-40" />
                    <div className="mt-1 h-8 flex items-center">
                      <Bar className="h-7 w-28" />
                    </div>
                  </div>
                ))}
              </div>
              <Bar className="h-[226px] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
        <div>
          <Card className="bg-card border-border h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <Bar className="h-5 w-24 mb-1" />
                <Bar className="h-4 w-44" />
              </div>
              <Bar className="h-7 w-32 rounded-full" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Bar className="w-12 h-12 rounded-lg" />
                    <div>
                      <Bar className="h-5 w-40 mb-1" />
                      <Bar className="h-4 w-24" />
                    </div>
                  </div>
                  <Bar className="h-5 w-14" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="h-full">
          <Card className="bg-card border-border h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <Bar className="h-5 w-32 mb-1" />
                <Bar className="h-4 w-52" />
              </div>
              <Bar className="h-7 w-32 rounded-full" />
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <Bar className="h-4 w-36" />
                <div className="h-9 flex items-center">
                  <Bar className="h-7 w-32" />
                </div>
                <div className="flex items-center gap-2 mt-1 h-5">
                  <Bar className="h-5 w-20 rounded-full" />
                  <Bar className="h-4 w-24" />
                </div>
              </div>
              <Bar className="h-[120px] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 h-full">
          <Card className="bg-card border-border h-full">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <Bar className="h-5 w-32 mb-1" />
                <Bar className="h-4 w-48" />
              </div>
              <div className="flex items-center gap-2">
                <Bar className="h-7 w-32 rounded-full" />
                <Bar className="h-7 w-[124px]" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <div>
                    <Bar className="h-4 w-20" />
                    <div className="h-8 flex items-center">
                      <Bar className="h-7 w-28" />
                    </div>
                    <Bar className="h-4 w-24" />
                  </div>
                  <div>
                    <Bar className="h-4 w-32" />
                    <div className="h-8 flex items-center">
                      <Bar className="h-7 w-24" />
                    </div>
                    <Bar className="h-4 w-24" />
                    <div className="mt-1 h-6 flex items-center">
                      <Bar className="h-5 w-20" />
                    </div>
                    <Bar className="h-4 w-24" />
                  </div>
                  <div>
                    <Bar className="h-4 w-24" />
                    <div className="h-8 flex items-center">
                      <Bar className="h-7 w-28" />
                    </div>
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="h-[180px] flex items-center justify-center">
                    <Bar className="w-full max-w-40 aspect-square rounded-full" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {Array.from({ length: 4 }, (_, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Bar className="w-2.5 h-2.5 rounded-full" />
                        <Bar className="h-4 w-20" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

function Bar({ className }: { className: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted max-w-full", className)} />
}
