/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus,
  Send,
  Search,
  RefreshCw,
  Loader2,
  MessageCircle,
  Users,
  User,
  ExternalLink,
  AlertTriangle,
  CheckCheck,
  X
} from 'lucide-react';
import { motion } from 'motion/react';

interface WaContact {
  jid: string;
  number: string;
  name: string;
  profilePicUrl?: string;
  lastMessage?: string;
  unreadCount?: number;
  updatedAt?: string | number | null;
}

interface WaMessage {
  id: string;
  direction: 'in' | 'out';
  content: string;
  pushName?: string;
  createdAt: string;
}

interface WhatsAppManagerProps {
  onMessageSent?: () => void;
}

const formatNumber = (num: string) => {
  const d = (num || '').replace(/\D/g, '');
  if (d.length === 13) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return num;
};

export default function WhatsAppManager({ onMessageSent }: WhatsAppManagerProps) {
  const [status, setStatus] = useState<{ configured: boolean; instance: string | null; state: string; managerUrl: string } | null>(null);
  const [listMode, setListMode] = useState<'chats' | 'contacts'>('chats');
  const [chats, setChats] = useState<WaContact[]>([]);
  const [contacts, setContacts] = useState<WaContact[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<WaContact | null>(null);
  const [messages, setMessages] = useState<WaMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [search, setSearch] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newNumber, setNewNumber] = useState('');
  const [newName, setNewName] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [startingChat, setStartingChat] = useState(false);
  const [newChatError, setNewChatError] = useState('');

  const threadEndRef = useRef<HTMLDivElement>(null);

  const notify = (type: 'ok' | 'err', text: string) => {
    setFeedback({ type, text });
    window.setTimeout(() => setFeedback(null), 8000);
  };

  // Monta a mensagem de erro juntando o motivo real devolvido pelo backend
  const describeError = (data: any, fallback: string) => {
    if (data?.details) return `${fallback} Motivo: ${data.details}`;
    return data?.error || fallback;
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/evolution/status');
      if (res.ok) setStatus(await res.json());
    } catch (e) {
      console.error('Erro ao consultar status Evolution:', e);
    }
  }, []);

  const fetchList = useCallback(async (mode: 'chats' | 'contacts') => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch(`/api/evolution/${mode}`);
      const data = await res.json();
      if (res.ok) {
        if (mode === 'chats') setChats(data);
        else setContacts(data);
      } else {
        setListError(describeError(data, 'Falha ao carregar a lista do WhatsApp.'));
      }
    } catch (e) {
      setListError('Não foi possível conectar ao servidor.');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchMessages = useCallback(async (contact: WaContact) => {
    setLoadingMessages(true);
    setMessagesError(null);
    try {
      const res = await fetch(`/api/evolution/messages?jid=${encodeURIComponent(contact.jid)}`);
      const data = await res.json();
      if (res.ok) {
        setMessages(data);
      } else {
        setMessages([]);
        setMessagesError(describeError(data, 'Falha ao carregar o histórico da conversa.'));
      }
    } catch (e) {
      setMessages([]);
      setMessagesError('Não foi possível conectar ao servidor.');
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchList('chats');
  }, [fetchStatus, fetchList]);

  useEffect(() => {
    if (listMode === 'contacts' && contacts.length === 0 && !loadingList) {
      fetchList('contacts');
    }
  }, [listMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSelect = (contact: WaContact) => {
    setSelected(contact);
    setDraft('');
    fetchMessages(contact);
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || !selected || sending) return;

    setSending(true);
    // Mensagem otimista para o atendente ver o envio imediatamente
    const optimistic: WaMessage = {
      id: `tmp_${Date.now()}`,
      direction: 'out',
      content: text,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft('');

    try {
      const res = await fetch('/api/evolution/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: selected.number, jid: selected.jid, text, name: selected.name })
      });
      const data = await res.json();

      if (res.ok) {
        notify('ok', 'Mensagem enviada pelo WhatsApp.');
        onMessageSent?.();
        fetchMessages(selected);
        fetchList(listMode);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        notify('err', describeError(data, 'Não foi possível enviar a mensagem pelo WhatsApp.'));
      }
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      notify('err', 'Erro de conexão ao enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  const handleStartNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = newNumber.replace(/\D/g, '');
    if (digits.length < 10) {
      setNewChatError('Informe o número com DDD (mínimo 10 dígitos).');
      return;
    }
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;
    const contact: WaContact = {
      jid: `${normalized}@s.whatsapp.net`,
      number: normalized,
      name: newName.trim() || formatNumber(normalized)
    };

    setStartingChat(true);
    setNewChatError('');

    try {
      // Se houver mensagem inicial, envia agora; senão apenas abre a conversa
      if (newMessage.trim()) {
        const res = await fetch('/api/evolution/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: normalized, text: newMessage.trim(), name: contact.name })
        });
        const data = await res.json();
        if (!res.ok) {
          setNewChatError(describeError(data, 'Não foi possível enviar a mensagem inicial.'));
          setStartingChat(false);
          return;
        }
        notify('ok', `Conversa iniciada com ${contact.name}.`);
        onMessageSent?.();
      }

      // Garante que a nova conversa apareça na lista mesmo antes da resposta
      setChats((prev) => (prev.some((c) => c.number === normalized) ? prev : [{ ...contact, lastMessage: newMessage.trim() }, ...prev]));
      setListMode('chats');
      setShowNewChat(false);
      setNewNumber('');
      setNewName('');
      setNewMessage('');
      handleSelect(contact);
      fetchList('chats');
    } catch (err) {
      setNewChatError('Erro de conexão com o servidor.');
    } finally {
      setStartingChat(false);
    }
  };

  const sourceList = listMode === 'chats' ? chats : contacts;
  const filtered = sourceList.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.number.includes(q.replace(/\D/g, ''));
  });

  const isOnline = status?.state === 'open';

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* Barra de status da instância */}
      <div className="bg-white rounded-2xl border border-brand-gold/15 shadow-xs px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-red-500 animate-pulse'}`} />
          <div className="leading-tight">
            <p className="text-xs font-serif font-bold text-brand-brown">
              Gerenciador WhatsApp {status?.instance ? `— ${status.instance}` : ''}
            </p>
            <p className="text-[10px] font-mono text-brand-brown/60 uppercase">
              {status === null
                ? 'Verificando conexão...'
                : !status.configured
                  ? 'Evolution API não configurada'
                  : isOnline
                    ? 'Instância conectada'
                    : 'Instância desconectada'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => { fetchStatus(); fetchList(listMode); if (selected) fetchMessages(selected); }}
            className="flex items-center space-x-1.5 bg-brand-brown/5 hover:bg-brand-beige text-brand-brown text-xxs font-semibold px-3 py-2 rounded-xl transition-all cursor-pointer"
            title="Atualizar"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingList ? 'animate-spin' : ''}`} />
            <span>Atualizar</span>
          </button>
          {status?.managerUrl && (
            <a
              href={status.managerUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center space-x-1.5 bg-brand-brown/5 hover:bg-brand-beige text-brand-brown text-xxs font-semibold px-3 py-2 rounded-xl transition-all"
              title="Abrir o painel completo da Evolution API em uma nova aba"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Painel Evolution</span>
            </a>
          )}
        </div>
      </div>

      {!isOnline && status?.configured && (
        <div className="flex items-start space-x-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xxs text-amber-800 leading-relaxed">
            A instância do WhatsApp está desconectada. Leia o QR Code na aba <strong>Integração WhatsApp</strong> para
            voltar a enviar e receber mensagens.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1 min-h-0">
        {/* Lista de conversas / contatos */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-brand-gold/15 shadow-xs flex flex-col overflow-hidden">
          <div className="p-4 pb-3 border-b border-brand-beige space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-serif font-bold text-brand-brown flex items-center space-x-2">
                <MessageCircle className="h-4 w-4 text-brand-gold" />
                <span>Chat</span>
              </h3>
              <button
                onClick={() => { setNewChatError(''); setShowNewChat(true); }}
                className="flex items-center justify-center h-8 w-8 rounded-xl bg-brand-brown hover:bg-brand-brown/90 text-brand-gold transition-all shadow-sm cursor-pointer"
                title="Iniciar nova conversa"
                aria-label="Iniciar nova conversa"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="flex space-x-1 bg-brand-cream/40 p-1 rounded-xl">
              <button
                onClick={() => setListMode('chats')}
                className={`flex-1 flex items-center justify-center space-x-1.5 text-xxs font-semibold py-1.5 rounded-lg transition-all cursor-pointer ${listMode === 'chats' ? 'bg-white text-brand-brown shadow-xs' : 'text-brand-brown/60 hover:text-brand-brown'}`}
              >
                <MessageCircle className="h-3 w-3" />
                <span>Conversas</span>
              </button>
              <button
                onClick={() => setListMode('contacts')}
                className={`flex-1 flex items-center justify-center space-x-1.5 text-xxs font-semibold py-1.5 rounded-lg transition-all cursor-pointer ${listMode === 'contacts' ? 'bg-white text-brand-brown shadow-xs' : 'text-brand-brown/60 hover:text-brand-brown'}`}
              >
                <Users className="h-3 w-3" />
                <span>Contatos</span>
              </button>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-brand-brown/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nome ou número..."
                className="w-full pl-9 pr-3 py-2 rounded-xl border border-brand-gold/20 bg-brand-cream/20 text-xs text-brand-brown focus:outline-none focus:ring-1 focus:ring-brand-gold"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loadingList && sourceList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-2">
                <Loader2 className="h-6 w-6 animate-spin text-brand-gold" />
                <p className="text-xxs text-brand-brown/60 font-mono">Carregando do WhatsApp...</p>
              </div>
            ) : listError ? (
              <div className="text-center py-10 px-3 space-y-2">
                <AlertTriangle className="h-6 w-6 text-amber-500 mx-auto" />
                <p className="text-xxs text-brand-brown/70 leading-relaxed">{listError}</p>
                <button
                  onClick={() => fetchList(listMode)}
                  className="text-xxs font-bold text-brand-brown bg-brand-beige hover:bg-brand-beige/70 px-3 py-1.5 rounded-lg cursor-pointer"
                >
                  Tentar novamente
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-xxs text-brand-brown/50 text-center py-10">
                {listMode === 'chats' ? 'Nenhuma conversa encontrada.' : 'Nenhum contato encontrado.'}
              </p>
            ) : (
              filtered.map((contact) => {
                const isSel = selected?.number === contact.number;
                return (
                  <button
                    key={contact.jid}
                    onClick={() => handleSelect(contact)}
                    className={`w-full text-left p-3 rounded-xl border transition-all duration-200 flex items-center space-x-3 cursor-pointer ${
                      isSel
                        ? 'bg-brand-brown border-brand-brown text-brand-beige shadow-md'
                        : 'bg-brand-cream/30 border-brand-gold/10 hover:border-brand-gold text-brand-brown'
                    }`}
                  >
                    {contact.profilePicUrl ? (
                      <img src={contact.profilePicUrl} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className={`h-9 w-9 rounded-full shrink-0 flex items-center justify-center ${isSel ? 'bg-brand-gold/20' : 'bg-brand-brown/10'}`}>
                        <User className={`h-4 w-4 ${isSel ? 'text-brand-gold' : 'text-brand-brown/60'}`} />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-serif font-semibold truncate">{contact.name}</span>
                        {!!contact.unreadCount && contact.unreadCount > 0 && (
                          <span className="text-[9px] font-bold bg-emerald-500 text-white px-1.5 py-0.5 rounded-full shrink-0">
                            {contact.unreadCount}
                          </span>
                        )}
                      </div>
                      <p className={`text-[10px] font-mono truncate ${isSel ? 'text-brand-beige/70' : 'text-brand-brown/55'}`}>
                        {contact.number}
                      </p>
                      {contact.lastMessage && (
                        <p className={`text-[10px] truncate mt-0.5 ${isSel ? 'text-brand-beige/60' : 'text-brand-brown/45'}`}>
                          {contact.lastMessage}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Painel da conversa */}
        <div className="lg:col-span-8 bg-white rounded-2xl border border-brand-gold/15 shadow-xs flex flex-col overflow-hidden">
          {selected ? (
            <>
              <div className="p-4 border-b border-brand-beige bg-brand-cream/15 flex items-center space-x-3">
                {selected.profilePicUrl ? (
                  <img src={selected.profilePicUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                ) : (
                  <span className="h-9 w-9 rounded-full bg-brand-brown/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-brand-gold" />
                  </span>
                )}
                <div className="leading-tight">
                  <h4 className="text-sm font-serif font-bold text-brand-brown">{selected.name}</h4>
                  <p className="text-[10px] font-mono text-brand-brown/60">{formatNumber(selected.number)}</p>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-3">
                {loadingMessages ? (
                  <div className="flex flex-col items-center justify-center h-full space-y-2">
                    <Loader2 className="h-6 w-6 animate-spin text-brand-gold" />
                    <p className="text-xxs text-brand-brown/60 font-mono">Carregando conversa...</p>
                  </div>
                ) : messagesError ? (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-2 px-6">
                    <AlertTriangle className="h-7 w-7 text-amber-500" />
                    <p className="text-xxs text-brand-brown/70 leading-relaxed">{messagesError}</p>
                    <p className="text-[10px] text-brand-brown/50">Você ainda pode enviar mensagens normalmente.</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-1">
                    <MessageCircle className="h-9 w-9 text-brand-gold/40" />
                    <p className="text-xs text-brand-brown/50">Nenhuma mensagem nesta conversa.</p>
                    <p className="text-[10px] text-brand-brown/45">Escreva abaixo para iniciar o atendimento.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOut = msg.direction === 'out';
                    return (
                      <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[75%] rounded-2xl p-3.5 shadow-xxs ${
                          isOut
                            ? 'bg-brand-brown text-brand-beige rounded-br-none'
                            : 'bg-brand-cream text-brand-brown border border-brand-gold/15 rounded-bl-none'
                        }`}>
                          <p className="text-xs whitespace-pre-line leading-relaxed">{msg.content}</p>
                          <div className={`flex items-center justify-end space-x-1 text-[9px] font-mono mt-1.5 ${isOut ? 'text-brand-beige/60' : 'text-brand-brown/50'}`}>
                            <span>{new Date(msg.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            {isOut && <CheckCheck className="h-3 w-3 text-brand-gold" />}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>

              <form onSubmit={handleSend} className="p-4 border-t border-brand-beige bg-brand-cream/10 flex items-center space-x-3">
                <textarea
                  rows={1}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Escreva sua mensagem..."
                  className="flex-1 px-4 py-3 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown resize-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || sending}
                  className="p-3 bg-brand-brown hover:bg-brand-brown/95 disabled:bg-brand-brown/40 text-brand-beige rounded-xl transition-all shadow-md flex items-center justify-center cursor-pointer disabled:cursor-not-allowed"
                  title="Enviar mensagem"
                  aria-label="Enviar mensagem"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin text-brand-gold" /> : <Send className="h-4 w-4 text-brand-gold" />}
                </button>
              </form>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-2">
              <MessageCircle className="h-12 w-12 text-brand-gold/40" />
              <h4 className="font-serif font-semibold text-brand-brown">Selecione uma conversa</h4>
              <p className="text-xs text-brand-brown/60 max-w-xs leading-relaxed">
                Escolha um contato na lista ao lado ou clique no <strong>+</strong> para iniciar uma nova conversa no WhatsApp.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal Nova Conversa */}
      {showNewChat && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center p-4 z-[60]">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white border border-brand-gold/20 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4"
          >
            <div className="flex justify-between items-center pb-3 border-b border-brand-beige">
              <h4 className="font-serif font-bold text-brand-brown text-base flex items-center space-x-2">
                <MessageCircle className="h-5 w-5 text-brand-gold" />
                <span>Nova Conversa WhatsApp</span>
              </h4>
              <button
                onClick={() => setShowNewChat(false)}
                className="text-brand-brown/60 hover:text-brand-brown cursor-pointer"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleStartNewChat} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-brown mb-1">Número com DDD *</label>
                <input
                  type="tel"
                  required
                  autoFocus
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="Ex: 15 99756-9764"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-brand-gold/25 bg-white text-xs text-brand-brown font-mono focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
                <p className="text-[10px] text-brand-brown/50 mt-1">O código do Brasil (55) é adicionado automaticamente.</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown mb-1">Nome do contato</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex: Mariana Silva"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-brand-gold/25 bg-white text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown mb-1">Primeira mensagem (opcional)</label>
                <textarea
                  rows={3}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Olá! Aqui é da Dra. Musa Estética de Elite..."
                  className="w-full p-3 rounded-xl border border-brand-gold/25 bg-white text-xs text-brand-brown leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-gold resize-none"
                />
              </div>

              {newChatError && (
                <p className="text-xxs font-semibold text-red-600 bg-red-50 border border-red-150 py-1.5 px-3 rounded-lg">
                  {newChatError}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowNewChat(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-brand-brown/70 hover:bg-brand-beige/50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={startingChat}
                  className="bg-brand-brown hover:bg-brand-brown/90 disabled:bg-brand-brown/40 text-brand-beige text-xs font-semibold px-5 py-2 rounded-xl transition-all shadow-md flex items-center space-x-1.5 cursor-pointer"
                >
                  {startingChat ? <Loader2 className="h-4 w-4 animate-spin text-brand-gold" /> : <span>Abrir Conversa</span>}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Toast de feedback (substitui os alerts bloqueantes) */}
      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className={`fixed bottom-6 right-6 z-[70] max-w-sm px-4 py-3 rounded-xl shadow-2xl border text-xs leading-relaxed ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.text}
        </motion.div>
      )}
    </div>
  );
}
