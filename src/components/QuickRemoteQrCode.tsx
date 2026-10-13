import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Smartphone, Maximize2, Check, Copy, Wifi, X, QrCode, ExternalLink, Globe, Edit2 } from 'lucide-react';
import { NodeSyncService } from '../services/nodeSync';
import { detectRealDeviceIp, DetectedIpCandidate } from '../utils/networkIp';

interface QuickRemoteQrCodeProps {
  onOpenNodeSync?: () => void;
  className?: string;
  compactOnMobile?: boolean;
}

export const QuickRemoteQrCode: React.FC<QuickRemoteQrCodeProps> = ({
  onOpenNodeSync,
  className = '',
  compactOnMobile = true
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkMode, setLinkMode] = useState<'lan' | 'origin'>(() => {
    const isLocal =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '0.0.0.0');
    return isLocal ? 'lan' : 'origin';
  });

  const [room, setRoom] = useState<string>(() => {
    try {
      return localStorage.getItem('serchtube_room') || NodeSyncService.getInstance().getConfig().room || 'serchtube-master';
    } catch {
      return 'serchtube-master';
    }
  });

  const [localIp, setLocalIp] = useState<string>(() => {
    try {
      return localStorage.getItem('serchtube_local_ip') || '';
    } catch {
      return '';
    }
  });

  const [detectedIp, setDetectedIp] = useState<string>('');
  const [candidates, setCandidates] = useState<DetectedIpCandidate[]>([]);
  const [isEditingIp, setIsEditingIp] = useState<boolean>(false);
  const [customIpInput, setCustomIpInput] = useState<string>('');

  // Auto-detect real LAN IP
  useEffect(() => {
    let isMounted = true;
    detectRealDeviceIp()
      .then(res => {
        if (!isMounted) return;
        setCandidates(res.candidates || []);
        if (res.primaryIp) {
          setDetectedIp(res.primaryIp);
          if (!localIp || localIp === '192.168.1.100') {
            setLocalIp(res.primaryIp);
            setCustomIpInput(res.primaryIp);
          }
        }
      })
      .catch(() => {});

    // Escuchar actualizaciones de localStorage
    const handleStorageChange = () => {
      try {
        const savedRoom = localStorage.getItem('serchtube_room');
        if (savedRoom) setRoom(savedRoom);
        const savedIp = localStorage.getItem('serchtube_local_ip');
        if (savedIp) {
          setLocalIp(savedIp);
          setCustomIpInput(savedIp);
        }
      } catch {}
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      isMounted = false;
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [localIp]);

  // Calcular la URL optimizada para el mando satélite móvil
  const remoteUrl = useMemo(() => {
    const activeRoom = room || 'serchtube-master';
    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '0.0.0.0');

    // Si el usuario eligió modo URL del navegador o si no es localhost
    if (linkMode === 'origin' || (!isLocalhost && !localIp)) {
      return `${window.location.origin}/?role=satellite&room=${encodeURIComponent(activeRoom)}`;
    }

    // Modo IP LAN para conectar celulares en la misma red Wi-Fi
    const bestIp = localIp || detectedIp || '192.168.1.100';
    const port = (typeof window !== 'undefined' && window.location.port) ? window.location.port : '3000';
    return `http://${bestIp}:${port}/?role=satellite&room=${encodeURIComponent(activeRoom)}`;
  }, [room, localIp, detectedIp, linkMode]);

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(remoteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  const handleSelectCandidate = (ip: string) => {
    setLocalIp(ip);
    setCustomIpInput(ip);
    setLinkMode('lan');
    try {
      localStorage.setItem('serchtube_local_ip', ip);
    } catch (_) {}
  };

  const handleSaveCustomIp = () => {
    if (customIpInput.trim()) {
      const clean = customIpInput.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0];
      setLocalIp(clean);
      setLinkMode('lan');
      setIsEditingIp(false);
      try {
        localStorage.setItem('serchtube_local_ip', clean);
      } catch (_) {}
    }
  };

  return (
    <>
      {/* Quick QR Card at bottom-left */}
      <div
        id="quick-remote-qr-card"
        onClick={() => setIsModalOpen(true)}
        className={`group relative flex items-center gap-2.5 p-1.5 sm:p-2 rounded-2xl bg-black/70 hover:bg-black/90 border border-white/15 hover:border-red-500/50 shadow-lg hover:shadow-[0_0_20px_rgba(220,38,38,0.25)] transition-all duration-300 cursor-pointer flex-shrink-0 select-none ${className}`}
        title="Escanea con tu celular para abrir el control remoto (clic para ampliar)"
      >
        {/* Crisp Large QR Code Container */}
        <div className="relative bg-white p-2 rounded-xl flex items-center justify-center flex-shrink-0 shadow-2xl group-hover:scale-[1.02] transition-transform duration-200">
          <QRCodeSVG
            value={remoteUrl}
            size={116}
            level="M"
            marginSize={1}
            bgColor="#ffffff"
            fgColor="#000000"
          />
          {/* Subtle expand hint on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <Maximize2 size={24} className="text-white drop-shadow" />
          </div>
        </div>

        {/* Compact Text Details */}
        <div className="flex flex-col justify-center min-w-0 max-w-[110px] pr-1">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-[9.5px] font-black text-red-400 uppercase tracking-wider flex items-center gap-0.5 truncate">
              <Smartphone size={11} className="text-red-400 shrink-0" />
              Control
            </span>
          </div>

          <h3 className="text-xs font-bold text-white tracking-tight leading-tight group-hover:text-red-400 transition-colors">
            Escanea con Celular
          </h3>
          <p className="text-[10px] text-gray-400 leading-tight mt-0.5">
            Mando web
          </p>

          <div className="mt-1.5 flex items-center text-[8.5px] text-gray-400 font-mono">
            <span className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300 border border-white/10 truncate">
              Toca para ampliar
            </span>
          </div>
        </div>
      </div>

      {/* Enlarged Modal Overlay when clicked */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-black/95 border border-white/15 rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl relative flex flex-col items-center text-center animate-scaleUp max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>

            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="p-2 rounded-xl bg-red-600/20 border border-red-500/30 text-red-500">
                <Smartphone size={24} />
              </div>
              <div className="text-left">
                <h2 className="text-lg font-bold text-white">Mando Remoto Móvil</h2>
                <p className="text-xs text-gray-400">Escanea con la cámara de tu smartphone para controlar la música</p>
              </div>
            </div>

            {/* Selector de Modo: IP LAN Wi-Fi vs URL Navegador */}
            <div className="flex items-center gap-1.5 p-1 bg-white/5 border border-white/10 rounded-xl mb-3 text-xs w-full max-w-sm">
              <button
                type="button"
                onClick={() => setLinkMode('lan')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  linkMode === 'lan'
                    ? 'bg-red-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Wifi size={13} />
                <span>Wi-Fi Local (IP)</span>
              </button>
              <button
                type="button"
                onClick={() => setLinkMode('origin')}
                className={`flex-1 py-1.5 px-2 rounded-lg font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  linkMode === 'origin'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Globe size={13} />
                <span>URL Web Actual</span>
              </button>
            </div>

            {/* Giant QR Code */}
            <div className="my-2 p-4 bg-white rounded-2xl shadow-[0_0_35px_rgba(255,255,255,0.18)] flex items-center justify-center border-4 border-white">
              <QRCodeSVG
                value={remoteUrl}
                size={220}
                level="Q"
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#000000"
              />
            </div>

            {/* Chips de IPs detectadas para cambio instantáneo */}
            {linkMode === 'lan' && candidates.length > 0 && (
              <div className="w-full max-w-sm my-2 text-left">
                <span className="text-[11px] text-gray-400 font-semibold block mb-1">
                  Direcciones IP disponibles en este equipo:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSelectCandidate(c.ip)}
                      className={`text-[10.5px] px-2 py-0.5 rounded-lg border font-mono transition-all cursor-pointer ${
                        localIp === c.ip
                          ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold'
                          : 'bg-white/5 border-white/10 text-gray-300 hover:border-white/30'
                      }`}
                    >
                      {c.ip}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="space-y-1 mb-3 max-w-xs text-xs text-gray-300">
              <p className="font-semibold text-white">¿Cómo conectarse?</p>
              <p className="text-gray-400 text-[11px] leading-relaxed">
                1. Conecta tu celular a la misma red Wi-Fi.<br />
                2. Apunta la cámara al QR y abre el enlace.<br />
                3. SerchTube cargará el mando satélite y se sincronizará automáticamente.
              </p>
            </div>

            {/* URL Box, Copy & Test */}
            <div className="w-full flex flex-col gap-1.5 p-2 bg-white/5 border border-white/10 rounded-xl mb-3 text-xs font-mono text-gray-300">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly={!isEditingIp}
                  value={isEditingIp ? customIpInput : remoteUrl}
                  onChange={(e) => setCustomIpInput(e.target.value)}
                  placeholder="ej. 192.168.1.150"
                  className={`flex-1 outline-none text-gray-200 px-1 text-[11px] bg-transparent truncate ${
                    isEditingIp ? 'border-b border-red-500 text-white' : ''
                  }`}
                />
                {isEditingIp ? (
                  <button
                    type="button"
                    onClick={handleSaveCustomIp}
                    className="px-2.5 py-1 rounded bg-green-600 hover:bg-green-500 text-white font-bold text-xs cursor-pointer"
                  >
                    Guardar
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomIpInput(localIp || detectedIp || '');
                      setIsEditingIp(true);
                    }}
                    title="Editar IP manualmente"
                    className="p-1 rounded text-gray-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <Edit2 size={13} />
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCopyLink}
                  className={`px-3 py-1 rounded-lg flex items-center gap-1 font-bold transition-all text-xs cursor-pointer ${
                    copied
                      ? 'bg-green-600 text-white'
                      : 'bg-white/10 hover:bg-white/20 text-white'
                  }`}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>

              {/* Botón de prueba directa en este navegador */}
              <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
                <span>¿Deseas probar el mando satélite aquí?</span>
                <a
                  href={`/remote?room=${encodeURIComponent(room)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-400 hover:text-cyan-300 font-bold flex items-center gap-1 cursor-pointer"
                >
                  <span>Abrir Mando en Nueva Pestaña</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>

            {/* Footer Actions */}
            <div className="w-full flex items-center justify-between pt-2 border-t border-white/10 text-xs">
              {onOpenNodeSync && (
                <button
                  type="button"
                  onClick={() => {
                    setIsModalOpen(false);
                    onOpenNodeSync();
                  }}
                  className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer py-1"
                >
                  <Wifi size={14} />
                  <span>Configuración Avanzada de Red</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-white text-black font-bold hover:bg-gray-200 transition-colors ml-auto cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
