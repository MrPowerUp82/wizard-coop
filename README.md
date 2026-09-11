# Arcana Survivors

MVP web de um survival roguelite cooperativo para 1–4 jogadores. O cliente estático funciona no GitHub Pages; o servidor WebSocket roda separadamente em Node.js na VPS.

## Desenvolvimento

```bash
npm install
npm run dev
```

Em outro terminal:

```bash
npm run server
```

O menu usa `ws://localhost:8080` por padrão. Em produção, abra **Configurar servidor** ou use `?server=wss://jogo.seudominio.com/ws`.

## Publicar o frontend no GitHub Pages

1. Suba o repositório no GitHub.
2. Em **Settings → Pages**, selecione **GitHub Actions**.
3. O workflow incluso compila e publica o diretório `dist`.
4. Defina a URL WebSocket no menu. Ela fica salva no navegador.

## Backend na VPS com aaPanel

1. Instale Node.js 20+ pelo **Node Project Manager** do aaPanel.
2. Envie o projeto e execute `npm ci --omit=dev`.
3. Crie um projeto Node com arquivo inicial `server/server.js` e porta `8080`.
4. Crie um domínio/subdomínio com SSL, por exemplo `jogo.seudominio.com`.
5. No proxy reverso, encaminhe `/ws` para `http://127.0.0.1:8080` com upgrade WebSocket habilitado.
6. No frontend use `wss://jogo.seudominio.com/ws`. GitHub Pages exige `wss://`, pois a página usa HTTPS.

Exemplo Nginx para o bloco `/ws`:

```nginx
location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
}
```

## Escopo atual

- Movimento por teclado e controle virtual no celular
- Ataque automático, hordas, experiência, níveis e vida
- Morte real, tela de derrota e espectador no co-op
- Escolha entre três poderes a cada nível
- Dificuldade progressiva com limites de entidades e drops temporários
- Offline sem servidor
- Salas co-op por código com servidor autoritativo
- Sprites WebP em atlas

Próximas evoluções naturais: chefes, novas armas, persistência, reconexão e ressurreição cooperativa.
