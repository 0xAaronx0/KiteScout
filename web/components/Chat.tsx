'use client';

import { useChat } from 'ai/react';
import { useEffect, useRef } from 'react';
import SwipeDeck from './SwipeDeck';
import type { ProviderResult } from '../lib/types';

const SUGGESTIONS = [
  'Kite camp in Morocco 🇲🇦',
  'Kitesurfing lessons in Fuerteventura 🇪🇸',
  'Kite cruise in the Grenadines ⛵',
  'Beginner kite school in Egypt 🇪🇬',
  'Equipment rental in Bali 🇮🇩',
  'Snowkite camp in the Alps 🏔️',
];

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit, isLoading, setInput } = useChat({
    api: '/api/chat',
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-xl mx-auto space-y-6">

          {isEmpty && (
            <div className="text-center pt-12 pb-4">
              <div className="text-5xl mb-4">🪁</div>
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Where do you want to kite?</h2>
              <p className="text-slate-500 mb-8">
                Describe your ideal trip and I'll find the best providers for you.
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => setInput(s)}
                    className="text-sm bg-white border border-slate-200 rounded-full px-4 py-2 hover:border-sky-400 hover:text-sky-600 transition-colors cursor-pointer">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(message => (
            <div key={message.id}>
              {message.role === 'user' && (
                <div className="flex justify-end">
                  <div className="bg-sky-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-sm text-sm">
                    {message.content as string}
                  </div>
                </div>
              )}

              {message.role === 'assistant' && (
                <div className="space-y-4">
                  {(message.content as string) && (
                    <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap">
                      {message.content as string}
                    </p>
                  )}
                  {message.toolInvocations?.map(inv => {
                    if (inv.toolName !== 'searchProviders' || inv.state !== 'result') return null;
                    const providers = (inv as { result: ProviderResult[] }).result;
                    if (!providers?.length) return (
                      <p key={inv.toolCallId} className="text-sm text-slate-400 italic">
                        No matching providers found.
                      </p>
                    );
                    return (
                      <SwipeDeck key={inv.toolCallId} providers={providers} />
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex gap-1.5 px-1 py-2">
              {[0, 150, 300].map(delay => (
                <span key={delay}
                  className="w-2 h-2 bg-slate-300 rounded-full animate-bounce"
                  style={{ animationDelay: `${delay}ms` }} />
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-4 py-4 shrink-0">
        <form onSubmit={handleSubmit} className="max-w-xl mx-auto flex gap-3">
          <input
            value={input}
            onChange={handleInputChange}
            placeholder="Describe your ideal kite trip…"
            disabled={isLoading}
            className="flex-1 border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent disabled:opacity-50 bg-white"
          />
          <button type="submit" disabled={isLoading || !input.trim()}
            className="bg-sky-600 text-white rounded-xl px-5 py-3 text-sm font-semibold hover:bg-sky-700 disabled:opacity-40 transition-colors shrink-0">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
