const COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-blue-100 text-blue-800',
  scraped: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  discarded: 'bg-slate-200 text-slate-600',
};

export function StatusPill({ status }: { status: string }) {
  const color = COLORS[status] ?? 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {status}
    </span>
  );
}
