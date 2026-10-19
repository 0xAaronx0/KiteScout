// Rendered by every admin page when ?key= is missing or wrong. The pages return this
// BEFORE their first Supabase query, so nothing from the DB reaches a visitor without the key.
export default function AdminLocked({ path }: { path: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
      <div className="max-w-md rounded-xl border border-slate-200 bg-white px-5 py-4 text-sm text-slate-700">
        <p className="font-semibold text-slate-900">🔒 Admin area</p>
        <p className="mt-1">
          Open this page with your admin key:{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded">{path}?key=…</code>
        </p>
      </div>
    </main>
  );
}
