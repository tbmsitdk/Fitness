'use client';
import { useRef, useState } from 'react';
import { Camera, Check, Loader2, PencilLine, X } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useDataRefresh } from '@/lib/data-refresh';
import { MAX_IMAGES, MAX_TEXT_LENGTH, type QuickLogProposal } from '@/lib/quick-log';

interface Photo { name: string; mediaType: 'image/jpeg'; data: string; preview: string }

/** Shrinks a photo in the browser: a label is readable at 1600px, and the upload stays small. */
async function shrink(file: File): Promise<Photo> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a photo this browser can read.'));
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { name: file.name, mediaType: 'image/jpeg', data: dataUrl.split(',')[1], preview: dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const when = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Log food, drink, exercises or a trip from a sentence or a photo. Nothing is saved until confirmed. */
export default function QuickLog() {
  const { refreshData } = useDataRefresh();
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [proposal, setProposal] = useState<QuickLogProposal | null>(null);
  const [busy, setBusy] = useState<'reading' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function addPhotos(files: FileList | null) {
    setError('');
    try {
      const next = await Promise.all(Array.from(files ?? []).slice(0, MAX_IMAGES - photos.length).map(shrink));
      setPhotos(prev => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function read() {
    setBusy('reading'); setError(''); setDone(''); setProposal(null);
    try {
      const res = await fetch('/api/quick-log', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, images: photos.map(p => ({ mediaType: p.mediaType, data: p.data })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setProposal(json.proposal);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  }

  async function save() {
    if (!proposal) return;
    setBusy('saving'); setError('');
    const post = async (url: string, body: unknown) => {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    };
    let saved = 0;
    try {
      // The ordinary routes do the saving, with their own validation.
      for (const d of proposal.days.filter(savable)) { await post('/api/meals', { date: d.date, meals: d.meals, no_alcohol: d.noAlcohol, ...(d.complete ? { complete: true } : {}) }); saved++; }
      for (const e of proposal.exercises) { await post('/api/exercises', { date: e.date, entries: e.entries }); saved++; }
      for (const t of proposal.trips) { await post('/api/travel', t.payload); saved++; }
      setDone(`Saved ${saved} ${saved === 1 ? 'entry' : 'entries'}.`);
      setProposal(null); setText(''); setPhotos([]);
      await refreshData();
    } catch (e) {
      setError(`${saved > 0 ? `${saved} saved, then it failed` : 'Nothing was saved'}: ${e instanceof Error ? e.message : String(e)}`);
      if (saved > 0) await refreshData();
    } finally { setBusy(null); }
  }

  /** The person says a flagged entry really is a second helping: move it into the meals to save. */
  function addAnyway(date: string, index: number) {
    setProposal(prev => prev && {
      ...prev,
      days: prev.days.map(d => {
        if (d.date !== date) return d;
        const dup = d.duplicates[index];
        return { ...d, meals: [...d.meals, dup.meal], lines: [...d.lines, dup.line], duplicates: d.duplicates.filter((_, i) => i !== index) };
      }),
    });
  }

  // A day that holds only flagged repeats has nothing to save.
  const savable = (d: QuickLogProposal['days'][number]) => d.meals.length > 0 || d.noAlcohol || d.complete;
  const nothing = proposal && proposal.days.filter(savable).length + proposal.exercises.length + proposal.trips.length === 0;

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center gap-2">
          <PencilLine className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Quick log</span>
          <span className="text-[11px] text-muted-foreground">what you ate and drank, exercises or a trip — in a sentence or a photo</span>
        </div>

        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={e => setText(e.target.value.slice(0, MAX_TEXT_LENGTH))}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !busy) read(); }}
            rows={2}
            placeholder="e.g. lunch: chicken salad and a roll · two glasses of red with dinner at 19:30 · that's everything for today · 2 x 20 s dead hang"
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <div className="flex flex-col gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addPhotos(e.target.files)} />
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={photos.length >= MAX_IMAGES || busy !== null}>
              <Camera className="w-3.5 h-3.5 mr-1.5" />Photo
            </Button>
            <Button size="sm" onClick={read} disabled={busy !== null || (!text.trim() && photos.length === 0)}>
              {busy === 'reading' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}Read
            </Button>
          </div>
        </div>

        {photos.length > 0 && (
          <div className="flex gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt={p.name} className="h-16 w-16 object-cover rounded-md border border-border" />
                <button onClick={() => setPhotos(prev => prev.filter((_, j) => j !== i))} aria-label="Remove photo"
                  className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
        {done && <p className="text-xs text-green-400 flex items-center gap-1.5"><Check className="w-3 h-3" />{done}</p>}

        {proposal && (
          <div className="rounded-md border border-border p-3 space-y-3">
            {proposal.understood && <p className="text-xs text-muted-foreground">{proposal.understood}</p>}

            {proposal.days.map(d => (
              <div key={d.date}>
                <p className="text-xs font-medium">Meal diary, {when(d.date)}</p>
                <ul className="mt-1 space-y-0.5">
                  {d.lines.map((l, i) => <li key={i} className="text-xs text-muted-foreground">{l}</li>)}
                  {d.duplicates.map((dup, i) => (
                    <li key={`dup-${i}`} className="text-xs text-amber-400 flex items-start justify-between gap-2">
                      <span>Already in the diary, not added again: {dup.line}</span>
                      <button onClick={() => addAnyway(d.date, i)} className="underline flex-shrink-0 hover:text-foreground">Add anyway</button>
                    </li>
                  ))}
                  {d.noAlcohol && <li className="text-xs text-muted-foreground">No alcohol this day</li>}
                  {d.complete && <li className="text-xs text-muted-foreground">Marks the day as complete: totals will count</li>}
                </ul>
              </div>
            ))}
            {proposal.exercises.map(e => (
              <div key={e.date}>
                <p className="text-xs font-medium">Exercises, {when(e.date)}</p>
                <ul className="mt-1 space-y-0.5">{e.lines.map(l => <li key={l} className="text-xs text-muted-foreground">{l}</li>)}</ul>
              </div>
            ))}
            {proposal.trips.map(t => (
              <div key={t.line}>
                <p className="text-xs font-medium">Trip</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.line}</p>
              </div>
            ))}

            {proposal.questions.length > 0 && (
              <ul className="space-y-0.5">{proposal.questions.map(q => <li key={q} className="text-xs text-amber-400">{q}</li>)}</ul>
            )}
            {nothing && proposal.questions.length === 0 && <p className="text-xs text-muted-foreground">Nothing to log from that.</p>}
            {proposal.days.some(d => d.meals.length > 0) && (
              <p className="text-[11px] text-muted-foreground/70">Amounts are estimates. You can adjust a portion or delete a meal in the meal diary afterwards.</p>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setProposal(null)} disabled={busy !== null}>Discard</Button>
              {!nothing && (
                <Button size="sm" onClick={save} disabled={busy !== null}>
                  {busy === 'saving' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1.5" />}Save
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
