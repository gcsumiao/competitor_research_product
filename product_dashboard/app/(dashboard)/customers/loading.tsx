import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const RANK_GRID_COLUMNS = "100px repeat(6, minmax(130px, 1fr)) minmax(150px, 1fr)"

export default function Loading() {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="min-w-0 flex-1">
          <Bar className="h-7 w-40 mb-1" />
          <Bar className="h-5 w-80" />
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <Bar className="h-9 w-44" />
          <Bar className="h-9 w-40" />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1">
        <div>
          <Card className="bg-card border-border">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <Bar className="h-6 w-36" />
                <div className="flex items-center gap-2 mt-1 h-9">
                  <Bar className="h-7 w-40" />
                  <Bar className="h-5 w-16 rounded-full" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6 mb-4 h-4">
                <div className="flex items-center gap-2">
                  <Bar className="w-3 h-3 rounded-full" />
                  <Bar className="h-4 w-20" />
                </div>
                <div className="flex items-center gap-2">
                  <Bar className="w-3 h-3 rounded-full" />
                  <Bar className="h-4 w-24" />
                </div>
              </div>
              <Bar className="h-[200px] w-full rounded-lg" />
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mb-6">
        <Card className="bg-card border border-border">
          <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
            <div>
              <Bar className="h-6 w-56" />
            </div>
            <Bar className="h-7 w-32 rounded-full" />
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg bg-background/20">
              <div className="min-w-[820px]">
                <div className="grid" style={{ gridTemplateColumns: RANK_GRID_COLUMNS }}>
                  <div className="px-3 py-2">
                    <Bar className="h-4 w-14" />
                  </div>
                  {Array.from({ length: 6 }, (_, index) => (
                    <div key={index} className="px-2 py-2 flex items-center justify-center">
                      <Bar className="h-4 w-16" />
                    </div>
                  ))}
                  <div className="px-2 py-2 flex items-center justify-center">
                    <Bar className="h-4 w-20" />
                  </div>
                </div>

                <div className="space-y-1 pt-1">
                  {Array.from({ length: 20 }, (_, rowIndex) => (
                    <div
                      key={rowIndex}
                      className={cn(
                        "grid items-center rounded-md",
                        rowIndex < 5 ? "bg-muted/35" : "bg-transparent"
                      )}
                      style={{ gridTemplateColumns: RANK_GRID_COLUMNS }}
                    >
                      <div className="px-3 py-2 min-h-[40px] flex items-center">
                        <Bar className="h-4 w-8" />
                      </div>
                      {Array.from({ length: 6 }, (_, cellIndex) => (
                        <div
                          key={cellIndex}
                          className="px-2 py-2 min-h-[40px] flex items-center justify-center"
                        >
                          <Bar className="h-[26px] w-24 rounded-full" />
                        </div>
                      ))}
                      <div className="px-2 py-2 min-h-[40px] flex items-center justify-center">
                        <Bar className="h-4 w-24" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Bar({ className }: { className: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted max-w-full", className)} />
}
