'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  X,
  Send,
  Hexagon,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { Logo } from '@/components/ui/Logo';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const QUICK_PROMPTS = [
  'How does DARF work in Brazil?',
  'When is Form 8949 due?',
  'What is DAC8 for EU?',
  'Do I owe taxes on staking?',
];

// Mock responses keyed by keywords
const MOCK_RESPONSES: Record<string, string> = {
  darf: 'The DARF (Documento de Arrecadação de Receitas Federais) is a monthly tax payment required in Brazil for crypto capital gains. If your total crypto sales in a month exceed R$35,000, you must calculate and pay the tax by the last business day of the following month. Rates are 15% for gains up to R$5M, scaling up to 22.5% for larger amounts.',
  '8949': 'Form 8949 is due annually on April 15th (or the next business day). It reports every crypto sale, swap, or disposition you made during the tax year. Each transaction needs: date acquired, date sold, proceeds, cost basis, and gain/loss. AuditSwarm can generate this form automatically from your on-chain transactions.',
  dac8: 'DAC8 (Directive on Administrative Cooperation 8) is the EU\'s crypto reporting framework. Starting January 2026, crypto-asset service providers must report user transactions to tax authorities. As a holder, you should prepare annual capital gains summaries. AuditSwarm\'s EU Bee agent handles DAC8-compliant report generation.',
  staking: 'Staking rewards are generally treated as income in most jurisdictions. In the US, staking rewards are taxed as ordinary income at the fair market value when received. In Brazil, staking gains follow the same GCAP rules. The EU varies by member state. AuditSwarm automatically classifies staking transactions and calculates the tax implications.',
  default: 'I can help you understand your crypto tax obligations across different jurisdictions. AuditSwarm supports US (IRS), EU (DAC8), and Brazil (Receita Federal) compliance. Try asking about specific forms, deadlines, or how different transaction types are taxed.',
};

function getMockResponse(input: string): string {
  const lower = input.toLowerCase();
  for (const [key, response] of Object.entries(MOCK_RESPONSES)) {
    if (key !== 'default' && lower.includes(key)) {
      return response;
    }
  }
  if (lower.includes('tax') || lower.includes('form') || lower.includes('report')) {
    return MOCK_RESPONSES.default;
  }
  return MOCK_RESPONSES.default;
}

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      const userMsg: Message = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: text.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsTyping(true);

      // Simulate API delay
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));

      const response = getMockResponse(text);
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setIsTyping(false);
    },
    [],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <>
      {/* Floating trigger button */}
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-2xl bg-primary text-background flex items-center justify-center shadow-lg shadow-primary/20 hover:scale-105 hover:shadow-xl hover:shadow-primary/30 transition-all"
          >
            <MessageCircle className="w-6 h-6" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Mobile backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 sm:hidden"
              onClick={() => setIsOpen(false)}
            />

            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-50 w-full sm:w-[420px] h-[100dvh] sm:h-[600px] sm:max-h-[80vh] flex flex-col bg-surface border border-white/5 sm:rounded-2xl overflow-hidden shadow-2xl shadow-black/40"
            >
              {/* Chat header */}
              <div className="shrink-0 px-5 py-4 border-b border-white/5 bg-surface/80 backdrop-blur-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Logo size={20} className="text-primary" />
                    </div>
                    <div>
                      <h3 className="text-sm font-display font-bold text-white">
                        Tax Assistant
                      </h3>
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                        <span className="text-[11px] text-white/30">
                          Powered by AuditSwarm AI
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Messages area */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 scrollbar-thin">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center text-center py-8">
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                      <Sparkles className="w-7 h-7 text-primary/60" />
                    </div>
                    <h4 className="text-base font-display font-bold text-white/70 mb-1">
                      Ask about crypto taxes
                    </h4>
                    <p className="text-xs text-white/30 max-w-[260px] mb-6 leading-relaxed">
                      Get answers about tax obligations, deadlines, forms, and compliance requirements for any supported jurisdiction.
                    </p>

                    {/* Quick prompts */}
                    <div className="flex flex-wrap justify-center gap-2">
                      {QUICK_PROMPTS.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => sendMessage(prompt)}
                          className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5 text-xs text-white/40 hover:text-white/70 hover:bg-white/[0.06] hover:border-white/10 transition-all"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {messages.map((msg) => (
                  <ChatMessage key={msg.id} message={msg} />
                ))}

                {isTyping && (
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Logo size={14} className="text-primary" />
                    </div>
                    <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-white/[0.04] border border-white/5">
                      <div className="flex items-center gap-1">
                        <Loader2 className="w-3.5 h-3.5 text-primary/50 animate-spin" />
                        <span className="text-xs text-white/30">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input area */}
              <div className="shrink-0 px-4 pb-4 pt-2">
                <form onSubmit={handleSubmit} className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="Ask about taxes, deadlines, forms..."
                      disabled={isTyping}
                      className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/5 text-sm text-white/80 placeholder-white/20 focus:outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all disabled:opacity-50"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!input.trim() || isTyping}
                    className="w-11 h-11 rounded-xl bg-primary text-background flex items-center justify-center hover:bg-primary-400 transition-all disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
                <p className="text-[10px] text-white/15 text-center mt-2">
                  AI-generated responses. Always verify with a tax professional.
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── ChatMessage ─────────────────────────────────────────────────────

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Logo size={14} className="text-primary" />
        </div>
      )}

      <div
        className={`
          max-w-[85%] px-4 py-3 text-sm leading-relaxed
          ${isUser
            ? 'rounded-2xl rounded-tr-md bg-primary/15 text-white/90 border border-primary/10'
            : 'rounded-2xl rounded-tl-md bg-white/[0.04] text-white/70 border border-white/5'
          }
        `}
      >
        {message.content}
      </div>
    </div>
  );
}
