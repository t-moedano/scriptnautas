# 📋 Neopets: Marcador de Lojas por Lista do itemDB (Wishlist Highlighter)

Script para Tampermonkey que conecta suas listas personalizadas do **[itemDB](https://itemdb.com.br)** diretamente ao Neopets, destacando visualmente em tempo real qualquer item da sua lista em **todas as lojas oficiais de Neopia** e **todas as lojas de usuários**.

[![Instalar no Tampermonkey](https://img.shields.io/badge/Instalar%20com%201--Clique-Tampermonkey-brightgreen?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-itemdb-list-highlighter/neopets-itemdb-list-highlighter.user.js)

---

## ✨ Funcionalidades

1. **Destaque em Qualquer Loja Oficial ou de Jogador**:
   - Funciona em mais de 100 lojas oficiais (`objects.phtml`) e em todas as lojas de usuários (`browseshop.phtml`).
   - Se o item à venda estiver na sua lista do itemDB, ele recebe uma borda vibrante na cor ametista (`#8b5cf6`), efeito de brilho e a tag `★ ITEMDB`.
2. **Estimativa de Preço Integrada**:
   - Exibe sob o item o preço estimado atualizado de mercado registrado no itemDB (ex: `💰 ~125.000 NP`).
3. **Dupla Experiência de Configuração**:
   - **Atalho 1-Clique no itemDB**: Ao visitar qualquer lista sua ou de outro usuário no `itemdb.com.br`, um botão `⭐ Destacar esta lista nas Lojas do Neopets` aparece no cabeçalho. Um clique e a lista já está ativa!
   - **Widget Flutuante no Neopets**: Em qualquer loja do Neopets, um widget discreto no canto inferior direito permite abrir o painel, colar uma URL, verificar o número de itens ou forçar a atualização.
4. **Desempenho Instantâneo (0ms de atraso)**:
   - Os dados são baixados uma única vez e armazenados localmente (`Cache-First`). Ao navegar pelas lojas de restock, a verificação é instantânea na memória do navegador.
5. **Compatível com Ambientes Moderno e Clássico**:
   - Suporte completo às interfaces modernas (`.shop-item`, `.bsp-item`) e clássicas (`haggle.phtml`, tabelas antigas) do Neopets.

---

## 🚀 Como Usar

### Passo 1: Instalação
1. Certifique-se de que possui a extensão [Tampermonkey](https://www.tampermonkey.net/) instalada no seu navegador.
2. Clique no link direto: **[Instalar Script (Raw)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-itemdb-list-highlighter/neopets-itemdb-list-highlighter.user.js)**.
3. Confirme a instalação no Tampermonkey.

### Passo 2: Escolher e Ativar sua Lista
Você pode ativar sua lista de duas maneiras super simples:

* **Método 1 (Direto pelo itemDB - Recomendado):**
  1. Acesse qualquer lista pública no itemDB (ex: `https://itemdb.com.br/pt/lists/nana/yay-focus-missing-stamps-scarabs-space-coins-shells`).
  2. Clique no botão roxo **`⭐ Destacar esta lista nas Lojas do Neopets`** no topo da página.
  3. Pronto! Ela já foi gravada no script.

* **Método 2 (Dentro de qualquer loja no Neopets):**
  1. Abra qualquer loja oficial ou de usuário no Neopets.
  2. No canto inferior direito, clique no widget `[ 📋 itemDB: ... ]`.
  3. Cole o link da sua lista do itemDB e clique em **Importar Lista**.

### Passo 3: Boas Compras!
- Ao visitar qualquer loja oficial (como Kauvara's Magic Shop, Chocolate Factory, Post Office) ou lojas de usuários, os itens da sua lista serão imediatamente destacados com a tag `★ ITEMDB` e estimativa de preço.

---

## ⚙️ Opções Personalizáveis

No painel de configurações (clicando no widget no Neopets), você pode:
* Alternar destaque em Lojas Oficiais (`objects.phtml`).
* Alternar destaque em Lojas de Usuários (`browseshop.phtml`).
* Ativar ou ocultar as tags com estimativa de preço em NP.
* Trocar ou remover a lista ativa a qualquer momento.

