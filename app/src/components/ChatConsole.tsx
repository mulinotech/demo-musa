/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Client, Lead, Interaction } from '../types';
import { 
  Send, 
  Sparkles, 
  MessageCircle, 
  User, 
  Loader2, 
  Settings, 
  CheckCheck,
  Phone,
  Bot,
  Trash2
} from 'lucide-react';
import { motion } from 'motion/react';

interface ChatConsoleProps {
  clients: Client[];
  leads: Lead[];
  interactions: Interaction[];
  onSendMessage: (clientId: string, content: string) => void;
  isAiConfigured: boolean;
  onDeleteLead?: (id: string) => void;
  onRefreshData?: () => void;
}

export default function ChatConsole({ 
  clients, 
  leads, 
  interactions, 
  onSendMessage,
  isAiConfigured,
  onDeleteLead,
  onRefreshData
}: ChatConsoleProps) {
  // Modal de novo chat
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newContactName, setNewContactName] = useState('');
  const [newContactPhone, setNewContactPhone] = useState('');
  const [creatingChat, setCreatingChat] = useState(false);
  const [newChatError, setNewChatError] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  // Display all clients and leads in the Atendimento tab.
  const rawContacts = [
    ...clients.map(c => ({ id: c.id, name: c.name || '', phone: c.phone || '', type: 'Paciente' as const })),
    ...leads.map(l => ({ id: l.id, name: l.name || '', phone: l.phone || '', type: 'Lead' as const }))
  ];

  // Ordenar contatos pela data da última mensagem (mais recente primeiro)
  const contacts = rawContacts.map(contact => {
    const contactMsgs = interactions.filter(i => i.clientId === contact.id);
    const lastMsg = contactMsgs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    return {
      ...contact,
      lastMsg,
      lastMsgTime: lastMsg ? new Date(lastMsg.createdAt).getTime() : 0
    };
  }).sort((a, b) => b.lastMsgTime - a.lastMsgTime);

  const filteredContacts = contacts.filter(c =>
    (c.name || '').toLowerCase().includes(searchFilter.toLowerCase()) ||
    (c.phone || '').includes(searchFilter)
  );

  const [selectedContactId, setSelectedContactId] = useState<string>(contacts[0]?.id || '');
  const [typedMessage, setTypedMessage] = useState('');
  const [suggestingReply, setSuggestingReply] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Guarda o contato criado agora, que ainda não apareceu na lista recarregada
  const pendingSelectionRef = useRef<string | null>(null);

  const selectedContact = contacts.find(c => c.id === selectedContactId);
  const activeInteractions = interactions
    .filter(i => i.clientId === selectedContactId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Auto scroll to bottom when messages list update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeInteractions.length, selectedContactId]);

  // Adjust selection if the current contact is deleted
  useEffect(() => {
    if (contacts.length === 0) {
      setSelectedContactId('');
      return;
    }
    const exists = contacts.some(c => c.id === selectedContactId);
    if (exists) {
      pendingSelectionRef.current = null;
      return;
    }
    // Não roubar a seleção de uma conversa recém-criada enquanto a lista recarrega
    if (pendingSelectionRef.current && pendingSelectionRef.current === selectedContactId) return;
    setSelectedContactId(contacts[0].id);
  }, [contacts, selectedContactId]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedMessage.trim() || !selectedContactId) return;

    onSendMessage(selectedContactId, typedMessage);
    setTypedMessage('');
    setAiSuggestion(null);
  };

  const handleCreateNewChat = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPhone = newContactPhone.replace(/\D/g, '');
    if (cleanPhone.length < 10) {
      setNewChatError('Informe o número com DDD (mínimo 10 dígitos).');
      return;
    }

    setCreatingChat(true);
    setNewChatError('');
    const formattedPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
    const name = newContactName.trim() || `WhatsApp (${cleanPhone.slice(-4)})`;

    const closeModal = () => {
      setShowNewChatModal(false);
      setNewContactName('');
      setNewContactPhone('');
      setNewChatError('');
    };

    try {
      // Verificar se já existe um lead/cliente com este telefone (comparando os
      // últimos 8 dígitos para ignorar diferenças de 55/DDD/nono dígito)
      const tail = formattedPhone.slice(-8);
      const existing = contacts.find(c => (c.phone || '').replace(/\D/g, '').slice(-8) === tail);

      if (existing) {
        setSelectedContactId(existing.id);
        closeModal();
        setCreatingChat(false);
        return;
      }

      // Criar novo lead
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': localStorage.getItem('userRole') || '',
          'x-salesperson-name': localStorage.getItem('salespersonName') || ''
        },
        body: JSON.stringify({
          name,
          whatsapp: formattedPhone,
          treatment: 'Atendimento Geral',
          message: 'Conversa iniciada manualmente no Atendimento CRM.',
          status: 'novo'
        })
      });

      const data = await response.json();
      if (response.ok && data.id) {
        pendingSelectionRef.current = data.id;
        setSelectedContactId(data.id);
        closeModal();
        if (onRefreshData) onRefreshData();
      } else {
        setNewChatError(data.details || data.error || 'Erro ao criar conversa.');
      }
    } catch (e) {
      setNewChatError('Erro ao conectar com o servidor.');
    } finally {
      setCreatingChat(false);
    }
  };

  const handleSuggestReply = async () => {
    if (!selectedContactId) return;
    setSuggestingReply(true);
    setAiSuggestion(null);

    try {
      const response = await fetch('/api/gemini/suggest-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedContactId }),
      });

      const data = await response.json();
      if (response.ok) {
        setAiSuggestion(data.suggestion);
      } else {
        alert(data.error || 'Erro ao obter sugestão de IA');
      }
    } catch (e) {
      alert('Não foi possível conectar ao assistente de IA.');
    } finally {
      setSuggestingReply(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch h-[calc(100vh-140px)]">
      {/* Active Chats Sidebar */}
      <div className="lg:col-span-4 bg-white rounded-2xl border border-brand-gold/15 p-5 shadow-xs flex flex-col h-full overflow-hidden">
        <div className="pb-4 mb-3 border-b border-brand-beige flex justify-between items-center">
          <div>
            <h3 className="text-lg font-serif font-bold text-brand-brown">Conversas Ativas</h3>
            <p className="text-xs text-brand-brown/60">Atendimento Centralizado WhatsApp</p>
          </div>
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex items-center space-x-1.5 bg-brand-brown hover:bg-brand-brown/90 text-brand-beige text-xs font-semibold px-3 py-2 rounded-xl transition-all shadow-sm cursor-pointer"
            title="Novo Chat WhatsApp"
          >
            <span className="text-sm font-bold text-brand-gold">+</span>
            <span className="hidden sm:inline">Novo Chat</span>
          </button>
        </div>

        {/* Input de Busca na Lista */}
        <div className="mb-3">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Buscar por nome ou número..."
            className="w-full px-3 py-1.5 rounded-xl border border-brand-gold/20 bg-brand-cream/20 text-xs text-brand-brown focus:outline-none focus:ring-1 focus:ring-brand-gold"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
          {filteredContacts.length === 0 ? (
            <p className="text-xs text-brand-brown/50 text-center py-6">Nenhum contato encontrado.</p>
          ) : (
            filteredContacts.map((contact) => {
              const isSelected = selectedContactId === contact.id;
              const lastMsg = contact.lastMsg;

              return (
                <div key={contact.id} className="relative group w-full">
                  <button
                    onClick={() => {
                      setSelectedContactId(contact.id);
                      setAiSuggestion(null);
                    }}
                    className={`w-full text-left p-3.5 pr-10 rounded-xl border transition-all duration-300 flex flex-col ${
                      isSelected
                        ? 'bg-brand-brown border-brand-brown text-brand-beige shadow-md'
                        : 'bg-brand-cream/35 border-brand-gold/10 hover:border-brand-gold text-brand-brown'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full mb-1">
                      <span className="text-xs font-serif font-semibold truncate max-w-[140px]">{contact.name}</span>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border ${
                        isSelected 
                          ? 'bg-brand-gold/20 border-brand-gold/40 text-brand-beige' 
                          : contact.type === 'Paciente'
                            ? 'bg-brand-brown/5 border-brand-brown/10 text-brand-brown'
                            : 'bg-amber-100 border-amber-200 text-amber-800'
                      }`}>
                        {contact.type}
                      </span>
                    </div>
                    <div className={`text-xxs font-mono truncate w-full flex items-center space-x-1 ${isSelected ? 'text-brand-beige/80' : 'text-brand-brown/70'}`}>
                      <Phone className="h-2.5 w-2.5" />
                      <span>{contact.phone}</span>
                    </div>
                    {lastMsg && (
                      <div className="flex justify-between items-center mt-2 w-full">
                        <p className={`text-xxs truncate leading-relaxed max-w-[160px] ${isSelected ? 'text-brand-beige/70' : 'text-brand-brown/55'}`}>
                          {lastMsg.direction === 'out' ? 'Você: ' : ''}{lastMsg.content}
                        </p>
                        <span className={`text-[8px] font-mono ${isSelected ? 'text-brand-beige/60' : 'text-brand-brown/40'}`}>
                          {new Date(lastMsg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}
                  </button>

                  {/* Delete/Archive lead button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Deseja excluir permanentemente a conversa e o lead de "${contact.name}"?`)) {
                        onDeleteLead?.(contact.id);
                      }
                    }}
                    className={`absolute right-3.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-50 text-red-500 hover:text-red-700 transition-all ${
                      isSelected ? 'text-brand-beige/80 hover:bg-brand-gold/20 hover:text-white' : ''
                    }`}
                    title="Excluir Lead/Conversa"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal Novo Chat WhatsApp */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-brand-brown/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-brand-gold/20 rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
            <div className="flex justify-between items-center pb-3 border-b border-brand-beige">
              <h4 className="font-serif font-bold text-brand-brown text-base flex items-center space-x-2">
                <MessageCircle className="h-5 w-5 text-brand-gold" />
                <span>Novo Chat WhatsApp</span>
              </h4>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="text-xs text-brand-brown/60 hover:text-brand-brown font-semibold cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNewChat} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-brand-brown mb-1">Nome do Paciente / Lead</label>
                <input
                  type="text"
                  placeholder="Ex: Mariana Silva"
                  value={newContactName}
                  onChange={(e) => setNewContactName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-brand-gold/25 bg-white text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-brand-brown mb-1">Telefone WhatsApp (Com DDD) *</label>
                <input
                  type="tel"
                  required
                  placeholder="Ex: 15 99733-7628"
                  value={newContactPhone}
                  onChange={(e) => setNewContactPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-brand-gold/25 bg-white text-xs text-brand-brown font-mono focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
              </div>

              {newChatError && (
                <p className="text-xxs font-semibold text-red-600 bg-red-50 border border-red-150 py-1.5 px-3 rounded-lg">
                  {newChatError}
                </p>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-brand-brown/70 hover:bg-brand-beige/50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creatingChat}
                  className="bg-brand-brown hover:bg-brand-brown/90 disabled:bg-brand-brown/40 text-brand-beige text-xs font-semibold px-5 py-2 rounded-xl transition-all shadow-md flex items-center space-x-1.5 cursor-pointer"
                >
                  {creatingChat ? (
                    <Loader2 className="h-4 w-4 animate-spin text-brand-gold" />
                  ) : (
                    <span>Iniciar Atendimento</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Message Panel Console */}
      <div className="lg:col-span-8 bg-white rounded-2xl border border-brand-gold/15 shadow-xs flex flex-col h-full overflow-hidden">
        {selectedContact ? (
          <>
            {/* Console Header */}
            <div className="p-4 border-b border-brand-beige flex justify-between items-center bg-brand-cream/15">
              <div className="space-y-0.5">
                <h4 className="font-serif font-bold text-brand-brown text-sm flex items-center space-x-2">
                  <User className="h-4 w-4 text-brand-gold" />
                  <span>{selectedContact.name}</span>
                </h4>
                <p className="text-xxs font-mono text-brand-brown/60">Canal Ativo: WhatsApp ({selectedContact.phone})</p>
              </div>

              {/* Smart AI Reply Suggestion Button */}
              <button
                onClick={handleSuggestReply}
                disabled={suggestingReply}
                className="flex items-center space-x-2 bg-brand-brown hover:bg-brand-brown/90 disabled:bg-brand-brown/40 text-brand-beige text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md"
              >
                {suggestingReply ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold" />
                    <span>Gerando Resposta IA...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5 text-brand-gold" />
                    <span>Sugerir Resposta IA</span>
                  </>
                )}
              </button>
            </div>

            {/* AI Suggestion Box */}
            {aiSuggestion && (
              <div className="mx-4 mt-4 p-4 border border-brand-gold/30 rounded-xl bg-brand-cream/70 shadow-sm relative overflow-hidden">
                <div className="absolute top-2 right-2 flex items-center space-x-1 text-[10px] text-brand-brown font-mono bg-brand-gold/20 px-2 py-0.5 rounded-full font-bold">
                  <Bot className="h-3 w-3" />
                  <span>DRAFT IA</span>
                </div>
                <h5 className="text-xs font-serif font-bold text-brand-brown mb-1.5 flex items-center space-x-1">
                  <span>Sugestão de Atendimento Concierge:</span>
                </h5>
                <p className="text-xs text-brand-brown/90 leading-relaxed italic mb-3">"{aiSuggestion}"</p>
                <div className="flex space-x-2">
                  <button
                    onClick={() => {
                      setTypedMessage(aiSuggestion);
                      setAiSuggestion(null);
                    }}
                    className="text-xxs bg-brand-brown text-brand-beige px-3 py-1.5 rounded-md hover:bg-brand-brown/95 font-medium shadow-sm"
                  >
                    Usar Sugestão
                  </button>
                  <button
                    onClick={() => setAiSuggestion(null)}
                    className="text-xxs text-brand-brown/60 hover:text-brand-brown px-2 py-1.5"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            )}

            {/* Conversation Messages Thread */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {activeInteractions.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-20">
                  <MessageCircle className="h-10 w-10 text-brand-gold/40 mb-2" />
                  <p className="text-xs text-brand-brown/50">Nenhuma mensagem neste chat.</p>
                  <p className="text-[10px] text-brand-brown/45">Envie uma mensagem de boas-vindas para iniciar o atendimento!</p>
                </div>
              ) : (
                activeInteractions.map((msg) => {
                  const isOut = msg.direction === 'out';
                  const isSystem = msg.type === 'system';

                  if (isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-2">
                        <span className="bg-brand-gold/10 text-brand-brown font-mono text-[9px] px-3 py-1 rounded-full uppercase tracking-wider font-semibold border border-brand-gold/20">
                          ⚙️ {msg.content}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div key={msg.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[75%] rounded-2xl p-4 shadow-xxs leading-relaxed ${
                        isOut 
                          ? 'bg-brand-brown text-brand-beige rounded-br-none' 
                          : 'bg-brand-cream text-brand-brown border border-brand-gold/15 rounded-bl-none'
                      }`}>
                        <p className="text-xs whitespace-pre-line">{msg.content}</p>
                        <div className={`flex items-center justify-end space-x-1 text-[9px] font-mono mt-2 ${isOut ? 'text-brand-beige/60' : 'text-brand-brown/50'}`}>
                          <span>
                            {new Date(msg.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isOut && <CheckCheck className="h-3.5 w-3.5 text-brand-gold" />}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input Form Footer */}
            <form onSubmit={handleSend} className="p-4 border-t border-brand-beige bg-brand-cream/10 flex items-center space-x-3">
              <textarea
                rows={1}
                value={typedMessage}
                onChange={(e) => setTypedMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e);
                  }
                }}
                placeholder="Escreva sua mensagem concierge..."
                className="flex-1 px-4 py-3 rounded-xl border border-brand-gold/30 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown resize-none"
              />
              <button
                type="submit"
                disabled={!typedMessage.trim()}
                className="p-3 bg-brand-brown hover:bg-brand-brown/95 disabled:bg-brand-brown/40 text-brand-beige rounded-xl transition-all shadow-md flex items-center justify-center"
              >
                <Send className="h-4 w-4 text-brand-gold" />
              </button>
            </form>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center py-20 p-6">
            <MessageCircle className="h-12 w-12 text-brand-gold/40 mb-3" />
            <h4 className="font-serif font-semibold text-brand-brown">Selecione uma Conversa</h4>
            <p className="text-xs text-brand-brown/60 max-w-xs">Escolha um lead ou paciente na lista lateral para iniciar o atendimento digital boutique.</p>
          </div>
        )}
      </div>
    </div>
  );
}
