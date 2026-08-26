/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { EvolutionInstance } from '../types';
import { 
  Settings, 
  Plus, 
  QrCode, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Send, 
  MessageSquare, 
  Terminal, 
  User, 
  Camera,
  Layers,
  Lock
} from 'lucide-react';
import { motion } from 'motion/react';

interface EvolutionHubProps {
  onWebhookTriggered: () => void;
}

export default function EvolutionHub({ onWebhookTriggered }: EvolutionHubProps) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return sessionStorage.getItem('evolution_admin_auth') === 'true';
  });
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleVerifyPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'MusaElite2026!Vx7Q' || password === 'MusaEquipe2026!Rb4T') {
      setIsAuthenticated(true);
      sessionStorage.setItem('evolution_admin_auth', 'true');
      setErrorMsg('');
    } else {
      setErrorMsg('Senha incorreta! Acesso negado.');
      setPassword('');
    }
  };

  const [instances, setInstances] = useState<EvolutionInstance[]>([]);
  const [loadingInstances, setLoadingInstances] = useState(false);
  
  // Create Instance States
  const [newInstanceName, setNewInstanceName] = useState('');
  const [creatingInstance, setCreatingInstance] = useState(false);

  // Connection/QR Code States
  const [activeQrName, setActiveQrName] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState(false);

  // Webhook Simulator States
  const [simName, setSimName] = useState('');
  const [simPhone, setSimPhone] = useState('');
  const [simType, setSimType] = useState<'text' | 'image'>('text');
  const [simText, setSimText] = useState('');
  const [simImage, setSimImage] = useState<string | null>(null);
  const [sendingWebhook, setSendingWebhook] = useState(false);
  const [webhookLog, setWebhookLog] = useState<string | null>(null);

  const fetchInstances = async () => {
    setLoadingInstances(true);
    try {
      const response = await fetch('/api/evolution/instances');
      const data = await response.json();
      if (response.ok) {
        setInstances(data);
      }
    } catch (e) {
      console.error('Error fetching instances:', e);
    } finally {
      setLoadingInstances(false);
    }
  };

  useEffect(() => {
    fetchInstances();
  }, []);

  const handleCreateInstance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInstanceName.trim()) return;
    setCreatingInstance(true);

    try {
      const response = await fetch('/api/evolution/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: newInstanceName }),
      });

      const data = await response.json();
      if (response.ok) {
        setNewInstanceName('');
        fetchInstances();
      } else {
        alert(data.error || 'Erro ao criar instância');
      }
    } catch (e) {
      alert('Erro ao se conectar com o servidor.');
    } finally {
      setCreatingInstance(false);
    }
  };

  const handleConnectInstance = async (name: string) => {
    setActiveQrName(name);
    setLoadingQr(true);
    setQrCodeUrl(null);

    try {
      const response = await fetch(`/api/evolution/instances/connect/${name}`);
      const data = await response.json();
      if (response.ok) {
        setQrCodeUrl(data.qrcode);
      } else {
        alert(data.error || 'Erro ao carregar QR Code');
      }
    } catch (e) {
      alert('Erro ao carregar conexão.');
    } finally {
      setLoadingQr(false);
    }
  };

  const handleSimulateScan = async (name: string) => {
    try {
      const response = await fetch('/api/evolution/instances/simulate-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceName: name, number: '5511912345678' }),
      });
      if (response.ok) {
        setQrCodeUrl(null);
        setActiveQrName(null);
        fetchInstances();
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Webhook Simulator Actions
  const handleSimImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setSimImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSendWebhook = async () => {
    if (!simName.trim() || !simPhone.trim() || !simText.trim()) {
      alert('Por favor, preencha o Nome, Telefone e Mensagem no simulador.');
      return;
    }
    setSendingWebhook(true);
    setWebhookLog(null);

    // Mock Evolution API Webhook Payload
    const payload = {
      event: 'messages.upsert',
      instance: 'Musa_Estetica_Oficial',
      data: {
        key: {
          remoteJid: `${simPhone}@s.whatsapp.net`,
          fromMe: false,
          id: 'MOCK_MSG_' + Math.random().toString(36).substr(2, 9),
        },
        pushName: simName,
        messageType: simType === 'text' ? 'conversation' : 'imageMessage',
        message: simType === 'text' 
          ? { conversation: simText }
          : { 
              imageMessage: {
                caption: simText,
                url: 'https://simulated-storage.com/photo.jpg',
              } 
            }
      }
    };

    try {
      const response = await fetch('/api/webhook/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      setWebhookLog(JSON.stringify(data, null, 2));
      
      if (response.ok) {
        // Trigger callback to refresh App state (leads & interactions)
        onWebhookTriggered();
      }
    } catch (e) {
      setWebhookLog('Erro ao disparar webhook.');
    } finally {
      setSendingWebhook(false);
    }
  };

  return (
    <div className="relative min-h-[70vh]">
      {/* Blurred background page content when not authenticated */}
      <div className={`space-y-8 transition-all duration-500 ${!isAuthenticated ? 'filter blur-md pointer-events-none select-none' : ''}`}>
        {/* Module Intro */}
        <div className="bg-white p-6 rounded-2xl border border-brand-gold/15 shadow-xs">
          <h2 className="text-xl font-serif font-bold text-brand-brown">Integração WhatsApp - Evolution API</h2>
          <p className="text-sm text-brand-brown/70 leading-relaxed max-w-4xl">
            A Evolution API permite que você conecte o CRM a contas reais do WhatsApp sem depender da API Oficial da Meta. 
            Gerencie instâncias de atendimento e utilize nosso Simulador de Webhook exclusivo para testar fluxos de captação e conversas em tempo real.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left column: Instances Management */}
          <div className="lg:col-span-7 space-y-6">
            {/* Active Instances Box */}
            <div className="bg-white p-6 rounded-2xl border border-brand-gold/15 shadow-xs space-y-4">
              <div className="flex justify-between items-center pb-3 border-b border-brand-beige">
                <h3 className="font-serif font-semibold text-brand-brown flex items-center space-x-2">
                  <Settings className="h-4 w-4 text-brand-gold" />
                  <span>Instâncias WhatsApp</span>
                </h3>
                <button
                  onClick={fetchInstances}
                  disabled={loadingInstances}
                  className="p-1.5 hover:bg-brand-beige text-brand-brown/70 rounded-lg"
                >
                  <RefreshCw className={`h-4 w-4 ${loadingInstances ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* List */}
              <div className="space-y-4">
                {instances.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-xs text-brand-brown/50">
                      {loadingInstances
                        ? 'Carregando instâncias...'
                        : 'Nenhuma instância encontrada na Evolution API. Crie uma abaixo para começar.'}
                    </p>
                  </div>
                ) : (
                  instances.map((inst) => {
                    const isOpen = inst.status === 'open';
                    const isConnecting = inst.status === 'connecting';

                    return (
                      <div 
                        key={inst.name} 
                        className="p-4 rounded-xl border border-brand-gold/15 bg-brand-cream/15 flex flex-col md:flex-row justify-between items-start md:items-center gap-4"
                      >
                        <div className="space-y-1">
                          <span className="text-xs font-serif font-bold text-brand-brown">{inst.name}</span>
                          <div className="flex items-center space-x-2 text-xxs font-mono">
                            <span className={`h-2 w-2 rounded-full ${isOpen ? 'bg-emerald-500' : isConnecting ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
                            <span className="uppercase text-brand-brown/70">
                              {isOpen ? 'CONECTADA' : isConnecting ? 'AGUARDANDO LEITURA' : 'DESCONECTADA'}
                            </span>
                            {inst.number && (
                              <span className="text-brand-brown/50">| Núm: {inst.number}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex space-x-2">
                          {!isOpen && (
                            <button
                              onClick={() => handleConnectInstance(inst.name)}
                              className="flex items-center space-x-1 bg-brand-brown hover:bg-brand-brown/95 text-brand-beige text-xxs font-semibold px-3 py-2 rounded-lg transition-all cursor-pointer"
                            >
                              <QrCode className="h-3.5 w-3.5 text-brand-gold" />
                              <span>{isConnecting ? 'Mostrar QR Code' : 'Conectar'}</span>
                            </button>
                          )}
                          {isOpen && (
                            <span className="text-emerald-600 text-xxs font-mono font-bold flex items-center space-x-1 bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-lg">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>ONLINE</span>
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Create Instance Form */}
              <form onSubmit={handleCreateInstance} className="pt-4 border-t border-brand-beige flex gap-3">
                <input
                  type="text"
                  required
                  value={newInstanceName}
                  onChange={(e) => setNewInstanceName(e.target.value)}
                  placeholder="Nome da nova instância..."
                  className="flex-1 px-3 py-2 rounded-xl border border-brand-gold/20 bg-white text-xs text-brand-brown focus:outline-none focus:ring-2 focus:ring-brand-gold"
                />
                <button
                  type="submit"
                  disabled={creatingInstance}
                  className="bg-brand-brown hover:bg-brand-brown/95 disabled:bg-brand-brown/40 text-brand-beige text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer font-serif"
                >
                  {creatingInstance ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-gold" />
                  ) : (
                    <Plus className="h-3.5 w-3.5 text-brand-gold" />
                  )}
                  <span>Criar</span>
                </button>
              </form>
            </div>

            {/* QR Display box */}
            {activeQrName && (
              <div className="bg-white p-6 rounded-2xl border border-brand-gold/15 shadow-xs space-y-4">
                <div className="flex justify-between items-center pb-3 border-b border-brand-beige">
                  <h3 className="font-serif font-semibold text-brand-brown flex items-center space-x-2">
                    <QrCode className="h-4 w-4 text-brand-gold" />
                    <span>Conectar Instância: {activeQrName}</span>
                  </h3>
                  <button 
                    onClick={() => setActiveQrName(null)}
                    className="text-xxs text-brand-brown/60 hover:text-brand-brown font-semibold cursor-pointer"
                  >
                    Fechar
                  </button>
                </div>

                <div className="flex flex-col items-center justify-center py-6 space-y-4">
                  {loadingQr ? (
                    <div className="flex flex-col items-center space-y-2">
                      <Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
                      <p className="text-xxs text-brand-brown/70 font-mono">Gerando QR Code...</p>
                    </div>
                  ) : qrCodeUrl ? (
                    <>
                      <div className="p-3 bg-white border border-brand-gold/25 rounded-2xl shadow-inner">
                        <img src={qrCodeUrl} alt="WhatsApp QR Code" className="w-56 h-56 rounded-lg" />
                      </div>
                      <p className="text-xxs text-brand-brown/70 text-center leading-relaxed max-w-sm">
                        Abra o WhatsApp no seu celular, vá em <strong>Aparelhos Conectados &gt; Conectar um Aparelho</strong> e aponte a câmera para o código acima.
                      </p>
                    </>
                  ) : (
                    <div className="text-center py-4 space-y-2">
                      <AlertCircle className="h-8 w-8 text-amber-500 mx-auto" />
                      <p className="text-xxs text-brand-brown/75 max-w-xs mx-auto">
                        Não foi possível recuperar o QR code. Garanta que a instância existe e está desconectada.
                      </p>
                      <button
                        onClick={() => handleConnectInstance(activeQrName)}
                        className="bg-brand-beige hover:bg-brand-beige/80 text-brand-brown text-xxs font-bold py-1 px-3 rounded-lg border border-brand-gold/20"
                      >
                        Tentar Novamente
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Right column: Webhook simulator */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-brand-gold/15 shadow-xs space-y-4">
              <h3 className="font-serif font-semibold text-brand-brown flex items-center space-x-2">
                <Terminal className="h-5 w-5 text-brand-gold" />
                <span>Simulador de Webhooks WhatsApp</span>
              </h3>
              <p className="text-xxs text-brand-brown/70 leading-relaxed">
                Dispare payloads de mensagens simulando o comportamento de um paciente real entrando em contato. 
                Isso enviará um POST real para <strong>/api/webhook/whatsapp</strong> do CRM, testando toda a lógica de captação e nutrição automática!
              </p>

              <div className="space-y-3.5">
                <div>
                  <label className="block text-xxs font-semibold text-brand-brown uppercase mb-1">Nome do Paciente</label>
                  <input
                    type="text"
                    required
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    placeholder="Ex: Mariana Lima"
                    className="w-full px-3 py-2 rounded-xl border border-brand-gold/20 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown"
                  />
                </div>

                <div>
                  <label className="block text-xxs font-semibold text-brand-brown uppercase mb-1">WhatsApp de Simulação</label>
                  <input
                    type="tel"
                    required
                    value={simPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    placeholder="Apenas DDD + Número (Ex: 11981149310 - sem 55)"
                    className="w-full px-3 py-2 rounded-xl border border-brand-gold/20 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown font-mono"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xxs font-semibold text-brand-brown uppercase mb-1">Tipo de Mensagem</label>
                    <select
                      value={simType}
                      onChange={(e) => setSimType(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl border border-brand-gold/20 bg-white text-xs text-brand-brown"
                    >
                      <option value="text">Texto Simples</option>
                      <option value="image">Foto de Pele (Anamnese)</option>
                    </select>
                  </div>

                  {simType === 'image' && (
                    <div>
                      <label className="block text-xxs font-semibold text-brand-brown uppercase mb-1">Carregar Foto</label>
                      <div className="relative border border-brand-gold/20 rounded-xl bg-white px-3 py-2 text-center cursor-pointer hover:bg-brand-cream/30 transition-all flex items-center justify-center gap-1">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleSimImageChange}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <Camera className="h-3.5 w-3.5 text-brand-gold" />
                        <span className="text-[10px] truncate max-w-[100px] text-brand-brown font-mono">
                          {simImage ? 'Carregada' : 'Escolher'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xxs font-semibold text-brand-brown uppercase mb-1">Mensagem do Paciente</label>
                  <textarea
                    rows={3}
                    value={simText}
                    onChange={(e) => setSimText(e.target.value)}
                    placeholder="Ex: Olá! Gostaria de agendar uma avaliação."
                    className="w-full p-3 rounded-xl border border-brand-gold/20 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-brand-gold text-brand-brown leading-relaxed"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSendWebhook}
                  disabled={sendingWebhook}
                  className="w-full flex items-center justify-center space-x-2 bg-brand-brown hover:bg-brand-brown/95 disabled:bg-brand-brown/40 text-brand-beige py-2.5 rounded-xl text-xs font-semibold transition-all shadow-md font-serif"
                >
                  {sendingWebhook ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin text-brand-gold" />
                      <span>Disparando Webhook...</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5 text-brand-gold" />
                      <span>Disparar Webhook WhatsApp</span>
                    </>
                  )}
                </button>
              </div>

              {/* Webhook Response Log Terminal */}
              {webhookLog && (
                <div className="space-y-1.5 pt-4 border-t border-brand-gold/20">
                  <span className="block text-[10px] font-mono font-bold text-brand-brown/70 flex items-center space-x-1">
                    <Terminal className="h-3 w-3" />
                    <span>LOG DE EXECUÇÃO WEBHOOK:</span>
                  </span>
                  <pre className="p-3 bg-brand-brown text-emerald-400 font-mono text-[9px] rounded-lg overflow-x-auto max-h-48 leading-relaxed whitespace-pre shadow-inner">
                    {webhookLog}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Security Overlay Modal */}
      {!isAuthenticated && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-brand-brown/5 backdrop-blur-xs min-h-[500px]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', damping: 25, stiffness: 250 }}
            className="w-full max-w-lg bg-white/95 border border-red-200 shadow-2xl rounded-2xl p-6 md:p-10 text-center relative z-10 flex flex-col items-center justify-center space-y-6"
          >
            {/* Warning Icon */}
            <div className="bg-red-50 text-red-600 p-4 rounded-full flex items-center justify-center shadow-inner">
              <Lock className="h-8 w-8 text-red-600 animate-pulse" />
            </div>
            
            <div className="space-y-3">
              <h2 className="text-xl md:text-2xl font-serif font-black text-red-600 tracking-wide uppercase leading-snug">
                ACESSO PERMITIDO APENAS AO ADMINISTRADOR DO SISTEMA
              </h2>
              <p className="text-xs md:text-sm text-brand-brown/70 leading-relaxed font-sans max-w-md mx-auto">
                Nesta aba, <strong>apenas e unicamente</strong> o usuário com a senha de acesso.
              </p>
            </div>

            <form onSubmit={handleVerifyPassword} className="w-full space-y-4 max-w-sm">
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Insira a senha de administrador..."
                  className="w-full px-4 py-3 rounded-xl border border-red-200 bg-red-50/20 text-xs focus:outline-none focus:ring-2 focus:ring-red-500 text-brand-brown text-center tracking-widest font-mono placeholder:tracking-normal placeholder:font-sans"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-brown/50 hover:text-brand-brown transition-colors cursor-pointer text-[10px] font-bold uppercase tracking-wider font-sans select-none"
                >
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>

              {errorMsg && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-xxs font-semibold text-red-600 bg-red-50 border border-red-150 py-1.5 px-3 rounded-lg"
                >
                  {errorMsg}
                </motion.div>
              )}

              <button
                type="submit"
                className="w-full flex items-center justify-center space-x-2 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white py-3 rounded-xl text-xs font-bold transition-all shadow-md uppercase tracking-wider font-serif cursor-pointer"
              >
                <span>Verificar Acesso</span>
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
