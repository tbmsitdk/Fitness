'use client';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Maximize2, X } from 'lucide-react';

interface Props {
  title: React.ReactNode;
  headerRight?: React.ReactNode;
  /** Render-prop: receives `expanded` so charts can use a taller height when maximised */
  children: (expanded: boolean) => React.ReactNode;
}

export default function ExpandableCard({ title, headerRight, children }: Props) {
  const [expanded, setExpanded] = useState(false);

  const close = useCallback(() => setExpanded(false), []);

  // Close on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded, close]);

  // Prevent body scroll while expanded
  useEffect(() => {
    document.body.style.overflow = expanded ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [expanded]);

  const modal = expanded && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          role="dialog"
          aria-modal="true"
        >
          {/* Modal header */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
            <span className="text-sm font-semibold">{title}</span>
            <div className="flex items-center gap-2">
              {headerRight}
              <Button variant="ghost" size="sm" onClick={close} className="gap-1.5">
                <X className="w-3.5 h-3.5" />
                <span className="text-xs">Close</span>
              </Button>
            </div>
          </div>
          {/* Chart content — takes all remaining height */}
          <div className="flex-1 overflow-auto p-6">
            {children(true)}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Card>
        <CardHeader className="flex-row items-center justify-between pb-2">
          <CardTitle>{title}</CardTitle>
          <div className="flex items-center gap-1">
            {headerRight}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded(true)}
              title="Maximise"
              className="opacity-50 hover:opacity-100 transition-opacity"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>{children(false)}</CardContent>
      </Card>
      {modal}
    </>
  );
}
