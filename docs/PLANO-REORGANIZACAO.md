# Plano de reorganização gradual — Mesa de Roteiro

**Status:** Etapa 1 (extração do CSS) aplicada na branch de desenvolvimento; validação funcional visual/offline ainda pendente.
**Branch de trabalho:** `desenvolvimento/organizacao-codigo`
**Referência inicial da `main`:** `7a7ab476877bd64c86aba5e1b6f67f0d02b84725` (22/11/2026).
**Objetivo:** tornar o código mais fácil de manter sem alterar funcionalidades, aparência, dados persistidos ou o site publicado.

## Diagnóstico inicial (versão da main em 22/11/2026)

- `index.html` tem aproximadamente 9.915 linhas e ~706 KiB; inclui HTML, CSS inline e vários blocos JavaScript inline.
- `style.css` existe na raiz, mas **não é referenciado** pelo `index.html` atual. Não assumir que é idêntico ao CSS inline.
- `sw.js` mantém cache offline próprio e lista explicitamente o app shell: `./`, `index.html`, manifest e ícones.
- `manifest.webmanifest` descreve o aplicativo instalável.
- O código de aplicação inclui editor de desenho, camadas e páginas, obras/capítulos/notas, localStorage/IndexedDB, recuperação de dados, Supabase e Cloudflare R2.

## Regras de segurança

1. **Não alterar a `main`** durante a reorganização. Trabalhar em commits pequenos na branch de desenvolvimento.
2. Antes de testar importação/restauração, exportar e guardar **um backup local externo** e executar testes em dados fictícios; não apagar ou migrar dados reais do navegador.
3. Não modificar nomes de chaves de armazenamento, esquema IndexedDB, contratos de backup, caminhos de nuvem, autenticação nem políticas de acesso por simples refatoração.
4. Não colocar credenciais privadas no GitHub; manter apenas identificadores e chaves explicitamente publicáveis no cliente, com controles de segurança no servidor.
5. Preservar a ordem e o escopo de inicialização dos scripts. O código atual usa IIFEs e scripts clássicos; separar arquivos não pode alterar dependências implícitas.
6. Não publicar a branch nem fazer merge automático. Antes de mesclar, revisar diff, validar offline/PWA e executar testes manuais e automatizados disponíveis.

## Etapa 0 — Proteção e linha de base

- [ ] Registrar quais arquivos e recursos compõem a versão que funciona.
- [ ] Criar checklist de verificação de: iniciar site, criar/renomear/excluir obra, capítulos/páginas, abrir editor, desenhar, salvar/reabrir, camadas, notas, exportar, backup local, sessão nuvem, upload/download e uso offline.
- [ ] Criar dados de exemplo **isolados** para testar backup e recuperação.
- [ ] Verificar como a publicação GitHub Pages está configurada antes de qualquer merge.
- [ ] Definir padrão para confirmar que uma mudança preserva o comportamento anterior.

**Critério de saída:** linha de base e procedimentos de recuperação documentados; nenhuma operação destrutiva em dados reais.

## Etapa 1 — Extrair CSS com equivalência visual

- [x] Comparar o `<style>` do `index.html` com o `style.css` que já existe. Resultado: diferentes; CSS inline foi mantido literalmente.
- [x] Escolher o CSS realmente usado como fonte de verdade; não substituir por um arquivo antigo sem conferência.
- [x] Mover CSS usado para `styles/app.css` (ou consolidar em `style.css`, após verificar equivalência).
- [x] Atualizar a referência do HTML e a lista de arquivos offline do `sw.js`; incrementar versão do cache.
- [ ] Validar desktop, celular, tema claro/escuro, editor e visualização offline.

**Critério de saída:** interface equivalente antes/depois; estilos carregam online e offline.

## Etapa 2 — Separar scripts sem alterar execução

Extrair **um bloco por vez**, preservando os scripts clássicos e sua ordem até remover dependências globais com segurança:

- [ ] `js/armazenamento-local.js`: adaptadores locais, controle de falhas e recuperação.
- [ ] `js/config-nuvem.js`: configuração pública (sem segredos).
- [ ] `js/editor-desenho.js`: implementação do editor e `window.EditorDesenho`.
- [ ] `js/app.js`: obras, capítulos, páginas, notas, interface e inicialização.
- [ ] Manter o SDK Supabase carregado antes dos trechos que dependem dele.
- [ ] Atualizar app shell/caches do service worker a cada extração e validar abertura offline.

**Critério de saída:** mesmos recursos e mesma ordem de execução; sem erros de JavaScript no console.

## Etapa 3 — Criar módulos internos claros

Depois que os blocos estiverem isolados e testados:

- [ ] Mapear APIs e dependências entre editor, biblioteca, persistência e sincronização.
- [ ] Dividir `js/app.js` por responsabilidades (obras/capítulos/páginas; notas e fichas; backup e nuvem; interface).
- [ ] Dividir `js/editor-desenho.js` em camadas, ferramentas/pincéis, renderização, interação e exportação.
- [ ] Evitar dependências circulares e globais novos; substituir gradualmente por interfaces estáveis.
- [ ] Não reescrever o projeto inteiro de uma vez, nem converter tudo para ES Modules no mesmo passo.

**Critério de saída:** arquivos com responsabilidades delimitadas e testes de regressão aprovados.

## Etapa 4 — Testes, desempenho e publicação controlada

- [ ] Adicionar checagens de sintaxe e testes automatizados para trechos puramente lógicos.
- [ ] Exercitar abertura de PWA, cache após atualização, edição offline e sincronização ao reconectar.
- [ ] Testar documentos pequenos e grandes, importação/exportação e recuperação após falha simulada, sempre com dados de teste.
- [ ] Comparar tempos de abertura e uso de memória com a linha de base, sem prometer ganhos antes das medições.
- [ ] Criar pull request para revisão; publicar apenas após aprovação explícita.

**Critério de saída:** nenhuma regressão conhecida; publicação deliberada na `main`.

## Estrutura-alvo indicativa (não criada ainda)

```text
roteiro-manga/
├── index.html
├── styles/
│   └── app.css
├── js/
│   ├── armazenamento-local.js
│   ├── config-nuvem.js
│   ├── editor-desenho.js
│   └── app.js
├── sw.js
├── manifest.webmanifest
├── icon-192-192-1.png
├── icon-512.png
└── docs/
    └── PLANO-REORGANIZACAO.md
```

A estrutura poderá ser refinada com o mapeamento das dependências. A ordem das etapas importa mais que os nomes dos arquivos.

## Primeiro trabalho recomendado

Executar a **Etapa 0**, depois fazer **apenas a extração do CSS** em um commit separado e conferir equivalência visual e cache offline antes de mexer no JavaScript.

> Este documento é apenas um plano de trabalho. A presença da branch não altera o site publicado, e os arquivos funcionais ainda não foram reorganizados.

## Registro de execução — 22/11/2026

- Criado `styles/app.css` com **os mesmos 89.157 caracteres** do bloco `<style>` que estava em `index.html`.
- Substituído o bloco por `<link rel="stylesheet" href="./styles/app.css">`, sem modificar o restante do HTML. A transformação foi comparada com o original e é reversível.
- Atualizado o `sw.js` para incluir `./styles/app.css` no cache offline, com nova versão `mesa-de-roteiro-local-v28-css-externo`.
- O antigo `style.css` foi mantido intocado para evitar perda de estilos; ainda não é utilizado pelo HTML.
- **Pendente:** testes de navegador, comparação visual, reabertura offline, atualização de PWA e regressão das telas principais. Não fazer merge na `main` até isso ser confirmado.
- **Observação:** a Etapa 0 (backup dos dados reais no dispositivo do usuário e linha de base visual) ainda depende de validação no ambiente do usuário; essa tarefa não deve ser marcada como concluída.
