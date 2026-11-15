'use client';
import { useEffect, useState } from 'react';
import { NotebookPen, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { MemoryFile } from '@/lib/coach-memory';

/** Everything the coach has written down about you, readable and deletable. */
export default function CoachMemory() {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/coach-memory')
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then(j => setFiles(j.files ?? []))
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function remove(path: string) {
    setError('');
    try {
      const res = await fetch(`/api/coach-memory?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setFiles(prev => (prev ?? []).filter(f => f.path !== path));
    } catch (e) {
      setError(`Could not delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 space-y-2">
          <div className="flex items-center gap-2">
            <NotebookPen className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">What the coach remembers</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Notes the coach keeps between conversations: what it advised, what you said you would do, what to follow up on.
            Files under advice/ are written automatically after each report and review. Delete anything you do not want kept.
          </p>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </CardContent>
      </Card>

      {files && files.length === 0 && !error && (
        <p className="text-xs text-muted-foreground text-center py-6">Nothing saved yet.</p>
      )}

      {files?.map(f => (
        <Card key={f.path}>
          <CardContent className="pt-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-mono break-all">{f.path.replace(/^\/memories\//, '')}</p>
                <p className="text-[11px] text-muted-foreground">Updated {new Date(f.updated_at).toLocaleDateString()}</p>
              </div>
              <button onClick={() => remove(f.path)} title="Delete this note" aria-label="Delete this note"
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-secondary flex-shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground whitespace-pre-wrap">{f.content}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
