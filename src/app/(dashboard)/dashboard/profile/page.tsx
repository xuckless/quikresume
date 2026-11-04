// src/app/(dashboard)/dashboard/profile/page.tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation";
import { getUserProfile } from "@/app/actions/user-actions"
import { toPersonalInfo } from "@/lib/resume-mapper"
import { ProfileForm } from "@/components/ui/profile-form"
import { TopBar } from "@/components/ui/primitives/top-bar";

export default async function ProfilePage() {
    const session = await auth();
    if (!session?.user?.id) redirect("/login");

    const profile = await getUserProfile();
    const initial = toPersonalInfo(profile, session.user.name);

    return (
        <>
            <TopBar title="Profile" subtitle="Details that appear in the header of every résumé you generate." />
            <main className="p-4 pb-16 md:p-6">
                <div className="mx-auto max-w-5xl">
                    <ProfileForm
                        initial={initial}
                        initialLinks={profile?.links ?? []}
                        linkChecks={profile?.linkChecks ?? {}}
                        review={profile?.profileReview ?? null}
                        account={{ name: session.user.name ?? "", email: session.user.email ?? "", image: session.user.image ?? null }}
                    />
                </div>
            </main>
        </>
    )
}
