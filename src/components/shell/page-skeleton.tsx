// Instant placeholder for signed-in pages while the server renders them (the route loading.tsx files).
// Shapes only: the real TopBar and content replace it as soon as the page streams in.

export function PageSkeleton() {
    return (
        <div aria-busy="true" aria-label="Loading" className="flex-1">
            <div className="sticky top-0 z-20 flex h-14 items-center border-b border-border bg-bg/85 px-4 md:px-6">
                <div className="h-5 w-40 shimmer rounded-md bg-surface-muted" />
            </div>
            <div className="space-y-3 p-4 md:p-6">
                <div className="h-9 w-72 max-w-full shimmer rounded-md bg-surface-muted" />
                {[0, 1, 2, 3].map(i => (
                    <div key={i} className="h-16 shimmer rounded-lg border border-border bg-surface" />
                ))}
            </div>
        </div>
    );
}
