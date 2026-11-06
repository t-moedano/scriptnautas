# 🚀 Scriptnautas
> *Userscripts focados em qualidade de vida, automação e facilidades para a web!*

Bem-vindo ao **Scriptnautas**! Este repositório reúne userscripts desenvolvidos para rodar via [Tampermonkey](https://www.tampermonkey.net/) (ou Violentmonkey / Greasemonkey), trazendo melhorias visuais e de navegação para jogos e sites.

---

## 📦 Catálogo de Scripts

| Script | Categoria | Versão | Instalação 1-Clique | Descrição |
| :--- | :--- | :---: | :---: | :--- |
| **Neopets: Book Tracker & Shop Marker** | Neopets | `1.0.3` | [📥 Instalar](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js) | Destaca livros não lidos em lojas oficiais e marca livros já lidos em lojas de usuários. |
| **Neopets: Stamp Tracker & Shop Marker** | Neopets | `1.1.0` | [📥 Instalar](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-stamp-tracker/neopets-stamp-tracker.user.js) | Destaca selos faltantes com cores personalizadas por faixas de preço do itemDB na Post Office, Coin Shop, Sea Shells, Toy Shop e lojas de usuários. |
| **Neopets: Gourmet Food Tracker & Shop Marker** | Neopets | `1.0.2` | [📥 Instalar](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-gourmet-tracker/neopets-gourmet-tracker.user.js) | Destaca comidas gourmet (r90-r100) faltantes nas 27 lojas oficiais e lojas de usuários, integrado ao itemDB. |
| **Neopets: itemDB Wishlist Highlighter** | Neopets | `1.0.0` | [📥 Instalar](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-itemdb-list-highlighter/neopets-itemdb-list-highlighter.user.js) | Destaca itens da sua lista personalizada do itemDB em qualquer loja oficial ou de usuários com preço estimado. |

---

## 🛠️ Como Instalar e Usar

1. **Instale uma extensão gerenciadora de Userscripts:**
   - [Tampermonkey para Chrome / Edge / Opera / Brave](https://www.tampermonkey.net/)
   - [Tampermonkey para Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/)
2. Na tabela acima, clique no link **"📥 Instalar"** do script desejado.
3. A tela do Tampermonkey será exibida automaticamente com o código. Clique em **"Instalar"** (ou *Confirmar Instalação*).
4. Pronto! O script já estará ativo nas páginas correspondentes.

---

## 🔄 Como Funcionam as Atualizações Automáticas

Todos os scripts deste repositório possuem diretrizes nativas de atualização automática (`@updateURL` e `@downloadURL`):

```javascript
// @version      1.0.0
// @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/.../script.user.js
// @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/.../script.user.js
```

### Para você (mantenedor do repositório):
Quando fizer uma alteração ou correção em qualquer script:
1. Suba o número da versão no cabeçalho do script (ex: de `@version 1.0.0` para `@version 1.0.1` ou `1.1.0`).
2. Faça o `git commit` e `git push` para a branch `main`.

### Para os usuários que instalaram:
* **Eles não precisam fazer nada!**
* O Tampermonkey checa o repositório em segundo plano periodicamente. Ao notar que o `@version` no GitHub aumentou, ele baixa e aplica a atualização de forma transparente.

---

## 📁 Estrutura do Repositório & Como Adicionar Novos Scripts

A estrutura de pastas foi planejada para acomodar dezenas de outros scripts de forma limpa e modular:

```text
scriptnautas/
├── README.md                              <- Catálogo geral e guia
└── scripts/
    ├── neopets-book-tracker/
    │   ├── README.md                      <- Guia detalhado do rastreador de livros
    │   └── neopets-book-tracker.user.js   <- Código do script
    ├── neopets-stamp-tracker/
    │   ├── README.md                      <- Guia detalhado do rastreador de selos
    │   └── neopets-stamp-tracker.user.js  <- Código do script
    ├── neopets-gourmet-tracker/
    │   ├── README.md                      <- Guia detalhado do rastreador de comidas gourmet
    │   └── neopets-gourmet-tracker.user.js <- Código do script
    └── neopets-itemdb-list-highlighter/
        ├── README.md                      <- Guia detalhado do marcador por lista do itemDB
        └── neopets-itemdb-list-highlighter.user.js <- Código do script
```

### Checklist para criar um novo script:
1. Crie uma pasta dentro de `scripts/` com o identificador do script (ex: `scripts/meu-novo-script/`).
2. Crie o arquivo terminando obrigatoriamente com `.user.js` (ex: `meu-novo-script.user.js`).
3. Adicione o cabeçalho padrão com as URLs apontando para o seu repositório:
   ```javascript
   // ==UserScript==
   // @name         Nome do Script
   // @namespace    https://github.com/t-moedano/scriptnautas
   // @version      1.0.0
   // @description  O que o script faz
   // @author       t-moedano
   // @match        https://exemplo.com/*
   // @grant        none
   // @updateURL    https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/meu-novo-script/meu-novo-script.user.js
   // @downloadURL  https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/meu-novo-script/meu-novo-script.user.js
   // ==/UserScript==
   ```
4. Adicione uma linha na tabela deste `README.md` com o link direto `raw.githubusercontent.com` para a instalação em 1 clique!
