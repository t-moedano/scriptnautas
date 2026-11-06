// ==UserScript==
// @name         Neopets: Rastreador & Temporizador do Sótão Quase Abandonado
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.1
// @description  Barra compacta e inteligente de temporizador de restock para o Sótão Quase Abandonado (Almost Abandoned Attic) do Neopets com fuso horário duplo, alertas sonoros e sem sobreposição de itens.
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
    // Drift cumulativo: até 15 segundos por ciclo
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
        overtimeSeconds: 30
    };

    const COMMON_TIMEZONES = [
        { label: '🇧🇷 Horário de Brasília (BRT / UTC-3)', value: 'America/Sao_Paulo' },
        { label: '🇧🇷 Horário de Manaus / Amazonas (AMT / UTC-4)', value: 'America/Manaus' },
        { label: '🇧🇷 Horário de Fernando de Noronha (FNT / UTC-2)', value: 'America/Noronha' },
        { label: '🇧🇷 Horário do Acre (ACT / UTC-5)', value: 'America/Rio_Branco' },
        { label: '🇵🇹 Horário de Lisboa / Portugal (WET / WEST)', value: 'Europe/Lisbon' },
        { label: '🌐 Horário Universal Coordenado (UTC)', value: 'UTC' },
        { label: '💻 Fuso do Navegador (Automático)', value: 'AUTO' }
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

    let serverTimeDriftMs = 0;
    const pageLoadLocalPerf = performance.now();
    const pageLoadLocalDate = Date.now();

    function detectServerNstTime() {
        const nstEl = document.querySelector('#nst, .nst, span[id="nst"]');
        if (!nstEl || !nstEl.textContent) return;

        const text = nstEl.textContent.trim();
        const match = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (!match) return;

        let hours = parseInt(match[1], 10);
        const minutes = parseInt(match[2], 10);
        const seconds = match[3] ? parseInt(match[3], 10) : 0;
        const meridian = match[4] ? match[4].toLowerCase() : null;

        if (meridian === 'pm' && hours < 12) hours += 12;
        if (meridian === 'am' && hours === 12) hours = 0;

        const nowUtc = new Date();
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

        const diff = targetServerUtcMs - pageLoadLocalDate;
        if (Math.abs(diff) < 12 * 60 * 60 * 1000) {
            serverTimeDriftMs = diff;
        }
    }

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

        const isDst = new Intl.DateTimeFormat('en-US', { timeZone: NST_TIMEZONE, timeZoneName: 'short' }).format(now).includes('PDT');
        const offsetHours = isDst ? 7 : 8;

        let targetUtcMs = Date.UTC(y, m - 1, d, hours + offsetHours, minutes, seconds);

        if (targetUtcMs > now.getTime() + 10 * 60 * 1000) {
            targetUtcMs -= 24 * 60 * 60 * 1000;
        }

        return targetUtcMs;
    }

    // =========================================================================
    // ÁUDIO NATIVO (WEB AUDIO API)
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
            console.warn('[Attic Tracker] Erro áudio:', e);
        }
    }

    function playSoundAlert(type) {
        if (!config.soundEnabled) return;

        if (type === '30s' && config.soundAlert30s) {
            playBeep(440, 110, 0, 'sine');
            playBeep(554, 130, 0.15, 'sine');
        } else if (type === '10s' && config.soundAlert10s) {
            playBeep(587, 90, 0, 'triangle');
            playBeep(659, 90, 0.12, 'triangle');
            playBeep(784, 140, 0.24, 'triangle');
        } else if (type === 'window' && config.soundAlertWindow) {
            playBeep(523.25, 110, 0.00, 'sine');
            playBeep(659.25, 110, 0.10, 'sine');
            playBeep(783.99, 110, 0.20, 'sine');
            playBeep(1046.50, 240, 0.30, 'triangle');
        } else if (type === 'test') {
            playBeep(523.25, 110, 0.00, 'sine');
            playBeep(659.25, 110, 0.11, 'sine');
            playBeep(783.99, 180, 0.22, 'triangle');
        }
    }

    // =========================================================================
    // CÁLCULO DE JANELAS DO SÓTÃO
    // =========================================================================

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

        let activeStatus = 'WAITING';
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
    // DETECÇÃO DE ITENS NO SÓTÃO
    // =========================================================================

    function detectAtticStockOnPage() {
        const items = document.querySelectorAll('#items li');
        return {
            stocked: items.length > 0,
            count: items.length
        };
    }

    // =========================================================================
    // INTERFACE VISUAL ULTRA COMPACTA (TOOLBAR HUD)
    // =========================================================================

    let uiElements = {};
    let originalDocumentTitle = document.title;
    let lastPlayedSoundCycle = null;
    let playedSoundFlags = { '30s': false, '10s': false, 'window': false };

    function injectStyles() {
        const style = document.createElement('style');
        style.id = 'neopets-attic-tracker-styles';
        style.textContent = `
            /* Container da Barra Compacta */
            #attic-hud-wrapper {
                position: relative;
                margin: 0 0 12px 0;
                width: 100%;
                box-sizing: border-box;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                z-index: 100;
                clear: both;
            }

            #attic-hud-bar {
                background: linear-gradient(180deg, #1e2030 0%, #151624 100%);
                color: #e2e8f0;
                border: 1px solid #363952;
                border-radius: 8px;
                padding: 6px 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
                min-height: 44px;
                box-sizing: border-box;
                flex-wrap: wrap;
            }

            /* Bloco Esquerda: Título & Relógios */
            .attic-hud-left {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-shrink: 0;
            }

            .attic-hud-badge {
                background: #4f46e5;
                color: #ffffff;
                font-size: 11px;
                font-weight: 700;
                padding: 3px 7px;
                border-radius: 5px;
                letter-spacing: 0.5px;
                text-transform: uppercase;
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .attic-hud-clocks {
                display: flex;
                flex-direction: column;
                font-size: 10px;
                line-height: 1.25;
                color: #94a3b8;
            }

            .attic-hud-clocks span strong {
                color: #f1f5f9;
                font-variant-numeric: tabular-nums;
            }

            /* Bloco Centro: O Timer Principal */
            .attic-hud-center {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }

            .attic-hud-timer-pill {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 3px 10px;
                border-radius: 6px;
                font-weight: 700;
                font-size: 13px;
                font-variant-numeric: tabular-nums;
                border: 1px solid transparent;
                transition: all 0.2s ease;
            }

            .attic-pill-nobase {
                background: #232538;
                color: #94a3b8;
                border-color: #383a54;
            }

            .attic-pill-waiting {
                background: rgba(56, 189, 248, 0.12);
                color: #38bdf8;
                border-color: rgba(56, 189, 248, 0.3);
            }

            .attic-pill-attention {
                background: rgba(250, 204, 21, 0.15);
                color: #facc15;
                border-color: rgba(250, 204, 21, 0.4);
            }

            .attic-pill-imminent {
                background: rgba(251, 146, 60, 0.18);
                color: #fb923c;
                border-color: rgba(251, 146, 60, 0.5);
            }

            .attic-pill-active {
                background: #e11d48;
                color: #ffffff;
                border-color: #f43f5e;
                animation: attic-pulse-glow 0.8s infinite alternate;
            }

            .attic-pill-overtime {
                background: rgba(168, 85, 247, 0.15);
                color: #c084fc;
                border-color: rgba(168, 85, 247, 0.4);
            }

            @keyframes attic-pulse-glow {
                from { box-shadow: 0 0 4px #e11d48; transform: scale(1); }
                to { box-shadow: 0 0 14px #fb7185; transform: scale(1.03); }
            }

            .attic-hud-next-info {
                font-size: 11px;
                color: #cbd5e1;
            }

            .attic-hud-next-info span {
                color: #38bdf8;
                font-weight: 600;
            }

            /* Bloco Direita: Ações & Botões */
            .attic-hud-right {
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }

            .attic-hud-btn {
                background: #25283d;
                color: #f1f5f9;
                border: 1px solid #3c4060;
                border-radius: 6px;
                padding: 4px 9px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
                display: inline-flex;
                align-items: center;
                gap: 4px;
                line-height: 1.3;
            }

            .attic-hud-btn:hover {
                background: #333754;
                border-color: #6366f1;
            }

            .attic-hud-btn-primary {
                background: #059669;
                border-color: #10b981;
                color: #ffffff;
            }

            .attic-hud-btn-primary:hover {
                background: #047857;
                border-color: #34d399;
            }

            .attic-hud-btn-icon {
                padding: 4px 7px;
                font-size: 12px;
            }

            /* Banner Compacto de Estoque Detectado */
            #attic-hud-stock-alert {
                background: #047857;
                border: 1px solid #10b981;
                color: #ecfdf5;
                border-radius: 6px;
                padding: 4px 10px;
                margin-top: 6px;
                display: none;
                align-items: center;
                justify-content: space-between;
                font-size: 11px;
                font-weight: 600;
                gap: 8px;
            }

            /* Modais Suspensos (Popovers) */
            .attic-hud-popover {
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                background: #171826;
                border: 1px solid #383b58;
                border-radius: 8px;
                padding: 14px;
                box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5), 0 4px 10px rgba(0, 0, 0, 0.3);
                z-index: 1000;
                display: none;
                width: 440px;
                max-width: 95vw;
                box-sizing: border-box;
                color: #e2e8f0;
                font-size: 12px;
            }

            .attic-hud-popover.open {
                display: block;
            }

            .attic-popover-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 10px;
                padding-bottom: 6px;
                border-bottom: 1px solid #282a40;
                font-weight: 700;
                font-size: 12px;
                color: #f8fafc;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .attic-popover-close {
                background: none;
                border: none;
                color: #94a3b8;
                cursor: pointer;
                font-size: 15px;
                font-weight: 700;
                padding: 0 4px;
            }

            .attic-popover-close:hover {
                color: #ffffff;
            }

            /* Tabela de Projeções no Popover */
            .attic-pop-table {
                width: 100%;
                border-collapse: collapse;
                font-size: 11px;
                margin-bottom: 10px;
            }

            .attic-pop-table th {
                text-align: left;
                padding: 6px 8px;
                background: #1f2133;
                color: #94a3b8;
                font-size: 10px;
                border-bottom: 1px solid #2f324c;
            }

            .attic-pop-table td {
                padding: 5px 8px;
                border-bottom: 1px solid #222438;
            }

            .attic-pop-table tr.active-row {
                background: rgba(99, 102, 241, 0.15);
                font-weight: 600;
            }

            .attic-badge-current {
                background: #4f46e5;
                color: #fff;
                font-size: 9px;
                padding: 1px 4px;
                border-radius: 3px;
                text-transform: uppercase;
            }

            /* Formulários & Configs no Popover */
            .attic-setting-row {
                margin-bottom: 10px;
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .attic-setting-row label {
                font-size: 11px;
                color: #94a3b8;
                font-weight: 600;
            }

            .attic-select, .attic-input {
                background: #0f101b;
                border: 1px solid #2d304a;
                color: #f1f5f9;
                border-radius: 5px;
                padding: 5px 8px;
                font-size: 12px;
                outline: none;
                width: 100%;
                box-sizing: border-box;
            }

            .attic-select:focus, .attic-input:focus {
                border-color: #6366f1;
            }

            .attic-chk-label {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                color: #cbd5e1;
                cursor: pointer;
                margin-top: 5px;
            }

            .attic-chk-label input {
                accent-color: #6366f1;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    function createHud() {
        const wrapper = document.createElement('div');
        wrapper.id = 'attic-hud-wrapper';

        wrapper.innerHTML = `
            <div id="attic-hud-bar">
                <!-- Esquerda -->
                <div class="attic-hud-left">
                    <span class="attic-hud-badge">🏚️ Sótão</span>
                    <div class="attic-hud-clocks">
                        <span>NST: <strong id="hud-clock-nst">--:--:--</strong></span>
                        <span id="hud-clock-local-row">Local: <strong id="hud-clock-local">--:--:--</strong></span>
                    </div>
                </div>

                <!-- Centro -->
                <div class="attic-hud-center">
                    <div class="attic-hud-timer-pill attic-pill-nobase" id="hud-timer-pill">
                        <span id="hud-timer-status-dot">⚪</span>
                        <span id="hud-timer-digits">--:--</span>
                    </div>
                    <div class="attic-hud-next-info" id="hud-next-info">
                        Aguardando último restock...
                    </div>
                </div>

                <!-- Direita -->
                <div class="attic-hud-right">
                    <button class="attic-hud-btn attic-hud-btn-primary" id="hud-btn-stocked-now" title="Define agora como momento exato do restock">
                        ⚡ Restocou!
                    </button>
                    <button class="attic-hud-btn" id="hud-btn-skip-cycle" title="Não veio item nesta janela? Avança para o próximo ciclo de +7m">
                        ⏩ +7m
                    </button>
                    <button class="attic-hud-btn attic-hud-btn-icon" id="hud-btn-open-manual" title="Inserir horário manual em NST">
                        ✏️
                    </button>
                    <button class="attic-hud-btn attic-hud-btn-icon" id="hud-btn-open-projections" title="Ver tabela de próximas janelas">
                        📅
                    </button>
                    <button class="attic-hud-btn attic-hud-btn-icon" id="hud-btn-open-settings" title="Configurações e fuso horário">
                        ⚙️
                    </button>
                </div>
            </div>

            <!-- Alerta Compacto de Estoque Detectado -->
            <div id="attic-hud-stock-alert">
                <span id="hud-stock-alert-text">🎉 <strong>Itens detectados no Sótão!</strong></span>
                <div style="display: flex; gap: 6px;">
                    <button class="attic-hud-btn attic-hud-btn-primary" id="hud-btn-confirm-stock" style="padding: 2px 8px; font-size: 11px;">
                        ✅ Atualizar Restock para Agora
                    </button>
                    <button class="attic-popover-close" id="hud-btn-dismiss-stock" title="Fechar">✕</button>
                </div>
            </div>

            <!-- Popover 1: Entrada Manual -->
            <div class="attic-hud-popover" id="popover-manual" style="width: 300px;">
                <div class="attic-popover-header">
                    <span>✏️ Definir Último Restock</span>
                    <button class="attic-popover-close" data-close="popover-manual">✕</button>
                </div>
                <div class="attic-setting-row">
                    <label>Horário em NST (ex: 14:22:15 ou 2:22 pm):</label>
                    <div style="display: flex; gap: 6px;">
                        <input type="text" class="attic-input" id="pop-input-manual" placeholder="HH:MM:SS" />
                        <button class="attic-hud-btn attic-hud-btn-primary" id="pop-btn-save-manual">Salvar</button>
                    </div>
                </div>
                <div style="font-size: 11px; color: #94a3b8; margin-top: 4px;" id="pop-current-base-desc">
                    Último cadastrado: Nenhum
                </div>
            </div>

            <!-- Popover 2: Tabela de Projeções -->
            <div class="attic-hud-popover" id="popover-projections">
                <div class="attic-popover-header">
                    <span>📅 Próximas Janelas Projetadas</span>
                    <button class="attic-popover-close" data-close="popover-projections">✕</button>
                </div>
                <table class="attic-pop-table">
                    <thead>
                        <tr>
                            <th>Ciclo</th>
                            <th>Janela NST</th>
                            <th id="pop-th-local-tz">Horário Brasília</th>
                            <th>Drift</th>
                        </tr>
                    </thead>
                    <tbody id="pop-projections-tbody">
                        <tr><td colspan="4" style="text-align: center; color: #64748b; padding: 10px;">Defina o último restock para calcular.</td></tr>
                    </tbody>
                </table>
                <div style="display: flex; justify-content: flex-end;">
                    <button class="attic-hud-btn" id="pop-btn-copy-projections">
                        📋 Copiar para Discord / Fórum
                    </button>
                </div>
            </div>

            <!-- Popover 3: Configurações -->
            <div class="attic-hud-popover" id="popover-settings" style="width: 320px;">
                <div class="attic-popover-header">
                    <span>⚙️ Configurações</span>
                    <button class="attic-popover-close" data-close="popover-settings">✕</button>
                </div>
                <div class="attic-setting-row">
                    <label>Seu Fuso Horário Local:</label>
                    <select class="attic-select" id="pop-select-tz"></select>
                </div>
                <div class="attic-setting-row">
                    <label>Volume do Alerta Sonoro:</label>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <input type="range" id="pop-range-volume" min="0" max="1" step="0.05" style="flex: 1; accent-color: #6366f1;">
                        <button class="attic-hud-btn" id="pop-btn-test-sound" style="padding: 2px 6px;">Testar 🔔</button>
                    </div>
                </div>
                <div class="attic-setting-row">
                    <label>Tolerância Pós-Janela (Overtime):</label>
                    <select class="attic-select" id="pop-select-overtime">
                        <option value="15">15 segundos</option>
                        <option value="30">30 segundos (Recomendado)</option>
                        <option value="45">45 segundos</option>
                        <option value="60">60 segundos (1 minuto)</option>
                    </select>
                </div>
                <div style="margin-top: 8px;">
                    <label class="attic-chk-label">
                        <input type="checkbox" id="pop-chk-sound">
                        Alertas Sonoros Ativos
                    </label>
                    <label class="attic-chk-label">
                        <input type="checkbox" id="pop-chk-30s">
                        Bip aos 30s antes da janela
                    </label>
                    <label class="attic-chk-label">
                        <input type="checkbox" id="pop-chk-10s">
                        Bip aos 10s antes da janela
                    </label>
                    <label class="attic-chk-label">
                        <input type="checkbox" id="pop-chk-window">
                        Arpejo ao abrir janela (0s)
                    </label>
                    <label class="attic-chk-label">
                        <input type="checkbox" id="pop-chk-title">
                        Contador no título da aba
                    </label>
                </div>
            </div>
        `;

        return wrapper;
    }

    function populateTimezones(selectEl) {
        selectEl.innerHTML = '';
        COMMON_TIMEZONES.forEach(tz => {
            const opt = document.createElement('option');
            opt.value = tz.value;
            opt.textContent = tz.label;
            if (config.timezone === tz.value) opt.selected = true;
            selectEl.appendChild(opt);
        });
    }

    function closeAllPopovers() {
        document.querySelectorAll('.attic-hud-popover').forEach(p => p.classList.remove('open'));
    }

    function togglePopover(popoverId) {
        const target = document.getElementById(popoverId);
        if (!target) return;
        const isOpen = target.classList.contains('open');
        closeAllPopovers();
        if (!isOpen) {
            target.classList.add('open');
        }
    }

    // =========================================================================
    // LOOP PRINCIPAL DE ATUALIZAÇÃO
    // =========================================================================

    function updateUiTick() {
        const nowMs = getCorrectedNow();
        const userTz = resolveUserTimezone();

        // 1. Relógios de Topo
        const nstStr = formatTimeInZone(nowMs, NST_TIMEZONE, true);
        const localStr = formatTimeInZone(nowMs, userTz, true);

        if (uiElements.clockNst) uiElements.clockNst.textContent = nstStr;
        if (uiElements.clockLocal) uiElements.clockLocal.textContent = localStr;

        // 2. Cálculos
        const calc = calculateAtticWindows(nowMs);

        // 3. Atualização do Popover Manual
        if (uiElements.currentBaseDesc) {
            if (config.lastRestockTimestamp) {
                const lrNst = formatTimeInZone(config.lastRestockTimestamp, NST_TIMEZONE, true);
                const lrLocal = formatTimeInZone(config.lastRestockTimestamp, userTz, true);
                uiElements.currentBaseDesc.innerHTML = `Último restock: <strong>${lrNst} NST</strong> (${lrLocal} Local)`;
            } else {
                uiElements.currentBaseDesc.textContent = 'Nenhum restock cadastrado ainda.';
            }
        }

        // 4. Sem Base
        if (!calc.hasBase) {
            if (uiElements.timerPill) {
                uiElements.timerPill.className = 'attic-hud-timer-pill attic-pill-nobase';
            }
            if (uiElements.timerDigits) uiElements.timerDigits.textContent = '--:--';
            if (uiElements.timerDot) uiElements.timerDot.textContent = '⚪';
            if (uiElements.nextInfo) {
                uiElements.nextInfo.innerHTML = 'Aguardando último restock. Clique em <strong>⚡ Restocou!</strong> ou <strong>✏️</strong>';
            }
            if (config.tabTitleCountdown) {
                document.title = originalDocumentTitle;
            }
            return;
        }

        const cycle = calc.currentCycle;
        const remainingMs = cycle.timeRemainingMs;
        const cycleNum = cycle.cycleNumber;
        const remainingSec = Math.ceil(remainingMs / 1000);

        if (lastPlayedSoundCycle !== cycleNum) {
            lastPlayedSoundCycle = cycleNum;
            playedSoundFlags = { '30s': false, '10s': false, 'window': false };
        }

        const startNst = formatTimeInZone(cycle.startTimestamp, NST_TIMEZONE, true);
        const endNst = formatTimeInZone(cycle.endTimestamp, NST_TIMEZONE, true);
        const startLocal = formatTimeInZone(cycle.startTimestamp, userTz, true);

        // 5. Atualização visual por status
        if (calc.activeStatus === 'WAITING' || calc.activeStatus === 'ATTENTION' || calc.activeStatus === 'IMMINENT') {
            let pillClass = 'attic-pill-waiting';
            let dot = '🟢';

            if (calc.activeStatus === 'ATTENTION') {
                pillClass = 'attic-pill-attention';
                dot = '🟡';
            } else if (calc.activeStatus === 'IMMINENT') {
                pillClass = 'attic-pill-imminent';
                dot = '🟠';
            }

            if (uiElements.timerPill) uiElements.timerPill.className = `attic-hud-timer-pill ${pillClass}`;
            if (uiElements.timerDot) uiElements.timerDot.textContent = dot;
            if (uiElements.timerDigits) uiElements.timerDigits.textContent = formatDuration(remainingMs);

            if (uiElements.nextInfo) {
                uiElements.nextInfo.innerHTML = `Ciclo #${cycleNum} abre às <span>${startNst} NST</span> (${startLocal}) [drift +${cycle.driftSeconds}s]`;
            }

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

            if (uiElements.timerPill) uiElements.timerPill.className = 'attic-hud-timer-pill attic-pill-active';
            if (uiElements.timerDot) uiElements.timerDot.textContent = '🚨';
            if (uiElements.timerDigits) uiElements.timerDigits.textContent = `REFRESH! (${formatDuration(remainingMs)})`;

            if (uiElements.nextInfo) {
                uiElements.nextInfo.innerHTML = `<strong>JANELA ATIVA!</strong> ${startNst} ~ ${endNst} NST. Atualize a página!`;
            }

            if (config.tabTitleCountdown) {
                document.title = `🔴 REFRESH NOW! (${formatDuration(remainingMs)}) Sótão`;
            }
        } else if (calc.activeStatus === 'OVERTIME') {
            if (uiElements.timerPill) uiElements.timerPill.className = 'attic-hud-timer-pill attic-pill-overtime';
            if (uiElements.timerDot) uiElements.timerDot.textContent = '⏳';
            if (uiElements.timerDigits) uiElements.timerDigits.textContent = `+${formatDuration(remainingMs)}`;

            if (uiElements.nextInfo) {
                uiElements.nextInfo.innerHTML = `Prorrogação de refresh (+${config.overtimeSeconds}s). Checando atrasos...`;
            }

            if (config.tabTitleCountdown) {
                document.title = `⏳ (${formatDuration(remainingMs)}) Sótão Quase Abandonado`;
            }
        }

        renderProjectionsTable(calc.upcomingCycles, userTz);
    }

    function renderProjectionsTable(upcomingCycles, userTz) {
        if (!uiElements.popProjectionsTbody || !upcomingCycles || upcomingCycles.length === 0) return;

        const rowsHtml = upcomingCycles.map((cycle) => {
            const startNst = formatTimeInZone(cycle.startTimestamp, NST_TIMEZONE, true);
            const endNst = formatTimeInZone(cycle.endTimestamp, NST_TIMEZONE, true);
            const startLocal = formatTimeInZone(cycle.startTimestamp, userTz, true);
            const endLocal = formatTimeInZone(cycle.endTimestamp, userTz, true);

            const isCurrent = cycle.isCurrent;
            const rowClass = isCurrent ? 'class="active-row"' : '';
            const badge = isCurrent ? '<span class="attic-badge-current">Atual</span>' : '';

            return `
                <tr ${rowClass}>
                    <td><strong>#${cycle.cycleNumber}</strong> ${badge}</td>
                    <td><code>${startNst} ~ ${endNst}</code></td>
                    <td><code>${startLocal} ~ ${endLocal}</code></td>
                    <td>+${cycle.driftSeconds}s</td>
                </tr>
            `;
        }).join('');

        uiElements.popProjectionsTbody.innerHTML = rowsHtml;
    }

    function copyProjectionsToClipboard() {
        if (!config.lastRestockTimestamp) {
            alert('Defina primeiro o horário do último restock!');
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
            const btn = document.getElementById('pop-btn-copy-projections');
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = '✅ Copiado!';
                setTimeout(() => { btn.textContent = originalText; }, 2000);
            }
        }).catch(err => {
            console.error('Erro ao copiar para clipboard:', err);
            alert('Não foi possível copiar para a área de transferência.');
        });
    }

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    function init() {
        injectStyles();
        detectServerNstTime();

        const hud = createHud();

        // Inserção precisa:
        // No Attic, o conteúdo principal é td.content. Inserir como primeiro filho de td.content
        // garante que a barra fique no topo absoluto da área útil, BEM ACIMA de qualquer item!
        const contentTd = document.querySelector('td.content');
        if (contentTd) {
            contentTd.insertBefore(hud, contentTd.firstChild);
        } else {
            const fallbackContainer = document.querySelector('#content, center, table[width="100%"]');
            if (fallbackContainer) {
                fallbackContainer.parentNode.insertBefore(hud, fallbackContainer);
            } else {
                document.body.insertBefore(hud, document.body.firstChild);
            }
        }

        // Cache de elementos de DOM
        uiElements = {
            clockNst: document.getElementById('hud-clock-nst'),
            clockLocal: document.getElementById('hud-clock-local'),
            timerPill: document.getElementById('hud-timer-pill'),
            timerDot: document.getElementById('hud-timer-status-dot'),
            timerDigits: document.getElementById('hud-timer-digits'),
            nextInfo: document.getElementById('hud-next-info'),
            popProjectionsTbody: document.getElementById('pop-projections-tbody'),
            thLocalTz: document.getElementById('pop-th-local-tz'),
            currentBaseDesc: document.getElementById('pop-current-base-desc')
        };

        // Popula fusos
        const selectTz = document.getElementById('pop-select-tz');
        if (selectTz) {
            populateTimezones(selectTz);
            selectTz.addEventListener('change', (e) => {
                config.timezone = e.target.value;
                saveConfig(config);
                updateTzLabels();
                updateUiTick();
            });
        }

        // Eventos dos botões de abrir popovers
        document.getElementById('hud-btn-open-manual')?.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover('popover-manual');
        });

        document.getElementById('hud-btn-open-projections')?.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover('popover-projections');
        });

        document.getElementById('hud-btn-open-settings')?.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePopover('popover-settings');
        });

        // Fechar popovers ao clicar nos botões '✕' ou fora
        document.querySelectorAll('.attic-popover-close').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAllPopovers();
            });
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.attic-hud-popover') && !e.target.closest('.attic-hud-btn')) {
                closeAllPopovers();
            }
        });

        // Checkboxes & Ajustes
        const chkSound = document.getElementById('pop-chk-sound');
        const chk30s = document.getElementById('pop-chk-30s');
        const chk10s = document.getElementById('pop-chk-10s');
        const chkWindow = document.getElementById('pop-chk-window');
        const chkTitle = document.getElementById('pop-chk-title');
        const rangeVol = document.getElementById('pop-range-volume');
        const selOvertime = document.getElementById('pop-select-overtime');

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

        document.getElementById('pop-btn-test-sound')?.addEventListener('click', () => {
            playSoundAlert('test');
        });

        // Ações da Barra: Restocou Agora!
        document.getElementById('hud-btn-stocked-now')?.addEventListener('click', () => {
            const now = getCorrectedNow();
            config.lastRestockTimestamp = now;
            saveConfig(config);
            updateUiTick();
        });

        // Ação: Pular Ciclo (+7m)
        document.getElementById('hud-btn-skip-cycle')?.addEventListener('click', () => {
            if (!config.lastRestockTimestamp) return;
            const now = getCorrectedNow();
            const calc = calculateAtticWindows(now);
            if (calc.currentCycle) {
                const currentCycleEnd = calc.currentCycle.endTimestamp;
                if (now < currentCycleEnd) {
                    config.lastRestockTimestamp -= RESTOCK_CYCLE_MS;
                }
                saveConfig(config);
                updateUiTick();
            }
        });

        // Ação: Salvar Manual
        const inputManual = document.getElementById('pop-input-manual');
        const btnSaveManual = document.getElementById('pop-btn-save-manual');
        const handleManualSave = () => {
            if (!inputManual) return;
            const text = inputManual.value.trim();
            const ts = parseNstInputToTimestamp(text);
            if (!ts) {
                alert('Formato inválido! Digite HH:MM:SS ou HH:MM (ex: 14:22:15 ou 2:22 pm).');
                return;
            }
            config.lastRestockTimestamp = ts;
            saveConfig(config);
            inputManual.value = '';
            closeAllPopovers();
            updateUiTick();
        };

        btnSaveManual?.addEventListener('click', handleManualSave);
        inputManual?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleManualSave();
        });

        // Copiar Projeções
        document.getElementById('pop-btn-copy-projections')?.addEventListener('click', copyProjectionsToClipboard);

        // Detecção de Estoque
        checkStockOnPageLoad();

        // Rótulos de fusos
        updateTzLabels();

        // Loop a cada 1 segundo
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

        const rowLabel = document.getElementById('hud-clock-local-row');
        if (rowLabel) {
            rowLabel.innerHTML = `${tzName}: <strong id="hud-clock-local">--:--:--</strong>`;
            uiElements.clockLocal = document.getElementById('hud-clock-local');
        }
        if (uiElements.thLocalTz) uiElements.thLocalTz.textContent = tzName;
    }

    function checkStockOnPageLoad() {
        const detection = detectAtticStockOnPage();
        const alertBox = document.getElementById('attic-hud-stock-alert');
        const alertText = document.getElementById('hud-stock-alert-text');
        const btnConfirm = document.getElementById('hud-btn-confirm-stock');
        const btnDismiss = document.getElementById('hud-btn-dismiss-stock');

        if (detection.stocked && alertBox && alertText && btnConfirm) {
            alertBox.style.display = 'flex';
            alertText.innerHTML = `🎉 <strong>Restock no Sótão!</strong> Encontramos ${detection.count} item(ns) à venda neste momento!`;

            btnConfirm.addEventListener('click', () => {
                const now = getCorrectedNow();
                config.lastRestockTimestamp = now;
                saveConfig(config);
                alertBox.style.display = 'none';
                updateUiTick();
            });

            btnDismiss?.addEventListener('click', () => {
                alertBox.style.display = 'none';
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
