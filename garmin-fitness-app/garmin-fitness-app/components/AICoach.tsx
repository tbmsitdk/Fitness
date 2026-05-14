'use client';

import { useState, useEffect, useRef } from 'react';
import { Activity, WellnessRecord, AISummary, ChatMessage } from '@/types';
import { Bot, Send, RefreshCw, AlertTriangle, TrendingUp, Shield, Heart, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface Props {
  activities: Activity[];
  wellness: WellnessRecord[];
}

const QUICK_QUESTIONS = [
  'Am I overtraining right now?',
  'How should I structure next week?',
  'How is my aerobic base developing?',
  'What does my Zone 2 training look like?',
  'Am I getting enough recovery?',
  'How is my fitness trending over the last 3 months?',
];

function MarkdownText({ text }: { text: string }) {
  const html = text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^## (.*?)$/gm, '<h2>$1</h2>')
    .replace(/^### (.*?)$/gm, '<h3 class="text-sm font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^- (.*?)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)+/gs, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hup])(.+)$/gm, (m) => m ? m : '');

  return <div className="ai-prose text-sm text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function AICoach({ activities, wellness }: Props) {
  const [summary, setSummary] = useState<AISummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [activeSection, setActiveSection] = useState<'summary' | 'chat'>('summary');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchSummary();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function fetchSummary(invalidate = false) {
    setSummaryLoading(true);
    setSummaryError('');
    try {
      if (invalidate) await fetch('/api/ai-summary', { method: 'DELETE' });
      const res = await fetch('/api/ai-summary');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load summary');
      setSummary(json);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to load coaching summary');
    } finally {
      setSummaryLoading(false);
    }
  }

  async function sendMessage(text: string) {
    if (!text.trim() || chatLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: text.trim() };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setChatLoading(true);

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
    setMessages([...updated, assistantMsg]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updated }),
      });

      if (!res.ok || !res.body) throw new Error('Chat failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;
          try {
            const { text: chunk, error } = JSON.parse(data);
            if (error) throw new Error(error);
            if (chunk) {
              setMessages(prev => {
                const msgs = [...prev];
                msgs[msgs.length - 1] = { role: 'assistant', content: msgs[msgs.length - 1].content + chunk };
                return msgs;
              });
            }
          } catch { /* skip malformed chunk */ }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const msgs = [...prev];
        msgs[msgs.length - 1] = { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' };
        return msgs;
      });
    } finally {
      setChatLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        {(['summary', 'chat'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveSection(tab)}
            className={clsx(
              'px-5 py-2.5 text-sm font-medium capitalize border-b-2 transition-colors -mb-px',
              activeSection === tab
                ? 'border-garmin-blue text-garmin-blue'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            {tab === 'summary' ? 'Weekly Summary' : 'Chat with your data'}
          </button>
        ))}
      </div>

      {/* Weekly Summary */}
      {activeSection === 'summary' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-garmin-blue" />
              <span className="text-sm font-semibold text-slate-700">AI Fitness Coach</span>
              <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">claude-sonnet-4-5</span>
            </div>
            <button
              onClick={() => fetchSummary(true)}
              disabled={summaryLoading}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', summaryLoading && 'animate-spin')} />
              Refresh
            </button>
          </div>

          {summaryLoading ? (
            <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center space-y-3">
              <div className="w-10 h-10 border-2 border-garmin-blue border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-slate-500">Analysing your last 90 days of training…</p>
              <p className="text-xs text-slate-400">This may take up to 30 seconds</p>
            </div>
          ) : summaryError ? (
            <div className="bg-red-50 rounded-2xl border border-red-100 p-6 flex gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-700">Could not load coaching summary</p>
                <p className="text-sm text-red-600 mt-1">{summaryError}</p>
                {summaryError.includes('ANTHROPIC') && (
                  <p className="text-xs text-red-500 mt-2">Add your ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables, then redeploy.</p>
                )}
              </div>
            </div>
          ) : summary ? (
            <div className="space-y-4">
              {/* Main summary */}
              <div className="bg-white rounded-2xl border border-slate-100 p-6">
                <MarkdownText text={summary.summary} />
                {summary.cached && (
                  <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-50">
                    Cached · generated {new Date(summary.generated_at).toLocaleString()} · refreshes every 24h
                  </p>
                )}
              </div>

              {/* Recommendations */}
              {summary.recommendations.length > 0 && (
                <div className="bg-blue-50 rounded-2xl border border-blue-100 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-garmin-blue" />
                    <h4 className="text-sm font-semibold text-garmin-blue">Recommendations</h4>
                  </div>
                  <ul className="space-y-2">
                    {summary.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700">
                        <span className="text-garmin-blue font-bold">→</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Injury risks */}
              {summary.injury_risks.length > 0 && (
                <div className="bg-amber-50 rounded-2xl border border-amber-100 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Shield className="w-4 h-4 text-amber-600" />
                    <h4 className="text-sm font-semibold text-amber-700">Injury Risk Flags</h4>
                  </div>
                  <ul className="space-y-2">
                    {summary.injury_risks.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-amber-800">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Longevity insights */}
              {summary.longevity_insights.length > 0 && (
                <div className="bg-green-50 rounded-2xl border border-green-100 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Heart className="w-4 h-4 text-garmin-green" />
                    <h4 className="text-sm font-semibold text-garmin-green">Longevity Insights</h4>
                  </div>
                  <ul className="space-y-2">
                    {summary.longevity_insights.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700">
                        <span className="text-garmin-green font-bold">♡</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}

          {/* CTA to chat */}
          <button
            onClick={() => setActiveSection('chat')}
            className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Bot className="w-4 h-4" />
            Ask a question about your data
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Chat */}
      {activeSection === 'chat' && (
        <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
          {/* Quick questions */}
          {messages.length === 0 && (
            <div className="mb-4">
              <p className="text-xs text-slate-500 mb-2 font-medium">Quick questions:</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_QUESTIONS.map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="text-xs px-3 py-1.5 bg-white border border-slate-200 hover:border-garmin-blue hover:text-garmin-blue rounded-full transition-colors text-slate-600"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-center">
                <div className="space-y-2">
                  <div className="w-12 h-12 bg-garmin-blue/10 rounded-2xl flex items-center justify-center mx-auto">
                    <Bot className="w-6 h-6 text-garmin-blue" />
                  </div>
                  <p className="text-sm font-medium text-slate-700">Ask me anything about your training</p>
                  <p className="text-xs text-slate-400">I have full context of your last 90 days</p>
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={clsx('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}>
                  <div className={clsx(
                    'w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold',
                    m.role === 'user' ? 'bg-garmin-blue text-white' : 'bg-slate-100 text-slate-600'
                  )}>
                    {m.role === 'user' ? 'You' : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={clsx(
                    'max-w-[85%] px-4 py-3 rounded-2xl text-sm',
                    m.role === 'user'
                      ? 'bg-garmin-blue text-white rounded-tr-sm'
                      : 'bg-white border border-slate-100 rounded-tl-sm'
                  )}>
                    {m.role === 'assistant'
                      ? <MarkdownText text={m.content || (chatLoading && i === messages.length - 1 ? '▋' : '')} />
                      : m.content
                    }
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="mt-4 flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your training, recovery, or next week's plan… (Enter to send)"
              rows={2}
              disabled={chatLoading}
              className="flex-1 resize-none rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-garmin-blue/30 focus:border-garmin-blue disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || chatLoading}
              className="w-10 h-10 bg-garmin-blue hover:bg-blue-600 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors flex-shrink-0"
            >
              {chatLoading
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
