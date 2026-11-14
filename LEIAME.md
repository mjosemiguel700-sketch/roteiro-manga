# Mesa de Roteiro — estrutura

    index.html                     estrutura da página (sem CSS/JS embutidos)
    style.css                      estilos (idêntico ao original)
    js/01-armazenamento.js         armazenamento local (idêntico)
    js/02-config-nuvem.js          URL e chave publicável do Supabase
    js/05-cofre-backup.js          NOVO: cifragem da cópia na nuvem
    js/03-app.js                   editor de desenho, canetas, personalização (idêntico ao original)
    js/04-app-nuvem-e-tela.js      telas, notas, backup e nuvem (alterado só na parte de nuvem/backup)
    js/06-registro-sw.js           registro do service worker
    js/vendor/supabase-js-2.118.0.umd.js   biblioteca do Supabase, versão fixa e local
    supabase/politicas-arquivos.sql        políticas do bucket (pode rodar mais de uma vez)
    sw.js, manifest.webmanifest, icon-*.png

## Cópia na nuvem cifrada
A cópia enviada ao Supabase é cifrada no navegador (AES-GCM, chave PBKDF2-SHA256, 310.000 iterações)
com uma **senha de backup separada da senha da conta**. Sem essa senha a cópia não pode ser aberta.
Guarde-a fora do computador. O backup manual (.json baixado) continua como antes.

## Ao publicar
1. Execute `supabase/politicas-arquivos.sql` no SQL Editor e confirme que o bucket `mesa-arquivos` é privado.
2. Envie todos os arquivos deste ZIP para o GitHub Pages (mantendo as pastas).
