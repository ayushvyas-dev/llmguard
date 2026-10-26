export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Top metric row skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-28 rounded-2xl glass-card p-6 border border-white/5 space-y-3">
            <div className="h-4 w-24 bg-slate-800 rounded-md" />
            <div className="h-8 w-32 bg-slate-700/50 rounded-md" />
          </div>
        ))}
      </div>

      {/* Main content skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-96 rounded-2xl glass-card p-6 border border-white/5 space-y-4">
          <div className="h-5 w-40 bg-slate-800 rounded-md" />
          <div className="h-72 bg-slate-800/30 rounded-xl" />
        </div>
        <div className="h-96 rounded-2xl glass-card p-6 border border-white/5 space-y-4">
          <div className="h-5 w-32 bg-slate-800 rounded-md" />
          <div className="space-y-3 pt-2">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="h-10 bg-slate-800/40 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
