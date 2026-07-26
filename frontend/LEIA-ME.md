# Bancada — projeto frontend (React)

## Mudou desde a última versão
Agora o login e a sessão dependem da API PHP real (pasta `api/` na raiz da
entrega). Isso significa que **`npm run dev` sozinho não abre mais o sistema**
— a tela de login vai ficar tentando falar com `/api/auth.php`, que só existe
depois que a API estiver publicada em algum lugar (o HostGator, no seu caso).

Na prática, o jeito mais direto de testar agora é publicar `api/` e o build
deste frontend no mesmo domínio (os.laxis.com.br) e testar direto lá — veja
`README-DEPLOY.md` na raiz da entrega.

Se ainda assim quiser rodar localmente durante o desenvolvimento (só a
interface, sem backend de verdade ainda funcionando), seria necessário um
servidor PHP+MySQL local (ex: XAMPP/MAMP) rodando a pasta `api/` também — não
é o caminho mais rápido; prefira testar direto no domínio publicado.

## Gerando o build para publicar
1. `npm install` (uma vez)
2. `npm run build` — gera a pasta `dist`
3. Envie o **conteúdo** da pasta `dist` para `public_html` no HostGator
   (a pasta `api` fica ao lado, também dentro de `public_html`)

## Sobre o `src/storage-shim.js`
Ainda existe e ainda é usado — clientes, equipamentos, ordens de serviço etc.
continuam salvando via `window.storage` por enquanto (isso é a próxima etapa
de migração para a API). Só login/logout/usuários já passam pela API PHP.
Não remova esse arquivo ainda.

## Quando eu (Claude) atualizar o `bancada.jsx` de novo
Basta substituir o conteúdo de `src/App.jsx` pelo novo arquivo.
