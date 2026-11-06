// ==UserScript==
// @name         Neopets: Rastreador de Livros & Marcador de Lojas
// @namespace    https://github.com/t-moedano/scriptnautas
// @version      1.0.3
// @description  Rastreia livros lidos (normais e Booktastic) e destaca livros não lidos em lojas oficiais ou marca livros já lidos em lojas de usuários no Neopets.
// @author       t-moedano
// @match        *://*.neopets.com/books_read.phtml*
// @match        *://*.neopets.com/objects.phtml?*type=shop*
// @match        *://*.neopets.com/browseshop.phtml*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=neopets.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-end
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js
// @supportURL   https://github.com/t-moedano/scriptnautas/issues
// @homepageURL  https://github.com/t-moedano/scriptnautas
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'neopets_books_storage_v4';

    // Acesso seguro ao contexto global (MAIN world) para acessar __booksReadConfig
    const pageWindow = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);

    // IDs de lojas oficiais que vendem exclusivamente livros / pergaminhos
    const OFFICIAL_BOOK_SHOPS = {
        7:   'Magical Bookshop',
        38:  'Faerieland Bookshop',
        51:  "Sutek's Scrolls",
        70:  'Booktastic Books',
        77:  'Brightvale Books',
        92:  'Words of Antiquity',
        106: 'Neovian Printing Press',
        114: 'Moltaran Books'
    };

    // Normalização para comparação sem problemas de case, espaços ou pontuação especial
    function normalizeTitle(text) {
        if (!text) return '';
        return text
            .replace(/^[\d]+\.\s*/, '') // Remove numeração "1. ", "2. "
            .replace(/&amp;/gi, '&')
            .replace(/&#039;|&apos;/gi, "'")
            .replace(/&quot;/gi, '"')
            .replace(/[\u2018\u2019']/g, "'") // Padroniza apóstrofos
            .replace(/[\u201C\u201D"]/g, '"') // Padroniza aspas
            .replace(/\s+/g, ' ') // Converte espaços múltiplos e quebras de linha em espaço único
            .trim()
            .toLowerCase();
    }

    // Carrega dados salvos (com fallback entre GM_getValue e localStorage para máxima resiliência)
    function loadStorage() {
        try {
            let raw = null;
            if (typeof GM_getValue !== 'undefined') {
                raw = GM_getValue(STORAGE_KEY, null);
            }
            if (!raw) {
                raw = localStorage.getItem(STORAGE_KEY);
            }
            if (!raw) return { pets: {}, activePet: null };
            return JSON.parse(raw);
        } catch (e) {
            console.error('[Scriptnautas] Erro ao carregar dados:', e);
            return { pets: {}, activePet: null };
        }
    }

    // Salva dados tanto no GM_setValue (cross-protocol HTTP/HTTPS) quanto no localStorage
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
            console.error('[Scriptnautas] Erro ao salvar dados:', e);
        }
    }

    // Detecta o Pet Ativo na página atual (seja pelo dropdown de navegação 2020 ou clássico)
    function detectPageActivePet() {
        const petLink = document.querySelector('.nav-profile-dropdown-text a[href*="petlookup.phtml"], a[href*="quickref.phtml"]');
        if (petLink && petLink.textContent) {
            return petLink.textContent.trim();
        }
        const petImg = document.querySelector('.nav-pet-menu-icon__2020, #navProfilePet__2020');
        if (petImg && petImg.getAttribute('data-petname')) {
            return petImg.getAttribute('data-petname').trim();
        }
        return null;
    }

    // Resolução inteligente do Pet Ativo e seus dados salvos
    function resolvePetData(storage) {
        if (!storage || !storage.pets) return { petName: null, petData: null };

        const pagePet = detectPageActivePet();
        const candidateNames = [];
        if (pagePet) candidateNames.push(pagePet);
        if (storage.activePet) candidateNames.push(storage.activePet);

        const petKeys = Object.keys(storage.pets);

        // 1. Tenta correspondência exata ou case-insensitive
        for (const candidate of candidateNames) {
            if (storage.pets[candidate]) {
                return { petName: candidate, petData: storage.pets[candidate] };
            }
            const match = petKeys.find(k => k.toLowerCase() === candidate.toLowerCase());
            if (match) {
                return { petName: match, petData: storage.pets[match] };
            }
        }

        // 2. Se houver exatamente 1 pet cadastrado no banco, utiliza ele
        if (petKeys.length === 1) {
            const singlePet = petKeys[0];
            return { petName: singlePet, petData: storage.pets[singlePet] };
        }

        return { petName: candidateNames[0] || null, petData: null };
    }

    // Retorna a URL atual e parâmetros
    const currentUrl = new URL(window.location.href);
    const pathname = currentUrl.pathname;
    const searchParams = currentUrl.searchParams;

    // Injeta estilos CSS para os marcadores e notificações
    function injectStyles() {
        if (document.getElementById('scriptnautas-book-styles')) return;
        const style = document.createElement('style');
        style.id = 'scriptnautas-book-styles';
        style.textContent = `
            @keyframes snFadeIn {
                from { opacity: 0; transform: translate(-50%, -10px); }
                to { opacity: 1; transform: translate(-50%, 0); }
            }
            .sn-badge-unread {
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
            .sn-badge-read {
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
            .sn-item-unread {
                outline: 3px solid #22c55e !important;
                background: rgba(34, 197, 94, 0.12) !important;
                border-radius: 8px !important;
                box-shadow: 0 0 12px rgba(34, 197, 94, 0.45) !important;
                position: relative !important;
                transition: transform 0.15s ease, box-shadow 0.15s ease;
            }
            .sn-item-unread:hover {
                transform: translateY(-2px);
                box-shadow: 0 0 16px rgba(34, 197, 94, 0.7) !important;
            }
            .sn-item-read {
                opacity: 0.38 !important;
                filter: grayscale(85%) !important;
                position: relative !important;
                transition: opacity 0.2s ease, filter 0.2s ease;
            }
            .sn-item-read:hover {
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
            .sn-sync-toast {
                position: fixed;
                top: 75px;
                left: 50%;
                transform: translateX(-50%);
                background: #064e3b;
                color: #ecfdf5;
                border: 2px solid #10b981;
                padding: 14px 22px;
                border-radius: 12px;
                font-family: system-ui, -apple-system, sans-serif;
                font-size: 14px;
                font-weight: 500;
                box-shadow: 0 12px 35px rgba(0, 0, 0, 0.6);
                z-index: 99999999;
                display: flex;
                align-items: center;
                gap: 12px;
                animation: snFadeIn 0.3s ease-out;
            }
        `;
        document.head.appendChild(style);
    }

    // =========================================================================
    // 1. PÁGINA DE LIVROS LIDOS (books_read.phtml)
    // =========================================================================
    if (pathname.includes('books_read.phtml')) {
        injectStyles();

        // Extrai a lista de livros lidos usando múltiplos fallbacks resilientes
        function syncBooksRead() {
            let petName = searchParams.get('pet_name') || '';
            const isBooktastic = searchParams.get('tab') === 'booktastic' || currentUrl.href.includes('tab=booktastic');
            const tabKey = isBooktastic ? 'booktastic' : 'regular';
            const tabIdsKey = isBooktastic ? 'booktasticIds' : 'regularIds';
            const bookTitles = new Set();
            const bookIds = new Set();

            // 1.1 Tentativa Principal: Variável global injetada pelo Neopets moderno
            const pageConfig = pageWindow.__booksReadConfig || window.__booksReadConfig;
            if (pageConfig) {
                if (pageConfig.currentPet && !petName) {
                    petName = pageConfig.currentPet;
                }
                if (Array.isArray(pageConfig.books)) {
                    pageConfig.books.forEach(b => {
                        if (b) {
                            if (b.name) bookTitles.add(b.name.trim());
                            if (b.objInfoId) bookIds.add(String(b.objInfoId));
                        }
                    });
                }
            }

            // 1.2 Fallback: Inspeção de scripts embutidos no DOM (caso contexto isolado do Tampermonkey)
            if (bookTitles.size === 0) {
                const scripts = document.querySelectorAll('script');
                for (const s of scripts) {
                    const text = s.textContent || '';
                    if (text.includes('__booksReadConfig')) {
                        const marker = '__booksReadConfig';
                        const idx = text.indexOf(marker);
                        if (idx !== -1) {
                            const jsonStart = text.indexOf('{', idx);
                            const appIdx = text.indexOf('window.app', jsonStart);
                            let jsonEnd = -1;
                            if (appIdx !== -1) {
                                jsonEnd = text.lastIndexOf('}', appIdx);
                            } else {
                                const scriptEnd = text.indexOf('</script>', jsonStart);
                                jsonEnd = text.lastIndexOf('}', scriptEnd !== -1 ? scriptEnd : text.length);
                            }
                            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                                try {
                                    const rawJson = text.slice(jsonStart, jsonEnd + 1);
                                    const parsed = JSON.parse(rawJson);
                                    if (parsed.currentPet && !petName) petName = parsed.currentPet;
                                    if (Array.isArray(parsed.books)) {
                                        parsed.books.forEach(b => {
                                            if (b) {
                                                if (b.name) bookTitles.add(b.name.trim());
                                                if (b.objInfoId) bookIds.add(String(b.objInfoId));
                                            }
                                        });
                                    }
                                } catch (e) {
                                    console.warn('[Scriptnautas] Falha no parse JSON slice:', e);
                                }
                            }
                        }
                    }
                }
            }

            // 1.3 Fallback: Leitura direta do DOM (Tabelas clássicas ou divs)
            if (bookTitles.size === 0) {
                const legacyElements = document.querySelectorAll('table td b, .content td b, .grid-item b, .book-title');
                legacyElements.forEach(el => {
                    const txt = el.textContent ? el.textContent.trim() : '';
                    if (txt && !txt.match(/^[0-9]+$/) && txt.length > 2) {
                        bookTitles.add(txt);
                    }
                });
            }

            // Se o nome do pet não foi extraído do config nem dos parâmetros, tenta o cabeçalho/título
            if (!petName) {
                const petTitle = document.querySelector('.page-title__2020 h1, .content h2, .header-text, title');
                if (petTitle && petTitle.textContent) {
                    const m = petTitle.textContent.match(/pet_name=([a-zA-Z0-9_]+)/) || petTitle.textContent.match(/([a-zA-Z0-9_]+)\s+(has read|já leu)/i);
                    if (m && m[1]) petName = m[1];
                }
            }

            if (!petName) petName = 'Neopet';

            // Salva dados no Storage
            const storage = loadStorage();
            if (!storage.pets[petName]) {
                storage.pets[petName] = { regular: [], regularIds: [], booktastic: [], booktasticIds: [], lastUpdated: 0 };
            }

            const currentList = Array.from(bookTitles);
            const currentIds = Array.from(bookIds);
            storage.pets[petName][tabKey] = currentList;
            storage.pets[petName][tabIdsKey] = currentIds;
            storage.pets[petName].lastUpdated = Date.now();
            storage.activePet = petName;
            saveStorage(storage);

            const tabName = isBooktastic ? 'Booktastic' : 'Livros Padrão';

            // 1. Toast Flutuante no Centro Superior (garantido visível em qualquer tema e resolução)
            showSyncToast(petName, tabName, currentList.length);

            // 2. Banner embutido no corpo da página (abaixo do cabeçalho)
            injectInlineBanner(petName, tabName, currentList.length);

            console.log(`[Scriptnautas] ${currentList.length} livros salvos com sucesso para ${petName} (${tabKey}).`);
        }

        // Exibe o Toast Flutuante com auto-dismiss
        function showSyncToast(petName, tabName, count) {
            const oldToast = document.getElementById('sn-sync-toast');
            if (oldToast) oldToast.remove();

            const toast = document.createElement('div');
            toast.id = 'sn-sync-toast';
            toast.className = 'sn-sync-toast';
            toast.innerHTML = `
                <span style="font-size: 24px;">📚</span>
                <div>
                    <div style="font-weight: 700; color: #34d399; font-size: 15px;">Scriptnautas: Sincronizado com Sucesso!</div>
                    <div style="font-size: 13px; color: #ecfdf5;">
                        Foram salvos <strong>${count}</strong> livros da aba <em>${tabName}</em> para <strong>${petName}</strong>.
                    </div>
                </div>
                <button type="button" style="background: none; border: none; color: #a7f3d0; font-size: 18px; cursor: pointer; margin-left: 14px; padding: 0 4px;" title="Fechar">✕</button>
            `;

            const closeBtn = toast.querySelector('button');
            if (closeBtn) closeBtn.onclick = () => toast.remove();

            document.body.appendChild(toast);

            setTimeout(() => {
                if (toast.parentElement) {
                    toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
                    toast.style.opacity = '0';
                    toast.style.transform = 'translate(-50%, -10px)';
                    setTimeout(() => toast.remove(), 400);
                }
            }, 7000);
        }

        // Insere o banner integrado na estrutura visível da página
        function injectInlineBanner(petName, tabName, count) {
            const oldBanner = document.getElementById('sn-inline-banner');
            if (oldBanner) oldBanner.remove();

            const banner = document.createElement('div');
            banner.id = 'sn-inline-banner';
            banner.style.cssText = `
                background: #064e3b;
                color: #ecfdf5;
                padding: 12px 18px;
                border-radius: 8px;
                margin: 15px auto;
                max-width: 820px;
                text-align: center;
                font-family: system-ui, sans-serif;
                font-size: 14px;
                box-shadow: 0 4px 6px rgba(0,0,0,0.15);
                border: 1px solid #10b981;
            `;
            banner.innerHTML = `
                <strong>📚 Scriptnautas:</strong> Sincronizado com sucesso! Foram salvos <strong>${count}</strong> livros da aba <em>${tabName}</em> para <strong>${petName}</strong>.
            `;

            // Procura o container visível da página (2020 moderno ou clássico)
            const targetContainer = document.querySelector('.page-title__2020') ||
                                    document.getElementById('books-read-app') ||
                                    document.getElementById('container__2020') ||
                                    document.querySelector('.content') ||
                                    document.getElementById('container');

            if (targetContainer) {
                if (targetContainer.classList.contains('page-title__2020')) {
                    targetContainer.insertAdjacentElement('afterend', banner);
                } else {
                    targetContainer.insertBefore(banner, targetContainer.firstChild);
                }
            }
        }

        // Executa com tolerância a carregamento dinâmico
        if (document.readyState === 'complete') {
            syncBooksRead();
        } else {
            window.addEventListener('load', () => setTimeout(syncBooksRead, 250));
        }
    }

    // =========================================================================
    // 2. LOJAS OFICIAIS DE LIVROS (objects.phtml?type=shop&obj_type=...)
    // =========================================================================
    else if (pathname.includes('objects.phtml') && (searchParams.get('type') === 'shop' || searchParams.has('obj_type'))) {
        const objType = parseInt(searchParams.get('obj_type'), 10);

        // Somente executa se for uma das lojas oficiais de livros homologadas
        if (OFFICIAL_BOOK_SHOPS[objType]) {
            injectStyles();

            const storage = loadStorage();
            const { petName: activePet, petData } = resolvePetData(storage);

            // Conjuntos normalizados de IDs e Títulos
            const readBooksSet = new Set();
            const readIdsSet = new Set();

            if (petData) {
                (petData.regular || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
                (petData.booktastic || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
                (petData.regularIds || []).forEach(id => readIdsSet.add(String(id)));
                (petData.booktasticIds || []).forEach(id => readIdsSet.add(String(id)));
            }

            const hasSavedData = (readBooksSet.size > 0 || readIdsSet.size > 0);

            function processOfficialShopItems() {
                // TRAVA DE SEGURANÇA: Se não há nenhum livro salvo no banco para o pet,
                // NÃO destaca nada como "NÃO LIDO" para evitar falsos positivos
                if (!hasSavedData) return;

                // Layout moderno do Neopets (.shop-item)
                const modernItems = document.querySelectorAll('.shop-item:not([data-sn-checked])');
                modernItems.forEach(item => {
                    item.setAttribute('data-sn-checked', 'true');
                    const img = item.querySelector('.item-img');
                    const nameEl = item.querySelector('.item-name b, .item-name');
                    const itemName = img?.getAttribute('data-name') || nameEl?.textContent || '';
                    if (!itemName) return;

                    const dataLink = img?.getAttribute('data-link') || item.querySelector('a')?.getAttribute('href') || '';
                    const idMatch = dataLink.match(/obj_info_id=(\d+)/);
                    const itemId = idMatch ? idMatch[1] : null;

                    const isRead = (itemId && readIdsSet.has(itemId)) || readBooksSet.has(normalizeTitle(itemName));

                    if (isRead) {
                        item.classList.add('sn-item-read');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-read';
                        badge.textContent = '✓ Lido';
                        item.appendChild(badge);
                    } else {
                        item.classList.add('sn-item-unread');
                        const badge = document.createElement('span');
                        badge.className = 'sn-badge-unread';
                        badge.textContent = '⭐ NÃO LIDO';
                        item.appendChild(badge);
                    }
                });

                // Layout clássico (tabela de itens com links para haggle.phtml)
                const legacyLinks = document.querySelectorAll('a[href*="haggle.phtml"]:not([data-sn-checked])');
                legacyLinks.forEach(link => {
                    link.setAttribute('data-sn-checked', 'true');
                    const cell = link.closest('td');
                    if (!cell) return;

                    const nameEl = cell.querySelector('b');
                    const itemName = nameEl ? nameEl.textContent : '';
                    if (!itemName) return;

                    const linkHref = link.getAttribute('href') || '';
                    const idMatch = linkHref.match(/obj_info_id=(\d+)/);
                    const itemId = idMatch ? idMatch[1] : null;

                    const isRead = (itemId && readIdsSet.has(itemId)) || readBooksSet.has(normalizeTitle(itemName));
                    if (isRead) {
                        cell.classList.add('sn-item-read');
                    } else {
                        cell.classList.add('sn-item-unread');
                    }
                });
            }

            processOfficialShopItems();

            // Observador de mutações para suportar restock dinâmico ou paginação na loja
            const shopContainer = document.querySelector('.shop-grid, #container__2020') || document.body;
            const observer = new MutationObserver(() => {
                processOfficialShopItems();
            });
            observer.observe(shopContainer, { childList: true, subtree: true });

            // Badge flutuante de status
            renderFloatingBadge(activePet, petData, OFFICIAL_BOOK_SHOPS[objType]);
        }
    }

    // =========================================================================
    // 3. LOJAS DE USUÁRIOS (browseshop.phtml)
    // =========================================================================
    else if (pathname.includes('browseshop.phtml')) {
        injectStyles();

        const storage = loadStorage();
        const { petName: activePet, petData } = resolvePetData(storage);

        const readBooksSet = new Set();
        const readIdsSet = new Set();

        if (petData) {
            (petData.regular || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
            (petData.booktastic || []).forEach(b => readBooksSet.add(normalizeTitle(b)));
            (petData.regularIds || []).forEach(id => readIdsSet.add(String(id)));
            (petData.booktasticIds || []).forEach(id => readIdsSet.add(String(id)));
        }

        function processUserShopItems() {
            // Layout moderno de loja de usuário (.bsp-item)
            const modernItems = document.querySelectorAll('.bsp-item:not([data-sn-checked])');
            modernItems.forEach(item => {
                item.setAttribute('data-sn-checked', 'true');
                const btn = item.querySelector('.bsp-item__buy');
                const nameSpan = item.querySelector('.bsp-item__name');
                const itemName = btn?.getAttribute('data-name') || nameSpan?.textContent || '';
                if (!itemName) return;

                const oii = item.getAttribute('data-oii') || (btn?.getAttribute('data-buy-url') || '').match(/obj_info_id=(\d+)/)?.[1];

                // REGRA ESTREITA: Apenas se o item for CONFIRMADO como já lido nós apagamos.
                // Itens não lidos permanecem inalterados pois podem ser brinquedos, comida, etc.
                const isRead = (oii && readIdsSet.has(oii)) || readBooksSet.has(normalizeTitle(itemName));

                if (isRead) {
                    item.classList.add('sn-item-read');
                    const badge = document.createElement('span');
                    badge.className = 'sn-badge-read';
                    badge.textContent = '✓ Já Lido';
                    item.appendChild(badge);
                }
            });

            // Layout clássico de loja de usuário (tabelas com links para buy_item.phtml)
            const legacyLinks = document.querySelectorAll('a[href*="buy_item.phtml"]:not([data-sn-checked])');
            legacyLinks.forEach(link => {
                link.setAttribute('data-sn-checked', 'true');
                const cell = link.closest('td');
                if (!cell) return;

                const nameEl = cell.querySelector('b');
                const itemName = nameEl ? nameEl.textContent : '';
                if (!itemName) return;

                const linkHref = link.getAttribute('href') || '';
                const idMatch = linkHref.match(/buy_obj_info_id=(\d+)/);
                const itemId = idMatch ? idMatch[1] : null;

                const isRead = (itemId && readIdsSet.has(itemId)) || readBooksSet.has(normalizeTitle(itemName));
                if (isRead) {
                    cell.classList.add('sn-item-read');
                }
            });
        }

        processUserShopItems();

        // Observa atualizações dinâmicas (ex: paginação AJAX ou busca sem recarregar tela)
        const gridRegion = document.getElementById('bsp-grid-region') || document.body;
        const observer = new MutationObserver(() => {
            processUserShopItems();
        });
        observer.observe(gridRegion, { childList: true, subtree: true });

        // Badge flutuante de status
        renderFloatingBadge(activePet, petData, 'Loja de Usuário');
    }

    function stackFloatingWidgets() {
        const selectors = [
            '#scriptnautas-status-badge',
            '#sn-floating-stamp-badge',
            '#scriptnautas-stamp-badge',
            '#sn-gourmet-floating-widget',
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

    // =========================================================================
    // COMPONENTE: Badge Flutuante de Informação
    // =========================================================================
    function renderFloatingBadge(petName, petData, shopName) {
        if (document.getElementById('scriptnautas-status-badge')) return;

        const badge = document.createElement('div');
        badge.id = 'scriptnautas-status-badge';
        badge.className = 'sn-status-floating';

        const regCount = (petData && petData.regular) ? petData.regular.length : 0;
        const bookCount = (petData && petData.booktastic) ? petData.booktastic.length : 0;
        const total = regCount + bookCount;

        if (!petName || total === 0) {
            badge.innerHTML = `
                <span>⚠️ <strong>Scriptnautas:</strong> Nenhum livro sincronizado${petName ? ` para ${petName}` : ''}.</span>
                <a href="/books_read.phtml${petName ? `?pet_name=${encodeURIComponent(petName)}` : ''}" target="_blank">Sincronizar Livros</a>
                <span id="sn-book-close-widget" style="margin-left: 6px; cursor: pointer; color: #9ca3af; font-size: 14px; line-height: 1;" title="Ocultar nesta página">&times;</span>
            `;
        } else {
            badge.innerHTML = `
                <span>📖 <strong>${petName}</strong>: ${total} livros lidos (${regCount} normais, ${bookCount} booktastic)</span>
                <span style="color: #9ca3af;">•</span>
                <a href="/books_read.phtml?pet_name=${encodeURIComponent(petName)}" title="Atualizar lista de livros">Atualizar</a>
                <span id="sn-book-close-widget" style="margin-left: 6px; cursor: pointer; color: #9ca3af; font-size: 14px; line-height: 1;" title="Ocultar nesta página">&times;</span>
            `;
        }

        document.body.appendChild(badge);

        const closeBtn = badge.querySelector('#sn-book-close-widget');
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
