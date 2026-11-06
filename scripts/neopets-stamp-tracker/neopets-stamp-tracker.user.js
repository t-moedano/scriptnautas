// ==UserScript==
// @name         Neopets: Rastreador de Selos & Marcador de Lojas
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.5
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
                    stampImages: {}
                };
            }
            const data = JSON.parse(raw);
            data.stampImages = data.stampImages || {};
            data.pageCounts = data.pageCounts || {};
            return data;
        } catch (e) {
            console.error('[Scriptnautas Selos] Erro ao carregar storage:', e);
            return { username: null, lastSync: null, totalCount: 0, uniqueCount: 0, pages: {}, pageCounts: {}, stamps: {}, stampImages: {} };
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
                    <div style="display: flex; gap: 8px;">
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
            <span id="sn-stamp-close-widget" style="margin-left: 6px; cursor: pointer; color: #9ca3af; font-size: 14px; line-height: 1;" title="Ocultar nesta página">&times;</span>
        `;
        document.body.appendChild(badge);

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

})();
