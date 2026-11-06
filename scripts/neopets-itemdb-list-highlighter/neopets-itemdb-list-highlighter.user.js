// ==UserScript==
// @name         Neopets: Marcador de Lojas por Lista do itemDB (Wishlist Highlighter)
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.1
// @description  Destaca itens da sua lista personalizada do itemDB em qualquer loja oficial ou loja de usuário do Neopets.
// @author       t-moedano
// @match        *://*.neopets.com/objects.phtml?*type=shop*
// @match        *://*.neopets.com/browseshop.phtml*
// @match        *://itemdb.com.br/lists/*
// @match        *://itemdb.com.br/pt/lists/*
// @match        *://itemdb.com.br/*lists/*
// @match        *://*.itemdb.com.br/lists/*
// @match        *://*.itemdb.com.br/pt/lists/*
// @match        *://*.itemdb.com.br/*lists/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=itemdb.com.br
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      itemdb.com.br
// @connect      www.itemdb.com.br
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-itemdb-list-highlighter/neopets-itemdb-list-highlighter.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-itemdb-list-highlighter/neopets-itemdb-list-highlighter.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'neopets_itemdb_highlighter_storage_v1';

    // =========================================================================
    // UTILITÁRIOS GERAIS
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

    function formatNumber(num) {
        if (!num || isNaN(num)) return '0';
        return Number(num).toLocaleString('pt-BR');
    }

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function parseItemdbListUrl(input) {
        if (!input || typeof input !== 'string') return null;
        const trimmed = input.trim();

        // 1. Formato URL completo (ex: https://itemdb.com.br/pt/lists/nana/minha-lista ou itemdb.com.br/lists/...)
        const fullMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?itemdb\.com\.br\/(?:[a-z]{2}\/)?lists\/([^/?#]+)\/([^/?#]+)/i);
        if (fullMatch) {
            return {
                username: decodeURIComponent(fullMatch[1]),
                slug: decodeURIComponent(fullMatch[2])
            };
        }

        // 2. Formato de caminho / pathname (ex: /pt/lists/nana/minha-lista ou /lists/nana/minha-lista)
        const pathMatch = trimmed.match(/^(?:\/?[a-z]{2})?\/lists\/([^/?#]+)\/([^/?#]+)/i);
        if (pathMatch) {
            return {
                username: decodeURIComponent(pathMatch[1]),
                slug: decodeURIComponent(pathMatch[2])
            };
        }

        // 3. Formato curto "usuario/slug"
        const shortMatch = trimmed.match(/^([a-zA-Z0-9_\-.]+)\/([a-zA-Z0-9_\-.]+)$/);
        if (shortMatch) {
            return {
                username: decodeURIComponent(shortMatch[1]),
                slug: decodeURIComponent(shortMatch[2])
            };
        }

        return null;
    }

    // =========================================================================
    // GERENCIAMENTO DE STORAGE
    // =========================================================================

    function getDefaultStorage() {
        return {
            activeList: null, // { url, username, slug, name, lastSync, itemCount, byName, byImage }
            settings: {
                highlightOfficial: true,
                highlightUserShops: true,
                showPriceTag: true
            }
        };
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
            if (!raw) return getDefaultStorage();

            const parsed = JSON.parse(raw);
            if (!parsed.settings) parsed.settings = getDefaultStorage().settings;
            return parsed;
        } catch (e) {
            console.error('[Scriptnautas itemDB] Erro ao carregar storage:', e);
            return getDefaultStorage();
        }
    }

    function saveStorage(data) {
        try {
            const raw = JSON.stringify(data);
            if (typeof GM_setValue !== 'undefined') {
                GM_setValue(STORAGE_KEY, raw);
            }
            try {
                localStorage.setItem(STORAGE_KEY, raw);
            } catch (ignore) {}
        } catch (e) {
            console.error('[Scriptnautas itemDB] Erro ao salvar storage:', e);
        }
    }

    // =========================================================================
    // INTEGRAÇÃO COM A API DO ITEMDB
    // =========================================================================

    function processItemdbResponse(data, username, slug, listName) {
        const byName = {};
        const byImage = {};

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

        itemsArray.forEach(item => {
            if (!item || !item.name) return;
            const name = String(item.name).trim();
            const normName = normalizeTitle(name);

            // Suporta item.image (objeto { id, url }), item.image_id, ou item.image (string)
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

            let priceValue = null;
            if (item.price && typeof item.price === 'object' && typeof item.price.value === 'number') {
                priceValue = item.price.value;
            } else if (typeof item.price === 'number') {
                priceValue = item.price;
            }

            const rarity = item.rarity || null;

            const entry = {
                name: name,
                image_id: imageId,
                price: priceValue,
                rarity: rarity
            };

            byName[normName] = entry;
            if (imageId) {
                byImage[imageId] = entry;
            }
        });

        const inferredName = listName || (slug ? slug.replace(/[-_]+/g, ' ') : 'Lista itemDB');

        return {
            url: `https://itemdb.com.br/pt/lists/${username}/${slug}`,
            username: username,
            slug: slug,
            name: inferredName,
            lastSync: Date.now(),
            itemCount: Object.keys(byName).length,
            byName: byName,
            byImage: byImage
        };
    }

    function fetchListFromItemdb(username, slug, listName = null) {
        return new Promise((resolve, reject) => {
            const apiUrl = `https://itemdb.com.br/api/v1/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/itemdata`;

            const handleSuccess = (responseText) => {
                try {
                    const json = JSON.parse(responseText);
                    const processedList = processItemdbResponse(json, username, slug, listName);
                    if (processedList.itemCount === 0) {
                        return reject(new Error('A lista foi encontrada, mas não contém nenhum item ou é privada.'));
                    }

                    const storage = loadStorage();
                    storage.activeList = processedList;
                    saveStorage(storage);
                    resolve(processedList);
                } catch (err) {
                    reject(new Error('Erro ao processar os dados retornados pelo itemDB.'));
                }
            };

            const tryStandardFetch = () => {
                const fetchUrl = (typeof window !== 'undefined' && window.location.hostname.includes('itemdb.com.br'))
                    ? `/api/v1/lists/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/itemdata`
                    : apiUrl;

                fetch(fetchUrl, { headers: { 'Accept': 'application/json' } })
                    .then(r => {
                        if (r.status === 404) throw new Error(`Lista não encontrada no itemDB (@${username}/${slug}).`);
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    })
                    .then(handleSuccess)
                    .catch(e => reject(new Error(`Erro ao conectar com itemDB: ${e.message}`)));
            };

            if (typeof GM_xmlhttpRequest !== 'undefined') {
                GM_xmlhttpRequest({
                    method: 'GET',
                    url: apiUrl,
                    headers: { 'Accept': 'application/json' },
                    timeout: 25000,
                    onload: function(res) {
                        if (res.status >= 200 && res.status < 300) {
                            handleSuccess(res.responseText);
                        } else if (res.status === 404) {
                            reject(new Error(`Lista não encontrada no itemDB (@${username}/${slug}). Verifique se a URL está correta e se a lista é pública.`));
                        } else {
                            tryStandardFetch();
                        }
                    },
                    ontimeout: function() {
                        tryStandardFetch();
                    },
                    onerror: function() {
                        tryStandardFetch();
                    }
                });
            } else {
                tryStandardFetch();
            }
        });
    }

    // =========================================================================
    // ESTILOS VISUAIS (DESIGN SYSTEM SCRIPTNAUTAS)
    // =========================================================================

    function injectStyles() {
        if (document.getElementById('scriptnautas-itemdb-styles')) return;
        const style = document.createElement('style');
        style.id = 'scriptnautas-itemdb-styles';
        style.textContent = `
            /* Efeito de destaque para itens da lista */
            .sn-itemdb-match {
                outline: 3px solid #8b5cf6 !important;
                background: rgba(139, 92, 246, 0.16) !important;
                border-radius: 8px !important;
                box-shadow: 0 0 16px rgba(139, 92, 246, 0.55) !important;
                position: relative !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease !important;
            }
            .sn-itemdb-match:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 20px rgba(139, 92, 246, 0.8) !important;
            }

            /* Badge sobre o item */
            .sn-itemdb-badge {
                position: absolute;
                top: 4px;
                right: 4px;
                background: linear-gradient(135deg, #7c3aed, #9333ea);
                color: #ffffff;
                font-family: system-ui, -apple-system, sans-serif;
                font-weight: 800;
                font-size: 10px;
                line-height: 1.2;
                padding: 3px 6px;
                border-radius: 9999px;
                box-shadow: 0 2px 5px rgba(0,0,0,0.4);
                z-index: 15;
                pointer-events: none;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                display: flex;
                align-items: center;
                gap: 4px;
            }
            .sn-itemdb-price-tag {
                position: absolute;
                bottom: 4px;
                left: 50%;
                transform: translateX(-50%);
                background: #111827;
                color: #facc15;
                border: 1px solid #374151;
                font-family: system-ui, -apple-system, sans-serif;
                font-weight: 700;
                font-size: 9px;
                padding: 2px 6px;
                border-radius: 6px;
                white-space: nowrap;
                pointer-events: none;
                z-index: 15;
                box-shadow: 0 2px 4px rgba(0,0,0,0.5);
            }

            /* Widget flutuante no Neopets */
            .sn-itemdb-floating-widget {
                position: fixed;
                bottom: 16px;
                right: 16px;
                background: #0f172a;
                color: #f8fafc;
                padding: 8px 14px;
                border-radius: 9999px;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                font-size: 12px;
                box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px #334155;
                z-index: 999999;
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                user-select: none;
                transition: bottom 0.25s ease, transform 0.15s ease, background 0.15s ease;
            }
            .sn-itemdb-floating-widget:hover {
                transform: translateY(-2px);
                background: #1e293b;
            }
            .sn-itemdb-dot-active {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #a855f7;
                box-shadow: 0 0 8px #a855f7;
            }
            .sn-itemdb-dot-inactive {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #64748b;
            }

            /* Modal de Configurações */
            .sn-itemdb-modal-overlay {
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
            .sn-itemdb-modal {
                background: #1e293b;
                color: #f8fafc;
                border: 1px solid #334155;
                border-radius: 16px;
                padding: 24px;
                width: 90%;
                max-width: 520px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
                position: relative;
            }
            .sn-itemdb-modal h3 {
                margin: 0 0 6px 0;
                font-size: 18px;
                font-weight: 700;
                color: #f1f5f9;
                display: flex;
                align-items: center;
                gap: 8px;
            }
            .sn-itemdb-modal p {
                margin: 0 0 16px 0;
                font-size: 13px;
                color: #94a3b8;
                line-height: 1.4;
            }
            .sn-itemdb-input {
                width: 100%;
                box-sizing: border-box;
                padding: 10px 14px;
                border-radius: 10px;
                background: #0f172a;
                border: 1px solid #334155;
                color: #f8fafc;
                font-size: 13px;
                outline: none;
                margin-bottom: 12px;
                transition: border-color 0.15s ease;
            }
            .sn-itemdb-input:focus {
                border-color: #8b5cf6;
            }
            .sn-itemdb-card-active {
                background: #0f172a;
                border: 1px solid #3b4252;
                border-left: 4px solid #a855f7;
                border-radius: 8px;
                padding: 12px;
                margin-bottom: 16px;
                font-size: 12px;
            }
            .sn-itemdb-card-active strong {
                color: #e2e8f0;
                display: block;
                font-size: 14px;
                margin-bottom: 4px;
            }
            .sn-itemdb-card-meta {
                color: #94a3b8;
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin-top: 6px;
            }
            .sn-itemdb-btn-primary {
                background: #7c3aed;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 9px 16px;
                font-size: 13px;
                font-weight: 600;
                cursor: pointer;
                transition: background 0.15s ease;
            }
            .sn-itemdb-btn-primary:hover {
                background: #6d28d9;
            }
            .sn-itemdb-btn-secondary {
                background: #334155;
                color: #e2e8f0;
                border: none;
                border-radius: 8px;
                padding: 9px 14px;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                transition: background 0.15s ease;
            }
            .sn-itemdb-btn-secondary:hover {
                background: #475569;
            }
            .sn-itemdb-btn-danger {
                background: #ef4444;
                color: #ffffff;
                border: none;
                border-radius: 8px;
                padding: 6px 10px;
                font-size: 11px;
                font-weight: 600;
                cursor: pointer;
            }
            .sn-itemdb-btn-danger:hover {
                background: #dc2626;
            }
            .sn-itemdb-btn-close {
                position: absolute;
                top: 16px;
                right: 16px;
                background: transparent;
                border: none;
                color: #94a3b8;
                font-size: 20px;
                cursor: pointer;
                line-height: 1;
            }
            .sn-itemdb-btn-close:hover {
                color: #f8fafc;
            }
            .sn-itemdb-checkbox-label {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 12px;
                color: #cbd5e1;
                margin-bottom: 8px;
                cursor: pointer;
                user-select: none;
            }
            .sn-itemdb-checkbox-label input {
                cursor: pointer;
                accent-color: #8b5cf6;
            }

            /* Botão de 1 clique na página do itemDB */
            .sn-itemdb-page-btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: linear-gradient(135deg, #7c3aed, #9333ea);
                color: #ffffff !important;
                font-family: system-ui, -apple-system, sans-serif;
                font-weight: 600;
                font-size: 13px;
                padding: 8px 14px;
                border-radius: 8px;
                border: none;
                cursor: pointer;
                text-decoration: none;
                box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
                transition: transform 0.15s ease, box-shadow 0.15s ease;
                margin-left: 8px;
                margin-bottom: 12px;
            }
            .sn-itemdb-page-btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(124, 58, 237, 0.5);
            }

            /* Topo Roxo no itemDB */
            .sn-itemdb-top-bar {
                position: sticky;
                top: 0;
                left: 0;
                width: 100%;
                z-index: 999999;
                background: linear-gradient(135deg, #4c1d95, #6d28d9, #7c3aed);
                color: #ffffff;
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
                border-bottom: 2px solid #a855f7;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                padding: 10px 20px;
                box-sizing: border-box;
                animation: snItemdbSlideDown 0.3s ease-out;
            }
            @keyframes snItemdbSlideDown {
                from { transform: translateY(-100%); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .sn-itemdb-bar-inner {
                max-width: 1280px;
                margin: 0 auto;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 12px;
            }
            .sn-itemdb-bar-left {
                display: flex;
                align-items: center;
                gap: 12px;
                font-size: 13px;
                flex-wrap: wrap;
            }
            .sn-itemdb-bar-badge {
                background: rgba(255, 255, 255, 0.18);
                border: 1px solid rgba(255, 255, 255, 0.3);
                padding: 3px 10px;
                border-radius: 9999px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.5px;
                text-transform: uppercase;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .sn-itemdb-bar-title {
                font-size: 14px;
                color: #f1f5f9;
            }
            .sn-itemdb-bar-title strong {
                color: #ffffff;
                font-weight: 700;
            }
            .sn-itemdb-bar-actions {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .sn-itemdb-btn-activate {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: #ffffff;
                color: #6d28d9 !important;
                font-family: system-ui, -apple-system, sans-serif;
                font-weight: 700;
                font-size: 12px;
                padding: 7px 16px;
                border-radius: 8px;
                border: none;
                cursor: pointer;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                transition: transform 0.15s ease, background 0.15s ease;
            }
            .sn-itemdb-btn-activate:hover {
                transform: translateY(-1px);
                background: #f8fafc;
            }
            .sn-itemdb-btn-activate:disabled {
                opacity: 0.7;
                cursor: not-allowed;
            }
            .sn-itemdb-status-pill {
                background: rgba(16, 185, 129, 0.25);
                border: 1px solid #10b981;
                color: #d1fae5;
                padding: 3px 10px;
                border-radius: 9999px;
                font-size: 11px;
                font-weight: 600;
                display: inline-flex;
                align-items: center;
                gap: 5px;
            }
            .sn-itemdb-toast {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%);
                background: #10b981;
                color: #ffffff;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 13px;
                font-weight: 600;
                padding: 10px 18px;
                border-radius: 9999px;
                box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                z-index: 1000001;
                animation: snItemdbFade 0.25s ease-out;
            }
            @keyframes snItemdbFade {
                from { opacity: 0; transform: translate(-50%, 10px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
        `;
        document.head.appendChild(style);
    }

    function showToast(msg, isError = false) {
        const toast = document.createElement('div');
        toast.className = 'sn-itemdb-toast';
        if (isError) {
            toast.style.background = '#ef4444';
        }
        toast.textContent = msg;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // =========================================================================
    // MODAL DE CONFIGURAÇÕES (NO NEOPETS)
    // =========================================================================

    function openConfigModal() {
        const existing = document.querySelector('.sn-itemdb-modal-overlay');
        if (existing) existing.remove();

        const storage = loadStorage();
        const activeList = storage.activeList;

        const overlay = document.createElement('div');
        overlay.className = 'sn-itemdb-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'sn-itemdb-modal';

        let activeCardHtml = `
            <div style="background: #0f172a; border-radius: 8px; padding: 12px; margin-bottom: 16px; color: #94a3b8; font-size: 12px; text-align: center;">
                Nenhuma lista configurada no momento. Cole a URL da sua lista do itemDB abaixo!
            </div>
        `;

        if (activeList) {
            const dateStr = activeList.lastSync ? new Date(activeList.lastSync).toLocaleString('pt-BR') : 'Nunca';
            activeCardHtml = `
                <div class="sn-itemdb-card-active">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <div>
                            <strong>${activeList.name}</strong>
                            <a href="${activeList.url}" target="_blank" rel="noopener noreferrer" style="color: #a855f7; text-decoration: underline; font-size: 11px;">
                                itemdb.com.br/lists/${activeList.username}/${activeList.slug} ↗
                            </a>
                        </div>
                        <button class="sn-itemdb-btn-danger" id="sn-btn-clear-list" title="Remover esta lista">Remover</button>
                    </div>
                    <div class="sn-itemdb-card-meta">
                        <span>📦 <b>${activeList.itemCount}</b> itens rastreados</span>
                        <span>🕒 Sincronizado: ${dateStr}</span>
                    </div>
                </div>
            `;
        }

        modal.innerHTML = `
            <button class="sn-itemdb-btn-close" id="sn-itemdb-close">&times;</button>
            <h3>📋 itemDB Wishlist Highlighter</h3>
            <p>Destaque itens da sua lista personalizada do itemDB ao navegar por lojas oficiais e lojas de usuários.</p>

            ${activeCardHtml}

            <label style="display: block; font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px;">
                URL ou Caminho da Lista do itemDB:
            </label>
            <input type="text" class="sn-itemdb-input" id="sn-itemdb-url-input" 
                   placeholder="Ex: https://itemdb.com.br/pt/lists/nana/yay-focus-missing-stamps..." 
                   value="${activeList ? activeList.url : ''}" />

            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <button class="sn-itemdb-btn-primary" id="sn-btn-sync" style="flex: 1;">
                    ${activeList ? '🔄 Atualizar Lista' : '📥 Importar Lista'}
                </button>
            </div>

            <div style="border-top: 1px solid #334155; padding-top: 12px; margin-top: 12px;">
                <label class="sn-itemdb-checkbox-label">
                    <input type="checkbox" id="sn-check-official" ${storage.settings.highlightOfficial ? 'checked' : ''} />
                    Destacar itens em Lojas Oficiais (objects.phtml)
                </label>
                <label class="sn-itemdb-checkbox-label">
                    <input type="checkbox" id="sn-check-user" ${storage.settings.highlightUserShops ? 'checked' : ''} />
                    Destacar itens em Lojas de Usuários (browseshop.phtml)
                </label>
                <label class="sn-itemdb-checkbox-label">
                    <input type="checkbox" id="sn-check-prices" ${storage.settings.showPriceTag ? 'checked' : ''} />
                    Exibir estimativa de preço do itemDB sob os itens destacados
                </label>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Ações dos botões
        const closeBtn = modal.querySelector('#sn-itemdb-close');
        closeBtn.onclick = () => overlay.remove();
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };

        const syncBtn = modal.querySelector('#sn-btn-sync');
        const urlInput = modal.querySelector('#sn-itemdb-url-input');

        syncBtn.onclick = () => {
            const rawVal = urlInput.value;
            const parsed = parseItemdbListUrl(rawVal);
            if (!parsed) {
                alert('URL inválida! Por favor, insira uma URL de lista do itemDB, como:\nhttps://itemdb.com.br/pt/lists/usuario/nome-da-lista');
                return;
            }

            syncBtn.disabled = true;
            syncBtn.textContent = '⏳ Baixando itens do itemDB...';

            fetchListFromItemdb(parsed.username, parsed.slug)
                .then(newList => {
                    overlay.remove();
                    showToast(`✅ Lista "${newList.name}" sincronizada com ${newList.itemCount} itens!`);
                    updateFloatingWidget();
                    processShopItems();
                })
                .catch(err => {
                    syncBtn.disabled = false;
                    syncBtn.textContent = '📥 Importar Lista';
                    alert(`Não foi possível carregar a lista:\n${err.message}`);
                });
        };

        const clearBtn = modal.querySelector('#sn-btn-clear-list');
        if (clearBtn) {
            clearBtn.onclick = () => {
                if (confirm('Deseja realmente desconectar e limpar esta lista?')) {
                    const st = loadStorage();
                    st.activeList = null;
                    saveStorage(st);
                    overlay.remove();
                    showToast('Lista removida.');
                    updateFloatingWidget();
                    window.location.reload();
                }
            };
        }

        // Checkboxes de opções
        const checkOfficial = modal.querySelector('#sn-check-official');
        const checkUser = modal.querySelector('#sn-check-user');
        const checkPrices = modal.querySelector('#sn-check-prices');

        const saveSettings = () => {
            const st = loadStorage();
            st.settings.highlightOfficial = checkOfficial.checked;
            st.settings.highlightUserShops = checkUser.checked;
            st.settings.showPriceTag = checkPrices.checked;
            saveStorage(st);
            processShopItems();
        };

        checkOfficial.onchange = saveSettings;
        checkUser.onchange = saveSettings;
        checkPrices.onchange = saveSettings;
    }

    // =========================================================================
    // BOTÃO FLUTUANTE (WIDGET) NO NEOPETS & AUTO-EMPILHAMENTO
    // =========================================================================

    function stackFloatingWidgets() {
        const selectors = [
            '#scriptnautas-status-badge',      // Livros
            '#sn-floating-stamp-badge',        // Selos
            '#scriptnautas-stamp-badge',       // Selos alternativo
            '#sn-gourmet-floating-widget',     // Gourmet
            '#sn-itemdb-floating-widget',      // itemDB Wishlist
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

    function updateFloatingWidget() {
        let widget = document.getElementById('sn-itemdb-floating-widget');
        const storage = loadStorage();
        const activeList = storage.activeList;

        if (!widget) {
            widget = document.createElement('div');
            widget.id = 'sn-itemdb-floating-widget';
            // Inclui classes padrão de status flutuante do Scriptnautas para auto-empilhamento universal
            widget.className = 'sn-itemdb-floating-widget sn-status-floating sn-floating-status';
            widget.onclick = () => openConfigModal();
            document.body.appendChild(widget);
        }

        if (activeList && activeList.itemCount > 0) {
            widget.innerHTML = `
                <span class="sn-itemdb-dot-active"></span>
                <span><b>itemDB:</b> ${activeList.itemCount} itens</span>
                <span style="opacity: 0.6; font-size: 11px;">⚙️</span>
            `;
            widget.title = `Lista ativa: "${activeList.name}" (@${activeList.username}). Clique para gerenciar ou atualizar.`;
        } else {
            widget.innerHTML = `
                <span class="sn-itemdb-dot-inactive"></span>
                <span><b>itemDB:</b> Sem lista</span>
                <span style="color: #a855f7; font-weight: 600;">+ Adicionar</span>
            `;
            widget.title = 'Nenhuma lista do itemDB configurada. Clique para configurar.';
        }

        stackFloatingWidgets();
    }

    // =========================================================================
    // HIGHLIGHT DE ITENS NAS LOJAS DO NEOPETS
    // =========================================================================

    function matchItemInList(name, src, activeList) {
        if (!activeList || !activeList.byName) return null;

        if (name) {
            const norm = normalizeTitle(name);
            if (activeList.byName[norm]) {
                return activeList.byName[norm];
            }
        }

        if (src && activeList.byImage) {
            const hash = extractItemHash(src);
            if (hash && activeList.byImage[hash]) {
                return activeList.byImage[hash];
            }
        }

        return null;
    }

    function processShopItems() {
        const isOfficialShop = window.location.pathname.includes('objects.phtml');
        const isUserShop = window.location.pathname.includes('browseshop.phtml');

        const storage = loadStorage();
        const settings = storage.settings;
        const activeList = storage.activeList;

        if (!activeList || !activeList.itemCount) return;
        if (isOfficialShop && !settings.highlightOfficial) return;
        if (isUserShop && !settings.highlightUserShops) return;

        // 1. Lojas Oficiais (Layout Moderno)
        if (isOfficialShop) {
            const modernItems = document.querySelectorAll('.shop-item:not([data-sn-itemdb-checked])');
            modernItems.forEach(item => {
                item.setAttribute('data-sn-itemdb-checked', 'true');
                const img = item.querySelector('.item-img');
                const nameEl = item.querySelector('.item-name b, .item-name');
                const itemName = img?.getAttribute('data-name') || nameEl?.textContent || '';
                const itemSrc = img?.getAttribute('src') || '';

                const matched = matchItemInList(itemName, itemSrc, activeList);
                if (matched) {
                    applyItemHighlight(item, matched, settings.showPriceTag);
                }
            });

            // Lojas Oficiais (Layout Clássico - Tabelas)
            const legacyLinks = document.querySelectorAll('a[href*="haggle.phtml"]:not([data-sn-itemdb-checked])');
            legacyLinks.forEach(link => {
                link.setAttribute('data-sn-itemdb-checked', 'true');
                const cell = link.closest('td');
                if (!cell) return;

                const nameEl = cell.querySelector('b');
                const img = cell.querySelector('img');
                const itemName = nameEl ? nameEl.textContent : '';
                const itemSrc = img ? img.getAttribute('src') : '';

                const matched = matchItemInList(itemName, itemSrc, activeList);
                if (matched) {
                    applyItemHighlight(cell, matched, settings.showPriceTag);
                }
            });
        }

        // 2. Lojas de Usuários (Layout Moderno e Clássico)
        if (isUserShop) {
            const modernUserItems = document.querySelectorAll('.bsp-item:not([data-sn-itemdb-checked])');
            modernUserItems.forEach(item => {
                item.setAttribute('data-sn-itemdb-checked', 'true');
                const btn = item.querySelector('.bsp-item__buy');
                const nameSpan = item.querySelector('.bsp-item__name');
                const img = item.querySelector('.bsp-item__image');
                const itemName = btn?.getAttribute('data-name') || nameSpan?.textContent || '';
                const itemSrc = img?.getAttribute('src') || '';

                const matched = matchItemInList(itemName, itemSrc, activeList);
                if (matched) {
                    applyItemHighlight(item, matched, settings.showPriceTag);
                }
            });

            const legacyUserLinks = document.querySelectorAll('a[href*="buy_item.phtml"]:not([data-sn-itemdb-checked])');
            legacyUserLinks.forEach(link => {
                link.setAttribute('data-sn-itemdb-checked', 'true');
                const cell = link.closest('td');
                if (!cell) return;

                const nameEl = cell.querySelector('b');
                const img = cell.querySelector('img');
                const itemName = nameEl ? nameEl.textContent : '';
                const itemSrc = img ? img.getAttribute('src') : '';

                const matched = matchItemInList(itemName, itemSrc, activeList);
                if (matched) {
                    applyItemHighlight(cell, matched, settings.showPriceTag);
                }
            });
        }
    }

    function applyItemHighlight(container, itemData, showPriceTag) {
        container.classList.add('sn-itemdb-match');

        // Evitar duplicar badges
        if (container.querySelector('.sn-itemdb-badge')) return;

        const badge = document.createElement('span');
        badge.className = 'sn-itemdb-badge';
        badge.innerHTML = '★ ITEMDB';
        container.appendChild(badge);

        if (showPriceTag && itemData.price) {
            const priceTag = document.createElement('span');
            priceTag.className = 'sn-itemdb-price-tag';
            priceTag.textContent = `💰 ~${formatNumber(itemData.price)} NP`;
            container.appendChild(priceTag);
        }

        container.title = `[Lista itemDB] ${itemData.name}${itemData.rarity ? ` (r${itemData.rarity})` : ''}${itemData.price ? ` - Est: ~${formatNumber(itemData.price)} NP` : ''}`;
    }

    // =========================================================================
    // INTEGRAÇÃO NO PRÓPRIO SITE DO ITEMDB (1-CLIQUE PARA ATIVAR)
    // =========================================================================

    function initItemdbSiteIntegration() {
        injectStyles();

        // 1. Detecta URL da lista (href ou pathname)
        const parsed = parseItemdbListUrl(window.location.href) || parseItemdbListUrl(window.location.pathname);
        if (!parsed) return;

        function getListTitle() {
            const h1El = document.querySelector('h1');
            if (h1El && h1El.textContent.trim()) {
                return h1El.textContent.trim();
            }
            const st = loadStorage();
            if (st.activeList && st.activeList.slug === parsed.slug) {
                return st.activeList.name;
            }
            return parsed.slug.replace(/[-_]+/g, ' ');
        }

        function ensureTopBanner() {
            let banner = document.getElementById('sn-itemdb-top-bar');
            const storage = loadStorage();
            const isActive = Boolean(storage.activeList &&
                             storage.activeList.username.toLowerCase() === parsed.username.toLowerCase() &&
                             storage.activeList.slug.toLowerCase() === parsed.slug.toLowerCase());

            const listTitle = getListTitle();

            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'sn-itemdb-top-bar';
                banner.className = 'sn-itemdb-top-bar';

                if (document.body) {
                    document.body.prepend(banner);
                } else if (document.documentElement) {
                    document.documentElement.prepend(banner);
                }
            }

            banner.innerHTML = `
                <div class="sn-itemdb-bar-inner">
                    <div class="sn-itemdb-bar-left">
                        <span class="sn-itemdb-bar-badge">📜 Scriptnautas</span>
                        <span class="sn-itemdb-bar-title">
                            Lista do itemDB: <strong>${escapeHtml(listTitle)}</strong>
                        </span>
                        ${isActive ? `<span class="sn-itemdb-status-pill">✓ Ativa no Neopets (${storage.activeList.itemCount} itens)</span>` : ''}
                    </div>
                    <div class="sn-itemdb-bar-actions">
                        <button id="sn-itemdb-activate-top-btn" class="sn-itemdb-btn-activate">
                            ${isActive ? '🔄 Sincronizar Novamente' : '⭐ Destacar esta lista nas Lojas do Neopets'}
                        </button>
                    </div>
                </div>
            `;

            const btn = banner.querySelector('#sn-itemdb-activate-top-btn');
            if (btn) {
                btn.onclick = () => handleActivation(btn);
            }
        }

        function ensureInlineButton() {
            const h1El = document.querySelector('h1');
            if (!h1El) return;

            let btn = document.getElementById('sn-itemdb-activate-btn');
            const storage = loadStorage();
            const isActive = Boolean(storage.activeList &&
                             storage.activeList.username.toLowerCase() === parsed.username.toLowerCase() &&
                             storage.activeList.slug.toLowerCase() === parsed.slug.toLowerCase());

            if (!btn) {
                btn = document.createElement('button');
                btn.id = 'sn-itemdb-activate-btn';
                btn.className = 'sn-itemdb-page-btn';

                if (h1El.parentElement) {
                    h1El.parentElement.appendChild(btn);
                }
            }

            btn.innerHTML = isActive ? '✓ Ativa no Neopets (Atualizar)' : '⭐ Destacar esta lista nas Lojas do Neopets';
            if (isActive) {
                btn.style.background = '#10b981';
            } else {
                btn.style.background = 'linear-gradient(135deg, #7c3aed, #9333ea)';
            }

            btn.onclick = () => handleActivation(btn);
        }

        function handleActivation(triggerBtn) {
            triggerBtn.disabled = true;
            const originalText = triggerBtn.innerHTML;
            triggerBtn.innerHTML = '⏳ Sincronizando com Scriptnautas...';

            const title = getListTitle();

            fetchListFromItemdb(parsed.username, parsed.slug, title)
                .then(result => {
                    triggerBtn.innerHTML = '✓ Lista Ativa no Neopets!';
                    triggerBtn.style.background = '#10b981';
                    showToast(`🚀 Lista "${result.name}" (${result.itemCount} itens) ativada nas Lojas do Neopets!`);

                    ensureTopBanner();
                    ensureInlineButton();
                })
                .catch(err => {
                    triggerBtn.disabled = false;
                    triggerBtn.innerHTML = originalText;
                    alert(`Erro ao ativar lista: ${err.message}`);
                });
        }

        ensureTopBanner();
        ensureInlineButton();

        let debounceTimer = null;
        const obs = new MutationObserver(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                ensureTopBanner();
                ensureInlineButton();
            }, 120);
        });

        if (document.body) {
            obs.observe(document.body, { childList: true, subtree: true });
        } else {
            window.addEventListener('DOMContentLoaded', () => {
                obs.observe(document.body, { childList: true, subtree: true });
            });
        }
    }

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    function initNeopets() {
        injectStyles();
        updateFloatingWidget();
        processShopItems();

        // Empilhamento dinâmico sem sobreposição
        stackFloatingWidgets();
        setTimeout(stackFloatingWidgets, 100);
        setTimeout(stackFloatingWidgets, 400);
        setTimeout(stackFloatingWidgets, 1200);
        window.addEventListener('resize', stackFloatingWidgets);

        // Observa criação ou remoção de outros widgets na página para re-empilhar instantaneamente
        const widgetObserver = new MutationObserver(() => {
            stackFloatingWidgets();
        });
        widgetObserver.observe(document.body, { childList: true });

        // Observa recarregamento dinâmico de itens na loja (restock, filtros, AJAX)
        const container = document.querySelector('.shop-grid, #container__2020') || document.body;
        const shopObserver = new MutationObserver(() => processShopItems());
        shopObserver.observe(container, { childList: true, subtree: true });

        // Menu do Tampermonkey
        if (typeof GM_registerMenuCommand !== 'undefined') {
            GM_registerMenuCommand('⚙️ Configurar Lista do itemDB', () => openConfigModal());
            GM_registerMenuCommand('🔄 Atualizar Lista Atual', () => {
                const storage = loadStorage();
                if (storage.activeList) {
                    fetchListFromItemdb(storage.activeList.username, storage.activeList.slug)
                        .then(l => showToast(`Lista atualizada (${l.itemCount} itens)!`))
                        .catch(e => alert(e.message));
                } else {
                    openConfigModal();
                }
            });
        }
    }

    if (window.location.hostname.includes('itemdb.com.br')) {
        initItemdbSiteIntegration();
    } else if (window.location.hostname.includes('neopets.com')) {
        initNeopets();
    }

})();

