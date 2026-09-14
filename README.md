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

Para conectar ao backend local, abra `http://localhost:5173/?server=ws://localhost:8080`. Sem configuração, o menu usa o endereço remoto definido em `src/main.js`. Em produção, abra **Configurar servidor** ou use `?server=wss://jogo.seudominio.com/ws`.

## Controles e validação

- **WASD / setas**: movimento; ataques são automáticos.
- **Esc / botão Ⅱ**: pausa e retoma a partida offline. Trocar de janela pausa automaticamente.
- **Novo poder**: no modo offline, a simulação espera sua escolha.
- **Observar aliados**: após cair no co-op, acompanhe um sobrevivente até o ritual terminar.
- **Celular**: use o controle virtual; cancelar o toque interrompe o movimento.

Execute `npm test` para validar a simulação e o protocolo WebSocket, e `npm run build` para gerar o frontend de produção.

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

## Salas e capacidade da VPS

A tela inicial consulta as salas abertas ao carregar e a cada 10 segundos enquanto o menu está ativo e a aba visível. Partidas em andamento com vagas também aparecem; salas fechadas, cheias ou encerradas ficam fora da lista pública.

O backend usa **`MAX_ROOMS=3` por padrão**, com até quatro jogadores por sala (12 jogadores no total). O limite inclui salas abertas e fechadas, em espera, em andamento ou encerradas ainda ocupadas. Ao atingir o limite, novas criações são recusadas com uma mensagem; entrar em uma sala existente continua permitido. A vaga é liberada quando o último jogador desconecta.

Esse valor é um ponto de partida conservador para a VPS informada (1 vCPU, 460 MiB de RAM e cerca de 249 MiB disponíveis), e não uma capacidade garantida por teste de carga. A swap não deve ser tratada como RAM adicional para dimensionar partidas. Meça CPU, memória e latência na própria VPS antes de aumentar o limite.

No aaPanel, configure as variáveis de ambiente `MAX_ROOMS=3` e `PORT=8080` no processo Node e reinicie. O código usa a porta 8081 quando `PORT` não está definido. Use apenas uma instância do backend: as salas e o limite são mantidos em memória por processo. `MAX_ROOMS` deve ser um inteiro positivo.

Para aplicar esta correção em produção, publique o frontend atualizado e atualize/reinicie o backend na VPS.

## Escopo atual

- Movimento por teclado e controle virtual no celular
- Ataque automático, hordas, experiência, níveis e vida
- Morte real, tela de derrota e espectador no co-op
- Escolha entre três poderes a cada nível
- Dificuldade progressiva com limites de entidades e drops temporários
- Offline sem servidor
- Salas co-op por código com servidor autoritativo
- Atlas de sprites WebP e PNG com transparência
- Campanha de três fases, seis inimigos temáticos e três chefes

## Campanha

| Fase | Chão e inimigos | Chefe |
| --- | --- | --- |
| Bosque Desperto | Terra e musgo, cogumelos e besouros de espinhos | Raiz Ancestral: impacto em área ao redor do chefe |
| Cripta Glacial | Lajes congeladas, esqueletos e espectros | Rei do Inverno: explosão marcada na posição de um jogador |
| Abismo de Brasas | Basalto e fissuras, diabretes e escorpiões | Coração da Caldeira: três áreas de explosão simultâneas |

Cada horda dura **300 segundos de simulação**. Ao completar esse tempo, os inimigos comuns dão lugar ao chefe. A próxima fase começa somente após derrotá-lo, com uma passagem de quatro segundos e cura de 35% da vida máxima para sobreviventes. Níveis e poderes são preservados. O tempo dos chefes e das passagens é adicional aos 15 minutos de hordas; pausa e escolha de poder offline congelam a simulação. A derrota do terceiro chefe concede vitória ao grupo.

Ataques especiais têm aviso de 1,3 segundo: saia do círculo antes de ele se preencher. Chefes não expiram pela limpeza de entidades e sua vida escala com o número de sobreviventes no momento da invocação. Jogadores derrotados continuam como espectadores.

O servidor mantém os limites de entidades, com no máximo 12 áreas de ataque, e interrompe o timer após vitória ou derrota. Os pisos são pequenos tiles gerados uma vez no navegador; o atlas novo também é carregado apenas no cliente. Isso não substitui um teste de carga na VPS de 1 CPU/500 MB.

Arte: `public/assets/phases.png`, gerada com a ferramenta integrada de imagens. Prompt e mapeamento em `public/assets/phases-art.md`. Regras e balanceamento em `server/phases.js`; texturas de chão em `src/terrain.js`.

Para atualizar o co-op, publique o frontend e atualize também os arquivos da pasta `server`, incluindo `phases.js`, reiniciando o processo Node. Um backend antigo não executa a campanha nova.

Próximas evoluções naturais: novas armas, persistência, reconexão e ressurreição cooperativa.
