// the backend stops counting at 100 so the status bar stays cheap on messy repos
export function formatCount(n: number): string {
    return n >= 100 ? "99+" : String(n);
}
