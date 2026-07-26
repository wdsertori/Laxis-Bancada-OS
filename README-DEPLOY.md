# Como publicar no HostGator (cPanel)

## 1. Banco de dados
1. cPanel → **MySQL® Databases** → crie um banco (ex: `bancada`) e um usuário, e
   vincule o usuário ao banco com **todas as permissões**.
   O HostGator vai prefixar os nomes automaticamente (ex: `seuusuario_bancada`).
2. cPanel → **phpMyAdmin** → selecione o banco criado → aba **Importar** →
   selecione o arquivo `schema.sql` → Executar.
3. Confirme que 9 tabelas foram criadas (`usuarios`, `clientes`, `equipamentos`,
   `tipos_equipamento`, `ordens`, `ordens_fotos`, `pecas_catalogo`,
   `configuracoes`, `logs`).

## 2. Arquivos da API
1. Copie `api/config/database.example.php` para `api/config/database.php`
   (mesma pasta, **sem** o ".example" no nome) e preencha `DB_NAME`, `DB_USER`,
   `DB_PASS` com os dados criados no passo 1.
2. Envie a pasta `api` inteira para `public_html/api` via FTP ou o Gerenciador
   de Arquivos do cPanel.
3. Confirme que `api/uploads/ordens/` existe e tem permissão de escrita
   (chmod 755 costuma bastar no HostGator).

## 3. Primeiro usuário
1. Abra `https://os.laxis.com.br/api/setup-admin.php` no navegador uma vez.
2. Deve aparecer "Usuário gestão criado com sucesso".
3. **Apague o arquivo `api/setup-admin.php` do servidor** (ele fica com uma
   senha fixa no código — não deixe publicado).
4. Faça login no sistema com o e-mail/senha que você definiu nesse arquivo
   antes de rodá-lo, e troque a senha depois pela tela de usuários.

## 4. Front-end (React)
Ainda vou te mandar a versão do `bancada.jsx` adaptada para consumir essa API
(isso é a segunda entrega, depois que você confirmar que os passos acima
funcionaram). Quando chegar essa versão:
1. Gere o build: `npm run build` na pasta do projeto (gera uma pasta `dist`).
2. Envie o **conteúdo** da pasta `dist` para `public_html` (na raiz, ao lado
   da pasta `api`) — não a pasta `dist` em si, o conteúdo dela.

## 5. Testando a API sozinha (antes do front)
Com um app tipo Postman/Insomnia, ou até `curl`:
```
curl -i -X POST https://os.laxis.com.br/api/auth.php \
  -H "Content-Type: application/json" \
  -d '{"email":"gestao@laxis.com.br","senha":"sua-senha"}' \
  -c cookies.txt

curl -i https://os.laxis.com.br/api/clientes.php -b cookies.txt
```
Se o segundo comando retornar a lista de clientes (vazia no início), a
autenticação e a sessão estão funcionando.

## Problemas comuns
- **Erro 500 em tudo**: geralmente é `api/config/database.php` com dado
  errado, ou o arquivo não foi criado (só existe o `.example`).
- **"Sessão expirada" mesmo logo após login**: confira se o site está com
  HTTPS ativo (cPanel → SSL/TLS Status) — o cookie de sessão é marcado como
  seguro automaticamente quando há HTTPS.
- **Erro ao subir foto**: confira permissão de escrita da pasta
  `api/uploads/ordens`.
