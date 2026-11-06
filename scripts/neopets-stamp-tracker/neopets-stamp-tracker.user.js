// ==UserScript==
// @name         Neopets: Rastreador de Selos & Marcador de Lojas
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.1.0
// @description  Rastreia selos, moedas, conchas e amuletos colecionados no Álbum de Selos do Neopets e destaca itens faltantes em lojas oficiais e de usuários com cores personalizadas por faixa de preço do itemDB.
// @author       t-moedano
// @match        *://*.neopets.com/stamps.phtml*
// @match        *://*.neopets.com/objects.phtml?*type=shop*
// @match        *://*.neopets.com/browseshop.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      itemdb.com.br
// @connect      www.itemdb.com.br
// @connect      neopets.com
// @connect      www.neopets.com
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-stamp-tracker/neopets-stamp-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-stamp-tracker/neopets-stamp-tracker.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'neopets_stamps_storage_v1';
    const ITEMDB_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 dias

    // Faixas padrão de preço (máximo 5 faixas configuráveis)
    const DEFAULT_PRICE_TIERS = [
        { maxPrice: 10000000, color: '#22c55e' }, // Até 10M -> Verde
        { maxPrice: 50000000, color: '#eab308' }, // Até 50M -> Amarelo
        { maxPrice: Infinity, color: '#ef4444' }  // Acima de 50M -> Vermelho
    ];
    const DEFAULT_UNPRICED_COLOR = '#8b5cf6'; // Roxo para itens sem preço no itemDB

    // Lojas oficiais homologadas que vendem itens para o álbum de selos
    const OFFICIAL_STAMP_SHOPS = {
        3: {
            name: 'Toy Shop',
            category: 'Amuletos / Charms',
            filter: (name) => {
                if (!name) return false;
                const clean = normalizeTitle(name);
                return clean.includes('collectable charm') || 
                       clean.includes('collectible charm') || 
                       clean.includes('baelia charm');
            }
        },
        58: { name: 'Neopian Post Office', category: 'Selos' },
        68: { name: 'Coin Shop', category: 'Moedas' },
        86: { name: 'Sea Shells', category: 'Conchas' }
    };

    // =========================================================================
    // UTILITÁRIOS
    // =========================================================================

    function normalizeTitle(text) {
        if (!text) return '';
        return text
            .replace(/&amp;/gi, '&')
            .replace(/&#039;|&apos;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/[\u2018\u2019']/g, "'")
            .replace(/[\u201C\u201D"]/g, '"')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    function extractItemHash(src) {
        if (!src) return null;
        const match = src.match(/\/items\/([^\/\.]+)\.(?:gif|png)/i);
        return match ? match[1].toLowerCase() : null;
    }

    function getLoggedInUsername() {
        const modernUser = document.querySelector('.nav-profile-dropdown-text');
        if (modernUser && modernUser.textContent && modernUser.textContent.trim()) {
            return modernUser.textContent.trim().toLowerCase();
        }

        const userLink = document.querySelector('a[href*="/userlookup.phtml?user="]');
        if (userLink) {
            const match = userLink.getAttribute('href').match(/user=([^&"']+)/);
            if (match) return match[1].toLowerCase();
        }

        if (typeof unsafeWindow !== 'undefined' && unsafeWindow.appInsightsUserName) {
            return String(unsafeWindow.appInsightsUserName).toLowerCase();
        }
        if (typeof window.appInsightsUserName !== 'undefined' && window.appInsightsUserName) {
            return String(window.appInsightsUserName).toLowerCase();
        }

        return null;
    }

    function loadStorage() {
        try {
            let raw = null;
            if (typeof GM_getValue !== 'undefined') {
                raw = GM_getValue(STORAGE_KEY, null);
            }
            if (!raw) {
                raw = localStorage.getItem(STORAGE_KEY);
            }
            if (!raw) {
                return {
                    username: null,
                    lastSync: null,
                    totalCount: 0,
                    uniqueCount: 0,
                    pages: {},
                    pageCounts: {},
                    stamps: {},
                    stampImages: {},
                    itemdbPrices: null,
                    priceTiers: JSON.parse(JSON.stringify(DEFAULT_PRICE_TIERS)),
                    unpricedColor: DEFAULT_UNPRICED_COLOR
                };
            }
            const data = JSON.parse(raw);
            data.stampImages = data.stampImages || {};
            data.pageCounts = data.pageCounts || {};
            data.priceTiers = (Array.isArray(data.priceTiers) && data.priceTiers.length > 0)
                ? data.priceTiers
                : JSON.parse(JSON.stringify(DEFAULT_PRICE_TIERS));
            data.unpricedColor = data.unpricedColor || DEFAULT_UNPRICED_COLOR;
            return data;
        } catch (e) {
            console.error('[Scriptnautas Selos] Erro ao carregar storage:', e);
            return {
                username: null,
                lastSync: null,
                totalCount: 0,
                uniqueCount: 0,
                pages: {},
                pageCounts: {},
                stamps: {},
                stampImages: {},
                itemdbPrices: null,
                priceTiers: JSON.parse(JSON.stringify(DEFAULT_PRICE_TIERS)),
                unpricedColor: DEFAULT_UNPRICED_COLOR
            };
        }
    }

    function saveStorage(data) {
        try {
            const consolidated = {};
            const consolidatedImages = {};
            let totalSlotsCount = 0;
            let uniqueCount = 0;

            if (data.pages) {
                Object.values(data.pages).forEach(pageStamps => {
                    if (Array.isArray(pageStamps)) {
                        totalSlotsCount += pageStamps.length;
                        pageStamps.forEach(item => {
                            const itemName = typeof item === 'string' ? item : item?.name;
                            const itemImg = typeof item === 'object' ? item?.imgKey : null;

                            if (itemName) {
                                const norm = normalizeTitle(itemName);
                                if (norm && !consolidated[norm]) {
                                    consolidated[norm] = true;
                                    uniqueCount++;
                                }
                            }
                            if (itemImg) {
                                consolidatedImages[itemImg.toLowerCase()] = true;
                            }
                        });
                    }
                });
            }
            data.stamps = consolidated;
            data.stampImages = consolidatedImages;
            // O Neopets conta o total oficial de selos colados em todas as páginas do álbum
            data.totalCount = totalSlotsCount;
            data.uniqueCount = uniqueCount;

            const raw = JSON.stringify(data);
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(STORAGE_KEY, raw);
            }
            try {
                localStorage.setItem(STORAGE_KEY, raw);
            } catch (ignore) {}
        } catch (e) {
            console.error('[Scriptnautas Selos] Erro ao salvar storage:', e);
        }
    }

    function hexToRgba(hex, alpha) {
        if (!hex || typeof hex !== 'string') return `rgba(34, 197, 94, ${alpha})`;
        let clean = hex.replace('#', '').trim();
        if (clean.length === 3) {
            clean = clean.split('').map(c => c + c).join('');
        }
        const num = parseInt(clean, 16);
        if (isNaN(num)) return `rgba(34, 197, 94, ${alpha})`;
        const r = (num >> 16) & 255;
        const g = (num >> 8) & 255;
        const b = num & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString('pt-BR');
    }

    function formatPriceCompact(num) {
        if (num === Infinity || num === null || num === undefined) return 'Sem limite';
        if (num >= 1000000) {
            const m = num / 1000000;
            return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
        }
        if (num >= 1000) {
            const k = num / 1000;
            return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
        }
        return String(num);
    }

    function parsePriceInput(val) {
        if (val === null || val === undefined) return null;
        val = String(val).trim().toLowerCase();
        if (val === 'inf' || val === 'infinity' || val === 'acima' || val === '+' || val === '' || val === 'sem limite' || val === 'sem teto') return Infinity;
        let multiplier = 1;
        if (val.endsWith('m') || val.endsWith('kk')) {
            multiplier = 1000000;
            val = val.replace(/m|kk/g, '').trim();
        } else if (val.endsWith('k')) {
            multiplier = 1000;
            val = val.replace(/k/g, '').trim();
        }
        val = val.replace(/\./g, '').replace(',', '.');
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) return null;
        return Math.round(num * multiplier);
    }

    function getItemPrice(itemName, itemSrc, itemdbPrices) {
        if (!itemdbPrices) return null;
        if (itemName) {
            const norm = normalizeTitle(itemName);
            if (itemdbPrices.byName && itemdbPrices.byName[norm] !== undefined) {
                return itemdbPrices.byName[norm];
            }
        }
        if (itemSrc) {
            const hash = extractItemHash(itemSrc);
            if (hash && itemdbPrices.byImage && itemdbPrices.byImage[hash] !== undefined) {
                return itemdbPrices.byImage[hash];
            }
        }
        return null;
    }

    function getItemTierColor(price, priceTiers, unpricedColor) {
        if (price === null || price === undefined || isNaN(price)) {
            return unpricedColor || DEFAULT_UNPRICED_COLOR;
        }
        if (!priceTiers || !priceTiers.length) {
            return '#22c55e';
        }

        const sorted = [...priceTiers].sort((a, b) => a.maxPrice - b.maxPrice);
        for (const tier of sorted) {
            if (price <= tier.maxPrice) {
                return tier.color;
            }
        }
        return sorted[sorted.length - 1].color;
    }

    function fetchItemdbPrices(force = false) {
        return new Promise((resolve, reject) => {
            const storage = loadStorage();
            const now = Date.now();
            if (!force && storage.itemdbPrices && storage.itemdbPrices.lastUpdated && 
                (now - storage.itemdbPrices.lastUpdated < ITEMDB_CACHE_TTL_MS) && 
                storage.itemdbPrices.itemCount > 100) {
                return resolve(storage.itemdbPrices);
            }

            const apiUrl = 'https://itemdb.com.br/api/v1/lists/official/all-collectibles/itemdata';

            const handleSuccess = (responseText) => {
                try {
                    const data = JSON.parse(responseText);
                    let itemsArray = [];
                    if (Array.isArray(data)) {
                        itemsArray = data;
                    } else if (data && typeof data === 'object') {
                        if (Array.isArray(data.items)) {
                            itemsArray = data.items;
                        } else if (data.items && typeof data.items === 'object') {
                            itemsArray = Object.values(data.items);
                        } else {
                            itemsArray = Object.values(data);
                        }
                    }

                    const byName = {};
                    const byImage = {};
                    let validPrices = 0;

                    itemsArray.forEach(item => {
                        if (!item || !item.name) return;
                        const name = String(item.name).trim();
                        const norm = normalizeTitle(name);

                        let priceValue = null;
                        if (item.price && typeof item.price === 'object' && typeof item.price.value === 'number') {
                            priceValue = item.price.value;
                        } else if (typeof item.price === 'number') {
                            priceValue = item.price;
                        }

                        let imageId = null;
                        if (item.image && typeof item.image === 'object') {
                            imageId = item.image.id || extractItemHash(item.image.url);
                        } else if (item.image_id) {
                            imageId = item.image_id;
                        } else if (typeof item.image === 'string') {
                            imageId = extractItemHash(item.image) || item.image;
                        }
                        if (imageId) {
                            imageId = String(imageId).toLowerCase().trim();
                        }

                        if (priceValue !== null && !isNaN(priceValue)) {
                            validPrices++;
                        }

                        byName[norm] = priceValue;
                        if (imageId) {
                            byImage[imageId] = priceValue;
                        }
                    });

                    const processed = {
                        lastUpdated: Date.now(),
                        itemCount: Object.keys(byName).length,
                        pricedCount: validPrices,
                        byName: byName,
                        byImage: byImage
                    };

                    const curStorage = loadStorage();
                    curStorage.itemdbPrices = processed;
                    saveStorage(curStorage);
                    resolve(processed);
                } catch (err) {
                    reject(new Error('Erro ao processar dados de preços do itemDB.'));
                }
            };

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: apiUrl,
                    headers: { 'Accept': 'application/json' },
                    timeout: 30000,
                    onload: function(res) {
                        if (res.status >= 200 && res.status < 300) {
                            handleSuccess(res.responseText);
                        } else {
                            reject(new Error(`Erro ao conectar ao itemDB (HTTP ${res.status}). Dica: abra o site itemdb.com.br em uma aba para validar a sessão.`));
                        }
                    },
                    ontimeout: function() {
                        reject(new Error('Tempo limite esgotado ao contatar o itemDB.'));
                    },
                    onerror: function(err) {
                        reject(new Error('Falha de conexão com o itemDB.'));
                    }
                });
            } else {
                fetch(apiUrl, { headers: { 'Accept': 'application/json' } })
                    .then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    })
                    .then(handleSuccess)
                    .catch(e => reject(new Error(`Falha de conexão com o itemDB: ${e.message}`)));
            }
        });
    }

    // Checa se o item já foi colecionado (por NOME normalizado ou pelo HASH da IMAGEM)
    function isCollectedItem(itemName, itemSrc, collectedSet, imageSet) {
        if (itemName) {
            const norm = normalizeTitle(itemName);
            if (collectedSet.has(norm)) return true;
        }
        if (itemSrc) {
            const hash = extractItemHash(itemSrc);
            if (hash && imageSet[hash]) {
                return true;
            }
        }
        return false;
    }

    // =========================================================================
    // ESTILOS VISUAIS
    // =========================================================================

    function injectStyles() {
        if (document.getElementById('scriptnautas-stamp-styles')) return;
        const style = document.createElement('style');
        style.id = 'scriptnautas-stamp-styles';
        style.textContent = `
            @keyframes snFadeIn {
                from { opacity: 0; transform: translate(-50%, -10px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
            .sn-badge-collected {
                position: absolute;
                top: 4px;
                right: 4px;
                background: #4b5563;
                color: #e5e7eb;
                font-weight: 700;
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 9999px;
                z-index: 10;
                pointer-events: none;
            }
            .sn-item-missing {
                outline: 3px solid var(--sn-tier-color, #22c55e) !important;
                background: var(--sn-tier-bg, rgba(34, 197, 94, 0.12)) !important;
                border-radius: 8px !important;
                box-shadow: 0 0 12px var(--sn-tier-shadow, rgba(34, 197, 94, 0.45)) !important;
                position: relative !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
            }
            .sn-item-missing:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 16px var(--sn-tier-shadow, rgba(34, 197, 94, 0.7)) !important;
            }
            .sn-badge-missing {
                position: absolute;
                top: 4px;
                right: 4px;
                background: var(--sn-tier-color, #16a34a);
                color: #ffffff;
                font-weight: 800;
                font-size: 10px;
                padding: 3px 6px;
                border-radius: 9999px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.3);
                z-index: 10;
                pointer-events: none;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .sn-item-collected {
                opacity: 0.38 !important;
                filter: grayscale(85%) !important;
                position: relative !important;
                transition: opacity 0.2s ease, filter 0.2s ease;
            }
            .sn-item-collected:hover {
                opacity: 0.85 !important;
                filter: grayscale(0%) !important;
            }
            .sn-status-floating {
                position: fixed;
                bottom: 16px;
                right: 16px;
                background: #111827;
                color: #f3f4f6;
                padding: 10px 14px;
                border-radius: 12px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
                border: 1px solid #374151;
                z-index: 999999;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sn-status-floating a {
                color: #38bdf8;
                text-decoration: underline;
                font-weight: 600;
            }
            .sn-sync-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100vw;
                height: 100vh;
                background: rgba(0, 0, 0, 0.75);
                backdrop-filter: blur(4px);
                z-index: 1000000;
                display: flex;
                align-items: center;
                justify-content: center;
                font-family: system-ui, -apple-system, sans-serif;
            }
            .sn-sync-modal {
                background: #1f2937;
                color: #f9fafb;
                border: 1px solid #374151;
                border-radius: 16px;
                padding: 24px;
                width: 90%;
                max-width: 520px;
                box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
                text-align: center;
            }
            .sn-progress-bar-bg {
                background: #374151;
                border-radius: 9999px;
                height: 12px;
                width: 100%;
                overflow: hidden;
                margin: 16px 0;
            }
            .sn-progress-bar-fill {
                background: linear-gradient(90deg, #10b981, #06b6d4);
                height: 100%;
                width: 0%;
                transition: width 0.2s ease;
            }
            .sn-btn-primary {
                background: #059669;
                color: white;
                border: none;
                padding: 8px 16px;
                border-radius: 8px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.2s;
            }
            .sn-btn-primary:hover {
                background: #10b981;
            }
            .sn-log-container {
                max-height: 160px;
                overflow-y: auto;
                background: #111827;
                border: 1px solid #374151;
                border-radius: 8px;
                padding: 8px 12px;
                font-family: monospace;
                font-size: 11px;
                text-align: left;
                margin-top: 12px;
                color: #d1d5db;
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================================
    // MODAL DE CONFIGURAÇÃO DE FAIXAS DE PREÇO (ITEMDB)
    // =========================================================================

    function openPriceConfigModal(onSavedCallback) {
        injectStyles();
        const existing = document.getElementById('sn-price-config-overlay');
        if (existing) existing.remove();

        const storage = loadStorage();
        let tiers = JSON.parse(JSON.stringify(storage.priceTiers || DEFAULT_PRICE_TIERS));
        let unpricedColor = storage.unpricedColor || DEFAULT_UNPRICED_COLOR;

        const overlay = document.createElement('div');
        overlay.id = 'sn-price-config-overlay';
        overlay.className = 'sn-sync-modal-overlay';

        function renderModalContent() {
            const prices = storage.itemdbPrices;
            let dbStatusText = '<span style="color: #f87171;">Não sincronizado</span>';
            if (prices && prices.lastUpdated) {
                const dateStr = new Date(prices.lastUpdated).toLocaleDateString('pt-BR');
                const timeStr = new Date(prices.lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                dbStatusText = `<strong style="color: #34d399;">${prices.itemCount}</strong> colecionáveis (<strong style="color: #38bdf8;">${prices.pricedCount || 0}</strong> cotados) • Atualizado em ${dateStr} ${timeStr}`;
            }

            overlay.innerHTML = `
                <div class="sn-sync-modal" style="max-width: 580px; text-align: left; box-sizing: border-box;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #374151; padding-bottom: 12px; margin-bottom: 16px;">
                        <h3 style="margin: 0; font-size: 17px; color: #38bdf8; display: flex; align-items: center; gap: 8px;">
                            🎨 Cores & Faixas de Preço (itemDB)
                        </h3>
                        <span id="sn-config-close-x" style="cursor: pointer; font-size: 24px; color: #9ca3af; line-height: 1;" title="Fechar">&times;</span>
                    </div>

                    <!-- Caixa status itemDB -->
                    <div style="background: #111827; border: 1px solid #374151; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <div>
                            <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; font-weight: 700;">
                                🏷️ Catálogo do itemDB (Cache de 14 dias)
                            </div>
                            <div id="sn-db-status-label" style="font-size: 12px; color: #e5e7eb; margin-top: 3px;">
                                ${dbStatusText}
                            </div>
                        </div>
                        <button id="sn-btn-update-itemdb" class="sn-btn-primary" style="background: #0284c7; font-size: 12px; padding: 6px 14px;">
                            🔄 Atualizar Preços
                        </button>
                    </div>

                    <!-- Título Faixas -->
                    <div style="margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                        <div>
                            <div style="font-weight: 700; font-size: 13px; color: #f3f4f6;">Faixas de Preço dos Selos Faltantes</div>
                            <div style="font-size: 11px; color: #9ca3af;">Até 5 faixas com cores e tetos (ex: 10M, 50m, 500k ou + para sem limite):</div>
                        </div>
                        <button id="sn-btn-add-tier" class="sn-btn-primary" style="background: #4f46e5; font-size: 11px; padding: 5px 12px; ${tiers.length >= 5 ? 'display: none;' : ''}">
                            ➕ Nova Faixa (${tiers.length}/5)
                        </button>
                    </div>

                    <!-- Lista de Faixas -->
                    <div id="sn-tiers-container" style="display: flex; flex-direction: column; gap: 8px; max-height: 220px; overflow-y: auto; margin-bottom: 14px; padding-right: 4px;">
                    </div>

                    <!-- Item sem preço -->
                    <div style="background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 10px 12px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <div style="font-size: 12px; font-weight: 600; color: #e5e7eb;">Selo sem cotação recente no itemDB:</div>
                            <div style="font-size: 11px; color: #9ca3af;">Cor aplicada quando o selo não tem histórico de preço</div>
                        </div>
                        <input type="color" id="sn-unpriced-color-input" value="${unpricedColor}" style="width: 38px; height: 32px; border: none; border-radius: 6px; cursor: pointer; background: transparent;" title="Escolher cor para itens sem cotação">
                    </div>

                    <!-- Rodapé com Ações -->
                    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; border-top: 1px solid #374151; padding-top: 14px;">
                        <button id="sn-btn-restore-tiers" style="background: transparent; border: 1px solid #4b5563; color: #9ca3af; font-size: 12px; padding: 7px 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">
                            Restaurar Padrões
                        </button>
                        <div style="display: flex; gap: 8px;">
                            <button id="sn-btn-cancel-config" style="background: #374151; color: #d1d5db; border: none; font-size: 12px; padding: 7px 14px; border-radius: 8px; cursor: pointer;">
                                Cancelar
                            </button>
                            <button id="sn-btn-save-config" class="sn-btn-primary" style="font-size: 12px; padding: 7px 16px;">
                                💾 Salvar Alterações
                            </button>
                        </div>
                    </div>
                </div>
            `;

            const container = overlay.querySelector('#sn-tiers-container');

            function renderTiersRows() {
                container.innerHTML = '';
                tiers.forEach((tier, index) => {
                    const row = document.createElement('div');
                    row.className = 'sn-tier-row';
                    row.style.cssText = 'display: flex; align-items: center; gap: 10px; background: #111827; border: 1px solid #374151; border-radius: 8px; padding: 8px 10px;';

                    const displayVal = tier.maxPrice === Infinity ? '+' : formatPriceCompact(tier.maxPrice);
                    const formattedHint = tier.maxPrice === Infinity ? 'Sem teto (acima de tudo)' : `${formatNumber(tier.maxPrice)} NP`;

                    row.innerHTML = `
                        <input type="color" class="sn-tier-color" value="${tier.color}" style="width: 34px; height: 30px; border: none; border-radius: 6px; cursor: pointer; background: transparent;" title="Escolher cor da faixa">
                        <div style="flex: 1; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="font-size: 12px; color: #9ca3af; white-space: nowrap;">Até:</span>
                            <input type="text" class="sn-tier-price" value="${displayVal}" placeholder="ex: 10M ou +" style="width: 100px; background: #1f2937; border: 1px solid #4b5563; color: #f3f4f6; border-radius: 6px; padding: 4px 8px; font-size: 12px; font-family: monospace;">
                            <span class="sn-tier-hint" style="font-size: 11px; color: #38bdf8;">${formattedHint}</span>
                        </div>
                        ${tiers.length > 1 ? `<button class="sn-tier-del-btn" style="background: transparent; border: none; color: #f87171; cursor: pointer; font-size: 16px; padding: 2px 6px; line-height: 1;" title="Remover esta faixa">&times;</button>` : ''}
                    `;

                    const colorInput = row.querySelector('.sn-tier-color');
                    const priceInput = row.querySelector('.sn-tier-price');
                    const hintSpan = row.querySelector('.sn-tier-hint');
                    const delBtn = row.querySelector('.sn-tier-del-btn');

                    colorInput.addEventListener('input', (e) => {
                        tier.color = e.target.value;
                    });

                    priceInput.addEventListener('input', (e) => {
                        const parsed = parsePriceInput(e.target.value);
                        if (parsed === null) {
                            hintSpan.textContent = 'Inválido';
                            hintSpan.style.color = '#f87171';
                        } else if (parsed === Infinity) {
                            tier.maxPrice = Infinity;
                            hintSpan.textContent = 'Sem teto (acima de tudo)';
                            hintSpan.style.color = '#a78bfa';
                        } else {
                            tier.maxPrice = parsed;
                            hintSpan.textContent = `${formatNumber(parsed)} NP`;
                            hintSpan.style.color = '#38bdf8';
                        }
                    });

                    if (delBtn) {
                        delBtn.addEventListener('click', () => {
                            tiers.splice(index, 1);
                            renderTiersRows();
                            updateAddButton();
                        });
                    }

                    container.appendChild(row);
                });
            }

            function updateAddButton() {
                const addBtn = overlay.querySelector('#sn-btn-add-tier');
                if (addBtn) {
                    addBtn.textContent = `➕ Nova Faixa (${tiers.length}/5)`;
                    addBtn.style.display = tiers.length >= 5 ? 'none' : 'inline-block';
                }
            }

            renderTiersRows();

            // Botão Adicionar Faixa
            overlay.querySelector('#sn-btn-add-tier')?.addEventListener('click', () => {
                if (tiers.length >= 5) return;
                let newMax = 100000000;
                let newColor = '#f97316';
                if (tiers.length > 0) {
                    const prevMax = tiers[tiers.length - 1].maxPrice;
                    if (prevMax !== Infinity) {
                        newMax = prevMax * 2;
                    }
                }
                tiers.push({ maxPrice: newMax, color: newColor });
                renderTiersRows();
                updateAddButton();
            });

            // Atualizar itemDB
            overlay.querySelector('#sn-btn-update-itemdb')?.addEventListener('click', async () => {
                const btn = overlay.querySelector('#sn-btn-update-itemdb');
                const label = overlay.querySelector('#sn-db-status-label');
                btn.disabled = true;
                btn.textContent = 'Carregando...';
                try {
                    const res = await fetchItemdbPrices(true);
                    const dateStr = new Date(res.lastUpdated).toLocaleDateString('pt-BR');
                    label.innerHTML = `<strong style="color: #34d399;">${res.itemCount}</strong> colecionáveis (<strong style="color: #38bdf8;">${res.pricedCount || 0}</strong> cotados) • Atualizado em ${dateStr}`;
                    btn.textContent = '✅ Atualizado!';
                    setTimeout(() => {
                        btn.textContent = '🔄 Atualizar Preços';
                        btn.disabled = false;
                    }, 2000);
                } catch (err) {
                    alert(`Não foi possível atualizar o itemDB: ${err.message}`);
                    btn.textContent = 'Tentar Novamente';
                    btn.disabled = false;
                }
            });

            // Restaurar Padrões
            overlay.querySelector('#sn-btn-restore-tiers')?.addEventListener('click', () => {
                tiers = JSON.parse(JSON.stringify(DEFAULT_PRICE_TIERS));
                unpricedColor = DEFAULT_UNPRICED_COLOR;
                const unpricedInput = overlay.querySelector('#sn-unpriced-color-input');
                if (unpricedInput) unpricedInput.value = unpricedColor;
                renderTiersRows();
                updateAddButton();
            });

            // Fechar / Cancelar
            overlay.querySelector('#sn-config-close-x')?.addEventListener('click', () => overlay.remove());
            overlay.querySelector('#sn-btn-cancel-config')?.addEventListener('click', () => overlay.remove());

            // Salvar Configurações
            overlay.querySelector('#sn-btn-save-config')?.addEventListener('click', () => {
                const unpricedInput = overlay.querySelector('#sn-unpriced-color-input');
                if (unpricedInput) {
                    unpricedColor = unpricedInput.value;
                }

                // Ordena faixas por valor ascendente
                tiers.sort((a, b) => a.maxPrice - b.maxPrice);

                const currentStorage = loadStorage();
                currentStorage.priceTiers = tiers;
                currentStorage.unpricedColor = unpricedColor;
                saveStorage(currentStorage);

                overlay.remove();

                if (typeof onSavedCallback === 'function') {
                    onSavedCallback(currentStorage);
                }
            });
        }

        renderModalContent();
        document.body.appendChild(overlay);
    }

    const currentUrl = new URL(window.location.href);
    const pathname = currentUrl.pathname;
    const searchParams = currentUrl.searchParams;

    // =========================================================================
    // 1. ÁLBUM DE SELOS (stamps.phtml)
    // =========================================================================
    if (pathname.includes('stamps.phtml')) {
        injectStyles();

        const currentUser = getLoggedInUsername();
        const requestedOwner = searchParams.get('owner');
        const isMyAlbum = !requestedOwner || (currentUser && requestedOwner.toLowerCase() === currentUser);

        // Extrai com precisão cirúrgica os 25 slots da grade do álbum
        function extractStampsFromDoc(rootDoc) {
            const stamps = [];

            // A grade do álbum do Neopets é uma tabela 5x5 com width="450" (ou altura 450)
            const albumTable = rootDoc.querySelector('table[width="450"]') ||
                               rootDoc.querySelector('table[height="450"]') ||
                               rootDoc.querySelector('.content table:has(img[src*="stamp_"], img[src*="no_stamp"], img[src*="items/"])');

            // Células da grade de selos
            const cells = albumTable
                ? albumTable.querySelectorAll('td[width="90"], td[bgcolor="white"], td[bgcolor="silver"]')
                : rootDoc.querySelectorAll('.content table td[width="90"]');

            cells.forEach(cell => {
                const img = cell.querySelector('img');
                if (!img) return;

                const src = img.getAttribute('src') || '';
                const alt = (img.getAttribute('alt') || '').trim();
                const title = (img.getAttribute('title') || '').trim();

                // Slot vazio: usa especificamente "/no_stamp.gif" ou alt="No Stamp"
                // IMPORTANTE: NÃO usar includes('no_stamp.gif') solto, pois 'sta_bruno_stamp.gif' contém 'no_stamp.gif'!
                const isBlankSlot = src.includes('/no_stamp.gif') || 
                                    src.includes('/stamp_blank.gif') || 
                                    src.includes('transparent_spacer.gif') ||
                                    (alt === 'No Stamp' && title === 'No Stamp');

                if (isBlankSlot) return;
                if (src.includes('arrow-') || src.includes('question_mark')) return;

                let name = (alt || title || cell.getAttribute('title') || '').trim();
                const imgKey = extractItemHash(src);

                if (name === 'No Stamp') return;

                // Se o nome vier vazio pela TNT, usa o hash da imagem como identificador seguro
                if (!name && imgKey) {
                    name = imgKey;
                }

                if (name || imgKey) {
                    stamps.push({
                        name: name || imgKey,
                        imgKey: imgKey
                    });
                }
            });

            // Lê a quantidade oficial declarada pelo Neopets na página: "has X stamps on this page!"
            const pageText = rootDoc.body ? rootDoc.body.textContent : '';
            const match = pageText.match(/has\s+(\d+)\s+stamps?\s+on\s+this\s+page/i);
            const expectedCount = match ? parseInt(match[1], 10) : null;

            return {
                stamps: stamps,
                expectedCount: expectedCount
            };
        }

        // Descobre todas as páginas de selos disponíveis no menu de navegação
        function discoverAlbumPages() {
            const pageMap = new Map();
            const links = document.querySelectorAll('a[href*="page_id="]');
            links.forEach(a => {
                const href = a.getAttribute('href') || '';
                const match = href.match(/page_id=(\d+)/);
                if (match) {
                    const id = parseInt(match[1], 10);
                    const title = a.textContent.trim() || `Página ${id}`;
                    if (!pageMap.has(id)) {
                        pageMap.set(id, title);
                    }
                }
            });

            // Garante que páginas de 0 a 53 estejam mapeadas mesmo se o menu estiver oculto
            for (let i = 0; i <= 53; i++) {
                if (!pageMap.has(i)) {
                    pageMap.set(i, `Página ${i}`);
                }
            }
            return pageMap;
        }

        // Sincronização Passiva da página atual caso seja o álbum do usuário
        if (isMyAlbum && searchParams.has('page_id')) {
            const pageId = searchParams.get('page_id');
            const result = extractStampsFromDoc(document);
            const storage = loadStorage();
            if (currentUser && (!storage.username || storage.username !== currentUser)) {
                storage.username = currentUser;
            }
            storage.pages = storage.pages || {};
            storage.pageCounts = storage.pageCounts || {};
            storage.pages[pageId] = result.stamps;
            if (result.expectedCount !== null) {
                storage.pageCounts[pageId] = result.expectedCount;
            }
            storage.lastSync = Date.now();
            saveStorage(storage);
            console.log(`[Scriptnautas Selos] Sincronização passiva: página ${pageId} com ${result.stamps.length} selos (declarado pelo Neopets: ${result.expectedCount}).`);
        }

        // Injeta painel de sincronização no topo do álbum
        function renderAlbumSyncBanner() {
            if (!isMyAlbum) return;

            const old = document.getElementById('sn-stamp-sync-banner');
            if (old) old.remove();

            const storage = loadStorage();
            const lastSyncText = storage.lastSync 
                ? new Date(storage.lastSync).toLocaleString() 
                : 'Nunca sincronizado';

            const banner = document.createElement('div');
            banner.id = 'sn-stamp-sync-banner';
            banner.style.cssText = `
                background: #0f172a;
                color: #f8fafc;
                border: 1px solid #334155;
                border-radius: 12px;
                padding: 14px 20px;
                margin: 15px auto;
                max-width: 650px;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                font-family: system-ui, -apple-system, sans-serif;
            `;

            banner.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                    <div style="text-align: left;">
                        <div style="font-weight: 700; font-size: 15px; color: #38bdf8;">
                            📮 Scriptnautas: Rastreador de Selos
                        </div>
                        <div style="font-size: 12px; color: #94a3b8; margin-top: 2px;">
                            Colecionados: <strong style="color: #4ade80;">${storage.totalCount || 0} selos</strong> | Última sync: <span>${lastSyncText}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <button id="sn-btn-open-price-config" class="sn-btn-primary" style="background: #4f46e5; font-size: 13px;">
                            🎨 Faixas de Preço
                        </button>
                        <button id="sn-btn-sync-all" class="sn-btn-primary" style="font-size: 13px;">
                            ⚡ Sincronizar Álbum Completo
                        </button>
                    </div>
                </div>
            `;

            const target = document.querySelector('.content table[width="450"]') ||
                           document.querySelector('.content p') ||
                           document.querySelector('.content') ||
                           document.getElementById('content');

            if (target) {
                target.parentNode.insertBefore(banner, target);
            }

            document.getElementById('sn-btn-open-price-config')?.addEventListener('click', () => {
                openPriceConfigModal();
            });
            document.getElementById('sn-btn-sync-all')?.addEventListener('click', startFullSync);
        }

        // Processo de Sincronização Completa em Lote com Barra de Progresso e Validador
        async function startFullSync() {
            const pageMap = discoverAlbumPages();
            const pageIds = Array.from(pageMap.keys()).sort((a, b) => a - b);
            const total = pageIds.length;

            const overlay = document.createElement('div');
            overlay.className = 'sn-sync-modal-overlay';
            overlay.innerHTML = `
                <div class="sn-sync-modal">
                    <h3 style="margin-top: 0; font-size: 18px; color: #38bdf8;">Sincronizando Álbum de Selos</h3>
                    <p style="font-size: 13px; color: #9ca3af; margin-bottom: 8px;">
                        Lendo páginas do álbum de forma otimizada com validação automática...
                    </p>
                    <div class="sn-progress-bar-bg">
                        <div id="sn-sync-fill" class="sn-progress-bar-fill"></div>
                    </div>
                    <div id="sn-sync-status" style="font-size: 13px; font-weight: 600; color: #e5e7eb;">
                        Iniciando... (0/${total})
                    </div>
                    <div id="sn-sync-log" class="sn-log-container">Iniciando varredura...</div>
                </div>
            `;
            document.body.appendChild(overlay);

            const fillEl = document.getElementById('sn-sync-fill');
            const statusEl = document.getElementById('sn-sync-status');
            const logEl = document.getElementById('sn-sync-log');

            function addLog(msg, isError = false) {
                const line = document.createElement('div');
                line.style.color = isError ? '#f87171' : '#d1d5db';
                line.textContent = msg;
                logEl.appendChild(line);
                logEl.scrollTop = logEl.scrollHeight;
            }

            const storage = loadStorage();
            if (currentUser) storage.username = currentUser;
            storage.pages = storage.pages || {};
            storage.pageCounts = storage.pageCounts || {};

            let completed = 0;
            let discrepancies = [];
            const batchSize = 2;
            const delayBetweenBatches = 150;
            const ownerParam = requestedOwner || currentUser || '';

            async function fetchPage(pageId) {
                const url = `/stamps.phtml?type=album&page_id=${pageId}${ownerParam ? '&owner=' + encodeURIComponent(ownerParam) : ''}`;
                try {
                    const response = await fetch(url, { credentials: 'include' });
                    const html = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(html, 'text/html');
                    return extractStampsFromDoc(doc);
                } catch (err) {
                    console.error(`[Scriptnautas Selos] Falha ao ler página ${pageId}:`, err);
                    return { stamps: [], expectedCount: null };
                }
            }

            for (let i = 0; i < pageIds.length; i += batchSize) {
                const batch = pageIds.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(pid => fetchPage(pid)));

                batch.forEach((pid, idx) => {
                    const res = results[idx];
                    storage.pages[pid] = res.stamps;
                    if (res.expectedCount !== null) {
                        storage.pageCounts[pid] = res.expectedCount;
                        if (res.expectedCount !== res.stamps.length) {
                            const pageName = pageMap.get(pid) || `Página ${pid}`;
                            discrepancies.push({
                                pageId: pid,
                                name: pageName,
                                expected: res.expectedCount,
                                extracted: res.stamps.length
                            });
                            addLog(`⚠️ [Pág. ${pid} - ${pageName}]: Neopets diz ${res.expectedCount}, mas foram lidos ${res.stamps.length}!`, true);
                        }
                    }
                    completed++;
                });

                const percent = Math.round((completed / total) * 100);
                fillEl.style.width = `${percent}%`;
                const pageName = pageMap.get(batch[batch.length - 1]) || `Página ${batch[batch.length - 1]}`;
                statusEl.textContent = `Lendo: ${pageName} (${completed}/${total})`;

                if (i + batchSize < pageIds.length) {
                    await new Promise(r => setTimeout(r, delayBetweenBatches));
                }
            }

            storage.lastSync = Date.now();
            saveStorage(storage);

            if (discrepancies.length > 0) {
                statusEl.innerHTML = `⚠️ Concluído com aviso: <strong style="color: #fbbf24;">${storage.totalCount}</strong> selos lidos. Veja detalhes abaixo:`;
                addLog(`-----------------------------------------`);
                addLog(`Encontradas ${discrepancies.length} página(s) com contagem diferente:`);
                discrepancies.forEach(d => {
                    addLog(`• Pág. ${d.pageId} (${d.name}): Neopets declara ${d.expected}, lidos ${d.extracted}`);
                });
                const closeBtn = document.createElement('button');
                closeBtn.className = 'sn-btn-primary';
                closeBtn.style.marginTop = '12px';
                closeBtn.textContent = 'Fechar';
                closeBtn.onclick = () => {
                    overlay.remove();
                    renderAlbumSyncBanner();
                };
                overlay.querySelector('.sn-sync-modal').appendChild(closeBtn);
            } else {
                statusEl.innerHTML = `✅ Concluído com sucesso! <strong style="color: #34d399;">${storage.totalCount}</strong> selos colecionados encontrados.`;
                setTimeout(() => {
                    overlay.remove();
                    renderAlbumSyncBanner();
                }, 1200);
            }
        }

        renderAlbumSyncBanner();
    }

    // =========================================================================
    // 2. LOJAS OFICIAIS DE SELOS (objects.phtml?type=shop&obj_type=...)
    // =========================================================================
    else if (pathname.includes('objects.phtml') && (searchParams.get('type') === 'shop' || searchParams.has('obj_type'))) {
        const objType = parseInt(searchParams.get('obj_type'), 10);

        if (OFFICIAL_STAMP_SHOPS[objType]) {
            injectStyles();

            const shopInfo = OFFICIAL_STAMP_SHOPS[objType];
            const storage = loadStorage();
            const collectedSet = new Set(Object.keys(storage.stamps || {}));
            const imageSet = storage.stampImages || {};
            const hasData = (storage.totalCount || 0) > 0;

            function processOfficialShopItems() {
                if (!hasData) return;

                // Layout moderno do Neopets (.shop-item)
                const modernItems = document.querySelectorAll('.shop-item:not([data-sn-stamp-checked])');
                modernItems.forEach(item => {
                    item.setAttribute('data-sn-stamp-checked', 'true');
                    const img = item.querySelector('.item-img');
                    const nameEl = item.querySelector('.item-name b, .item-name');
                    const itemName = img?.getAttribute('data-name') || nameEl?.textContent || img?.getAttribute('alt') || img?.getAttribute('title') || '';
                    const itemSrc = img?.getAttribute('src') || '';
                    if (!itemName && !itemSrc) return;

                    // Se a loja possuir filtro de itens de álbum (ex: Toy Shop, que vende brinquedos e charms)
                    if (typeof shopInfo.filter === 'function' && !shopInfo.filter(itemName, itemSrc)) {
                        return;
                    }

                    const isCollected = isCollectedItem(itemName, itemSrc, collectedSet, imageSet);

                    if (isCollected) {
                        item.classList.add('sn-item-collected');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-collected';
                        badge.textContent = '✓ Colecionado';
                        item.appendChild(badge);
                    } else {
                        const itemPrice = getItemPrice(itemName, itemSrc, storage.itemdbPrices);
                        const tierColor = getItemTierColor(itemPrice, storage.priceTiers, storage.unpricedColor);
                        const bgRgba = hexToRgba(tierColor, 0.14);
                        const shadowRgba = hexToRgba(tierColor, 0.45);

                        item.classList.add('sn-item-missing');
                        item.style.setProperty('--sn-tier-color', tierColor);
                        item.style.setProperty('--sn-tier-bg', bgRgba);
                        item.style.setProperty('--sn-tier-shadow', shadowRgba);

                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-missing';
                        badge.textContent = '⭐ FALTANDO';
                        badge.style.setProperty('background', tierColor, 'important');
                        if (itemPrice !== null && !isNaN(itemPrice)) {
                            badge.title = `Preço itemDB: ${formatNumber(itemPrice)} NP`;
                        } else {
                            badge.title = `Preço itemDB: Sem cotação recente`;
                        }
                        item.appendChild(badge);
                    }
                });

                // Layout clássico (tabelas com links para haggle.phtml)
                const legacyLinks = document.querySelectorAll('a[href*="haggle.phtml"]:not([data-sn-stamp-checked])');
                legacyLinks.forEach(link => {
                    link.setAttribute('data-sn-stamp-checked', 'true');
                    const cell = link.closest('td');
                    if (!cell) return;

                    const nameEl = cell.querySelector('b');
                    const img = cell.querySelector('img');
                    const itemName = nameEl ? nameEl.textContent : (img?.getAttribute('alt') || img?.getAttribute('title') || '');
                    const itemSrc = img ? img.getAttribute('src') : '';
                    if (!itemName && !itemSrc) return;

                    // Se a loja possuir filtro de itens de álbum (ex: Toy Shop, que vende brinquedos e charms)
                    if (typeof shopInfo.filter === 'function' && !shopInfo.filter(itemName, itemSrc)) {
                        return;
                    }

                    const isCollected = isCollectedItem(itemName, itemSrc, collectedSet, imageSet);

                    if (isCollected) {
                        cell.classList.add('sn-item-collected');
                    } else {
                        const itemPrice = getItemPrice(itemName, itemSrc, storage.itemdbPrices);
                        const tierColor = getItemTierColor(itemPrice, storage.priceTiers, storage.unpricedColor);
                        const bgRgba = hexToRgba(tierColor, 0.14);
                        const shadowRgba = hexToRgba(tierColor, 0.45);

                        cell.classList.add('sn-item-missing');
                        cell.style.setProperty('--sn-tier-color', tierColor);
                        cell.style.setProperty('--sn-tier-bg', bgRgba);
                        cell.style.setProperty('--sn-tier-shadow', shadowRgba);
                        if (itemPrice !== null && !isNaN(itemPrice)) {
                            cell.title = `Preço itemDB: ${formatNumber(itemPrice)} NP`;
                        } else {
                            cell.title = `Preço itemDB: Sem cotação recente`;
                        }
                    }
                });
            }

            function refreshOfficialShop() {
                const updated = loadStorage();
                Object.assign(storage, updated);
                document.querySelectorAll('[data-sn-stamp-checked]').forEach(el => {
                    el.removeAttribute('data-sn-stamp-checked');
                    el.classList.remove('sn-item-missing', 'sn-item-collected');
                    el.querySelectorAll('.sn-badge-missing, .sn-badge-collected').forEach(b => b.remove());
                });
                processOfficialShopItems();
            }

            processOfficialShopItems();

            const shopContainer = document.querySelector('.shop-grid, #container__2020') || document.body;
            const observer = new MutationObserver(() => processOfficialShopItems());
            observer.observe(shopContainer, { childList: true, subtree: true });

            renderFloatingBadge(shopInfo.name, storage, refreshOfficialShop);
        }
    }

    // =========================================================================
    // 3. LOJAS DE USUÁRIOS (browseshop.phtml)
    // =========================================================================
    else if (pathname.includes('browseshop.phtml')) {
        injectStyles();

        const storage = loadStorage();
        const collectedSet = new Set(Object.keys(storage.stamps || {}));
        const imageSet = storage.stampImages || {};
        const hasData = (storage.totalCount || 0) > 0;

        function processUserShopItems() {
            if (!hasData) return;

            // Layout moderno de loja de usuário (.bsp-item)
            const modernItems = document.querySelectorAll('.bsp-item:not([data-sn-stamp-checked])');
            modernItems.forEach(item => {
                item.setAttribute('data-sn-stamp-checked', 'true');
                const btn = item.querySelector('.bsp-item__buy');
                const nameSpan = item.querySelector('.bsp-item__name');
                const img = item.querySelector('.bsp-item__image');
                const itemName = btn?.getAttribute('data-name') || nameSpan?.textContent || '';
                const itemSrc = img?.getAttribute('src') || '';
                if (!itemName && !itemSrc) return;

                const isCollected = isCollectedItem(itemName, itemSrc, collectedSet, imageSet);

                // Apenas se o item for confirmado como já colecionado nós escurecemos
                // Demais itens permanecem inalterados (comidas, poções, brinquedos, etc.)
                if (isCollected) {
                    item.classList.add('sn-item-collected');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-collected';
                    badge.textContent = '✓ Colecionado';
                    item.appendChild(badge);
                }
            });

            // Layout clássico (links buy_item.phtml)
            const buyLinks = document.querySelectorAll('a[href*="buy_item.phtml"]:not([data-sn-stamp-checked])');
            buyLinks.forEach(link => {
                link.setAttribute('data-sn-stamp-checked', 'true');
                const cell = link.closest('td') || link.parentElement;
                if (!cell) return;

                const boldEl = cell.querySelector('b');
                const img = cell.querySelector('img');
                const itemName = boldEl ? boldEl.textContent.trim() : (img?.getAttribute('alt') || '');
                const itemSrc = img ? img.getAttribute('src') : '';
                if (!itemName && !itemSrc) return;

                const isCollected = isCollectedItem(itemName, itemSrc, collectedSet, imageSet);

                if (isCollected) {
                    cell.classList.add('sn-item-collected');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-collected';
                    badge.textContent = '✓ Colecionado';
                    cell.style.position = 'relative';
                    cell.appendChild(badge);
                }
            });
        }

        processUserShopItems();

        const container = document.querySelector('#container__2020, .content, #content') || document.body;
        const observer = new MutationObserver(() => processUserShopItems());
        observer.observe(container, { childList: true, subtree: true });

        renderFloatingBadge('Loja de Usuário', storage);
    }

    function stackFloatingWidgets() {
        const selectors = [
            '#scriptnautas-status-badge',
            '#sn-floating-stamp-badge',
            '#scriptnautas-stamp-badge',
            '#sn-gourmet-floating-widget',
            '#sn-itemdb-floating-widget',
            '.sn-status-floating',
            '.sn-floating-status'
        ];
        const widgets = [];
        selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
                if (!widgets.includes(el) && el.style.display !== 'none' && el.isConnected) {
                    widgets.push(el);
                }
            });
        });
        let currentBottom = 16;
        widgets.forEach(w => {
            w.style.bottom = `${currentBottom}px`;
            w.style.right = '16px';
            w.style.transition = 'bottom 0.25s ease';
            const h = w.offsetHeight || 44;
            currentBottom += h + 8;
        });
    }

    // Badge flutuante informativa no canto inferior da tela
    function renderFloatingBadge(contextName, storage, onConfigSaved) {
        const old = document.getElementById('sn-floating-stamp-badge');
        if (old) old.remove();

        const badge = document.createElement('div');
        badge.id = 'sn-floating-stamp-badge';
        badge.className = 'sn-status-floating';

        const total = storage?.totalCount || 0;
        const syncLabel = total > 0 
            ? `<strong style="color: #34d399;">${total}</strong> selos sincronizados`
            : `<span style="color: #f87171;">Álbum não sincronizado</span>`;

        badge.innerHTML = `
            <span>📮 <strong>${contextName}</strong></span>
            <span style="color: #6b7280;">•</span>
            <span>${syncLabel}</span>
            <span style="color: #6b7280;">•</span>
            <a href="javascript:void(0)" id="sn-floating-price-config" style="color: #a78bfa; text-decoration: underline; font-weight: 600;" title="Configurar cores por faixa de preço">🎨 Cores</a>
            <span style="color: #6b7280;">•</span>
            <a href="/stamps.phtml" title="Ir para o Álbum de Selos">Abrir Álbum</a>
            <span id="sn-stamp-close-widget" style="margin-left: 6px; cursor: pointer; color: #9ca3af; font-size: 14px; line-height: 1;" title="Ocultar nesta página">&times;</span>
        `;
        document.body.appendChild(badge);

        badge.querySelector('#sn-floating-price-config')?.addEventListener('click', () => {
            openPriceConfigModal(onConfigSaved);
        });

        const closeBtn = badge.querySelector('#sn-stamp-close-widget');
        if (closeBtn) {
            closeBtn.onclick = () => {
                badge.remove();
                stackFloatingWidgets();
            };
        }

        stackFloatingWidgets();
        setTimeout(stackFloatingWidgets, 100);
        setTimeout(stackFloatingWidgets, 400);
        setTimeout(stackFloatingWidgets, 1200);
        window.addEventListener('resize', stackFloatingWidgets);
    }

    // =========================================================================
    // INICIALIZAÇÃO GERAL E ATUALIZAÇÃO TRANSPARENTE DO ITEMDB
    // =========================================================================

    // Registra comando no menu Tampermonkey
    if (typeof GM_registerMenuCommand !== 'undefined') {
        GM_registerMenuCommand('🎨 Configurar Cores & Faixas de Preço (itemDB)', () => {
            openPriceConfigModal();
        });
    }

    // Verificação e atualização transparente de preços do itemDB em segundo plano (cache de 14 dias)
    fetchItemdbPrices(false).catch(err => {
        console.warn('[Scriptnautas Selos] Sincronização automática do itemDB em background:', err.message);
    });

})();
