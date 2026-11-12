# Nossa Call

Call de voz + compartilhamento de tela privados, 100% P2P (WebRTC + PeerJS), sem backend. PWA instalável.

## Publicar no GitHub Pages
1. Crie um repositório e envie todos os arquivos desta pasta para a raiz.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. Acesse `https://SEU-USUARIO.github.io/NOME-DO-REPO/?room=nosso-codigo`.

## Usar como app
- Chrome/Edge (PC e Android): botão **Instalar como app** ou ícone de instalar na barra de endereço.
- iPhone: Safari → Compartilhar → **Adicionar à Tela de Início**.

## Ajustes
- Bitrate: slider em Config; limite do slider em `index.html` (`#brRange`), aplicado em `applyBitrate()` no `app.js`.
- TURN (caso uma rede bloqueie P2P): adicione em `ICE` no `app.js`.
- Ao alterar arquivos, mude `V` em `sw.js` (ex.: `nossa-call-v2`) para forçar atualização do cache.

## Observações
- Áudio do sistema na tela compartilhada: Chrome/Edge no Windows.
- Compartilhar tela não existe em navegadores de celular (só assistir e falar).
