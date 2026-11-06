// ==UserScript==
// @name         Neopets: Marcador de Lojas por Lista do itemDB (Wishlist Highlighter)
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.0
// @description  Destaca itens da sua lista personalizada do itemDB em qualquer loja oficial ou loja de usuário do Neopets.
// @author       t-moedano
// @match        *://*.neopets.com/objects.phtml?*type=shop*
// @match        *://*.neopets.com/browseshop.phtml*
// @match        *://itemdb.com.br/lists/*
// @match        *://itemdb.com.br/pt/lists/*
// @match        *://*.itemdb.com.br/lists/*
// @match        *://*.itemdb.com.br/pt/lists/*
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

    function parseItemdbListUrl(input) {
        if (!input || typeof input !== 'string') return null;
        const trimmed = input.trim();

        // Formato URL completo (ex: https://itemdb.com.br/pt/lists/nana/minha-lista)
        const fullMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?itemdb\.com\.br\/(?:[a-z]{2}\/)?lists\/([^\/\?#]+)\/([^\/\?#]+)/i);
        if (fullMatch) {
            return {
                username: decodeURIComponent(fullMatch[1]),
                slug: decodeURIComponent(fullMatch[2])
            };
        }

        // Formato curto "usuario/slug"
        const shortMatch = trimmed.match(/^([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)$/);
        if (shortMatch) {
            return {
                username: shortMatch[1],
                slug: shortMatch[2]
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
        } else if (data && Array.isArray(data.items)) {
            itemsArray = data.items;
        } else if (data && typeof data === 'object') {
            itemsArray = Object.values(data);
        }

        itemsArray.forEach(item => {
            if (!item || !item.name) return;
            const name = String(item.name).trim();
            const normName = normalizeTitle(name);

            // image_id pode vir como número ou string (ex: 'foo_bar_123')
            const imageId = item.image_id ? String(item.image_id).toLowerCase().trim() : null;
            const priceValue = (item.price && typeof item.price.value === 'number') ? item.price.value : null;
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
                            reject(new Error(`Erro HTTP ${res.status} ao consultar itemDB.`));
                        }
                    },
                    ontimeout: function() {
                        reject(new Error('Tempo limite esgotado ao contatar o servidor do itemDB.'));
                    },
                    onerror: function(err) {
                        reject(new Error('Erro de conexão com o itemDB.'));
                    }
                });
            } else {
                fetch(apiUrl)
                    .then(r => {
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        return r.text();
                    })
                    .then(handleSuccess)
                    .catch(reject);
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
                transition: transform 0.15s ease, background 0.15s ease;
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
    // BOTÃO FLUTUANTE (WIDGET) NO NEOPETS
    // =========================================================================

    function updateFloatingWidget() {
        let widget = document.getElementById('sn-itemdb-floating-widget');
        const storage = loadStorage();
        const activeList = storage.activeList;

        if (!widget) {
            widget = document.createElement('div');
            widget.id = 'sn-itemdb-floating-widget';
            widget.className = 'sn-itemdb-floating-widget';
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

        const path = window.location.pathname;
        const parsed = parseItemdbListUrl(path);
        if (!parsed) return;

        function injectActivationButton() {
            if (document.getElementById('sn-itemdb-activate-btn')) return;

            // Busca título da lista ou cabeçalho da página
            const headerContainer = document.querySelector('h1, .list-header, [class*="ListHeader"], main header, .container') || document.body;
            if (!headerContainer) return;

            const listTitleEl = document.querySelector('h1');
            const listTitle = listTitleEl ? listTitleEl.textContent.trim() : parsed.slug;

            const btn = document.createElement('button');
            btn.id = 'sn-itemdb-activate-btn';
            btn.className = 'sn-itemdb-page-btn';
            btn.innerHTML = '⭐ Destacar esta lista nas Lojas do Neopets';

            btn.onclick = () => {
                btn.disabled = true;
                btn.innerHTML = '⏳ Sincronizando com Scriptnautas...';

                fetchListFromItemdb(parsed.username, parsed.slug, listTitle)
                    .then(result => {
                        btn.innerHTML = '✓ Lista Ativa no Neopets!';
                        btn.style.background = '#10b981';
                        showToast(`🚀 Lista "${result.name}" com ${result.itemCount} itens ativada no Neopets!`);
                    })
                    .catch(err => {
                        btn.disabled = false;
                        btn.innerHTML = '⭐ Destacar esta lista nas Lojas do Neopets';
                        alert(`Erro ao ativar lista: ${err.message}`);
                    });
            };

            if (listTitleEl && listTitleEl.parentElement) {
                listTitleEl.parentElement.appendChild(btn);
            } else {
                headerContainer.prepend(btn);
            }
        }

        injectActivationButton();
        const obs = new MutationObserver(() => injectActivationButton());
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // =========================================================================
    // INICIALIZAÇÃO
    // =========================================================================

    function initNeopets() {
        injectStyles();
        updateFloatingWidget();
        processShopItems();

        // Observa recarregamento dinâmico de itens na loja (restock, filtros, AJAX)
        const container = document.querySelector('.shop-grid, #container__2020') || document.body;
        const observer = new MutationObserver(() => processShopItems());
        observer.observe(container, { childList: true, subtree: true });

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

