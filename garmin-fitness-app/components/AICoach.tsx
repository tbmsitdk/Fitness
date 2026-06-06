'use client';
import { useState, useEffect, useRef } from 'react';
import { Activity, WellnessRecord, AISummary, ChatMessage, ChatFile } from '@/types';
import { Bot, Send, RefreshCw, AlertTriangle, TrendingUp, Shield, Heart, Paperclip, X, FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { UserSettings } from '@/lib/settings';

interface Props { activities: Activity[]; wellness: WellnessRecord[]; settings?: UserSettings; }

const QUICK = [
  'Am I overtraining?','How should I structure next week?',
  'How is my aerobic base developing?','What does my Zone 2 look like?',
  'Am I recovering enough?','How is my fitness trending?',
];

function Prose({ text }: { text: string }) {
  const html = text
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/^## (.*?)$/gm,'<h2>$1</h2>')
    .replace(/^- (.*?)$/gm,'<li>$1</li>')
    .replace(/\n\n/g,'</p><p>');
  return <div className="ai-prose text-sm" dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}

export default function AICoach({ activities, wellness, settings }: Props) {
  const [section, setSection] = useState<'chat'|'summary'>('chat');
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [loading, setLoading] = useState(false);  // not auto-started
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [attachedFile, setAttachedFile] = useState<ChatFile | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function fetchSummary(invalidate = false) {
    setLoading(true); setError('');
    try {
      if (invalidate) await fetch('/api/ai-summary', { method: 'DELETE' });
      const res = await fetch('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSummary(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1];
      setAttachedFile({ name: file.name, mediaType: file.type, data: base64 });
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  async function send(text: string) {
    if (!text.trim() && !attachedFile || chatLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim(), file: attachedFile ?? undefined };
    const updated = [...messages, userMsg];
    setMessages([...updated, { role: 'assistant', content: '' }]);
    setInput(''); setAttachedFile(null); setChatLoading(true);
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: updated, settings }) });
      if (!res.ok || !res.body) throw new Error('Chat failed');
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6); if (d === '[DONE]') break;
          try { const { text: chunk } = JSON.parse(d); if (chunk) setMessages(prev => { const m = [...prev]; m[m.length-1] = { role: 'assistant', content: m[m.length-1].content + chunk }; return m; }); } catch { /* skip */ }
        }
      }
    } catch { setMessages(prev => { const m = [...prev]; m[m.length-1] = { role: 'assistant', content: 'Something went wrong. Please try again.' }; return m; }); }
    finally { setChatLoading(false); }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Section tabs */}
      <div className="flex border-b border-border">
        {([
          { id: 'chat',    label: 'Chat'            },
          { id: 'summary', label: 'Coaching Report' },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setSection(t.id)} className={cn(
            'px-4 py-2.5 text-xs font-medium border-b-2 transition-colors -mb-px',
            section === t.id ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>{t.label}</button>
        ))}
      </div>

      {section === 'summary' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">AI Fitness Coach</span>
              <Badge variant="outline">claude-sonnet-4-5</Badge>
            </div>
            {summary && (
              <Button variant="ghost" size="sm" onClick={() => fetchSummary(true)} disabled={loading}>
                <RefreshCw className={cn('w-3 h-3 mr-1.5', loading && 'animate-spin')} />Refresh
              </Button>
            )}
          </div>

          {!summary && !loading && !error && (
            <Card><CardContent className="py-12 text-center space-y-4">
              <Bot className="w-8 h-8 text-muted-foreground mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Full-dashboard coaching analysis</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Analyses your training load, body composition, sleep, HRV, cycling power, injury risk, and longevity metrics — then delivers both training and health recommendations.
                </p>
              </div>
              <Button onClick={() => fetchSummary()} className="mx-auto">
                <Bot className="w-3.5 h-3.5 mr-2" />Generate coaching report
              </Button>
            </CardContent></Card>
          )}

          {loading ? (
            <Card><CardContent className="py-10 text-center space-y-2">
              <div className="w-4 h-4 border border-border border-t-foreground rounded-full animate-spin mx-auto" />
              <p className="text-xs text-muted-foreground">Analysing your full dashboard data…</p>
            </CardContent></Card>
          ) : error ? (
            <Card className="border-red-500/20 bg-red-500/5"><CardContent className="py-4 flex gap-3 items-start">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
              <div><p className="text-sm font-medium text-red-400">{error}</p>
              {error.includes('ANTHROPIC') && <p className="text-xs text-muted-foreground mt-1">Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.</p>}
              </div>
            </CardContent></Card>
          ) : summary && (
            <>
              <Card><CardContent className="pt-4"><Prose text={summary.summary} />
                {summary.cached && <p className="text-[10px] text-muted-foreground mt-3 pt-3 border-t border-border">Cached · {new Date(summary.generated_at).toLocaleString()} · 24h TTL</p>}
              </CardContent></Card>

              {summary.recommendations.length > 0 && (() => {
                const training = summary.recommendations.filter(r => r.toUpperCase().startsWith('TRAINING'));
                const health   = summary.recommendations.filter(r => r.toUpperCase().startsWith('HEALTH'));
                const other    = summary.recommendations.filter(r => !r.toUpperCase().startsWith('TRAINING') && !r.toUpperCase().startsWith('HEALTH'));
                const strip    = (r: string) => r.replace(/^(TRAINING|HEALTH)\s*[-–:]\s*/i, '');
                return (
                  <div className="space-y-3">
                    {(training.length > 0 || other.length > 0) && (
                      <Card className="border-blue-500/20 bg-blue-500/5"><CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-1.5 text-blue-400"><TrendingUp className="w-3 h-3" />Training Recommendations</CardTitle>
                      </CardHeader><CardContent>
                        <ul className="space-y-2">{[...training, ...other].map((r,i) => (
                          <li key={i} className="flex gap-2 text-xs text-muted-foreground"><span className="text-blue-400">→</span>{strip(r)}</li>
                        ))}</ul>
                      </CardContent></Card>
                    )}
                    {health.length > 0 && (
                      <Card className="border-purple-500/20 bg-purple-500/5"><CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-1.5 text-purple-400"><Heart className="w-3 h-3" />Health Recommendations</CardTitle>
                      </CardHeader><CardContent>
                        <ul className="space-y-2">{health.map((r,i) => (
                          <li key={i} className="flex gap-2 text-xs text-muted-foreground"><span className="text-purple-400">→</span>{strip(r)}</li>
                        ))}</ul>
                      </CardContent></Card>
                    )}
                  </div>
                );
              })()}

              {summary.injury_risks.length > 0 && (
                <Card className="border-amber-500/20 bg-amber-500/5"><CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-amber-400"><Shield className="w-3 h-3" />Injury Risk Flags</CardTitle>
                </CardHeader><CardContent>
                  <ul className="space-y-2">{summary.injury_risks.map((r,i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground"><AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0 mt-0.5" />{r}</li>
                  ))}</ul>
                </CardContent></Card>
              )}

              {summary.longevity_insights.length > 0 && (
                <Card className="border-green-500/20 bg-green-500/5"><CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-1.5 text-green-400"><Heart className="w-3 h-3" />Longevity Insights</CardTitle>
                </CardHeader><CardContent>
                  <ul className="space-y-2">{summary.longevity_insights.map((r,i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground"><span className="text-green-400">♡</span>{r}</li>
                  ))}</ul>
                </CardContent></Card>
              )}
            </>
          )}
        </div>
      )}

      {section === 'chat' && (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 220px)', minHeight: 500 }}>
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {QUICK.map(q => (
                <button key={q} onClick={() => send(q)} className="text-[11px] px-2.5 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors">{q}</button>
              ))}
            </div>
          )}

          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center space-y-2">
                  <Bot className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">Ask anything about your training</p>
                  <p className="text-xs text-muted-foreground/60">I have full context of your last 90 days</p>
                </div>
              </div>
            ) : messages.map((m,i) => (
              <div key={i} className={cn('flex gap-2.5', m.role === 'user' && 'flex-row-reverse')}>
                <div className={cn('w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-bold',
                  m.role === 'user' ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground')}>
                  {m.role === 'user' ? 'U' : <Bot className="w-3.5 h-3.5" />}
                </div>
                <div className={cn('max-w-[85%] rounded-lg text-sm overflow-hidden',
                  m.role === 'user' ? 'bg-foreground text-background rounded-tr-sm' : 'bg-secondary text-foreground rounded-tl-sm')}>
                  {m.file && m.role === 'user' && (
                    m.file.mediaType.startsWith('image/')
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={`data:${m.file.mediaType};base64,${m.file.data}`} alt={m.file.name} className="max-w-[260px] max-h-[200px] object-cover w-full" />
                      : <div className="flex items-center gap-2 px-3 py-2 border-b border-background/20">
                          <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="text-xs truncate">{m.file.name}</span>
                        </div>
                  )}
                  {(m.content || m.role === 'assistant') && (
                    <div className="px-3 py-2">
                      {m.role === 'assistant' ? <Prose text={m.content || (chatLoading && i === messages.length-1 ? '▋' : '')} /> : m.content}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <div className="mt-3 space-y-2">
            {/* File preview chip */}
            {attachedFile && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-secondary w-fit max-w-xs">
                {attachedFile.mediaType.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`data:${attachedFile.mediaType};base64,${attachedFile.data}`} alt="preview" className="w-6 h-6 rounded object-cover" />
                ) : (
                  <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <span className="text-xs text-muted-foreground truncate max-w-[160px]">{attachedFile.name}</span>
                <button onClick={() => setAttachedFile(null)} className="text-muted-foreground/50 hover:text-muted-foreground ml-1">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            <div className="flex gap-2 items-end">
              {/* Hidden file input */}
              <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileSelect} />

              {/* Attach button */}
              <Button variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} disabled={chatLoading} title="Attach image or PDF" className="flex-shrink-0">
                <Paperclip className="w-3.5 h-3.5" />
              </Button>

              <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask about your training… (Enter to send)"
                rows={2} disabled={chatLoading}
                className="flex-1 resize-none rounded-md border border-border bg-secondary px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
              />
              <Button onClick={() => send(input)} disabled={(!input.trim() && !attachedFile) || chatLoading} size="icon">
                {chatLoading ? <div className="w-3.5 h-3.5 border border-background border-t-transparent rounded-full animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
