import React, { useState, useEffect, useRef } from 'react'
import {
  LifeBuoy,
  X,
  Send,
  RefreshCw,
  MessageSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  Paperclip
} from 'lucide-react'

interface ChatMessage {
  sender: 'user' | 'support'
  text: string
  timestamp: number
}

interface SupportTicket {
  id: string
  title: string
  status: 'open' | 'closed'
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

interface MessageCenterModalProps {
  onClose: () => void
}

export const MessageCenterModal: React.FC<MessageCenterModalProps> = ({ onClose }) => {
  const [deviceId, setDeviceId] = useState<string>('')
  const [tickets, setTickets] = useState<SupportTicket[]>([
    {
      id: 'TICK-101',
      title: 'Willkommen beim Omega Nachrichtencenter',
      status: 'open',
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now(),
      messages: [
        {
          sender: 'support',
          text: 'Herzlich willkommen beim Omega Wave Recorder Support & Nachrichtencenter! Hier erhalten Sie direkte Antworten auf Ihre Supportanfragen.',
          timestamp: Date.now() - 3600000
        }
      ]
    }
  ])
  const [selectedTicketId, setSelectedTicketId] = useState<string>('TICK-101')
  const [replyText, setReplyText] = useState('')
  const [isSending, setIsSending] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function loadDevice() {
      try {
        if (window.api?.getDeviceId) {
          const id = await window.api.getDeviceId()
          if (id) setDeviceId(id)
        }
      } catch (err) {
        console.warn('Failed to load device ID:', err)
      }
    }
    loadDevice()
  }, [])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [tickets, selectedTicketId])

  const selectedTicket = tickets.find((t) => t.id === selectedTicketId) || tickets[0]

  const handleSendReply = (e: React.FormEvent) => {
    e.preventDefault()
    if (!replyText.trim() || !selectedTicket) return

    const newMsg: ChatMessage = {
      sender: 'user',
      text: replyText.trim(),
      timestamp: Date.now()
    }

    setTickets((prev) =>
      prev.map((t) =>
        t.id === selectedTicket.id
          ? {
              ...t,
              updatedAt: Date.now(),
              messages: [...t.messages, newMsg]
            }
          : t
      )
    )

    setReplyText('')
  }

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[5000] p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#24272c] border border-gray-700/80 w-full max-w-4xl h-[600px] max-h-[90vh] rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-gray-300">
        {/* Header */}
        <div className="bg-[#1a1d21] px-5 py-3.5 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <LifeBuoy size={17} className="text-omega-accent" />
            <h2 className="text-sm font-bold text-white tracking-wide">
              Omega Nachrichtencenter & Support
            </h2>
            {deviceId && (
              <span className="text-[10px] font-mono text-gray-500 bg-[#16181b] px-2 py-0.5 rounded border border-gray-800">
                Geräte-ID: {deviceId.slice(0, 8)}...
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Ticket List */}
          <div className="w-64 border-r border-gray-800 bg-[#1e2126] flex flex-col">
            <div className="p-3 border-b border-gray-800 text-[11px] font-semibold text-gray-400">
              Ihre Anfragen & Tickets
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTicketId(t.id)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                    selectedTicket?.id === t.id
                      ? 'bg-omega-accent/20 border-omega-accent text-white'
                      : 'bg-[#181a1e] hover:bg-[#25282e] border-gray-800 text-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-[10px] text-omega-accent font-bold">
                      {t.id}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded-full uppercase font-bold ${
                        t.status === 'open'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                  <div className="font-medium truncate text-xs">{t.title}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Right: Active Ticket Chat Pane */}
          <div className="flex-1 flex flex-col bg-[#141619]">
            {selectedTicket ? (
              <>
                {/* Chat Messages Area */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar">
                  {selectedTicket.messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col ${
                        msg.sender === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`max-w-[75%] p-3 rounded-xl leading-relaxed text-xs shadow-md ${
                          msg.sender === 'user'
                            ? 'bg-omega-accent text-white rounded-br-none'
                            : 'bg-[#202328] border border-gray-700/70 text-gray-200 rounded-bl-none'
                        }`}
                      >
                        {msg.text}
                      </div>
                      <span className="text-[9px] text-gray-600 mt-1 font-mono">
                        {new Date(msg.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Reply Form */}
                <form
                  onSubmit={handleSendReply}
                  className="p-3 bg-[#1a1d21] border-t border-gray-800 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Nachricht eingeben..."
                    className="flex-1 bg-[#121417] border border-gray-700 rounded-lg px-3 py-2 text-white focus:border-omega-accent outline-none text-xs"
                  />
                  <button
                    type="submit"
                    disabled={!replyText.trim() || isSending}
                    className="px-4 py-2 rounded-lg bg-omega-accent hover:bg-blue-600 active:scale-[0.97] text-white font-bold transition-all shadow-[0_0_8px_rgba(0,120,215,0.4)] flex items-center gap-1.5"
                  >
                    <Send size={13} />
                    <span>Senden</span>
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-500">
                Kein Ticket ausgewählt
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default MessageCenterModal
