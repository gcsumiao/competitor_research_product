import { Mail, ShieldCheck, UserRound } from "lucide-react"

import { PageHeader } from "@/components/dashboard/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { getDashboardUser } from "@/lib/cloudflare-access"

export default async function ProfilePage() {
  const user = await getDashboardUser()
  const initials = initialsFor(user.displayName, user.email)

  return (
    <>
      <PageHeader title="Profile" description="Your identity is managed by Microsoft Entra ID." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="border border-border bg-card">
          <CardContent className="p-6">
            <div className="flex flex-col items-center text-center">
              <Avatar className="mb-4 h-24 w-24">
                <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
              </Avatar>
              <h2 className="text-xl font-semibold">{user.displayName}</h2>
              <p className="mt-1 break-all text-sm text-muted-foreground">{user.email}</p>
              <Badge className="mt-3 bg-[var(--color-accent)] capitalize text-foreground hover:bg-[var(--color-accent)]/90">
                {user.role}
              </Badge>

              <Separator className="my-6" />

              <div className="w-full space-y-4 text-left">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-all text-sm">{user.email}</span>
                </div>
                <div className="flex items-center gap-3">
                  <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm">Microsoft Entra ID</span>
                </div>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm capitalize">{user.role} access</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-2">
          <Card className="border border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium">Personal Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ReadOnlyField label="First Name" value={user.firstName} />
              <ReadOnlyField label="Last Name" value={user.lastName} />
              <div className="sm:col-span-2">
                <ReadOnlyField label="Email Address" value={user.email} />
              </div>
              <ReadOnlyField label="Role" value={capitalize(user.role)} />
              <ReadOnlyField label="Identity Provider" value="Microsoft Entra ID" />
            </CardContent>
          </Card>

          <Card className="border border-border bg-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-base font-medium">Security</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4">
                <div className="rounded-lg bg-background p-2">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Managed by Microsoft Entra ID</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Password, multi-factor authentication, and account recovery are managed by
                    your organization. Contact your Microsoft Entra administrator to make changes.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

function ReadOnlyField({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      <div className="min-h-11 rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm">
        {value || <span className="text-muted-foreground">Not provided by Microsoft Entra ID</span>}
      </div>
    </div>
  )
}

function initialsFor(name: string, email: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || email.charAt(0).toUpperCase() || "U"
  )
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
