// ==UserScript==
// @name         Neopets: Rastreador de Selos & Marcador de Lojas
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.1
// @description  Rastreia selos, moedas e conchas colecionados no seu Álbum de Selos do Neopets e destaca itens faltantes em lojas oficiais (Post Office, Coin Shop, Sea Shells) e lojas de usuários.
// @author       t-moedano
// @match        *://*.neopets.com/stamps.phtml*
// @match        *://*.neopets.com/objects.phtml?*type=shop*
// @match        *://*.neopets.com/browseshop.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
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

    // Lojas oficiais homologadas que vendem exclusivamente colecionáveis de álbum
    const OFFICIAL_STAMP_SHOPS = {
        58: { name: 'Neopian Post Office', category: 'Selos' },
        68: { name: 'Coin Shop', category: 'Moedas' },
        88: { name: 'Sea Shells', category: 'Conchas' }
    };

    // Palavras-chave para identificar itens de álbum em lojas de usuários sem confundir com comida/brinquedos
    const ALBUM_ITEM_KEYWORDS = [
        'stamp', 'coin', 'coins', 'shell', 'scarab', 'coconut', 'charm', 'golden dubloon'
    ];

    // Mapeamento de fallback para itens novos conhecidos cujo alt/title venha vazio da TNT
    const KNOWN_HASH_FALLBACKS = {
        'ba70c82b0047e6': 'Library Faerie Coin'
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

    function isLikelyAlbumItem(name) {
        const lower = name.toLowerCase();
        return ALBUM_ITEM_KEYWORDS.some(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'i');
            return regex.test(lower);
        });
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
                    stamps: {},
                    stampImages: {}
                };
            }
            const data = JSON.parse(raw);
            data.stampImages = data.stampImages || {};
            return data;
        } catch (e) {
            console.error('[Scriptnautas Selos] Erro ao carregar storage:', e);
            return { username: null, lastSync: null, totalCount: 0, uniqueCount: 0, pages: {}, stamps: {}, stampImages: {} };
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

    // Checa se o item já foi colecionado (por NOME normalizado ou pelo HASH da IMAGEM)
    function isCollectedItem(itemName, itemSrc, collectedSet, imageSet) {
        if (itemName) {
            const norm = normalizeTitle(itemName);
            if (collectedSet.has(norm)) return true;
        }
        if (itemSrc) {
            const hash = extractItemHash(itemSrc);
            if (hash && (imageSet[hash] || KNOWN_HASH_FALLBACKS[hash])) {
                const fallbackName = KNOWN_HASH_FALLBACKS[hash];
                if (imageSet[hash] || (fallbackName && collectedSet.has(normalizeTitle(fallbackName)))) {
                    return true;
                }
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
            .sn-badge-missing {
                position: absolute;
                top: 4px;
                right: 4px;
                background: #16a34a;
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
                outline: 3px solid #22c55e !important;
                background: rgba(34, 197, 94, 0.12) !important;
                border-radius: 8px !important;
                box-shadow: 0 0 12px rgba(34, 197, 94, 0.45) !important;
                position: relative !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
            }
            .sn-item-missing:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 16px rgba(34, 197, 94, 0.7) !important;
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
                max-width: 480px;
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
        `;
        document.head.appendChild(style);
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

        // Extrai selos colados de um Document ou Container
        function extractStampsFromDoc(rootDoc) {
            const stamps = [];

            // As células dos selos têm width="90" ou estão na tabela central de 450px
            const cells = rootDoc.querySelectorAll('table[width="450"] td, .content table td[width="90"], table[width="450"] img, .content table img');

            cells.forEach(el => {
                const img = el.tagName === 'IMG' ? el : el.querySelector('img');
                if (!img) return;

                const src = img.getAttribute('src') || '';
                // Ignora slots vazios, bordas, espaçadores e setas
                if (!src || src.includes('no_stamp.gif') || src.includes('stamp_blank.gif') || src.includes('transparent_spacer.gif')) {
                    return;
                }
                if (src.includes('arrow-') || src.includes('question_mark')) return;

                let name = (img.getAttribute('alt') || img.getAttribute('title') || el.getAttribute?.('title') || '').trim();
                const imgKey = extractItemHash(src);

                // Se explicitamente for "No Stamp", ignora
                if (name === 'No Stamp') return;

                // Fallback para itens com hash sem nome no HTML da TNT
                if (!name && imgKey && KNOWN_HASH_FALLBACKS[imgKey]) {
                    name = KNOWN_HASH_FALLBACKS[imgKey];
                }

                // Se ainda assim não tiver nome, mas é um item válido no slot
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

            // Evita duplicação caso tenhamos selecionado tanto td quanto img
            const uniqueStamps = [];
            const seen = new Set();
            stamps.forEach(s => {
                const key = `${s.name}|${s.imgKey}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    uniqueStamps.push(s);
                }
            });

            return uniqueStamps;
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
            const pageStamps = extractStampsFromDoc(document);
            const storage = loadStorage();
            if (currentUser && (!storage.username || storage.username !== currentUser)) {
                storage.username = currentUser;
            }
            storage.pages = storage.pages || {};
            storage.pages[pageId] = pageStamps;
            storage.lastSync = Date.now();
            saveStorage(storage);
            console.log(`[Scriptnautas Selos] Sincronização passiva: página ${pageId} com ${pageStamps.length} selos.`);
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
                    <button id="sn-btn-sync-all" class="sn-btn-primary" style="font-size: 13px;">
                        ⚡ Sincronizar Álbum Completo
                    </button>
                </div>
            `;

            const target = document.querySelector('.content table[width="450"]') ||
                           document.querySelector('.content p') ||
                           document.querySelector('.content') ||
                           document.getElementById('content');

            if (target) {
                target.parentNode.insertBefore(banner, target);
            }

            document.getElementById('sn-btn-sync-all')?.addEventListener('click', startFullSync);
        }

        // Processo de Sincronização Completa em Lote com Barra de Progresso
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
                        Lendo páginas do álbum de forma otimizada sem sobrecarregar sua conexão...
                    </p>
                    <div class="sn-progress-bar-bg">
                        <div id="sn-sync-fill" class="sn-progress-bar-fill"></div>
                    </div>
                    <div id="sn-sync-status" style="font-size: 13px; font-weight: 600; color: #e5e7eb;">
                        Iniciando... (0/${total})
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            const fillEl = document.getElementById('sn-sync-fill');
            const statusEl = document.getElementById('sn-sync-status');

            const storage = loadStorage();
            if (currentUser) storage.username = currentUser;
            storage.pages = storage.pages || {};

            let completed = 0;
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
                    return [];
                }
            }

            for (let i = 0; i < pageIds.length; i += batchSize) {
                const batch = pageIds.slice(i, i + batchSize);
                const results = await Promise.all(batch.map(pid => fetchPage(pid)));

                batch.forEach((pid, idx) => {
                    storage.pages[pid] = results[idx];
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

            statusEl.innerHTML = `✅ Concluído! <strong style="color: #34d399;">${storage.totalCount}</strong> selos colecionados encontrados.`;
            setTimeout(() => {
                overlay.remove();
                renderAlbumSyncBanner();
            }, 1200);
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
                    const itemName = img?.getAttribute('data-name') || nameEl?.textContent || '';
                    const itemSrc = img?.getAttribute('src') || '';
                    if (!itemName && !itemSrc) return;

                    const isCollected = isCollectedItem(itemName, itemSrc, collectedSet, imageSet);

                    if (isCollected) {
                        item.classList.add('sn-item-collected');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-collected';
                        badge.textContent = '✓ Colecionado';
                        item.appendChild(badge);
                    } else {
                        item.classList.add('sn-item-missing');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-missing';
                        badge.textContent = '⭐ FALTANDO';
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
                    const itemName = nameEl ? nameEl.textContent : '';
                    const itemSrc = img ? img.getAttribute('src') : '';
                    if (!itemName && !itemSrc) return;

                    const isCollected = isCollectedItem(itemName, itemSrc, collectedSet, imageSet);

                    if (isCollected) {
                        cell.classList.add('sn-item-collected');
                    } else {
                        cell.classList.add('sn-item-missing');
                    }
                });
            }

            processOfficialShopItems();

            const shopContainer = document.querySelector('.shop-grid, #container__2020') || document.body;
            const observer = new MutationObserver(() => processOfficialShopItems());
            observer.observe(shopContainer, { childList: true, subtree: true });

            renderFloatingBadge(shopInfo.name, storage);
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
                } else if (isLikelyAlbumItem(itemName)) {
                    cell.classList.add('sn-item-missing');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-missing';
                    badge.textContent = '⭐ FALTANDO';
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

    // Badge flutuante informativa no canto inferior da tela
    function renderFloatingBadge(contextName, storage) {
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
            <a href="/stamps.phtml" title="Ir para o Álbum de Selos">Abrir Álbum</a>
        `;
        document.body.appendChild(badge);
    }

})();
