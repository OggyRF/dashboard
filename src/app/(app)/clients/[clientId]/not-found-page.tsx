import Link from "next/link";

export function notFoundPage() {
  return (
    <div className="card mx-auto max-w-xl text-center">
      <h1 className="text-lg font-bold">Client not found</h1>
      <p className="mt-1 text-sm text-muted">It may have been removed, or you are not on this client&apos;s team.</p>
      <Link href="/" className="btn-secondary mt-4">Go home</Link>
    </div>
  );
}
