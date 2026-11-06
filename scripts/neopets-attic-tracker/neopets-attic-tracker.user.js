// ==UserScript==
// @name         Neopets: Rastreador & Temporizador do Sótão Quase Abandonado
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.0
// @description  Temporizador e rastreador de horários de restock para o Sótão Quase Abandonado (Almost Abandoned Attic) do Neopets com conversor de fuso horário, alertas sonoros e notificações.
// @author       t-moedano
// @match        *://*.neopets.com/halloween/garage.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-attic-tracker/neopets-attic-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-attic-tracker/neopets-attic-tracker.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'neopets_attic_tracker_v1';
    const NST_TIMEZONE = 'America/Los_Angeles';

    // Regra matemática do Sótão:
    // Ciclo base de restock: 7 minutos (420 segundos)
    // Janela de incerteza cumulativa (drift): até 15 segundos por ciclo
    const RESTOCK_CYCLE_MS = 7 * 60 * 1000;
    const CYCLE_DRIFT_STEP_MS = 15 * 1000;

    // Configurações padrão
    const DEFAULT_CONFIG = {
        lastRestockTimestamp: null,  // Timestamp UTC (ms) do último restock confirmado
        timezone: 'America/Sao_Paulo', // Padrão: Horário de Brasília
        soundEnabled: true,
        soundVolume: 0.35,
        soundAlert30s: true,
        soundAlert10s: true,
        soundAlertWindow: true,
        tabTitleCountdown: true,
        overtimeSeconds: 35, // Segundos adicionais de tolerância após a janela oficial
        panelCollapsed: false
    };

    // Fuso horários populares para seleção rápida
    const COMMON_TIMEZONES = [
        { label: '🇧🇷 Horário de Brasília (BRT / UTC-3)', value: 'America/Sao_Paulo' },
        { label: '🇧🇷 Horário de Manaus / Amazonas (AMT / UTC-4)', value: 'America/Manaus' },
        { label: '🇧🇷 Horário de Fernando de Noronha (FNT / UTC-2)', value: 'America/Noronha' },
        { label: '🇧🇷 Horário do Acre (ACT / UTC-5)', value: 'America/Rio_Branco' },
        { label: '🇵🇹 Horário de Lisboa / Portugal (WET / WEST)', value: 'Europe/Lisbon' },
        { label: '🌐 Horário Universal Coordenado (UTC)', value: 'UTC' },
        { label: '💻 Fuso Horário Local do Navegador', value: 'AUTO' }
    ];

    // =========================================================================
    // GERENCIAMENTO DE STORAGE
    // =========================================================================

    function loadConfig() {
        try {
            let raw = null;
            if (typeof GM_getValue !== 'undefined') {
                raw = GM_getValue(STORAGE_KEY, null);
            }
            if (!raw) {
                raw = localStorage.getItem(STORAGE_KEY);
            }
            if (raw) {
                const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return { ...DEFAULT_CONFIG, ...parsed };
            }
        } catch (e) {
            console.warn('[Attic Tracker] Erro ao carregar configurações:', e);
        }
        return { ...DEFAULT_CONFIG };
    }

    function saveConfig(cfg) {
        try {
            const serialized = JSON.stringify(cfg);
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(STORAGE_KEY, serialized);
            }
            localStorage.setItem(STORAGE_KEY, serialized);
        } catch (e) {
            console.warn('[Attic Tracker] Erro ao salvar configurações:', e);
        }
    }

    let config = loadConfig();

    // =========================================================================
    // SINCRONIZAÇÃO DE TEMPO & FUSOS HORÁRIOS
    // =========================================================================

    // Diferença em ms entre o relógio local do usuário e o relógio do Neopets (caso haja drift no PC)
    let serverTimeDriftMs = 0;
    const pageLoadLocalPerf = performance.now();
    const pageLoadLocalDate = Date.now();

    function detectServerNstTime() {
        // Tenta encontrar o elemento oficial do relógio no layout clássico
        const nstEl = document.querySelector('#nst, .nst, span[id="nst"]');
        if (!nstEl || !nstEl.textContent) return;

        const text = nstEl.textContent.trim();
        // Formatos comuns: "1:23:45 pm NST" ou "01:23:45 pm" ou "13:23:45"
        const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (!match) return;

        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = match[3] ? parseInt(match[3], 10) : 0;
        const meridian = match[4] ? match[4].toLowerCase() : null;

        if (meridian === 'pm' && hours < 12) hours += 12;
        if (meridian === 'am' && hours === 12) hours = 0;

        // Calcula o timestamp NST esperado correspondente a hoje
        const nowUtc = new Date();
        const nstDateStr = nowUtc.toLocaleDateString('en-US', { timeZone: NST_TIMEZONE });
        const estimatedNstDate = new Date(`${nstDateStr} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} GMT-0700`);

        // Ajusta para PDT (UTC-7) ou PST (UTC-8) automaticamente
        const nstFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: NST_TIMEZONE,
            timeZoneName: 'short'
        });
        const isPdt = nstFormatter.format(nowUtc).includes('PDT');
        const offsetHours = isPdt ? 7 : 8;
        const targetServerUtcMs = Date.UTC(
            nowUtc.getUTCFullYear(),
            nowUtc.getUTCMonth(),
            nowUtc.getUTCDate(),
            hours + offsetHours,
            minutes,
            seconds
        );

        // Se a diferença for plausível (< 12 horas), calcula a compensação
        const diff = targetServerUtcMs - pageLoadLocalDate;
        if (Math.abs(diff) < 12 * 60 * 60 * 1000) {
            serverTimeDriftMs = diff;
        }
    }

    // Retorna o timestamp atual compensado
    function getCorrectedNow() {
        const elapsed = performance.now() - pageLoadLocalPerf;
        return pageLoadLocalDate + elapsed + serverTimeDriftMs;
    }

    function resolveUserTimezone() {
        if (!config.timezone || config.timezone === 'AUTO') {
            try {
                return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
            } catch (e) {
                return 'America/Sao_Paulo';
            }
        }
        return config.timezone;
    }

    function formatTimeInZone(timestamp, timezone, withSeconds = true) {
        if (!timestamp) return '--:--:--';
        try {
            const d = new Date(timestamp);
            return d.toLocaleTimeString('pt-BR', {
                timeZone: timezone,
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                second: withSeconds ? '2-digit' : undefined
            });
        } catch (e) {
            const d = new Date(timestamp);
            return d.toTimeString().split(' ')[0];
        }
    }

    function formatDuration(ms) {
        if (ms <= 0) return '00:00';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    // Converte string de hora NST digitada (ex: "14:22:15" ou "2:22 pm") para timestamp absoluto
    function parseNstInputToTimestamp(inputStr) {
        if (!inputStr) return null;
        const clean = inputStr.trim();
        const match = clean.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
        if (!match) return null;

        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = match[3] ? parseInt(match[3], 10) : 0;
        const meridian = match[4] ? match[4].toLowerCase() : null;

        if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
            return null;
        }

        if (meridian === 'pm' && hours < 12) hours += 12;
        if (meridian === 'am' && hours === 12) hours = 0;

        const now = new Date(getCorrectedNow());
        // Obtém o ano/mês/dia atual no fuso NST
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: NST_TIMEZONE,
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour12: false
        }).formatToParts(now);

        let y, m, d;
        for (const p of parts) {
            if (p.type === 'year') y = parseInt(p.value, 10);
            if (p.type === 'month') m = parseInt(p.value, 10);
            if (p.type === 'day') d = parseInt(p.value, 10);
        }

        // Descobre o offset UTC de NST hoje
        const nstIso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        // Cria objeto provisório em UTC e ajusta
        const isDst = new Intl.DateTimeFormat('en-US', { timeZone: NST_TIMEZONE, timeZoneName: 'short' }).format(now).includes('PDT');
        const offsetHours = isDst ? 7 : 8;

        let targetUtcMs = Date.UTC(y, m - 1, d, hours + offsetHours, minutes, seconds);

        // Se o horário informado estiver no futuro em relação ao momento atual (por mais de 10 min),
        // assume-se que foi no dia anterior
        if (targetUtcMs > now.getTime() + 10 * 60 * 1000) {
            targetUtcMs -= 24 * 60 * 60 * 1000;
        }

        return targetUtcMs;
    }

    // =========================================================================
    // GERADOR DE ALERTAS SONOROS (WEB AUDIO API NATIVA)
    // =========================================================================

    let audioCtx = null;

    function getAudioContext() {
        if (!audioCtx) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (AudioContextClass) {
                audioCtx = new AudioContextClass();
            }
        }
        if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        return audioCtx;
    }

    function playBeep(frequency, durationMs, startTimeOffset = 0, type = 'sine') {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;

            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(frequency, ctx.currentTime + startTimeOffset);

            const vol = Math.max(0.01, Math.min(1, config.soundVolume || 0.35));
            gain.gain.setValueAtTime(0.001, ctx.currentTime + startTimeOffset);
            gain.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + startTimeOffset + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + startTimeOffset + (durationMs / 1000));

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(ctx.currentTime + startTimeOffset);
            osc.stop(ctx.currentTime + startTimeOffset + (durationMs / 1000) + 0.05);
        } catch (e) {
            console.warn('[Attic Tracker] Falha ao reproduzir áudio:', e);
        }
    }

    function playSoundAlert(type) {
        if (!config.soundEnabled) return;

        if (type === '30s' && config.soundAlert30s) {
            // Dois bips suaves
            playBeep(440, 120, 0, 'sine');
            playBeep(554, 140, 0.16, 'sine');
        } else if (type === '10s' && config.soundAlert10s) {
            // Três bips mais rápidos e focados
            playBeep(587, 100, 0, 'triangle');
            playBeep(659, 100, 0.13, 'triangle');
            playBeep(784, 150, 0.26, 'triangle');
        } else if (type === 'window' && config.soundAlertWindow) {
            // Arpejo ascendente e chamativo avisando a abertura da janela de restock
            playBeep(523.25, 120, 0.00, 'sine'); // C5
            playBeep(659.25, 120, 0.10, 'sine'); // E5
            playBeep(783.99, 120, 0.20, 'sine'); // G5
            playBeep(1046.50, 260, 0.30, 'triangle'); // C6
        } else if (type === 'test') {
            playBeep(523.25, 120, 0.00, 'sine');
            playBeep(659.25, 120, 0.12, 'sine');
            playBeep(783.99, 200, 0.24, 'triangle');
        }
    }

    // =========================================================================
    // CÁLCULO DAS JANELAS DE RESTOCK DO SÓTÃO
    // =========================================================================

    /**
     * Calcula o ciclo atual e as próximas janelas.
     * Regra:
     * - Ciclo k (k = 1, 2, 3...):
     *   Início: lastRestock + (k * 7m)
     *   Fim:    lastRestock + (k * 7m) + (k * 15s)
     */
    function calculateAtticWindows(nowMs) {
        if (!config.lastRestockTimestamp) {
            return {
                hasBase: false,
                currentCycle: null,
                activeStatus: 'NO_BASE',
                upcomingCycles: []
            };
        }

        const base = config.lastRestockTimestamp;
        const overtimeMs = (config.overtimeSeconds || 30) * 1000;

        // Encontra qual é o ciclo k atual (o menor k cujo fim + overtime ainda não passou)
        let k = 1;
        while (true) {
            const cycleStart = base + (k * RESTOCK_CYCLE_MS);
            const cycleEnd = cycleStart + (k * CYCLE_DRIFT_STEP_MS);

            if (nowMs <= cycleEnd + overtimeMs || k > 50) {
                break;
            }
            k++;
        }

        const currentStart = base + (k * RESTOCK_CYCLE_MS);
        const currentEnd = currentStart + (k * CYCLE_DRIFT_STEP_MS);

        let activeStatus = 'WAITING'; // WAITING | IMMINENT | ACTIVE | OVERTIME
        let timeRemainingMs = 0;

        if (nowMs < currentStart) {
            timeRemainingMs = currentStart - nowMs;
            if (timeRemainingMs <= 10000) {
                activeStatus = 'IMMINENT';
            } else if (timeRemainingMs <= 60000) {
                activeStatus = 'ATTENTION';
            } else {
                activeStatus = 'WAITING';
            }
        } else if (nowMs <= currentEnd) {
            activeStatus = 'ACTIVE';
            timeRemainingMs = currentEnd - nowMs;
        } else {
            activeStatus = 'OVERTIME';
            timeRemainingMs = (currentEnd + overtimeMs) - nowMs;
        }

        // Gera a lista das próximas 5 janelas
        const upcomingCycles = [];
        for (let i = 0; i < 5; i++) {
            const cycleIndex = k + i;
            const start = base + (cycleIndex * RESTOCK_CYCLE_MS);
            const end = start + (cycleIndex * CYCLE_DRIFT_STEP_MS);
            upcomingCycles.push({
                cycleNumber: cycleIndex,
                startTimestamp: start,
                endTimestamp: end,
                isCurrent: i === 0,
                driftSeconds: cycleIndex * 15
            });
        }

        return {
            hasBase: true,
            currentCycle: {
                cycleNumber: k,
                startTimestamp: currentStart,
                endTimestamp: currentEnd,
                driftSeconds: k * 15,
                timeRemainingMs
            },
            activeStatus,
            upcomingCycles
        };
    }

    // =========================================================================
    // DETECÇÃO AUTOMÁTICA DE ITENS NO SÓTÃO
    // =========================================================================

    function detectAtticStockOnPage() {
        // Verifica se há itens à venda na página
        // Na página clássica de garagem do Neopets, itens à venda aparecem com links para compra
        const buyLinks = document.querySelectorAll('a[href*="garage.phtml?action=buy"], form[action*="garage.phtml"]');
        const itemImages = document.querySelectorAll('img[src*="/items/"]:not([src*="ghostchia"]):not([src*="header"])');

        // Se houver links de compra ou itens não vazios
        if (buyLinks.length > 0 || itemImages.length > 0) {
            return {
                stocked: true,
                count: buyLinks.length || itemImages.length
            };
        }
        return { stocked: false, count: 0 };
    }

    // =========================================================================
    // INTERFACE VISUAL (PAINEL DO SÓTÃO)
    // =========================================================================

    let uiElements = {};
    let originalDocumentTitle = document.title;
    let lastPlayedSoundCycle = null;
    let playedSoundFlags = { '30s': false, '10s': false, 'window': false };

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'neopets-attic-tracker-styles';
        style.textContent = `
            #attic-tracker-panel {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background: linear-gradient(145deg, #181926 0%, #202235 100%);
                color: #e2e8f0;
                border: 1px solid #3b3d5c;
                border-radius: 12px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
                margin: 15px auto 25px auto;
                max-width: 820px;
                padding: 16px 20px;
                box-sizing: border-box;
                font-size: 13px;
                line-height: 1.45;
                text-align: left;
                position: relative;
            }

            #attic-tracker-panel * {
                box-sizing: border-box;
            }

            .attic-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid #333652;
                padding-bottom: 12px;
                margin-bottom: 14px;
            }

            .attic-header-left {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .attic-title-badge {
                background: #6366f1;
                color: #ffffff;
                font-size: 11px;
                font-weight: 700;
                padding: 3px 8px;
                border-radius: 6px;
                letter-spacing: 0.5px;
                text-transform: uppercase;
            }

            .attic-title {
                font-size: 17px;
                font-weight: 700;
                color: #f8fafc;
                margin: 0;
                display: flex;
                align-items: center;
                gap: 6px;
            }

            .attic-header-actions {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .attic-btn-icon {
                background: #2a2c42;
                border: 1px solid #434668;
                color: #cbd5e1;
                border-radius: 6px;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                transition: all 0.15s ease;
                font-size: 13px;
            }

            .attic-btn-icon:hover {
                background: #373a5a;
                color: #ffffff;
                border-color: #6366f1;
            }

            /* Banner de Detecção Automática */
            .attic-detection-alert {
                background: linear-gradient(135deg, #065f46 0%, #047857 100%);
                border: 1px solid #10b981;
                color: #ecfdf5;
                padding: 12px 16px;
                border-radius: 8px;
                margin-bottom: 14px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                animation: attic-pulse-subtle 2s infinite;
            }

            .attic-detection-alert-text {
                font-size: 13px;
                font-weight: 600;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            /* Grid Principal */
            .attic-main-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-bottom: 16px;
            }

            @media (max-width: 680px) {
                .attic-main-grid {
                    grid-template-columns: 1fr;
                }
            }

            /* Cartão do Timer */
            .attic-card {
                background: #1e2032;
                border: 1px solid #31344f;
                border-radius: 10px;
                padding: 14px 16px;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
            }

            .attic-timer-display {
                text-align: center;
                padding: 10px 0;
            }

            .attic-timer-status {
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.8px;
                margin-bottom: 4px;
            }

            .attic-timer-digits {
                font-size: 40px;
                font-weight: 800;
                font-variant-numeric: tabular-nums;
                letter-spacing: -1px;
                line-height: 1.1;
                margin: 4px 0;
            }

            .attic-timer-sub {
                font-size: 11px;
                color: #94a3b8;
            }

            /* Status do Timer */
            .status-waiting { color: #38bdf8; }
            .status-attention { color: #facc15; }
            .status-imminent { color: #fb923c; }
            .status-active {
                color: #f43f5e;
                animation: attic-glow-red 1s infinite alternate;
            }
            .status-overtime { color: #a855f7; }
            .status-nobase { color: #94a3b8; }

            @keyframes attic-glow-red {
                from { text-shadow: 0 0 4px rgba(244, 63, 94, 0.4); }
                to { text-shadow: 0 0 16px rgba(244, 63, 94, 0.9), 0 0 24px rgba(244, 63, 94, 0.6); }
            }

            @keyframes attic-pulse-subtle {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.85; }
            }

            /* Cartão de Controle & Relógios */
            .attic-clocks-bar {
                display: flex;
                justify-content: space-between;
                background: #141522;
                border: 1px solid #282a40;
                border-radius: 8px;
                padding: 8px 12px;
                margin-bottom: 12px;
                font-size: 12px;
            }

            .attic-clock-item {
                display: flex;
                flex-direction: column;
            }

            .attic-clock-label {
                color: #64748b;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
            }

            .attic-clock-val {
                color: #f1f5f9;
                font-weight: 600;
                font-variant-numeric: tabular-nums;
            }

            /* Linhas de Ação Rápida */
            .attic-actions-row {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
                margin-top: 8px;
            }

            .attic-btn {
                background: #31344f;
                color: #f8fafc;
                border: 1px solid #434769;
                border-radius: 6px;
                padding: 8px 12px;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }

            .attic-btn:hover {
                background: #3e4265;
                border-color: #6366f1;
            }

            .attic-btn-primary {
                background: #059669;
                border-color: #10b981;
                color: #ffffff;
                flex: 1;
            }

            .attic-btn-primary:hover {
                background: #047857;
                border-color: #34d399;
            }

            .attic-btn-secondary {
                background: #4338ca;
                border-color: #6366f1;
                color: #ffffff;
            }

            .attic-btn-secondary:hover {
                background: #3730a3;
            }

            .attic-btn-skip {
                background: #475569;
                border-color: #64748b;
                color: #f1f5f9;
            }

            .attic-btn-skip:hover {
                background: #334155;
            }

            /* Entrada Manual */
            .attic-manual-box {
                display: flex;
                gap: 6px;
                margin-top: 10px;
                align-items: center;
            }

            .attic-input {
                background: #141522;
                border: 1px solid #333652;
                color: #f8fafc;
                border-radius: 6px;
                padding: 6px 10px;
                font-size: 12px;
                font-family: inherit;
                outline: none;
                flex: 1;
            }

            .attic-input:focus {
                border-color: #6366f1;
                box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
            }

            /* Tabela de Próximas Janelas */
            .attic-table-container {
                margin-top: 14px;
                background: #191b2b;
                border: 1px solid #2d3049;
                border-radius: 8px;
                overflow: hidden;
            }

            .attic-table-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 14px;
                background: #1e2033;
                border-bottom: 1px solid #2d3049;
            }

            .attic-table-title {
                font-size: 12px;
                font-weight: 700;
                color: #cbd5e1;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .attic-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
            }

            .attic-table th {
                text-align: left;
                padding: 8px 12px;
                color: #64748b;
                font-size: 11px;
                font-weight: 600;
                border-bottom: 1px solid #282a40;
                background: #171827;
            }

            .attic-table td {
                padding: 7px 12px;
                border-bottom: 1px solid #24263a;
                color: #e2e8f0;
            }

            .attic-table tr:last-child td {
                border-bottom: none;
            }

            .attic-table tr.active-row {
                background: rgba(99, 102, 241, 0.12);
                font-weight: 600;
            }

            .attic-badge-current {
                background: #4f46e5;
                color: #ffffff;
                font-size: 10px;
                font-weight: 700;
                padding: 2px 6px;
                border-radius: 4px;
                text-transform: uppercase;
            }

            /* Painel de Configurações Colapsável */
            .attic-settings-drawer {
                margin-top: 14px;
                padding-top: 14px;
                border-top: 1px solid #2e314b;
                display: none;
            }

            .attic-settings-drawer.open {
                display: block;
            }

            .attic-settings-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
                gap: 12px;
                margin-bottom: 12px;
            }

            .attic-setting-item {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .attic-setting-label {
                font-size: 11px;
                color: #94a3b8;
                font-weight: 600;
            }

            .attic-select {
                background: #141522;
                border: 1px solid #333652;
                color: #f8fafc;
                border-radius: 6px;
                padding: 6px 8px;
                font-size: 12px;
                outline: none;
            }

            .attic-checkbox-row {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: #cbd5e1;
                cursor: pointer;
                user-select: none;
            }

            .attic-checkbox-row input[type="checkbox"] {
                cursor: pointer;
                accent-color: #6366f1;
            }

            .attic-collapsed-content {
                display: none;
            }
        `;
        document.head.appendChild(style);
    }

    function createPanel() {
        const panel = document.createElement('div');
        panel.id = 'attic-tracker-panel';

        panel.innerHTML = `
            <div class="attic-header">
                <div class="attic-header-left">
                    <span class="attic-title-badge">Sótão</span>
                    <h2 class="attic-title">🏚️ Temporizador do Sótão Quase Abandonado</h2>
                </div>
                <div class="attic-header-actions">
                    <button class="attic-btn-icon" id="attic-btn-toggle-settings" title="Configurações e Fusos">⚙️</button>
                    <button class="attic-btn-icon" id="attic-btn-collapse" title="Minimizar / Expandir Painel">▼</button>
                </div>
            </div>

            <!-- Banner de Detecção Automática (oculto por padrão) -->
            <div id="attic-detection-banner" class="attic-detection-alert" style="display: none;">
                <div class="attic-detection-alert-text">
                    <span>🎉</span>
                    <span id="attic-detection-text">Itens detectados no Sótão!</span>
                </div>
                <button class="attic-btn attic-btn-primary" id="attic-btn-confirm-detection">
                    ✅ Marcar Restock Agora
                </button>
            </div>

            <div id="attic-body-content">
                <!-- Relógios e Informações de Fuso -->
                <div class="attic-clocks-bar">
                    <div class="attic-clock-item">
                        <span class="attic-clock-label">Neopian Standard Time (NST)</span>
                        <span class="attic-clock-val" id="attic-clock-nst">--:--:--</span>
                    </div>
                    <div class="attic-clock-item" style="text-align: right;">
                        <span class="attic-clock-label" id="attic-local-tz-label">Horário de Brasília</span>
                        <span class="attic-clock-val" id="attic-clock-local">--:--:--</span>
                    </div>
                </div>

                <div class="attic-main-grid">
                    <!-- Cartão do Timer -->
                    <div class="attic-card">
                        <div class="attic-timer-display">
                            <div class="attic-timer-status status-nobase" id="attic-status-text">SEM REGISTRO</div>
                            <div class="attic-timer-digits status-nobase" id="attic-timer-digits">--:--</div>
                            <div class="attic-timer-sub" id="attic-timer-sub">Informe o último restock abaixo para iniciar</div>
                        </div>
                        <div class="attic-actions-row">
                            <button class="attic-btn attic-btn-primary" id="attic-btn-stocked-now" title="Registra o segundo exato de agora como momento de restock">
                                ⚡ Restocou Agora!
                            </button>
                            <button class="attic-btn attic-btn-skip" id="attic-btn-skip-cycle" title="Se passou da janela e você não viu nenhum item, avança +7m">
                                ⏩ Não Restocou (+7m)
                            </button>
                        </div>
                    </div>

                    <!-- Cartão de Ações & Input Manual -->
                    <div class="attic-card">
                        <div>
                            <div style="font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">
                                Último Restock Conhecido
                            </div>
                            <div style="font-size: 14px; font-weight: 700; color: #f1f5f9;" id="attic-last-restock-display">
                                Nenhum informado
                            </div>
                            <div style="font-size: 11px; color: #64748b; margin-top: 2px;" id="attic-last-restock-local">
                                Defina abaixo via NST
                            </div>
                        </div>

                        <div style="margin-top: 12px;">
                            <label style="font-size: 11px; color: #94a3b8; font-weight: 600; display: block; margin-bottom: 4px;">
                                Inserir Horário Manual (NST):
                            </label>
                            <div class="attic-manual-box">
                                <input type="text" class="attic-input" id="attic-input-manual" placeholder="Ex: 14:22:15 ou 2:22 pm" />
                                <button class="attic-btn attic-btn-secondary" id="attic-btn-save-manual">Salvar</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tabela de Próximas Janelas de Restock -->
                <div class="attic-table-container">
                    <div class="attic-table-header">
                        <span class="attic-table-title">📅 Próximas Janelas Projetadas (+7m a cada ciclo)</span>
                        <button class="attic-btn" id="attic-btn-copy-projections" style="padding: 4px 10px; font-size: 11px;">
                            📋 Copiar para Discord
                        </button>
                    </div>
                    <table class="attic-table">
                        <thead>
                            <tr>
                                <th>Ciclo</th>
                                <th>Janela NST</th>
                                <th id="attic-th-local-tz">Horário Brasília</th>
                                <th>Drift Acumulado</th>
                                <th>Status / Restante</th>
                            </tr>
                        </thead>
                        <tbody id="attic-projections-tbody">
                            <tr>
                                <td colspan="5" style="text-align: center; color: #64748b; padding: 14px;">
                                    Defina o último restock acima para gerar as projeções.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Painel de Configurações Colapsável -->
                <div class="attic-settings-drawer" id="attic-settings-drawer">
                    <div style="font-size: 12px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; margin-bottom: 10px;">
                        ⚙️ Ajustes e Preferências
                    </div>
                    <div class="attic-settings-grid">
                        <div class="attic-setting-item">
                            <label class="attic-setting-label">Seu Fuso Horário Local:</label>
                            <select class="attic-select" id="attic-select-tz"></select>
                        </div>
                        <div class="attic-setting-item">
                            <label class="attic-setting-label">Volume do Alerta Sonoro:</label>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <input type="range" id="attic-range-volume" min="0" max="1" step="0.05" value="0.35" style="flex: 1; accent-color: #6366f1;">
                                <button class="attic-btn" id="attic-btn-test-sound" style="padding: 4px 8px; font-size: 11px;">Testar 🔔</button>
                            </div>
                        </div>
                        <div class="attic-setting-item">
                            <label class="attic-setting-label">Tolerância Pós-Janela (Overtime):</label>
                            <select class="attic-select" id="attic-select-overtime">
                                <option value="15">15 segundos</option>
                                <option value="30">30 segundos (Recomendado)</option>
                                <option value="45">45 segundos</option>
                                <option value="60">60 segundos (1 minuto)</option>
                            </select>
                        </div>
                    </div>

                    <div style="display: flex; flex-wrap: wrap; gap: 16px; margin-top: 10px;">
                        <label class="attic-checkbox-row">
                            <input type="checkbox" id="attic-chk-sound-enabled">
                            Alertas Sonoros Ativos
                        </label>
                        <label class="attic-checkbox-row">
                            <input type="checkbox" id="attic-chk-alert-30s">
                            Avisar 30s antes
                        </label>
                        <label class="attic-checkbox-row">
                            <input type="checkbox" id="attic-chk-alert-10s">
                            Avisar 10s antes
                        </label>
                        <label class="attic-checkbox-row">
                            <input type="checkbox" id="attic-chk-alert-window">
                            Avisar ao abrir janela (0s)
                        </label>
                        <label class="attic-checkbox-row">
                            <input type="checkbox" id="attic-chk-title-countdown">
                            Timer no título da aba
                        </label>
                    </div>
                </div>
            </div>
        `;

        return panel;
    }

    function populateTimezoneOptions(selectEl) {
        selectEl.innerHTML = '';
        COMMON_TIMEZONES.forEach(tz => {
            const opt = document.createElement('option');
            opt.value = tz.value;
            opt.textContent = tz.label;
            if (config.timezone === tz.value) {
                opt.selected = true;
            }
            selectEl.appendChild(opt);
        });
    }

    // =========================================================================
    // ATUALIZAÇÃO DO TIMER & LÓGICA EM TEMPO REAL (LOOP A CADA SEGUNDO)
    // =========================================================================

    function updateUiTick() {
        const nowMs = getCorrectedNow();
        const userTz = resolveUserTimezone();

        // 1. Atualiza os relógios de topo
        const nstStr = formatTimeInZone(nowMs, NST_TIMEZONE, true);
        const localStr = formatTimeInZone(nowMs, userTz, true);

        if (uiElements.clockNst) uiElements.clockNst.textContent = `${nstStr} NST`;
        if (uiElements.clockLocal) uiElements.clockLocal.textContent = localStr;

        // 2. Calcula as janelas
        const calc = calculateAtticWindows(nowMs);

        // 3. Atualiza o display do último restock registrado
        if (config.lastRestockTimestamp) {
            const lrNst = formatTimeInZone(config.lastRestockTimestamp, NST_TIMEZONE, true);
            const lrLocal = formatTimeInZone(config.lastRestockTimestamp, userTz, true);
            if (uiElements.lastRestockDisplay) {
                uiElements.lastRestockDisplay.textContent = `${lrNst} NST`;
            }
            if (uiElements.lastRestockLocal) {
                uiElements.lastRestockLocal.textContent = `Horário Local: ${lrLocal}`;
            }
        } else {
            if (uiElements.lastRestockDisplay) uiElements.lastRestockDisplay.textContent = 'Nenhum informado';
            if (uiElements.lastRestockLocal) uiElements.lastRestockLocal.textContent = 'Clique em "Restocou Agora" ou digite o horário';
        }

        // 4. Se não tem base cadastrada
        if (!calc.hasBase) {
            if (uiElements.statusText) {
                uiElements.statusText.textContent = 'SEM REGISTRO';
                uiElements.statusText.className = 'attic-timer-status status-nobase';
            }
            if (uiElements.timerDigits) {
                uiElements.timerDigits.textContent = '--:--';
                uiElements.timerDigits.className = 'attic-timer-digits status-nobase';
            }
            if (uiElements.timerSub) {
                uiElements.timerSub.textContent = 'Aguardando primeiro restock para iniciar os cálculos';
            }
            if (config.tabTitleCountdown) {
                document.title = originalDocumentTitle;
            }
            return;
        }

        const cycle = calc.currentCycle;
        const remainingMs = cycle.timeRemainingMs;
        const cycleNum = cycle.cycleNumber;

        // Reset dos flags de som caso tenha mudado de ciclo
        if (lastPlayedSoundCycle !== cycleNum) {
            lastPlayedSoundCycle = cycleNum;
            playedSoundFlags = { '30s': false, '10s': false, 'window': false };
        }

        // 5. Atualização visual do status e timer
        if (calc.activeStatus === 'WAITING' || calc.activeStatus === 'ATTENTION' || calc.activeStatus === 'IMMINENT') {
            const remainingSec = Math.ceil(remainingMs / 1000);
            let statusLabel = `CICLO #${cycleNum} • AGUARDANDO`;
            let statusClass = 'status-waiting';

            if (calc.activeStatus === 'ATTENTION') {
                statusLabel = `CICLO #${cycleNum} • ATENÇÃO (QUASE LÁ)`;
                statusClass = 'status-attention';
            } else if (calc.activeStatus === 'IMMINENT') {
                statusLabel = `CICLO #${cycleNum} • IMINENTE! PREPARE-SE`;
                statusClass = 'status-imminent';
            }

            if (uiElements.statusText) {
                uiElements.statusText.textContent = statusLabel;
                uiElements.statusText.className = `attic-timer-status ${statusClass}`;
            }
            if (uiElements.timerDigits) {
                uiElements.timerDigits.textContent = formatDuration(remainingMs);
                uiElements.timerDigits.className = `attic-timer-digits ${statusClass}`;
            }
            if (uiElements.timerSub) {
                const startNst = formatTimeInZone(cycle.startTimestamp, NST_TIMEZONE, true);
                uiElements.timerSub.textContent = `Abertura prevista às ${startNst} NST (+${cycle.driftSeconds}s de drift)`;
            }

            // Título da aba
            if (config.tabTitleCountdown) {
                document.title = `(${formatDuration(remainingMs)}) Sótão Quase Abandonado`;
            }

            // Alertas sonoros
            if (remainingSec <= 30 && remainingSec > 10 && !playedSoundFlags['30s']) {
                playedSoundFlags['30s'] = true;
                playSoundAlert('30s');
            } else if (remainingSec <= 10 && remainingSec > 0 && !playedSoundFlags['10s']) {
                playedSoundFlags['10s'] = true;
                playSoundAlert('10s');
            }
        } else if (calc.activeStatus === 'ACTIVE') {
            if (!playedSoundFlags['window']) {
                playedSoundFlags['window'] = true;
                playSoundAlert('window');
            }

            if (uiElements.statusText) {
                uiElements.statusText.textContent = `🚨 CICLO #${cycleNum} • JANELA ATIVA! REFRESH NOW!`;
                uiElements.statusText.className = 'attic-timer-status status-active';
            }
            if (uiElements.timerDigits) {
                uiElements.timerDigits.textContent = formatDuration(remainingMs);
                uiElements.timerDigits.className = 'attic-timer-digits status-active';
            }
            if (uiElements.timerSub) {
                uiElements.timerSub.textContent = `Janela aberta! Dê refresh na página (F5) para checar o estoque!`;
            }

            if (config.tabTitleCountdown) {
                document.title = `🔴 REFRESH NOW! (${formatDuration(remainingMs)}) Sótão`;
            }
        } else if (calc.activeStatus === 'OVERTIME') {
            if (uiElements.statusText) {
                uiElements.statusText.textContent = `⏳ CICLO #${cycleNum} • PRORROGAÇÃO`;
                uiElements.statusText.className = 'attic-timer-status status-overtime';
            }
            if (uiElements.timerDigits) {
                uiElements.timerDigits.textContent = formatDuration(remainingMs);
                uiElements.timerDigits.className = 'attic-timer-digits status-overtime';
            }
            if (uiElements.timerSub) {
                uiElements.timerSub.textContent = `Janela oficial encerrou, checando possíveis atrasos do servidor`;
            }

            if (config.tabTitleCountdown) {
                document.title = `⏳ (${formatDuration(remainingMs)}) Sótão Quase Abandonado`;
            }
        }

        // 6. Atualização da tabela de projeções (apenas a cada 1 segundo se tiver dados)
        renderProjectionsTable(calc.upcomingCycles, userTz);
    }

    function renderProjectionsTable(upcomingCycles, userTz) {
        if (!uiElements.projectionsTbody || !upcomingCycles || upcomingCycles.length === 0) return;

        const rowsHtml = upcomingCycles.map((cycle, index) => {
            const startNst = formatTimeInZone(cycle.startTimestamp, NST_TIMEZONE, true);
            const endNst = formatTimeInZone(cycle.endTimestamp, NST_TIMEZONE, true);

            const startLocal = formatTimeInZone(cycle.startTimestamp, userTz, true);
            const endLocal = formatTimeInZone(cycle.endTimestamp, userTz, true);

            const isCurrent = cycle.isCurrent;
            const rowClass = isCurrent ? 'class="active-row"' : '';
            const badge = isCurrent ? '<span class="attic-badge-current">Atual</span>' : `+${(index) * 7}m`;

            return `
                <tr ${rowClass}>
                    <td><strong>#${cycle.cycleNumber}</strong> ${isCurrent ? badge : ''}</td>
                    <td><code>${startNst} ~ ${endNst}</code></td>
                    <td><code>${startLocal} ~ ${endLocal}</code></td>
                    <td>+${cycle.driftSeconds}s</td>
                    <td>${isCurrent ? '<strong>Janela em foco</strong>' : 'Projetado'}</td>
                </tr>
            `;
        }).join('');

        uiElements.projectionsTbody.innerHTML = rowsHtml;
    }

    // =========================================================================
    // COMPARTILHAMENTO DE PROJEÇÕES (DISCORD / FÓRUM)
    // =========================================================================

    function copyProjectionsToClipboard() {
        if (!config.lastRestockTimestamp) {
            alert('Defina primeiro o horário do último restock para copiar as projeções!');
            return;
        }

        const nowMs = getCorrectedNow();
        const userTz = resolveUserTimezone();
        const calc = calculateAtticWindows(nowMs);

        const lastNst = formatTimeInZone(config.lastRestockTimestamp, NST_TIMEZONE, true);
        const lastLocal = formatTimeInZone(config.lastRestockTimestamp, userTz, true);

        let lines = [];
        lines.push(`📦 **Almost Abandoned Attic - Projeção de Restock**`);
        lines.push(`🕒 **Último Restock:** ${lastNst} NST (${lastLocal} Local)`);
        lines.push(`----------------------------------------------`);

        calc.upcomingCycles.forEach(c => {
            const sNst = formatTimeInZone(c.startTimestamp, NST_TIMEZONE, true);
            const eNst = formatTimeInZone(c.endTimestamp, NST_TIMEZONE, true);
            const sLoc = formatTimeInZone(c.startTimestamp, userTz, true);
            const eLoc = formatTimeInZone(c.endTimestamp, userTz, true);
            const curTag = c.isCurrent ? ' 👈 *Janela Atual*' : '';

            lines.push(`• **Ciclo #${c.cycleNumber}:** ${sNst} ~ ${eNst} NST | ${sLoc} ~ ${eLoc} Local (+${c.driftSeconds}s)${curTag}`);
        });

        lines.push(`----------------------------------------------`);
        lines.push(`*Gerado pelo Rastreador do Sótão Quase Abandonado (Scriptnautas)*`);

        const text = lines.join('\n');
        navigator.clipboard.writeText(text).then(() => {
            const btn = document.getElementById('attic-btn-copy-projections');
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = '✅ Copiado!';
                setTimeout(() => { btn.textContent = originalText; }, 2000);
            }
        }).catch(err => {
            console.error('Erro ao copiar para clipboard:', err);
            alert('Não foi possível copiar automaticamente para a área de transferência.');
        });
    }

    // =========================================================================
    // INICIALIZAÇÃO E BINDING DE EVENTOS
    // =========================================================================

    function init() {
        injectStyles();
        detectServerNstTime();

        const panel = createPanel();

        // Inserção do painel na página do Sótão
        // Procura locais clássicos de inserção para garantir máxima compatibilidade
        const targetContainer = document.querySelector('td.content, .contentModule, #content, center, table[width="100%"]');
        if (targetContainer) {
            targetContainer.parentNode.insertBefore(panel, targetContainer);
        } else {
            document.body.insertBefore(panel, document.body.firstChild);
        }

        // Cache de referências de DOM
        uiElements = {
            panel,
            clockNst: document.getElementById('attic-clock-nst'),
            clockLocal: document.getElementById('attic-clock-local'),
            localTzLabel: document.getElementById('attic-local-tz-label'),
            statusText: document.getElementById('attic-status-text'),
            timerDigits: document.getElementById('attic-timer-digits'),
            timerSub: document.getElementById('attic-timer-sub'),
            lastRestockDisplay: document.getElementById('attic-last-restock-display'),
            lastRestockLocal: document.getElementById('attic-last-restock-local'),
            projectionsTbody: document.getElementById('attic-projections-tbody'),
            thLocalTz: document.getElementById('attic-th-local-tz')
        };

        // Popula fusos horários
        const selectTz = document.getElementById('attic-select-tz');
        if (selectTz) {
            populateTimezoneOptions(selectTz);
            selectTz.addEventListener('change', (e) => {
                config.timezone = e.target.value;
                saveConfig(config);
                updateTzLabels();
                updateUiTick();
            });
        }

        // Configurações e Checkboxes
        const chkSound = document.getElementById('attic-chk-sound-enabled');
        const chk30s = document.getElementById('attic-chk-alert-30s');
        const chk10s = document.getElementById('attic-chk-alert-10s');
        const chkWindow = document.getElementById('attic-chk-alert-window');
        const chkTitle = document.getElementById('attic-chk-title-countdown');
        const rangeVol = document.getElementById('attic-range-volume');
        const selOvertime = document.getElementById('attic-select-overtime');

        if (chkSound) {
            chkSound.checked = config.soundEnabled;
            chkSound.addEventListener('change', (e) => {
                config.soundEnabled = e.target.checked;
                saveConfig(config);
            });
        }

        if (chk30s) {
            chk30s.checked = config.soundAlert30s;
            chk30s.addEventListener('change', (e) => {
                config.soundAlert30s = e.target.checked;
                saveConfig(config);
            });
        }

        if (chk10s) {
            chk10s.checked = config.soundAlert10s;
            chk10s.addEventListener('change', (e) => {
                config.soundAlert10s = e.target.checked;
                saveConfig(config);
            });
        }

        if (chkWindow) {
            chkWindow.checked = config.soundAlertWindow;
            chkWindow.addEventListener('change', (e) => {
                config.soundAlertWindow = e.target.checked;
                saveConfig(config);
            });
        }

        if (chkTitle) {
            chkTitle.checked = config.tabTitleCountdown;
            chkTitle.addEventListener('change', (e) => {
                config.tabTitleCountdown = e.target.checked;
                if (!config.tabTitleCountdown) {
                    document.title = originalDocumentTitle;
                }
                saveConfig(config);
            });
        }

        if (rangeVol) {
            rangeVol.value = config.soundVolume;
            rangeVol.addEventListener('input', (e) => {
                config.soundVolume = parseFloat(e.target.value);
                saveConfig(config);
            });
        }

        if (selOvertime) {
            selOvertime.value = String(config.overtimeSeconds || 30);
            selOvertime.addEventListener('change', (e) => {
                config.overtimeSeconds = parseInt(e.target.value, 10);
                saveConfig(config);
                updateUiTick();
            });
        }

        // Botão Testar Som
        const btnTestSound = document.getElementById('attic-btn-test-sound');
        if (btnTestSound) {
            btnTestSound.addEventListener('click', () => {
                playSoundAlert('test');
            });
        }

        // Toggle do Drawer de Configurações
        const btnToggleSettings = document.getElementById('attic-btn-toggle-settings');
        const drawerSettings = document.getElementById('attic-settings-drawer');
        if (btnToggleSettings && drawerSettings) {
            btnToggleSettings.addEventListener('click', () => {
                drawerSettings.classList.toggle('open');
            });
        }

        // Minimizar / Expandir Painel
        const btnCollapse = document.getElementById('attic-btn-collapse');
        const bodyContent = document.getElementById('attic-body-content');
        if (btnCollapse && bodyContent) {
            if (config.panelCollapsed) {
                bodyContent.style.display = 'none';
                btnCollapse.textContent = '▲';
            }
            btnCollapse.addEventListener('click', () => {
                config.panelCollapsed = !config.panelCollapsed;
                bodyContent.style.display = config.panelCollapsed ? 'none' : 'block';
                btnCollapse.textContent = config.panelCollapsed ? '▲' : '▼';
                saveConfig(config);
            });
        }

        // Ação: Restocou Agora!
        const btnStockedNow = document.getElementById('attic-btn-stocked-now');
        if (btnStockedNow) {
            btnStockedNow.addEventListener('click', () => {
                const now = getCorrectedNow();
                config.lastRestockTimestamp = now;
                saveConfig(config);
                updateUiTick();
                alert(`Horário de Restock registrado: ${formatTimeInZone(now, NST_TIMEZONE, true)} NST!`);
            });
        }

        // Ação: Não Restocou (+7m) / Avançar Ciclo
        const btnSkipCycle = document.getElementById('attic-btn-skip-cycle');
        if (btnSkipCycle) {
            btnSkipCycle.addEventListener('click', () => {
                if (!config.lastRestockTimestamp) {
                    alert('Defina primeiro um horário de restock base.');
                    return;
                }
                const now = getCorrectedNow();
                const calc = calculateAtticWindows(now);
                if (calc.currentCycle) {
                    // Pula forçando a base ou avançando para a próxima janela esperada
                    const currentCycleEnd = calc.currentCycle.endTimestamp;
                    if (now < currentCycleEnd) {
                        // Se clicou antes do fim do ciclo atual, retroage a base fictícia em 7m para simular avanço
                        config.lastRestockTimestamp -= RESTOCK_CYCLE_MS;
                    } else {
                        // Se já passou, o cálculo natural já avança
                    }
                    saveConfig(config);
                    updateUiTick();
                }
            });
        }

        // Ação: Salvar Horário Manual
        const btnSaveManual = document.getElementById('attic-btn-save-manual');
        const inputManual = document.getElementById('attic-input-manual');
        if (btnSaveManual && inputManual) {
            const handleSaveManual = () => {
                const text = inputManual.value.trim();
                const ts = parseNstInputToTimestamp(text);
                if (!ts) {
                    alert('Formato de horário inválido! Use HH:MM:SS ou HH:MM (ex: 14:22:15 ou 2:22 pm).');
                    return;
                }
                config.lastRestockTimestamp = ts;
                saveConfig(config);
                inputManual.value = '';
                updateUiTick();
                alert(`Horário registrado com sucesso: ${formatTimeInZone(ts, NST_TIMEZONE, true)} NST.`);
            };

            btnSaveManual.addEventListener('click', handleSaveManual);
            inputManual.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') handleSaveManual();
            });
        }

        // Copiar projeções
        const btnCopyProjections = document.getElementById('attic-btn-copy-projections');
        if (btnCopyProjections) {
            btnCopyProjections.addEventListener('click', copyProjectionsToClipboard);
        }

        // Checagem de Restock ao carregar a página
        checkStockOnPageLoad();

        // Atualiza rótulos de fusos
        updateTzLabels();

        // Tick inicial e loop a cada 1 segundo
        updateUiTick();
        setInterval(updateUiTick, 1000);
    }

    function updateTzLabels() {
        const userTz = resolveUserTimezone();
        let tzName = 'Horário Local';
        if (userTz === 'America/Sao_Paulo') {
            tzName = 'Horário de Brasília';
        } else if (userTz.includes('/')) {
            tzName = userTz.split('/')[1].replace(/_/g, ' ');
        }

        if (uiElements.localTzLabel) uiElements.localTzLabel.textContent = tzName;
        if (uiElements.thLocalTz) uiElements.thLocalTz.textContent = tzName;
    }

    function checkStockOnPageLoad() {
        const detection = detectAtticStockOnPage();
        const banner = document.getElementById('attic-detection-banner');
        const bannerText = document.getElementById('attic-detection-text');
        const btnConfirm = document.getElementById('attic-btn-confirm-detection');

        if (detection.stocked && banner && bannerText && btnConfirm) {
            banner.style.display = 'flex';
            bannerText.innerHTML = `🎉 <strong>Restock Detectado!</strong> Há itens à venda no Sótão neste momento!`;

            btnConfirm.addEventListener('click', () => {
                const now = getCorrectedNow();
                config.lastRestockTimestamp = now;
                saveConfig(config);
                banner.style.display = 'none';
                updateUiTick();
            });
        }
    }

    // Inicializa quando a página estiver pronta
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();

