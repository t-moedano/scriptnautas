# 📚 Neopets: Rastreador de Livros & Marcador de Lojas

Script para Tampermonkey que rastreia os livros já lidos pelo seu Neopet e ajuda você a saber exatamente o que comprar nas lojas oficiais e de outros jogadores.

[![Instalar no Tampermonkey](https://img.shields.io/badge/Instalar%20com%201--Clique-Tampermonkey-brightgreen?style=for-the-badge&logo=tampermonkey)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js)

---

## ✨ Funcionalidades

1. **Sincronização Dupla de Abas**:
   - Salva os livros lidos comuns (`books_read.phtml`).
   - Salva os livros Booktastic de Kreludor (`books_read.phtml?tab=booktastic`).
2. **Lojas Oficiais de Livros**:
   - Destaca itens **não lidos** com borda verde brilhante e tag `⭐ NÃO LIDO`.
   - Marca itens **já lidos** com transparência e tag `✓ Lido`.
3. **Lojas de Usuários (`browseshop.phtml`)**:
   - **Filtro seguro**: escurece apenas os itens que você **tem certeza que já leu**. Não altera nem esconde itens não lidos (pois poderiam ser pelúcias, comidas, etc.).
   - Suporta busca interna e paginação AJAX da loja sem precisar recarregar a página.
4. **Atualizações Automáticas**:
   - O Tampermonkey checa o repositório diretamente e atualiza o script sem você precisar reinstalar.

---

## 🚀 Como Usar

### Passo 1: Instalação
1. Certifique-se de que a extensão [Tampermonkey](https://www.tampermonkey.net/) está instalada no seu navegador.
2. Clique no link direto: **[Instalar Script (Raw)](https://raw.githubusercontent.com/t-moedano/scriptnautas/main/scripts/neopets-book-tracker/neopets-book-tracker.user.js)**.
3. O Tampermonkey abrirá a tela de confirmação; clique em **Instalar** (ou *Confirmar Instalação*).

### Passo 2: Sincronizar seus Livros Lidos
1. Visite a página de livros lidos do seu Neopet:
   `https://www.neopets.com/books_read.phtml?pet_name=SEU_PET`
   *(Você verá um aviso verde no topo confirmando os livros lidos salvos)*.
2. Em seguida, clique na aba **Booktastic Books**:
   `https://www.neopets.com/books_read.phtml?pet_name=SEU_PET&tab=booktastic`
   *(O script salvará também os livros especiais de Kreludor)*.

### Passo 3: Fazer Compras
- Acesse qualquer loja oficial de livros ou qualquer loja de usuários.
- No canto inferior direito da tela aparecerá um distintivo mostrando o pet ativo e quantos livros estão sincronizados.

---

## 🏪 Lojas Oficiais Homologadas

O destaque completo funciona automaticamente nas seguintes lojas oficiais de livros:
* **Magical Bookshop** (Loja #7 - Neopia Central)
* **Faerieland Bookshop** (Loja #38 - Faerieland)
* **Sutek's Scrolls** (Loja #51 - Lost Desert)
* **Booktastic Books** (Loja #70 - Kreludor)
* **Brightvale Books** (Loja #77 - Brightvale)
* **Words of Antiquity** (Loja #92 - Shenkuu)
* **Neovian Printing Press** (Loja #106 - Neovia)
* **Moltaran Books** (Loja #114 - Moltara)
