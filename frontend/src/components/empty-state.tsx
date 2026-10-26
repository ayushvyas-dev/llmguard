import React from "react";
import { FolderOpen } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title,
  description,
  icon: Icon = FolderOpen,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="p-12 text-center glass-card rounded-2xl border border-white/5 space-y-4">
      <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-white/10 text-slate-400 mx-auto flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-400" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-white">{title}</h3>
        <p className="text-sm text-slate-400 max-w-sm mx-auto">{description}</p>
      </div>
      {actionLabel && onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            className="px-4 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-sm font-medium transition-all cursor-pointer"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
