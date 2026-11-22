
(function(){
"use strict";


/* ========== escolhas de composição ========== */
var ENQUADRAMENTOS = [
  "", "Estabelecimento", "Ação", "Diálogo", "Reação", "Detalhe",
  "Transição", "Silhueta", "Página dupla"
];
var DISTANCIAS = [
  "", "Muito distante", "Distante", "Média distância", "Próxima", "Muito próxima"
];
var PLANOS = [
  "", "Plano geral", "Plano conjunto", "Plano inteiro", "Plano americano",
  "Plano médio", "Primeiro plano", "Close", "Close extremo", "Detalhe"
];
var ANGULOS_CAMERA = [
  "", "Nível dos olhos", "Plongée (de cima)", "Contra-plongée (de baixo)",
  "Sobre o ombro", "Ponto de vista", "Ângulo holandês", "Vista aérea"
];
var TIPOS_BALAO = [
  ["fala","Fala"], ["pensamento","Pensamento"], ["grito","Grito"],
  ["off","Fora de quadro"], ["sussurro","Sussurro"], ["narracao","Narração"]
];
var ROTULO_BALAO = {
  fala:"", pensamento:"(pensamento)", grito:"(grito)", off:"(fora de quadro)",
  sussurro:"(sussurro)", narracao:"NARRAÇÃO"
};

/* tamanhos de painel (definidos no editor de desenho) */
var TAMANHOS=window.EditorDesenho.TAMANHOS, ORDEM_TAM=window.EditorDesenho.ORDEM;
var bdLer=window.EditorDesenho.bdLer, bdGravar=window.EditorDesenho.bdGravar, bdApagar=window.EditorDesenho.bdApagar, bdListar=window.EditorDesenho.bdListar;
function nomeTamanho(ch){ return TAMANHOS[ch]?TAMANHOS[ch].nome:""; }
function opcoesTamanho(valor){
  return '<option value=""'+(valor?"":" selected")+'>Escolha o tamanho</option>'+
    ORDEM_TAM.map(function(k){
      return '<option value="'+k+'"'+(valor===k?" selected":"")+'>'+esc(TAMANHOS[k].nome+" ("+TAMANHOS[k].razao+")")+'</option>';
    }).join("");
}

/* ========== estado ========== */
var db=null, dbLocal=null, baixador=null, base="roteiros/local", baseLocal="roteiros/local", contaNuvemPronta=false;
var obras=[], caps=[], obraAtual=null, capAtual=null, doc=null;
var pendente=null, salvando=false, sujo=false, revisaoCapitulo=0;
var notas=[], notaAtual=null, modoNotas=false;
var MARCA_NOTA={notaId:null,termo:"",faixas:[],indice:0,cursor:null};
var desenhosLivres=[];
var pendenteNota=null, salvandoNota=false, notaSuja=false, revisaoNota=0;
var acaoTextoAtiva=false, textosVolateis=false;
var modoLeitura=false;
var BIBLIOTECA_TEXTOS_OK=false,DESENHOS_LIVRES_LIDOS=false,FALHAS_LEITURA_LOCAL=Object.create(null),CACHE_CONSULTA=null,RECUPERACAO_INICIAL=true;
var LEITURA={zoom:100,base:420};

var el=function(id){return document.getElementById(id);};
var tela=el("tela"), estado=el("estado");

function id(p){return p+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}

var STATUS_CAP={roteiro:"Roteiro",rascunho:"Rascunho",desenhando:"Desenhando",finalizado:"Finalizado"};
function statusCapitulo(valor){ return STATUS_CAP[valor]?valor:"roteiro"; }
function progressoCapitulo(valor){ valor=parseInt(valor,10); return isNaN(valor)?0:Math.max(0,Math.min(100,valor)); }
function opcoesStatusCap(valor){ valor=statusCapitulo(valor); return Object.keys(STATUS_CAP).map(function(k){return '<option value="'+k+'"'+(k===valor?' selected':'')+'>'+STATUS_CAP[k]+'</option>';}).join(""); }
function seloCapitulo(valor){ valor=statusCapitulo(valor); return '<span class="cap-selo status-'+valor+'">'+esc(STATUS_CAP[valor])+'</span>'; }
function tagsNota(valor){
  var lista=Array.isArray(valor)?valor:String(valor||"").split(/[,;\n]+/), vistos=Object.create(null), saida=[];
  lista.forEach(function(item){ item=String(item||"").trim().replace(/^#+/,'').trim(); var chave=normalizarBuscaNota(item); if(item&&!vistos[chave]){vistos[chave]=true;saida.push(item);} });
  return saida;
}
function textoTags(valor){ return tagsNota(valor).join(", "); }
function htmlTags(valor,idNota){var lista=tagsNota(valor),nid=idNota||notaAtual,n=notaObj(nid),imagens=n&&notaSomenteImagens(n);return lista.length?'<div class="nota-tags" aria-label="Etiquetas">'+lista.map(function(t){var ativa=MARCA_NOTA.notaId===nid&&normalizarBuscaNota(t)===normalizarBuscaNota(MARCA_NOTA.termo);return '<button type="button" class="nota-tag" data-nota-tag="'+esc(t)+'" data-nota-tag-id="'+esc(nid||"")+'" aria-pressed="'+ativa+'" title="Grifar e ir até esta etiqueta no texto da nota"'+(imagens?' disabled':'')+'>#'+esc(t)+'</button>';}).join("")+'</div>':"";}
function horaCurta(valor){ try{return new Date(valor).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});}catch(e){return "agora";} }
function erroLeituraLocal(mensagem){var e=new Error(mensagem||"Não foi possível ler os textos ou metadados locais. Preserve seus backups e tente novamente sem apagar dados.");e.code="leitura_local";return e;}
function registrarFalhaLocal(grupo,mensagem){FALHAS_LEITURA_LOCAL[grupo]=mensagem;atualizarFalhasLocais();}
function limparFalhaLocal(grupo){delete FALHAS_LEITURA_LOCAL[grupo];atualizarFalhasLocais();}
function atualizarFalhasLocais(){var box=el("avisoLeituraLocal"),texto=el("textoLeituraLocal");if(!box||!texto)return;var lista=Object.keys(FALHAS_LEITURA_LOCAL);box.classList.toggle("oculto",!lista.length);texto.textContent=lista.map(function(k){return FALHAS_LEITURA_LOCAL[k];}).join(" ");}
function lerJsonLocal(chave){
  var bruto;
  try{var ar=window.__mesaArmazenamento;bruto=ar&&ar.lerValor?ar.lerValor(chave):window.localStorage.getItem("mesa:"+chave);if(bruto===null)return{existe:false,valor:null};return{existe:true,valor:JSON.parse(bruto)};}catch(e){throw erroLeituraLocal();}
}
function lerMetaLocal(chave){return lerJsonLocal(chave).valor;}
function lerListaEssencial(chave){
  var l=lerJsonLocal(chave);if(!l.existe)return[];var lista=l.valor,vistos=Object.create(null);
  if(!Array.isArray(lista))throw erroLeituraLocal("Uma biblioteca local contém dados inválidos. Ela foi preservada sem substituição.");
  lista.forEach(function(v){
    if(!v||typeof v!=="object"||Array.isArray(v)||!((typeof v.id==="string"&&v.id)||(typeof v.id==="number"&&isFinite(v.id)))||vistos[String(v.id)])throw erroLeituraLocal("Uma biblioteca local contém registros inválidos ou repetidos. Ela foi preservada sem substituição.");
    vistos[String(v.id)]=true;
    if(chave==="desenhos-livres"&&typeof v.titulo!=="string")throw erroLeituraLocal();
    if(chave==="fichas-personagem-v1"){
      if(v.notas!=null&&(typeof v.notas!=="object"||Array.isArray(v.notas)))throw erroLeituraLocal();
      if(v.imagens!=null&&!Array.isArray(v.imagens))throw erroLeituraLocal();
      var imgs=Object.create(null);(v.imagens||[]).forEach(function(im){if(!im||typeof im!=="object"||!im.id||imgs[String(im.id)])throw erroLeituraLocal();imgs[String(im.id)]=true;});
    }
  });return lista;
}
function gravarMetaLocal(chave,valor,restauracaoConfirmada){
  try{
    if(chave==="desenhos-livres"||chave==="fichas-personagem-v1"){
      if(!restauracaoConfirmada)lerListaEssencial(chave);
      else{var fonte=window.__mesaArmazenamento;if(fonte&&fonte.lerValor)fonte.lerValor(chave);else window.localStorage.getItem("mesa:"+chave);}
    }
    var ar=window.__mesaArmazenamento;if(ar&&ar.gravarValor)ar.gravarValor(chave,JSON.stringify(valor));else window.localStorage.setItem("mesa:"+chave,JSON.stringify(valor));return true;
  }catch(e){return false;}
}
function carregarDesenhosLivres(){
  try{var lista=lerListaEssencial("desenhos-livres").map(function(x){var v=dadosProfundos(x);v.id=String(x.id);return v;});lista.sort(function(a,b){return (b.atualizadoEm||0)-(a.atualizadoEm||0);});desenhosLivres=lista;DESENHOS_LIVRES_LIDOS=true;limparFalhaLocal("livres");return true;}
  catch(e){DESENHOS_LIVRES_LIDOS=false;registrarFalhaLocal("livres","Não foi possível ler a lista de desenhos livres; ela não será substituída por uma lista vazia.");throw e;}
}
function garantirDesenhosLivresLidos(){if(!DESENHOS_LIVRES_LIDOS)carregarDesenhosLivres();}
function salvarDesenhosLivres(restauracaoConfirmada){
  if(!restauracaoConfirmada)garantirDesenhosLivresLidos();
  if(!gravarMetaLocal("desenhos-livres",desenhosLivres,restauracaoConfirmada)){registrarFalhaLocal("livres","A lista de desenhos livres não foi salva. A versão anterior foi preservada; tente novamente.");return false;}
  DESENHOS_LIVRES_LIDOS=true;limparFalhaLocal("livres");agendarBackupNuvem();return true;
}
/* ========== fichas visuais de personagens ========== */
var FICHAS={lista:null,atual:null,escopo:null,aba:"vistas",janela:null,zoom:null,importando:false};
var FICHA_ABAS=[["geral","Geral"],["vistas","Vistas"],["expressoes","Expressões"],["roupas","Roupas"],["detalhes","Detalhes"]];
function normalizarFichaPersonagem(v){
  if(!v||typeof v!=="object"||!v.id)return null;
  var notasBrutas=v.notas||{},notasFicha=dadosProfundos(notasBrutas);FICHA_ABAS.forEach(function(a){notasFicha[a[0]]=String(notasBrutas[a[0]]||"").slice(0,20000);});
  var vistos=Object.create(null),imagens=(Array.isArray(v.imagens)?v.imagens:[]).filter(function(im){if(!im||!im.id||vistos[im.id])return false;vistos[im.id]=true;return true;}).map(function(im){return Object.assign(dadosProfundos(im),{id:String(im.id),nome:String(im.nome||"Referência").slice(0,160),aba:FICHA_ABAS.some(function(a){return a[0]===im.aba;})?im.aba:"vistas",vista:String(im.vista||"Livre").slice(0,30),retirada:!!im.retirada});});
  return Object.assign(dadosProfundos(v),{id:String(v.id),nome:String(v.nome||"Sem nome").trim().slice(0,80)||"Sem nome",obraId:v.obraId?String(v.obraId):null,notas:notasFicha,imagens:imagens,arquivada:!!v.arquivada,atualizadoEm:+v.atualizadoEm||Date.now()});
}
function fichasLer(){
  if(!FICHAS.lista){try{var lista=lerListaEssencial("fichas-personagem-v1").map(normalizarFichaPersonagem);if(lista.some(function(v){return!v;}))throw erroLeituraLocal();FICHAS.lista=lista;limparFalhaLocal("fichas");}catch(e){registrarFalhaLocal("fichas","Não foi possível ler as fichas; a biblioteca existente foi preservada.");throw e;}}
  return FICHAS.lista;
}
function fichaAtual(){return fichasLer().filter(function(f){return f.id===FICHAS.atual;})[0]||null;}
function fichaStatus(texto,erro){if(!FICHAS.janela)return;var st=FICHAS.janela.querySelector("[data-ficha-status]");if(st){st.textContent=texto;st.classList.toggle("erro",!!erro);}}
function fichasGravar(){
  try{if(!gravarMetaLocal("fichas-personagem-v1",fichasLer()))throw erroLeituraLocal();FICHAS.pendente=false;limparFalhaLocal("fichas");agendarBackupNuvem();fichaStatus("Salvo neste aparelho.");return true;}
  catch(e){FICHAS.pendente=true;registrarFalhaLocal("fichas","Há alterações de ficha ainda não salvas. Mantenha esta aba aberta e tente novamente.");fichaStatus("Não foi possível guardar a ficha. As alterações continuam nesta aba.",true);return false;}
}
function fichaImagemChave(fid,iid){return "ficha-imagem/"+fid+"/"+iid;}
function fichaCriar(nome,obraIdFicha){
  nome=String(nome||"").trim().slice(0,80);if(!nome){fichaStatus("Escreva o nome do personagem.",true);return null;}
  var existente=fichasLer().filter(function(f){return f.obraId===(obraIdFicha||null)&&f.nome.toLocaleLowerCase("pt-BR")===nome.toLocaleLowerCase("pt-BR");})[0];
  if(existente){existente.arquivada=false;FICHAS.atual=existente.id;fichasGravar();return existente;}
  var novo=normalizarFichaPersonagem({id:id("ficha"),nome:nome,obraId:obraIdFicha||null,notas:{},imagens:[]});fichasLer().push(novo);FICHAS.atual=novo.id;fichasGravar();return novo;
}
function montarFichasPersonagem(){
  if(FICHAS.janela)return;
  var janela=document.createElement("aside");janela.id="fichasPersonagemJanela";janela.className="fichas-janela oculto";janela.setAttribute("aria-label","Fichas visuais de personagens");
  janela.innerHTML='<header class="fichas-cab"><strong>Fichas de personagens</strong><button type="button" class="bt mini" data-ficha-fechar aria-label="Fechar fichas de personagens">×</button></header><div class="fichas-corpo"></div>';
  document.body.appendChild(janela);FICHAS.janela=janela;
  var zoom=document.createElement("div");zoom.className="fichas-zoom oculto";zoom.setAttribute("role","dialog");zoom.setAttribute("aria-label","Referência do personagem ampliada");zoom.innerHTML='<button type="button" class="bt" data-ficha-zoom-fechar>Fechar imagem</button><img alt="">';document.body.appendChild(zoom);FICHAS.zoom=zoom;
  janela.addEventListener("click",fichaClique);janela.addEventListener("input",fichaEntrada);janela.addEventListener("change",fichaMudanca);
  zoom.addEventListener("click",function(e){if(e.target===zoom||e.target.closest("[data-ficha-zoom-fechar]")){zoom.classList.add("oculto");zoom.querySelector("img").removeAttribute("src");}});
  janela.querySelector(".fichas-cab").addEventListener("pointerdown",function(e){
    if(e.button!==0||e.target.closest("button"))return;e.preventDefault();var cab=e.currentTarget,rc=janela.getBoundingClientRect(),sx=e.clientX,sy=e.clientY;cab.setPointerCapture(e.pointerId);
    function mover(ev){if(ev.pointerId!==e.pointerId)return;janela.style.left=Math.max(0,Math.min(window.innerWidth-janela.offsetWidth,rc.left+ev.clientX-sx))+"px";janela.style.top=Math.max(0,Math.min(window.innerHeight-48,rc.top+ev.clientY-sy))+"px";janela.style.right="auto";}
    function fim(){cab.removeEventListener("pointermove",mover);cab.removeEventListener("pointerup",fim);cab.removeEventListener("pointercancel",fim);}
    cab.addEventListener("pointermove",mover);cab.addEventListener("pointerup",fim);cab.addEventListener("pointercancel",fim);
  });
}
function renderFichasPersonagem(){
  if(!FICHAS.janela)return;var f=fichaAtual(),scope=FICHAS.escopo||"",lista=fichasLer().filter(function(x){return(x.obraId||"")===scope&&!x.arquivada;}),o=obras.filter(function(x){return x.id===scope;})[0],nomes=(o&&o.personagens||[]).filter(function(n){return !lista.some(function(x){return x.nome===n;});});
  var opt='<option value="">Geral / desenho livre</option>'+obras.map(function(x){return '<option value="'+esc(x.id)+'"'+(scope===x.id?' selected':'')+'>'+esc(x.titulo||"Sem título")+'</option>';}).join("");
  var selecao='<option value="">Escolher personagem…</option>'+lista.map(function(x){return '<option value="'+esc(x.id)+'"'+(f&&f.id===x.id?' selected':'')+'>'+esc(x.nome)+'</option>';}).join("")+nomes.map(function(n,i){return '<option value="criar:'+i+'">'+esc(n)+' · criar ficha</option>';}).join("");
  var retiradas=f?f.imagens.filter(function(im){return im.retirada;}):[],arquivadas=fichasLer().filter(function(x){return(x.obraId||"")===scope&&x.arquivada;});
  var conteudo=f?'<div class="fichas-abas" role="group" aria-label="Seções da ficha">'+FICHA_ABAS.map(function(a){return '<button type="button" class="bt mini" data-ficha-aba="'+a[0]+'" aria-pressed="'+(FICHAS.aba===a[0])+'">'+a[1]+'</button>';}).join("")+'</div><label>'+({geral:"Identidade, personalidade e proporções",vistas:"Frente, perfil e costas — detalhes para manter consistência",expressoes:"Expressões, olhos, boca e gestos",roupas:"Roupas, acessórios e cores",detalhes:"Cabelo, marcas e detalhes importantes"}[FICHAS.aba])+'<textarea data-ficha-notas aria-label="Anotações da ficha" rows="4" placeholder="Descreva o que você precisa lembrar ao desenhar…">'+esc(f.notas[FICHAS.aba])+'</textarea></label><div class="fichas-linha"><label style="flex:1;margin:0">Identificar imagens<select data-ficha-vista aria-label="Identificar as próximas imagens"><option>Frente</option><option>Perfil</option><option>Costas</option><option>Três quartos</option><option>Livre</option></select></label><button type="button" class="bt mini" data-ficha-adicionar'+(FICHAS.importando?' disabled':'')+'>+ Referências</button><input type="file" data-ficha-arquivos accept="image/*" multiple hidden></div><p class="fichas-dica">Toque na imagem para ampliar. As referências ficam nesta ficha, sem entrar no papel.</p><div class="fichas-grade" data-ficha-grade></div>'+(retiradas.length?'<details class="fichas-retiradas"><summary>Imagens retiradas ('+retiradas.length+')</summary>'+retiradas.map(function(im){return '<button class="bt mini" type="button" data-ficha-restaurar-imagem="'+esc(im.id)+'">Restaurar '+esc(im.nome)+'</button>';}).join("")+'</details>':'')+'<div class="fichas-linha"><button type="button" class="bt mini" data-ficha-arquivar>Arquivar ficha</button></div>':'<p class="fichas-vazio">Escolha um personagem ou crie uma ficha. Guarde vistas, expressões e roupas para consultar ao lado do desenho.</p>';
  FICHAS.janela.querySelector(".fichas-corpo").innerHTML='<label>Biblioteca<select data-ficha-escopo aria-label="Obra das fichas">'+opt+'</select></label><label>Personagem<select data-ficha-selecionar aria-label="Escolher ficha de personagem">'+selecao+'</select></label><div class="fichas-linha"><input type="text" data-ficha-nome maxlength="80" placeholder="Nome de outro personagem" aria-label="Nome do novo personagem"><button type="button" class="bt mini" data-ficha-criar>Criar ficha</button></div>'+conteudo+(arquivadas.length?'<details class="fichas-retiradas"><summary>Fichas arquivadas ('+arquivadas.length+')</summary>'+arquivadas.map(function(x){return '<button type="button" class="bt mini" data-ficha-restaurar="'+esc(x.id)+'">Restaurar '+esc(x.nome)+'</button>';}).join("")+'</details>':'')+'<p class="fichas-status" data-ficha-status role="status">Salvo neste aparelho. Incluído no backup completo.</p>';
  if(f)hidratarFichaImagens(f);
  if(FICHAS.pendente)fichaStatus("Não foi possível guardar a ficha. As alterações continuam nesta aba.",true);
}
async function hidratarFichaImagens(f){
  var host=FICHAS.janela.querySelector("[data-ficha-grade]"),aba=FICHAS.aba,lista=f.imagens.filter(function(im){return!im.retirada&&im.aba===aba;});if(!host)return;
  host.innerHTML=lista.length?lista.map(function(im){return '<figure class="fichas-imagem" data-ficha-imagem="'+esc(im.id)+'"><button type="button" class="fichas-visualizar" data-ficha-ampliar="'+esc(im.id)+'" aria-label="Ampliar '+esc(im.nome)+'">Carregando…</button><label>'+esc(im.vista)+'<input type="text" data-ficha-legenda="'+esc(im.id)+'" aria-label="Legenda da referência" maxlength="160" value="'+esc(im.nome)+'"></label><button type="button" class="bt mini" data-ficha-retirar-imagem="'+esc(im.id)+'">Retirar da ficha</button></figure>';}).join(""):'<p class="fichas-dica" style="grid-column:1/-1">Nenhuma referência nesta seção.</p>';
  for(var i=0;i<lista.length;i++){
    var rec=null,falhou=false;try{rec=await bdLer(fichaImagemChave(f.id,lista[i].id));}catch(e){falhou=true;}
    if(fichaAtual()!==f||FICHAS.aba!==aba||!host.isConnected)return;
    var btn=host.querySelectorAll("[data-ficha-ampliar]")[i];if(!btn)continue;
    if(falhou){btn.textContent="Falha ao ler. Reabra a ficha para tentar novamente.";continue;}
    if(rec&&/^data:image\//i.test(rec.src||"")){var img=document.createElement("img");img.alt=lista[i].nome;img.onerror=function(){if(this.isConnected)this.replaceWith(document.createTextNode("Não foi possível abrir esta imagem."));};img.src=rec.src;btn.textContent="";btn.appendChild(img);}
    else btn.textContent="Imagem referenciada não encontrada";
  }
}
function abrirFichasPersonagem(nome){
  try{
  montarFichasPersonagem();var jaAberta=!FICHAS.janela.classList.contains("oculto");if(!jaAberta)FICHAS.escopo=obraAtual||"";
  if(nome){var ficha=fichaCriar(nome,FICHAS.escopo);if(ficha)FICHAS.atual=ficha.id;}
  else if(!fichaAtual()||(fichaAtual().obraId||"")!==FICHAS.escopo){var prim=fichasLer().filter(function(f){return(f.obraId||"")===FICHAS.escopo&&!f.arquivada;})[0];FICHAS.atual=prim?prim.id:null;}
  var pai=document.fullscreenElement||document.body;if(FICHAS.janela.parentNode!==pai)pai.appendChild(FICHAS.janela);if(FICHAS.zoom.parentNode!==pai)pai.appendChild(FICHAS.zoom);
  FICHAS.janela.classList.remove("oculto");renderFichasPersonagem();
  }catch(e){mostrarFalhaFichas();}
}
function mostrarFalhaFichas(){montarFichasPersonagem();FICHAS.janela.classList.remove("oculto");FICHAS.janela.querySelector(".fichas-corpo").innerHTML='<p role="status">Não foi possível ler a biblioteca de fichas. Os dados existentes foram preservados.</p><button type="button" class="bt" data-ficha-reler>Tentar ler novamente</button>';}
function fecharFichasPersonagem(){if(FICHAS.janela)FICHAS.janela.classList.add("oculto");if(FICHAS.zoom){FICHAS.zoom.classList.add("oculto");FICHAS.zoom.querySelector("img").removeAttribute("src");}}
function fichaEntrada(e){var f=fichaAtual();if(!f)return;if(e.target.hasAttribute("data-ficha-notas")){f.notas[FICHAS.aba]=e.target.value;f.atualizadoEm=Date.now();fichasGravar();}else if(e.target.hasAttribute("data-ficha-legenda")){var iid=e.target.getAttribute("data-ficha-legenda"),im=f.imagens.filter(function(x){return x.id===iid;})[0];if(im){im.nome=e.target.value.slice(0,160);f.atualizadoEm=Date.now();fichasGravar();}}}
function fichaMudanca(e){
  var t=e.target;if(t.hasAttribute("data-ficha-escopo")){FICHAS.escopo=t.value;var primeiro=fichasLer().filter(function(f){return(f.obraId||"")===t.value&&!f.arquivada;})[0];FICHAS.atual=primeiro?primeiro.id:null;renderFichasPersonagem();}
  else if(t.hasAttribute("data-ficha-selecionar")){if(t.value.indexOf("criar:")===0){var o=obras.filter(function(x){return x.id===FICHAS.escopo;})[0],lista=fichasLer().filter(function(x){return(x.obraId||"")===FICHAS.escopo&&!x.arquivada;}),nomes=(o&&o.personagens||[]).filter(function(n){return!lista.some(function(x){return x.nome===n;});});fichaCriar(nomes[+t.value.slice(6)],FICHAS.escopo);}else FICHAS.atual=t.value||null;renderFichasPersonagem();}
  else if(t.hasAttribute("data-ficha-arquivos")){var arquivos=Array.prototype.slice.call(t.files||[]);t.value="";adicionarFichaImagens(arquivos);}
}
async function fichaClique(e){
  var b=e.target.closest("button");if(!b)return;
  if(b.hasAttribute("data-ficha-fechar")){fecharFichasPersonagem();return;}
  if(b.hasAttribute("data-ficha-reler")){abrirFichasPersonagem();return;}
  var f;try{f=fichaAtual();}catch(err){mostrarFalhaFichas();return;}
  if(b.hasAttribute("data-ficha-criar")){var nome=FICHAS.janela.querySelector("[data-ficha-nome]").value,novo=fichaCriar(nome,FICHAS.escopo);if(novo)renderFichasPersonagem();return;}
  if(b.hasAttribute("data-ficha-restaurar")){var ar=fichasLer().filter(function(x){return x.id===b.getAttribute("data-ficha-restaurar");})[0];if(ar){ar.arquivada=false;FICHAS.atual=ar.id;fichasGravar();renderFichasPersonagem();}return;}
  if(!f)return;
  if(b.hasAttribute("data-ficha-aba")){FICHAS.aba=b.getAttribute("data-ficha-aba");renderFichasPersonagem();}
  else if(b.hasAttribute("data-ficha-adicionar"))FICHAS.janela.querySelector("[data-ficha-arquivos]").click();
  else if(b.hasAttribute("data-ficha-ampliar")){
    try{var rec=await bdLer(fichaImagemChave(f.id,b.getAttribute("data-ficha-ampliar")));if(fichaAtual()!==f||!b.isConnected)return;
      if(!rec||!/^data:image\//i.test(rec.src||""))throw new Error("Imagem indisponível");
      var ampliada=FICHAS.zoom.querySelector("img");ampliada.onerror=function(){if(fichaAtual()===f&&this.isConnected){FICHAS.zoom.classList.add("oculto");fichaStatus("Não foi possível abrir esta referência. Os dados armazenados foram preservados.",true);}};ampliada.src=rec.src;ampliada.alt=b.getAttribute("aria-label")||"Referência do personagem";FICHAS.zoom.classList.remove("oculto");FICHAS.zoom.querySelector("button").focus();
    }catch(e){fichaStatus("Não foi possível ler esta referência. Reabra a ficha para tentar novamente.",true);}
  }
  else if(b.hasAttribute("data-ficha-retirar-imagem")||b.hasAttribute("data-ficha-restaurar-imagem")){var retirar=b.hasAttribute("data-ficha-retirar-imagem"),iid=b.getAttribute(retirar?"data-ficha-retirar-imagem":"data-ficha-restaurar-imagem"),im=f.imagens.filter(function(x){return x.id===iid;})[0];if(im){im.retirada=retirar;f.atualizadoEm=Date.now();fichasGravar();renderFichasPersonagem();}}
  else if(b.hasAttribute("data-ficha-arquivar")){f.arquivada=true;FICHAS.atual=null;fichasGravar();renderFichasPersonagem();}
}
async function adicionarFichaImagens(arquivos){
  var f=fichaAtual();if(!f||FICHAS.importando||!arquivos.length)return;var aba=FICHAS.aba,vista=FICHAS.janela.querySelector("[data-ficha-vista]").value,ok=0,falhas=0;FICHAS.importando=true;
  var botao=FICHAS.janela.querySelector("[data-ficha-adicionar]");if(botao)botao.disabled=true;
  for(var i=0;i<arquivos.length;i++){fichaStatus("Guardando referência "+(i+1)+" de "+arquivos.length+"…");try{if(!/^image\//i.test(arquivos[i].type||""))throw new Error("formato");var src=await arquivoDataUrl(arquivos[i]),im={id:id("ref"),nome:arquivos[i].name||"Referência",aba:aba,vista:vista,retirada:false},gravou=await bdGravar(fichaImagemChave(f.id,im.id),{src:src,nome:im.nome});if(!gravou)throw new Error("armazenamento");f.imagens.push(im);f.atualizadoEm=Date.now();if(!fichasGravar()){f.imagens.pop();throw new Error("metadados");}ok++;}catch(err){falhas++;}}
  FICHAS.importando=false;if(FICHAS.janela&&!FICHAS.janela.classList.contains("oculto"))renderFichasPersonagem();fichaStatus(ok+" referência(s) guardada(s)."+(falhas?" "+falhas+" não foram guardadas; verifique o formato e o espaço do aparelho.":""),!!falhas);
}
async function exportarFichasPersonagem(){
  var fichas=dadosProfundos(fichasLer()),imagens=[];
  for(var i=0;i<fichas.length;i++)for(var j=0;j<fichas[i].imagens.length;j++){
    var im=fichas[i].imagens[j],chave=fichaImagemChave(fichas[i].id,im.id),rec=await bdLer(chave);
    if(!rec||!/^data:image\//i.test(rec.src||"")){var erro=new Error("Uma imagem de ficha não está disponível. O backup completo foi interrompido.");erro.code="backup_incompleto";throw erro;}
    imagens.push({chave:chave,src:rec.src,nome:im.nome});
  }
  return{fichas:fichas,imagens:imagens};
}
async function importarFichasPersonagem(pacote){
  return importarBackupArquivo({text:async function(){return JSON.stringify({obras:[],capitulos:[],notas:[],fichasPersonagem:pacote});}});
}
window.FichasPersonagem={abrir:abrirFichasPersonagem,fechar:fecharFichasPersonagem,exportar:exportarFichasPersonagem,importar:importarFichasPersonagem};
document.addEventListener("click",function(e){var b=e.target.closest("[data-ficha-personagem]");if(b){e.preventDefault();abrirFichasPersonagem(b.getAttribute("data-ficha-personagem")||null);}});
document.addEventListener("keydown",function(e){
  var vis=FICHAS.janela&&!FICHAS.janela.classList.contains("oculto"),editavel=e.target&&(e.target.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
  if(vis&&e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();if(FICHAS.zoom&&!FICHAS.zoom.classList.contains("oculto")){FICHAS.zoom.classList.add("oculto");FICHAS.zoom.querySelector("img").removeAttribute("src");}else fecharFichasPersonagem();return;}
  if(!editavel&&e.shiftKey&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&(e.code==="KeyF"||String(e.key).toLowerCase()==="f")){e.preventDefault();e.stopImmediatePropagation();if(vis)fecharFichasPersonagem();else abrirFichasPersonagem();return;}
  if(e.target&&e.target.closest&&e.target.closest(".fichas-janela,.fichas-zoom"))e.stopImmediatePropagation();
},true);
document.addEventListener("fullscreenchange",function(){if(FICHAS.janela&&!FICHAS.janela.classList.contains("oculto")){var pai=document.fullscreenElement||document.body;pai.appendChild(FICHAS.janela);pai.appendChild(FICHAS.zoom);}});
function registrarDesenhoLivre(idLivre,titulo,criadoEm){
  garantirDesenhosLivresLidos();var anteriores=dadosProfundos(desenhosLivres);
  if(!idLivre) return null;
  titulo=(titulo||"Desenho livre").trim()||"Desenho livre";
  var agora=Date.now(), item=desenhosLivres.filter(function(x){return x.id===idLivre;})[0];
  if(!item){ item={id:idLivre,titulo:titulo,criadoEm:criadoEm||agora,atualizadoEm:agora}; desenhosLivres.unshift(item); }
  else{ item.titulo=titulo; item.atualizadoEm=agora; }
  desenhosLivres.sort(function(a,b){return (b.atualizadoEm||0)-(a.atualizadoEm||0);});if(!salvarDesenhosLivres()){desenhosLivres=anteriores;aviso("Não foi possível guardar o registro do desenho livre. A lista anterior foi preservada.");return null;}return item;
}
function renomearDesenhoLivre(idLivre){
  try{garantirDesenhosLivresLidos();}catch(e){aviso("Não foi possível ler a lista de desenhos livres. O nome anterior foi preservado.");return false;}
  var item=desenhosLivres.filter(function(x){return x.id===idLivre;})[0]; if(!item) return;
  var novo=window.prompt("Nome do desenho livre:",item.titulo||""); if(novo===null) return;
  novo=novo.trim(); if(!novo){ aviso("O nome não pode ficar vazio."); return; }
  var anteriores=dadosProfundos(desenhosLivres);item.titulo=novo;item.atualizadoEm=Date.now();if(!salvarDesenhosLivres()){desenhosLivres=anteriores;aviso("O novo nome não foi salvo. O registro anterior foi preservado.");return;}desenhar();aviso("Desenho livre renomeado.");
}
async function apagarDesenhoLivre(idLivre){
  try{garantirDesenhosLivresLidos();}catch(e){aviso("Não foi possível ler a lista de desenhos livres. Nenhum desenho foi apagado.");return false;}
  var item=desenhosLivres.filter(function(x){return x.id===idLivre;})[0]; if(!item) return;
  if(!window.confirm("Apagar o desenho livre “"+(item.titulo||"Desenho livre")+"”? Esta ação não pode ser desfeita.")) return;
  var anteriores=desenhosLivres;desenhosLivres=desenhosLivres.filter(function(x){return x.id!==idLivre;});
  if(!salvarDesenhosLivres()){desenhosLivres=anteriores;aviso("Não foi possível confirmar a remoção. O desenho e seu registro foram preservados.");return false;}
  var limpo=window.EditorDesenho&&window.EditorDesenho.apagar?await window.EditorDesenho.apagar(idLivre):false;
  desenhar();aviso(limpo===true?"Desenho livre apagado.":"Registro removido. A limpeza dos pixels não foi confirmada.");return true;
}
function htmlEntradaBiblioteca(){
  var obraHtml=obras.map(function(o){
    var qtd=caps.filter(function(c){return c.obraId===o.id;}).length;
    return '<button type="button" class="entrada-biblioteca-item" data-entrada-obra="'+esc(o.id)+'"><span class="entrada-mini-icone" aria-hidden="true">▤</span><span class="entrada-mini-texto"><strong>'+esc(o.titulo||"Sem título")+'</strong><small>'+qtd+' capítulo'+(qtd===1?'':'s')+'</small></span><span class="entrada-mini-seta" aria-hidden="true">→</span></button>';
  }).join("");
  var notasHtml=notas.map(function(n){
    var titulo=(n.titulo||"").trim()||"Sem título", qtd=(n.imagens||[]).length;
    return '<button type="button" class="entrada-biblioteca-item" data-entrada-nota="'+esc(n.id)+'"><span class="entrada-mini-icone" aria-hidden="true">▤</span><span class="entrada-mini-texto"><strong>'+esc(titulo)+'</strong><small>'+(qtd?(qtd+' imagem'+(qtd===1?'':'ns')+' · '):'')+esc(dataNota(n.atualizadoEm||n.criadoEm||Date.now(),false))+'</small></span><span class="entrada-mini-seta" aria-hidden="true">→</span></button>';
  }).join("");
  var livresHtml=desenhosLivres.map(function(d){
    return '<div class="entrada-biblioteca-item" role="group"><button type="button" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;border:0;background:none;padding:0;text-align:left;cursor:pointer;color:inherit" data-entrada-livre="'+esc(d.id)+'"><span class="entrada-mini-icone" aria-hidden="true">✎</span><span class="entrada-mini-texto"><strong>'+esc(d.titulo)+'</strong><small>Desenho livre · '+esc(dataNota(d.atualizadoEm||d.criadoEm||Date.now(),false))+'</small></span><span class="entrada-mini-seta" aria-hidden="true">→</span></button><span class="entrada-biblioteca-acoes"><button type="button" class="bt-texto" data-entrada-livre-renomear="'+esc(d.id)+'">renomear</button><button type="button" class="bt-texto risco" data-entrada-livre-apagar="'+esc(d.id)+'">apagar</button></span></div>';
  }).join("");
  if(!obraHtml&&!notasHtml&&!livresHtml&&DESENHOS_LIVRES_LIDOS) return "";
  return '<section class="entrada-biblioteca" aria-labelledby="entradaBibliotecaTitulo"><div class="entrada-biblioteca-cab"><div><h3 id="entradaBibliotecaTitulo">Sua biblioteca</h3><p>Obras, notas e desenhos livres ficam organizados aqui.</p></div></div><div class="entrada-biblioteca-grid">'+
    '<section class="entrada-biblioteca-secao" aria-labelledby="entradaObrasTitulo"><h4 id="entradaObrasTitulo">Obras <span>'+obras.length+'</span></h4><div class="entrada-biblioteca-lista">'+(obraHtml||'<p class="entrada-biblioteca-vazio">Nenhuma obra criada ainda.</p>')+'</div></section>'+ 
    '<section class="entrada-biblioteca-secao" aria-labelledby="entradaNotasTitulo"><h4 id="entradaNotasTitulo">Notas <span>'+notas.length+'</span></h4><div class="entrada-biblioteca-lista">'+(notasHtml||'<p class="entrada-biblioteca-vazio">Nenhuma nota criada ainda.</p>')+'</div><div class="entrada-biblioteca-acoes"><button type="button" class="bt mini" data-entrada-nota-nova>+ Nova nota</button></div></section>'+ 
    '<section class="entrada-biblioteca-secao" aria-labelledby="entradaLivresTitulo"><h4 id="entradaLivresTitulo">Desenhos livres <span>'+(DESENHOS_LIVRES_LIDOS?desenhosLivres.length:'?')+'</span></h4><div class="entrada-biblioteca-lista">'+(DESENHOS_LIVRES_LIDOS?(livresHtml||'<p class="entrada-biblioteca-vazio">Nenhum desenho livre salvo ainda.</p>'):'<p class="entrada-biblioteca-vazio">A lista de desenhos livres não pôde ser lida. Tente ler novamente no aviso acima.</p>')+'</div><div class="entrada-biblioteca-acoes"><button type="button" class="bt mini" data-entrada-novo-livre>+ Novo desenho livre</button></div></section>'+ 
    '</div></section>';
}
function ligarEntradaBiblioteca(){
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-obra]"),function(b){ b.onclick=function(){ return abrirObra(b.getAttribute("data-entrada-obra")); }; });
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-nota]"),function(b){ b.onclick=function(){ abrirNota(b.getAttribute("data-entrada-nota")); }; });
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-livre]"),function(b){ b.onclick=function(){ abrirDesenhoLivre(desenhosLivres.filter(function(x){return x.id===b.getAttribute("data-entrada-livre");})[0]); }; });
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-livre-renomear]"),function(b){ b.onclick=function(ev){ev.stopPropagation();renomearDesenhoLivre(b.getAttribute("data-entrada-livre-renomear"));}; });
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-livre-apagar]"),function(b){ b.onclick=function(ev){ev.stopPropagation();apagarDesenhoLivre(b.getAttribute("data-entrada-livre-apagar"));}; });
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-novo-livre]"),function(b){ b.onclick=function(){ abrirDesenhoLivre(); }; });
  Array.prototype.forEach.call(tela.querySelectorAll("[data-entrada-nota-nova]"),function(b){ b.onclick=function(){ criarNota(); }; });
}
function filaNuvemLer(){ return []; }
function filaNuvemGravar(){ }
/* A versão local não cria fila de sincronização nem tenta enviar dados para
   qualquer serviço externo. Os dados ficam no armazenamento deste aparelho. */
function salvarCacheOffline(fonteConfirmada){
  if(!BIBLIOTECA_TEXTOS_OK)return false;
  try{
    if(fonteConfirmada){window.__mesaCapsOffline=dadosProfundos(fonteConfirmada.caps);return gravarMetaLocal("offline-cache",Object.assign({},fonteConfirmada,{em:Date.now()}));}
    var capsCache=Array.isArray(window.__mesaCapsOffline)?window.__mesaCapsOffline.slice():[];
    if(doc&&doc.id){ var cp=JSON.parse(JSON.stringify(doc)); var ci=capsCache.findIndex(function(x){return x.id===doc.id;}); if(ci>=0) capsCache[ci]=cp; else capsCache.push(cp); }
    window.__mesaCapsOffline=capsCache;
    return gravarMetaLocal("offline-cache",{obras:obras,caps:capsCache,notas:notas,em:Date.now()});
  }catch(e){return false;}
}
function atualizarEstadoBackup(){
  var alvo=el("estadoBackup");if(!alvo)return;var meta;
  try{meta=lerMetaLocal("backup-meta");}catch(e){alvo.textContent="Não foi possível ler o registro do último backup. Isso não indica ausência das suas cópias.";return;}
  alvo.textContent=meta&&meta.em?"Último backup deste aparelho: "+dataNota(meta.em,true)+" · "+(meta.itens||0)+" item(ns).":"Último backup: ainda não registrado neste aparelho.";
  /* Este modo não usa nuvem; o arquivo de backup é a forma de transportar os dados. */
}
function registrarBackup(pacote,destino){ var itens=(pacote.obras||[]).length+(pacote.capitulos||[]).length+(pacote.notas||[]).length; gravarMetaLocal("backup-meta",{em:Date.now(),itens:itens,destino:destino||"download",versao:pacote.versao||"antiga"}); atualizarEstadoBackup(); }

var tAviso;
function aviso(txt){
  var a=el("aviso"); a.textContent=txt; a.classList.remove("oculto");
  clearTimeout(tAviso); tAviso=setTimeout(function(){a.classList.add("oculto");},2600);
}
function atualizarConexao(){
  var a=el("estadoConexao"); if(!a) return;
  a.classList.remove("offline","pendente");
  if(window.__mesaArmazenamento&&window.__mesaArmazenamento.temLocalStorage===false)a.textContent="Temporário nesta aba · baixe um backup";
  else if(sujo||notaSuja||salvando||salvandoNota){a.textContent="Salvamento local pendente";a.classList.add("pendente");}
  else a.textContent="Salvo neste aparelho";
}

/* ========== armazenamento e sincronização ========== */
function dadosProfundos(v){ return JSON.parse(JSON.stringify(v)); }
async function contarDocumentos(banco,raiz){
  var grupos=["obras","capitulos","notas"], total=0;
  for(var i=0;i<grupos.length;i++){
    var lista=await banco.collection(raiz+"/"+grupos[i]).get(); total+=lista.size||0;
  }
  return total;
}
async function copiarBibliotecaLocal(bancoDestino,raizDestino){
  var grupos=["obras","capitulos","notas"];
  for(var i=0;i<grupos.length;i++){
    var grupo=grupos[i], lista=await dbLocal.collection(baseLocal+"/"+grupo).get();
    for(var j=0;j<lista.docs.length;j++){
      var item=lista.docs[j];
      await bancoDestino.collection(raizDestino+"/"+grupo).doc(item.id).set(dadosProfundos(item.data()));
    }
  }
}
var CONTA_NUVEM={uid:null,geracao:0,autorizada:false,pausada:false,operando:false,assinatura:null,consultas:0};
function invalidarContaNuvem(uid){
  CONTA_NUVEM.uid=uid||null;CONTA_NUVEM.geracao++;CONTA_NUVEM.consultas++;CONTA_NUVEM.autorizada=false;contaNuvemPronta=false;
  clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;
  COPIA_NUVEM.pendente=null;COPIA_NUVEM.ultima=null;COPIA_NUVEM.lista=[];COPIA_NUVEM.contextoLista=null;COPIA_NUVEM.offset=0;COPIA_NUVEM.cursorR2=null;COPIA_NUVEM.fimR2=false;COPIA_NUVEM.fimSupabase=false;COPIA_NUVEM.bloqueio=null;limparFalhaCopiaNuvem();
  var lista=el("listaCopiasNuvem");if(lista)lista.replaceChildren();var mais=el("btMaisCopiasNuvem");if(mais)mais.classList.add("oculto");
  var st=el("estadoCopiasNuvem");if(st)st.textContent="A sessão mudou. Atualize a lista para consultar esta conta.";
}
function vinculoNuvemPermitido(uid){
  try{var v=lerMetaLocal("nuvem-vinculo-v1"),cfg=window.MesaNuvem;return!!(v&&v.versao===1&&v.uid===uid&&v.projeto===cfg.url&&v.ativo===true);}catch(e){return false;}
}
function conferirContextoConta(c){
  var cfg=window.MesaNuvem;if(!c||!cfg||c.cfg!==cfg||c.client!==cfg.client||c.uid!==CONTA_NUVEM.uid||c.geracao!==CONTA_NUVEM.geracao)throw erroCopiaNuvem("nuvem_conta","A sessão mudou. Atualize a conta e tente novamente.");
  if(c.assinaturaDestino&&!destinoCopiaVigente(c))throw erroCopiaNuvem("nuvem_destino_alterado","O destino da cópia mudou. Atualize a conta e a lista antes de tentar novamente.");
  if(c.exigirEnvio&&(CONTA_NUVEM.pausada||!vinculoNuvemPermitido(c.uid)))throw erroCopiaNuvem("nuvem_autorizacao","Autorize esta biblioteca para esta conta antes de enviar trabalhos.");
}
function atualizarControlesConta(){
  var ocupado=CONTA_NUVEM.operando,conectado=!!CONTA_NUVEM.uid;
  ["emailNuvem","senhaNuvem","btEntrarNuvem","btCriarContaNuvem"].forEach(function(k){var b=el(k);if(b)b.disabled=ocupado||conectado;});
  var autorizar=el("btAutorizarBibliotecaNuvem"),sair=el("btSairNuvem"),form=el("formContaNuvem");
  if(autorizar){autorizar.classList.toggle("oculto",!conectado);autorizar.disabled=ocupado||!conectado||CONTA_NUVEM.autorizada;}
  if(sair){sair.classList.toggle("oculto",!conectado);sair.disabled=ocupado||!conectado;}
  if(form)form.classList.toggle("oculto",conectado);
}
async function consultarUsuarioNuvem(){
  var cfg=window.MesaNuvem;if(!cfg||!cfg.client)throw erroCopiaNuvem("nuvem_conta","Conecte sua conta da nuvem.");
  var r=await esperarCopiaNuvem(cfg.client.auth.getSession());if(r&&r.error)throw r.error;
  var sessao=r&&r.data&&r.data.session,u=sessao&&sessao.user;if(!u)return null;
  if(typeof u.id!=="string"||! /^[a-zA-Z0-9_-]+$/.test(u.id))throw erroCopiaNuvem("nuvem_conta","A sessão local não pôde ser conferida.");
  var ver=await esperarCopiaNuvem(cfg.client.auth.getUser());if(ver&&ver.error)throw ver.error;
  var confirmado=ver&&ver.data&&ver.data.user;if(!confirmado||confirmado.id!==u.id)throw erroCopiaNuvem("nuvem_conta","A conta mudou ou não pôde ser confirmada pelo servidor.");
  return confirmado;
}
async function atualizarContaNuvem(){
  var alvo=el("estadoNuvem"),botao=el("btContaNuvem"),painel=el("estadoContaNuvem"),identidade=el("identidadeContaNuvem"),cfg=window.MesaNuvem;
  if(!cfg||!cfg.client){if(alvo)alvo.textContent="Nuvem indisponível";return null;}
  var consulta=++CONTA_NUVEM.consultas;
  try{
    var usuario=await consultarUsuarioNuvem();if(consulta!==CONTA_NUVEM.consultas)return null;
    var uid=usuario&&usuario.id||null;if(uid!==CONTA_NUVEM.uid)invalidarContaNuvem(uid);
    CONTA_NUVEM.autorizada=!!uid&&!CONTA_NUVEM.pausada&&vinculoNuvemPermitido(uid);contaNuvemPronta=CONTA_NUVEM.autorizada;
    if(identidade)identidade.textContent=usuario?"Conta conectada: "+(usuario.email||usuario.id):"Nenhuma conta conectada.";
    if(alvo)alvo.textContent=usuario?(contaNuvemPronta?"Conta conectada · cópias autorizadas":"Conta conectada · autorize esta biblioteca"):"Nuvem desconectada";
    if(botao)botao.textContent=usuario?"Minha conta":"Conectar nuvem";
    if(painel)painel.textContent=usuario?(contaNuvemPronta?"Cópias automáticas autorizadas para esta conta após 2 minutos sem alterações.":"Entrar não envia seus trabalhos. Autorize esta biblioteca para habilitar as cópias nesta conta."):"Entre para consultar cópias ou autorizar o envio desta biblioteca.";
    atualizarControlesConta();return usuario||null;
  }catch(e){if(consulta===CONTA_NUVEM.consultas){invalidarContaNuvem(null);if(alvo)alvo.textContent="Conta não confirmada · cópias pausadas";if(identidade)identidade.textContent="Não foi possível confirmar a conta no servidor.";if(painel)painel.textContent="Verifique a conexão antes de usar a nuvem. Seus trabalhos locais continuam disponíveis.";atualizarControlesConta();}return null;}
}
function receberEventoContaNuvem(evento,sessao){
  var uid=sessao&&sessao.user&&sessao.user.id||null;
  if(uid!==CONTA_NUVEM.uid||evento==="SIGNED_OUT")invalidarContaNuvem(uid);
  if(evento==="PASSWORD_RECOVERY"){CONTA_NUVEM.pausada=true;CONTA_NUVEM.autorizada=false;contaNuvemPronta=false;CONTA_NUVEM.geracao++;clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;}
  /* O callback do SDK termina antes de chamar APIs assíncronas de autenticação. */
  setTimeout(function(){atualizarContaNuvem().then(function(){if(contaNuvemPronta)agendarBackupNuvem();}).catch(function(){});},0);
}
async function iniciarContaNuvem(){
  var cfg=window.MesaNuvem;if(!cfg||!window.supabase||!window.supabase.createClient)return;
  if(!cfg.client)cfg.client=window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true}});
  if(!CONTA_NUVEM.assinatura&&cfg.client.auth.onAuthStateChange){var r=cfg.client.auth.onAuthStateChange(receberEventoContaNuvem);CONTA_NUVEM.assinatura=r&&r.data&&r.data.subscription||null;}
  setTimeout(function(){atualizarContaNuvem().then(function(){if(contaNuvemPronta)agendarBackupNuvem();}).catch(function(){});},0);
}
async function usarContaNuvem(){
  el("dlgNuvem").showModal();return!!await atualizarContaNuvem();
}
async function autorizarBibliotecaNuvem(){
  if(CONTA_NUVEM.operando)return false;CONTA_NUVEM.operando=true;atualizarControlesConta();var alvo=el("estadoContaNuvem");
  try{
    var c=await contextoCopiaNuvem(false),u=await consultarUsuarioNuvem();conferirContextoConta(c);if(!u||u.id!==c.uid)throw erroCopiaNuvem("nuvem_conta","A conta mudou antes da autorização.");
    if(!window.confirm("Autorizar cópias de TODOS os trabalhos locais deste perfil do navegador para a conta "+(u.email||u.id)+"?\n\nInclui obras, notas, desenhos e imagens. Os envios automáticos ocorrerão após 2 minutos sem alterações. Cópias anteriores de outras contas serão preservadas."))return false;
    await confirmarContaCopia(c);conferirContextoConta(c);
    var v={versao:1,projeto:c.cfg.url,uid:c.uid,ativo:true,em:Date.now()};
    if(!gravarMetaLocal("nuvem-vinculo-v1",v)||!vinculoNuvemPermitido(c.uid))throw erroCopiaNuvem("nuvem_autorizacao","Não foi possível guardar a autorização. As cópias continuam pausadas.");
    if(c.geracao!==CONTA_NUVEM.geracao||c.uid!==CONTA_NUVEM.uid)throw erroCopiaNuvem("nuvem_conta","A conta mudou antes da confirmação.");
    CONTA_NUVEM.pausada=false;CONTA_NUVEM.autorizada=true;contaNuvemPronta=true;
    await atualizarContaNuvem();if(contaNuvemPronta){agendarBackupNuvem();alvo.textContent="Biblioteca autorizada. A primeira cópia será preparada após 2 minutos sem alterações.";}else alvo.textContent="Autorização guardada. As cópias aguardam a confirmação da conta e da conexão.";return true;
  }catch(e){alvo.textContent=e&&e.code==="nuvem_autorizacao"?e.message:"A autorização não foi confirmada. Confira a conta e a conexão antes de tentar novamente.";return false;}
  finally{CONTA_NUVEM.operando=false;atualizarControlesConta();}
}
async function sairContaNuvem(){
  if(CONTA_NUVEM.operando)return false;CONTA_NUVEM.operando=true;atualizarControlesConta();
  var cfg=window.MesaNuvem,uid=CONTA_NUVEM.uid,alvo=el("estadoContaNuvem");
  invalidarContaNuvem(uid);CONTA_NUVEM.pausada=true;var guardou=uid?gravarMetaLocal("nuvem-vinculo-v1",{versao:1,projeto:cfg.url,uid:uid,ativo:false,em:Date.now()}):true;
  try{
    var r=await esperarCopiaNuvem(cfg.client.auth.signOut({scope:"local"}));if(r&&r.error)throw r.error;
    invalidarContaNuvem(null);CONTA_NUVEM.pausada=true;el("senhaNuvem").value="";await atualizarContaNuvem();
    alvo.textContent="Sessão encerrada neste navegador. Os trabalhos locais e os backups existentes foram preservados."+(guardou?"":" A preferência de pausa não pôde ser gravada; confira a conta antes de reabrir.");return true;
  }catch(e){alvo.textContent="A saída não foi confirmada pelo servidor. Nenhuma cópia será iniciada nesta aba; preserve a aba e tente novamente."+(guardou?"":" A pausa também não pôde ser gravada para uma próxima abertura.");return false;}
  finally{CONTA_NUVEM.operando=false;el("senhaNuvem").value="";atualizarControlesConta();}
}
async function enviarContaNuvem(criar){
  if(CONTA_NUVEM.operando)return false;
  var cfg=window.MesaNuvem,alvo=el("estadoContaNuvem"),email=(el("emailNuvem").value||"").trim(),senha=el("senhaNuvem").value||"";
  if(!cfg||!cfg.client){alvo.textContent="A conexão com a nuvem não foi carregada.";return false;}
  if(CONTA_NUVEM.uid){alvo.textContent="Saia da conta conectada antes de entrar em outra.";return false;}
  if(!email||senha.length<8){alvo.textContent="Informe um e-mail e uma senha com pelo menos 8 caracteres.";return false;}
  CONTA_NUVEM.operando=true;atualizarControlesConta();alvo.textContent=criar?"Criando conta…":"Entrando…";
  try{
    var r=criar?await esperarCopiaNuvem(cfg.client.auth.signUp({email:email,password:senha})):await esperarCopiaNuvem(cfg.client.auth.signInWithPassword({email:email,password:senha}));
    if(r.error){alvo.textContent="Não foi possível continuar: "+r.error.message;return false;}
    if(criar&&!(r.data&&r.data.session)){alvo.textContent="Verifique seu e-mail para confirmar o acesso e depois entre. Entrar não autoriza envio de trabalhos.";return true;}
    await atualizarContaNuvem();return true;
  }catch(e){alvo.textContent="Não foi possível concluir o acesso. Confira a conexão e tente novamente.";return false;}
  finally{senha="";el("senhaNuvem").value="";CONTA_NUVEM.operando=false;atualizarControlesConta();}
}
var temporizadorBackupNuvem=null, backupNuvemEmCurso=false;
var COPIA_NUVEM={revisao:0,tentativas:0,pendente:null,ultima:null,lista:[],contextoLista:null,offset:0,cursorR2:null,fimR2:false,fimSupabase:false,consultando:false,baixando:false,bloqueio:null};
function erroCopiaNuvem(codigo,mensagem){var e=new Error(mensagem);e.code=codigo;return e;}
/* Transporte opcional apenas para o JSON completo. Nenhuma URL assinada é
   persistida: a identidade usa projeto/API, conta e bucket públicos fixos. */
function destinoCopiaConfigurado(){
  var cfg=window.MesaNuvem,r=cfg&&cfg.r2;
  if(!r||r.ativo!==true)return{provedor:"supabase",destino:cfg&&cfg.url||""};
  var u;try{u=new URL(r.url);}catch(e){throw erroCopiaNuvem("nuvem_configuracao","A configuração R2 está incompleta. Preserve o backup local e confira o destino.");}
  if(u.protocol!=="https:"||u.username||u.password||u.hash||u.search||u.pathname!=="/"||u.port||! /^[a-f0-9]{32}$/.test(r.accountId||"")||! /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(r.bucket||""))throw erroCopiaNuvem("nuvem_configuracao","A configuração R2 não pôde ser validada. Preserve o backup local e confira o destino.");
  return{provedor:"r2",destino:u.origin,accountId:r.accountId,bucket:r.bucket};
}
function assinaturaDestinoCopia(){
  var cfg=window.MesaNuvem;return JSON.stringify({projeto:cfg&&cfg.url||"",transporte:destinoCopiaConfigurado()});
}
function destinoCopiaVigente(c){try{return !c.assinaturaDestino||c.assinaturaDestino===assinaturaDestinoCopia();}catch(e){return false;}}
function referenciaDestinoCopia(c){
  var t=c.transporte||{provedor:"supabase",destino:c.cfg.url},r={provedor:t.provedor,destino:t.destino};
  if(t.provedor==="r2"){r.accountId=t.accountId;r.bucket=t.bucket;}return r;
}
function mesmoDestinoCopia(ref,c){
  if(!ref)return false;var t=referenciaDestinoCopia(c),provedor=ref.provedor||"supabase",destino=ref.destino||c.cfg.url;
  return provedor===t.provedor&&destino===t.destino&&(provedor!=="r2"||(ref.accountId===t.accountId&&ref.bucket===t.bucket));
}
function contextoLeituraCopia(c,origem){
  if(!origem)return c;
  var provedor=origem.provedor||"supabase",destino=origem.destino||c.cfg.url,t;
  if(provedor==="supabase"&&destino===c.cfg.url)t={provedor:"supabase",destino:destino};
  else if(provedor==="r2"&&c.transporte&&c.transporte.provedor==="r2"&&mesmoDestinoCopia(origem,c))t=c.transporte;
  else throw erroCopiaNuvem("nuvem_destino_alterado","A referência pertence a outro destino. Atualize a lista antes de baixar.");
  return Object.assign({},c,{transporte:t});
}
function conferirOperacaoR2(c){
  conferirContextoConta(c);
  if(!c.transporte||c.transporte.provedor!=="r2"||! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.uid))throw erroCopiaNuvem("nuvem_configuracao","A conta ou o destino R2 não pôde ser validado.");
  if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
}
async function requisicaoR2(c,url,opcoes,tempo,ler){
  conferirOperacaoR2(c);
  if(typeof AbortController!=="function"||typeof fetch!=="function")throw erroCopiaNuvem("nuvem_configuracao","Este navegador não oferece a transferência segura da cópia.");
  var controle=new AbortController(),timer;
  try{
    var limite=new Promise(function(resolve,reject){timer=setTimeout(function(){controle.abort();reject(erroCopiaNuvem("nuvem_tempo","A transferência não terminou no prazo. Preserve o backup local e tente novamente."));},tempo);});
    var pedido=Promise.resolve().then(function(){return fetch(url,Object.assign({},opcoes,{signal:controle.signal,credentials:"omit",redirect:"error",cache:"no-store",referrerPolicy:"no-referrer"}));}).then(async function(r){conferirOperacaoR2(c);var dado=await ler(r);conferirOperacaoR2(c);return dado;});
    return await Promise.race([pedido,limite]);
  }finally{clearTimeout(timer);}
}
function erroRespostaR2(status,codigo){
  var e=erroCopiaNuvem("nuvem_envio","A operação R2 não foi confirmada. Confira a conta, a conexão e a configuração do destino.");
  e.status=status;
  if(codigo==="too_large")e.code="EntityTooLarge";
  else if(codigo==="invalid_request")e.code="InvalidRequest";
  else if(codigo==="auth_required")e.code="InvalidJWT";
  else if(codigo==="version_missing")e.code="NoSuchKey";
  else if(codigo==="user_not_allowed"||codigo==="origin_denied")e.code="AccessDenied";
  return e;
}
async function chamarApiR2(c,rota,corpo){
  conferirOperacaoR2(c);
  if(["/v1/uploads","/v1/downloads","/v1/versions/list"].indexOf(rota)<0)throw erroCopiaNuvem("nuvem_caminho","A operação R2 não é permitida.");
  var r=await esperarCopiaNuvem(c.client.auth.getSession());conferirOperacaoR2(c);
  var s=r&&r.data&&r.data.session;
  if(r&&r.error||!s||!s.user||s.user.id!==c.uid||typeof s.access_token!=="string"||!s.access_token||/[\r\n]/.test(s.access_token))throw erroCopiaNuvem("nuvem_conta","A sessão não pôde ser confirmada para esta operação.");
  return requisicaoR2(c,c.transporte.destino+rota,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+s.access_token},body:JSON.stringify(corpo)},15000,async function(res){
    var texto=await res.text();if(texto.length>65536)throw erroCopiaNuvem("nuvem_integridade","A resposta de controle R2 excedeu o tamanho esperado.");
    var dado;try{dado=JSON.parse(texto);}catch(e){throw erroCopiaNuvem("nuvem_integridade","A API R2 não retornou a resposta esperada.");}
    if(!res.ok)throw erroRespostaR2(res.status,dado&&dado.error&&dado.error.code);
    return dado;
  });
}
function validarUrlAssinadaR2(c,res,metodo,nome,hash){
  conferirOperacaoR2(c);var t=c.transporte,u,agora=Date.now();
  if(!res||typeof res!=="object"||Array.isArray(res)||typeof res.url!=="string"||!Number.isSafeInteger(res.expiresAt)||res.expiresAt<=agora||res.expiresAt>agora+900000||!res.headers||typeof res.headers!=="object"||Array.isArray(res.headers))throw erroCopiaNuvem("nuvem_integridade","A autorização temporária R2 é inválida ou expirou.");
  try{u=new URL(res.url);}catch(e){throw erroCopiaNuvem("nuvem_integridade","A autorização R2 contém um endereço inválido.");}
  var caminho="/"+t.bucket+"/"+c.uid+"/sincronizacao/versoes/"+nome;
  if(!caminhoVersaoCopia(c.uid+"/sincronizacao/versoes/"+nome,c.uid)||u.protocol!=="https:"||u.host!==t.accountId+".r2.cloudflarestorage.com"||u.username||u.password||u.hash||u.pathname!==caminho)throw erroCopiaNuvem("nuvem_integridade","O endereço autorizado não corresponde ao destino e à conta esperados.");
  var q=u.searchParams,permitidos=["X-Amz-Algorithm","X-Amz-Credential","X-Amz-Date","X-Amz-Expires","X-Amz-SignedHeaders","X-Amz-Signature"],vistos=new Set();
  q.forEach(function(v,k){if(permitidos.indexOf(k)<0||vistos.has(k))throw erroCopiaNuvem("nuvem_integridade","A assinatura R2 contém parâmetros inesperados.");vistos.add(k);});
  var exp=q.get("X-Amz-Expires"),data=q.get("X-Amz-Date"),cred=q.get("X-Amz-Credential")||"";
  if(vistos.size!==6||q.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256"||! /^[1-9][0-9]{0,2}$/.test(exp||"")||+exp>900||! /^\d{8}T\d{6}Z$/.test(data||"")||! /^[A-Za-z0-9]+\/\d{8}\/auto\/s3\/aws4_request$/.test(cred)||! /^[a-f0-9]{64}$/.test(q.get("X-Amz-Signature")||""))throw erroCopiaNuvem("nuvem_integridade","A assinatura R2 não corresponde ao formato esperado.");
  var instante=Date.parse(data.slice(0,4)+"-"+data.slice(4,6)+"-"+data.slice(6,8)+"T"+data.slice(9,11)+":"+data.slice(11,13)+":"+data.slice(13,15)+"Z"),fim=instante+(+exp)*1000;
  if(!isFinite(instante)||fim<=agora||fim>agora+900000||Math.abs(fim-res.expiresAt)>1500||cred.split("/")[1]!==data.slice(0,8))throw erroCopiaNuvem("nuvem_integridade","A validade da assinatura R2 não pôde ser confirmada.");
  var headers=Object.create(null),esperados=metodo==="PUT"?{"content-type":"application/json","if-none-match":"*","x-amz-meta-write-id":nome,"x-amz-meta-sha256":hash}:{};
  if(metodo!=="PUT"&&metodo!=="GET")throw erroCopiaNuvem("nuvem_integridade","O método de transferência R2 é inválido.");
  Object.keys(res.headers).forEach(function(k){var chave=k.toLowerCase(),v=res.headers[k];if(Object.prototype.hasOwnProperty.call(headers,chave)||!Object.prototype.hasOwnProperty.call(esperados,chave)||typeof v!=="string"||v!==esperados[chave])throw erroCopiaNuvem("nuvem_integridade","Os cabeçalhos da autorização R2 divergem do envio esperado.");headers[chave]=v;});
  if(Object.keys(headers).length!==Object.keys(esperados).length)throw erroCopiaNuvem("nuvem_integridade","A autorização R2 está incompleta.");
  var assinados=metodo==="PUT"?"content-length;content-type;host;if-none-match;x-amz-meta-sha256;x-amz-meta-write-id":"host";
  if(q.get("X-Amz-SignedHeaders")!==assinados)throw erroCopiaNuvem("nuvem_integridade","A assinatura R2 não protege os cabeçalhos obrigatórios.");
  return{url:u.href,headers:headers};
}
async function enviarArquivoCopiaNuvem(c,p,arquivo){
  if(!c.transporte||c.transporte.provedor!=="r2")return esperarCopiaNuvem(c.client.storage.from("mesa-arquivos").upload(p.caminho,arquivo,{upsert:false,cacheControl:"0",contentType:"application/json"}));
  var nome=p.caminho.slice((c.uid+"/sincronizacao/versoes/").length),hash=await sha256Texto(p.texto);conferirOperacaoR2(c);
  if(!hash)throw erroCopiaNuvem("nuvem_integridade","A verificação SHA-256 não está disponível.");
  var res=await chamarApiR2(c,"/v1/uploads",{name:nome,bytes:arquivo.size,sha256:hash}),aut=validarUrlAssinadaR2(c,res,"PUT",nome,hash);
  return requisicaoR2(c,aut.url,{method:"PUT",headers:aut.headers,body:arquivo},900000,async function(r){if(!r.ok)throw erroRespostaR2(r.status);return{error:null};});
}
async function lerArquivoCopiaR2(c,caminho){
  var nome=caminho.slice((c.uid+"/sincronizacao/versoes/").length);
  if(!caminhoVersaoCopia(caminho,c.uid))throw erroCopiaNuvem("nuvem_caminho","O caminho R2 não pertence à conta atual.");
  var res=await chamarApiR2(c,"/v1/downloads",{name:nome}),aut=validarUrlAssinadaR2(c,res,"GET",nome);
  return requisicaoR2(c,aut.url,{method:"GET",headers:aut.headers},900000,async function(r){if(!r.ok)throw erroRespostaR2(r.status);return r.text();});
}
async function listarPaginaR2(c,cursor){
  var r=await chamarApiR2(c,"/v1/versions/list",{cursor:cursor});
  if(!r||!Array.isArray(r.versions)||r.versions.length>50||!(r.cursor===null||typeof r.cursor==="string"&&r.cursor.length>0&&r.cursor.length<=2048)||r.cursor!==null&&r.cursor===cursor)throw erroCopiaNuvem("nuvem_integridade","A página do histórico R2 não pôde ser confirmada.");
  var vistos=new Set();r.versions.forEach(function(v){if(!v||!caminhoVersaoCopia(c.uid+"/sincronizacao/versoes/"+v.name,c.uid)||!Number.isSafeInteger(v.bytes)||v.bytes<=0||typeof v.uploaded!=="string"||!isFinite(Date.parse(v.uploaded))||vistos.has(v.name))throw erroCopiaNuvem("nuvem_integridade","O histórico R2 contém uma referência inválida.");vistos.add(v.name);});
  return r;
}
async function listarCopiasR2ComLegado(c,alvo,botao){
  var r2=conferirPaginaR2(),sb=conferirPaginaSupabase();
  function conferirPaginaR2(){return COPIA_NUVEM.fimR2?Promise.resolve(null):listarPaginaR2(c,COPIA_NUVEM.cursorR2||null);}
  function conferirPaginaSupabase(){return COPIA_NUVEM.fimSupabase?Promise.resolve(null):esperarCopiaNuvem(c.client.storage.from("mesa-arquivos").list(c.uid+"/sincronizacao/versoes",{limit:50,offset:COPIA_NUVEM.offset,sortBy:{column:"name",order:"desc"}})).then(function(v){if(v.error)throw v.error;if(!Array.isArray(v.data))throw erroCopiaNuvem("nuvem_integridade","A lista Supabase está incompleta.");return v.data;});}
  var resultados=await Promise.allSettled([r2,sb]);await confirmarContaCopia(c);conferirOperacaoR2(c);
  var falhas=0,confirmadas=0;
  resultados.forEach(function(r,i){if(r.status!=="fulfilled"){falhas++;return;}confirmadas++;if(r.value===null)return;
    var origem=i===0?referenciaDestinoCopia(c):{provedor:"supabase",destino:c.cfg.url};
    var itens=i===0?r.value.versions:r.value;
    itens.forEach(function(v){var caminho=c.uid+"/sincronizacao/versoes/"+v.name;if(caminhoVersaoCopia(caminho,c.uid)&&!COPIA_NUVEM.lista.some(function(a){return a.caminho===caminho&&(a.provedor||"supabase")===origem.provedor&&a.destino===origem.destino;}))COPIA_NUVEM.lista.push(Object.assign({caminho:caminho,nome:v.name,data:i===0?v.uploaded:v.created_at||"",legado:false},origem));});
    if(i===0){COPIA_NUVEM.cursorR2=r.value.cursor;COPIA_NUVEM.fimR2=r.value.cursor===null;}else{COPIA_NUVEM.offset+=itens.length;COPIA_NUVEM.fimSupabase=itens.length<50;}
  });
  if(!confirmadas)throw erroCopiaNuvem("nuvem_envio","Os históricos não puderam ser consultados.");
  if(!COPIA_NUVEM.lista.some(function(v){return v.legado;}))COPIA_NUVEM.lista.push({provedor:"supabase",destino:c.cfg.url,caminho:c.uid+"/sincronizacao/atual.json",nome:"Cópia antiga Supabase (se disponível)",legado:true});
  botao.classList.toggle("oculto",COPIA_NUVEM.fimR2&&COPIA_NUVEM.fimSupabase);renderCopiasNuvem();
  alvo.textContent=falhas?"Parte do histórico não pôde ser confirmada. Use Mais cópias para tentar novamente; uma lista parcial não comprova ausência de backups.":"Selecione uma cópia para baixar e verificar. O download não altera os trabalhos locais.";return true;
}
function normalizarErroEnvioNuvem(original,tamanhoBytes){
  /* O SDK admite statusCode simbólico e numérico, inclusive nas respostas
     legadas. Textos remotos ajudam a reconhecer casos antigos, mas nunca são
     reproduzidos na interface nem usados como códigos internos confiáveis. */
  var e=original||{}, codigos=[e.code,e.statusCode,e.error].filter(function(v){return typeof v==="string";}).map(function(v){return v.slice(0,100).toLowerCase().replace(/[^a-z0-9]/g,"");});
  var status=[e.status,e.statusCode,e.httpStatusCode].filter(function(v){return typeof v==="number"?Number.isInteger(v)&&v>=100&&v<=599:typeof v==="string"&&/^[1-5][0-9]{2}$/.test(v);}).map(Number);
  var mensagem=typeof e.message==="string"?e.message.slice(0,512).toLowerCase():"";
  function tem(lista){return codigos.some(function(v){return lista.indexOf(v)>=0;});}
  var codigo="nuvem_envio", texto="O envio não foi confirmado. Confira a conexão e tente novamente; a verificação usará o mesmo arquivo.", permanente=false;
  if(tem(["entitytoolarge","payloadtoolarge","requestentitytoolarge"])||status.indexOf(413)>=0||/maximum allowed size|payload too large|entity too large/.test(mensagem)){
    codigo="nuvem_tamanho";permanente=true;
    var tamanho=typeof tamanhoBytes==="number"&&isFinite(tamanhoBytes)&&tamanhoBytes>0?" ("+(tamanhoBytes<1000000?tamanhoBytes+" bytes":(tamanhoBytes/1000000).toFixed(1).replace(".",",")+" MB")+")":"";
    texto="O arquivo de backup"+tamanho+" ultrapassa o limite de envio da nuvem. Baixe um backup local. É necessário ajustar o destino ou o formato antes de tentar novamente.";
  }else if(tem(["invalidjwt","jwtexpired"])||/jwt (?:expired|is expired)/.test(mensagem)||(status.indexOf(401)>=0&&tem(["unauthorized"]))){
    codigo="nuvem_sessao";permanente=true;texto="A sessão não foi aceita pela nuvem. Confira a conta e use Enviar cópia agora para validar a sessão novamente.";
  }else if(tem(["accessdenied","unauthorized","invalidsignature","signaturedoesnotmatch"])||/new row violates row.level security policy/.test(mensagem)){
    codigo="nuvem_permissao";permanente=true;texto="A nuvem recusou a permissão de envio. Confira a conta e as permissões do armazenamento antes de tentar novamente.";
  }else if(tem(["nosuchbucket","tenantnotfound"])||/bucket not found|bucket does not exist/.test(mensagem)){
    codigo="nuvem_destino";permanente=true;texto="O destino da cópia não foi encontrado ou está inacessível. Confira a configuração e as permissões da nuvem.";
  }else if(tem(["invalidrequest","invalidbucketname","invalidkey","invalidmimetype","missingcontentlength","missingparameter","invalidchecksum"])){
    codigo="nuvem_pedido";permanente=true;texto="A nuvem recusou o formato ou a configuração do envio. Preserve o backup local e confira a configuração antes de tentar novamente.";
  }else if(tem(["internalerror","databasetimeout","databaseerror","resourcelocked","locktimeout","slowdown","toomanyrequests","alreadyexists","resourcealreadyexists","keyalreadyexists"])){
    /* Conflitos e falhas transitórias ainda podem esconder um envio concluído. */
  }else if(status.indexOf(401)>=0){
    codigo="nuvem_sessao";permanente=true;texto="A sessão não foi aceita pela nuvem. Confira a conta e use Enviar cópia agora para validar a sessão novamente.";
  }else if(status.indexOf(403)>=0){
    codigo="nuvem_permissao";permanente=true;texto="A nuvem recusou a permissão de envio. Confira a conta e as permissões do armazenamento antes de tentar novamente.";
  }else if(status.indexOf(404)>=0){
    codigo="nuvem_destino";permanente=true;texto="O destino da cópia não foi encontrado ou está inacessível. Confira a configuração e as permissões da nuvem.";
  }else if(status.indexOf(400)>=0||status.indexOf(411)>=0||status.indexOf(415)>=0||status.indexOf(422)>=0){
    codigo="nuvem_pedido";permanente=true;texto="A nuvem recusou o formato ou a configuração do envio. Preserve o backup local e confira a configuração antes de tentar novamente.";
  }else if(e.code==="nuvem_tempo"){
    codigo="nuvem_tempo";texto="A nuvem demorou a responder. O envio pode ter concluído; a próxima tentativa verificará o mesmo arquivo.";
  }
  var falha=erroCopiaNuvem(codigo,texto);falha.permanente=permanente;falha.cause=original;
  if(typeof tamanhoBytes==="number"&&isFinite(tamanhoBytes)&&tamanhoBytes>=0)falha.tamanhoBytes=tamanhoBytes;
  return falha;
}
function bloqueioCopiaNuvemAtivo(){
  var b=COPIA_NUVEM.bloqueio;if(!b||b.uid!==CONTA_NUVEM.uid||b.geracao!==CONTA_NUVEM.geracao)return false;
  if(b.assinaturaDestino){try{return b.assinaturaDestino===assinaturaDestinoCopia();}catch(e){return false;}}return true;
}
function registrarFalhaCopiaNuvem(mensagem){
  var alvo=el("falhaCopiaNuvem");if(alvo){alvo.textContent=mensagem;alvo.classList.remove("oculto");}
}
function limparFalhaCopiaNuvem(){
  var alvo=el("falhaCopiaNuvem");if(alvo){alvo.textContent="";alvo.classList.add("oculto");}
}
function esperarCopiaNuvem(promessa){
  return new Promise(function(resolve,reject){
    var t=setTimeout(function(){reject(erroCopiaNuvem("nuvem_tempo","A nuvem demorou a responder."));},60000);
    Promise.resolve(promessa).then(function(v){clearTimeout(t);resolve(v);},function(e){clearTimeout(t);reject(e);});
  });
}
async function contextoCopiaNuvem(exigirEnvio){
  var cfg=window.MesaNuvem;if(!cfg||!cfg.client)throw erroCopiaNuvem("nuvem_conta","Conecte sua conta da nuvem.");
  var transporte=destinoCopiaConfigurado(),assinatura=assinaturaDestinoCopia();
  var geracao=CONTA_NUVEM.geracao,uidInicial=CONTA_NUVEM.uid,u=await consultarUsuarioNuvem();
  if(geracao!==CONTA_NUVEM.geracao)throw erroCopiaNuvem("nuvem_conta","A sessão mudou durante a operação. Tente novamente.");
  if(!u)throw erroCopiaNuvem("nuvem_conta","Conecte sua conta da nuvem.");
  if(u.id!==CONTA_NUVEM.uid){invalidarContaNuvem(u.id);if(uidInicial)throw erroCopiaNuvem("nuvem_conta","A conta mudou. Confira a conta antes de continuar.");}
  if(exigirEnvio&&(CONTA_NUVEM.pausada||!vinculoNuvemPermitido(u.id)))throw erroCopiaNuvem("nuvem_autorizacao","Autorize esta biblioteca na janela Minha conta antes de enviar trabalhos para esta conta.");
  var contexto={cfg:cfg,client:cfg.client,uid:u.id,geracao:CONTA_NUVEM.geracao,exigirEnvio:!!exigirEnvio,transporte:transporte,assinaturaDestino:assinatura};
  conferirContextoConta(contexto);return contexto;
}
async function confirmarContaCopia(c){
  conferirContextoConta(c);
  if(c.geracao!==CONTA_NUVEM.geracao)throw erroCopiaNuvem("nuvem_conta","A sessão mudou. Atualize a lista e tente novamente.");
  var atual=await contextoCopiaNuvem(c.exigirEnvio);
  conferirContextoConta(c);
  if(atual.cfg!==c.cfg||atual.client!==c.client||atual.uid!==c.uid||atual.geracao!==c.geracao)throw erroCopiaNuvem("nuvem_conta","A conta mudou. Atualize a lista e tente novamente.");
}
function caminhoVersaoCopia(caminho,uid){
  var prefixo=uid+"/sincronizacao/versoes/";
  return typeof caminho==="string"&&caminho.indexOf(prefixo)===0&&/^\d{17}-[a-f0-9]{32}\.json$/.test(caminho.slice(prefixo.length));
}
function nomeVersaoCopia(){
  if(!window.crypto||!crypto.getRandomValues)throw erroCopiaNuvem("nuvem_integridade","A verificação segura não está disponível neste navegador.");
  var bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  return new Date().toISOString().replace(/\D/g,"")+"-"+Array.prototype.map.call(bytes,function(v){return v.toString(16).padStart(2,"0");}).join("")+".json";
}
function backupNuvemTemConteudo(p){
  return [p.obras,p.capitulos,p.notas,p.desenhos,p.desenhosLivres,p.fichasPersonagem&&p.fichasPersonagem.fichas].some(function(a){return Array.isArray(a)&&a.length>0;});
}
/* MIDIA-NUVEM-INICIO */
/* Mídia na nuvem (R2) por conteúdo. Desligada por padrão: só age com ativa:true e api configurada.
   Cópia na nuvem = backup v4 com referências (sha256). Download da cópia = arquivo v3 autocontido. */
var MIDIA_NUVEM={ativa:true,api:"https://mesa-midia.mesa-roteiro-d90994b6.workers.dev",accountId:"d90994b604856f19411d68d5fedfc888",bucket:"mesa-roteiro-backups"};
var MIDIA_LIMITE_BYTES=50*1024*1024, MIDIA_TIMEOUT_MS=30000, MIDIA_EXPIRA_MS=900000;
var MIDIA_TIPOS=["image/png","image/jpeg","image/webp","image/gif","application/octet-stream"];
var MIDIA_RE_SHA=/^[a-f0-9]{64}$/;
function midiaHex(buf){return Array.prototype.map.call(new Uint8Array(buf),function(x){return x.toString(16).padStart(2,"0");}).join("");}
async function midiaShaBytes(buf){
  if(!window.crypto||!crypto.subtle)throw erroCopiaNuvem("nuvem_integridade","A verificação SHA-256 não está disponível. Use um backup local e tente em uma página segura.");
  return midiaHex(await crypto.subtle.digest("SHA-256",buf));
}
function usarMidiaNuvem(c){return !!(MIDIA_NUVEM.ativa&&MIDIA_NUVEM.api&&c&&c.transporte&&c.transporte.provedor==="r2");}
function midiaTipo(blob){var t=(blob&&blob.type)||"";return MIDIA_TIPOS.indexOf(t)>=0?t:"application/octet-stream";}
function midiaFetch(url,opcoes){
  var controle=new AbortController(),timer=setTimeout(function(){controle.abort();},MIDIA_TIMEOUT_MS);
  return fetch(url,Object.assign({},opcoes,{signal:controle.signal,credentials:"omit",redirect:"error",cache:"no-store",referrerPolicy:"no-referrer"}))
    .catch(function(){throw erroCopiaNuvem("nuvem_envio","Não foi possível falar com a nuvem de mídia. Tente novamente; nenhuma cópia foi confirmada.");})
    .finally(function(){clearTimeout(timer);});
}
async function midiaToken(c){
  var r=await c.client.auth.getSession(),s=r&&r.data&&r.data.session;
  if(r&&r.error||!s||!s.user||s.user.id!==c.uid||typeof s.access_token!=="string"||!s.access_token)throw erroCopiaNuvem("nuvem_conta","Entre na sua conta para usar a mídia na nuvem.");
  return s.access_token;
}
/* Confere a autorização antes de usar: host, bucket, prefixo do uid, validade e cabeçalhos exatos. */
function midiaValidarAutorizacao(a,c,metodo,sha,tipo){
  var agora=Date.now(),falha=function(m){return erroCopiaNuvem("nuvem_integridade",m);};
  if(!a||typeof a!=="object"||typeof a.url!=="string"||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=agora||a.expiresAt>agora+MIDIA_EXPIRA_MS+1000||!a.headers||typeof a.headers!=="object")throw falha("A autorização da mídia é inválida ou expirou.");
  var u;try{u=new URL(a.url);}catch(e){throw falha("A autorização da mídia contém um endereço inválido.");}
  if(u.protocol!=="https:"||u.host!==MIDIA_NUVEM.accountId+".r2.cloudflarestorage.com"||u.username||u.password||u.hash||u.pathname!=="/"+MIDIA_NUVEM.bucket+"/"+c.uid+"/midia/"+sha)throw falha("O endereço autorizado não corresponde ao destino da mídia.");
  var q=u.searchParams,nomes=[];q.forEach(function(v,k){nomes.push(k);});
  var permitidos=["X-Amz-Algorithm","X-Amz-Credential","X-Amz-Date","X-Amz-Expires","X-Amz-SignedHeaders","X-Amz-Signature"];
  if(nomes.length!==6||nomes.some(function(k){return permitidos.indexOf(k)<0;}))throw falha("A assinatura da mídia contém parâmetros inesperados.");
  var exp=q.get("X-Amz-Expires"),data=q.get("X-Amz-Date")||"",cred=q.get("X-Amz-Credential")||"";
  if(q.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256"||!/^[1-9][0-9]{0,2}$/.test(exp||"")||+exp>900||!/^\d{8}T\d{6}Z$/.test(data)||!/^[A-Za-z0-9]+\/\d{8}\/auto\/s3\/aws4_request$/.test(cred)||!/^[a-f0-9]{64}$/.test(q.get("X-Amz-Signature")||""))throw falha("A assinatura da mídia não corresponde ao formato esperado.");
  var esperados=metodo==="PUT"?{"content-type":tipo,"if-none-match":"*","x-amz-meta-sha256":sha}:{};
  if(metodo==="PUT"&&(q.get("X-Amz-SignedHeaders")||"").indexOf("if-none-match")<0)throw falha("A assinatura da mídia não protege a regra de criação única.");
  var chaves=Object.keys(a.headers),ok=chaves.length===Object.keys(esperados).length&&chaves.every(function(k){return Object.prototype.hasOwnProperty.call(esperados,k.toLowerCase())&&a.headers[k]===esperados[k.toLowerCase()];});
  if(!ok)throw falha("Os cabeçalhos da autorização da mídia divergem do envio esperado.");
  return a;
}
async function midiaPedirAutorizacao(c,rota,corpo){
  var token=await midiaToken(c);
  var r=await midiaFetch(MIDIA_NUVEM.api+rota,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(corpo)});
  if(r.status===401)throw erroCopiaNuvem("nuvem_conta","A sessão expirou. Entre novamente para usar a mídia na nuvem.");
  if(!r.ok)throw erroCopiaNuvem("nuvem_envio","A nuvem de mídia recusou o pedido. Nenhuma cópia foi confirmada.");
  try{return await r.json();}catch(e){throw erroCopiaNuvem("nuvem_integridade","A autorização da mídia veio em formato inválido.");}
}
/* Envia um blob pelo endereço pré-assinado. 412 = o mesmo conteúdo (mesmo hash) já existe: é sucesso. */
async function midiaEnviar(c,m){
  var a=midiaValidarAutorizacao(await midiaPedirAutorizacao(c,"/v2/midia/uploads",{sha256:m.sha256,bytes:m.tamanho,tipo:m.tipo}),c,"PUT",m.sha256,m.tipo);
  var r=await midiaFetch(a.url,{method:"PUT",headers:a.headers,body:m.blob});
  if(r.status===412)return "existente";
  if(!r.ok)throw erroCopiaNuvem("nuvem_envio","Não foi possível enviar uma imagem à nuvem. Nenhuma cópia foi confirmada.");
  return "enviada";
}
/* Baixa um objeto e confere o hash antes de devolver: nada é usado sem essa conferência. */
async function midiaBaixar(c,sha,tipo){
  var a=midiaValidarAutorizacao(await midiaPedirAutorizacao(c,"/v2/midia/downloads",{sha256:sha}),c,"GET",sha,null);
  var r=await midiaFetch(a.url,{method:"GET"});
  if(!r.ok)throw erroCopiaNuvem("nuvem_envio","Uma imagem da cópia não está disponível na nuvem. A restauração foi interrompida.");
  var buf=await r.arrayBuffer();
  if(buf.byteLength<1||buf.byteLength>MIDIA_LIMITE_BYTES)throw erroCopiaNuvem("nuvem_integridade","Uma imagem da nuvem tem tamanho inválido. A restauração foi interrompida.");
  if(await midiaShaBytes(buf)!==sha)throw erroCopiaNuvem("nuvem_integridade","Uma imagem da nuvem não confere com o registro. A restauração foi interrompida.");
  return new Blob([buf],{type:tipo});
}
/* v3 (local) -> v4 (nuvem): troca cada imagem por referência. Não envia nada: só calcula hashes.
   Devolve também a lista de blobs que ainda precisam ser enviados. */
async function formaNuvemComMidia(pacote,c){
  var catalogo=Object.create(null),pendentes=[],copia=dadosProfundos(pacote);
  async function ref(valor){
    if(valor==null)return null;
    var blob=typeof valor==="string"?window.EditorDesenho.dataParaBlob(valor):valor;
    if(!(blob instanceof Blob))throw erroCopiaNuvem("nuvem_integridade","Uma imagem do backup está em formato inválido. Use um backup local.");
    if(blob.size<1||blob.size>MIDIA_LIMITE_BYTES)throw erroCopiaNuvem("nuvem_tamanho","Uma imagem passa do limite de 50 MB para a nuvem. Use Baixar backup local.");
    var sha=await midiaShaBytes(await blob.arrayBuffer()),tipo=midiaTipo(blob);
    if(!catalogo[sha]){catalogo[sha]={sha256:sha,tamanho:blob.size,tipo:tipo};pendentes.push({sha256:sha,tamanho:blob.size,tipo:tipo,blob:blob});}
    return {sha256:sha,tamanho:blob.size,tipo:tipo};
  }
  var notas=Array.isArray(copia.notas)?copia.notas:[];
  for(var i=0;i<notas.length;i++){var d=notas[i].dados;if(d&&Array.isArray(d.imagensDados)){d.imagensRef=[];for(var j=0;j<d.imagensDados.length;j++){var im=d.imagensDados[j],r=await ref(im.src);d.imagensRef.push({meta:im.meta,sha256:r.sha256,tamanho:r.tamanho,tipo:r.tipo});}delete d.imagensDados;}}
  var fichas=copia.fichasPersonagem&&Array.isArray(copia.fichasPersonagem.imagens)?copia.fichasPersonagem.imagens:[];
  for(var f=0;f<fichas.length;f++){var fr=await ref(fichas[f].src);fichas[f]={chave:fichas[f].chave,nome:fichas[f].nome,sha256:fr.sha256,tamanho:fr.tamanho,tipo:fr.tipo};}
  var desenhos=Array.isArray(copia.desenhos)?copia.desenhos:[];
  for(var k=0;k<desenhos.length;k++){var camadas=(desenhos[k].rec&&desenhos[k].rec.camadas)||[];for(var q=0;q<camadas.length;q++){var cam=camadas[q];cam.blobRef=await ref(cam.blob);delete cam.blob;cam.originalBlobRef=await ref(cam.originalBlob);delete cam.originalBlob;}}
  copia.versao=4;copia.modo="referencias";
  copia.midia=Object.keys(catalogo).sort().map(function(s){return catalogo[s];});
  return {pacote:copia,pendentes:pendentes};
}
/* Valida a forma v4 sem depender de dados embutidos: referências bem formadas e todas no catálogo. */
function validarFormaNuvemV4(p){
  var falha=function(m){var e=new Error("Cópia v4: "+m);e.code="backup_formato";return e;};
  if(p.versao!==4||p.modo!=="referencias"||!Array.isArray(p.midia))throw falha("cabeçalho inválido");
  var catalogo=Object.create(null);
  p.midia.forEach(function(m){if(!m||typeof m.sha256!=="string"||!MIDIA_RE_SHA.test(m.sha256)||!Number.isSafeInteger(m.tamanho)||m.tamanho<1||m.tamanho>MIDIA_LIMITE_BYTES||MIDIA_TIPOS.indexOf(m.tipo)<0)throw falha("item do catálogo inválido");catalogo[m.sha256]=true;});
  function conferir(r){if(!r||typeof r.sha256!=="string"||!catalogo[r.sha256])throw falha("referência fora do catálogo");}
  (p.notas||[]).forEach(function(n){((n.dados&&n.dados.imagensRef)||[]).forEach(function(r){conferir(r);});});
  ((p.fichasPersonagem&&p.fichasPersonagem.imagens)||[]).forEach(conferir);
  (p.desenhos||[]).forEach(function(d){((d.rec&&d.rec.camadas)||[]).forEach(function(cam){if(cam.blob||cam.originalBlob)throw falha("dados embutidos em cópia de referências");conferir(cam.blobRef);if(cam.originalBlobRef)conferir(cam.originalBlobRef);});});
  return true;
}
/* v4 (nuvem) -> v3 (arquivo autocontido): baixa e confere cada imagem, depois reconstrói os dados embutidos. */
async function hidratarNuvemParaArquivo(pacote,c){
  validarFormaNuvemV4(pacote);
  var copia=dadosProfundos(pacote),tamanhos={};
  (copia.midia||[]).forEach(function(m){tamanhos[m.sha256]=m;});
  var cache=Object.create(null);
  async function obter(r){
    if(r==null)return null;
    var m=tamanhos[r.sha256];
    if(!cache[r.sha256])cache[r.sha256]=await midiaBaixar(c,r.sha256,m.tipo);
    return window.EditorDesenho.blobParaData(cache[r.sha256]);
  }
  var notas=copia.notas||[];
  for(var i=0;i<notas.length;i++){var d=notas[i].dados;if(d&&Array.isArray(d.imagensRef)){d.imagensDados=[];for(var j=0;j<d.imagensRef.length;j++){var r=d.imagensRef[j];d.imagensDados.push({meta:r.meta,src:await obter(r)});}delete d.imagensRef;}}
  if(copia.fichasPersonagem&&Array.isArray(copia.fichasPersonagem.imagens)){var fs=copia.fichasPersonagem.imagens;for(var f=0;f<fs.length;f++){var fr=fs[f];fs[f]={chave:fr.chave,nome:fr.nome,src:await obter(fr)};}}
  var desenhos=copia.desenhos||[];
  for(var k=0;k<desenhos.length;k++){var camadas=(desenhos[k].rec&&desenhos[k].rec.camadas)||[];for(var q=0;q<camadas.length;q++){var cam=camadas[q];cam.blob=await obter(cam.blobRef);delete cam.blobRef;cam.originalBlob=await obter(cam.originalBlobRef);delete cam.originalBlobRef;}}
  delete copia.midia;delete copia.modo;copia.versao=3;
  return copia;
}
/* MIDIA-NUVEM-FIM */

async function resumoCopiaNuvem(p){
  var copia=dadosProfundos(p);delete copia.criadoEm;delete copia.integridade;
  copia.preferenciasLocal=(copia.preferenciasLocal||[]).filter(function(v){return v.chave!=="mesa:offline-cache"&&!/^mesa:(backup-|sync-meta)/.test(v.chave);}).sort(function(a,b){return a.chave<b.chave?-1:a.chave>b.chave?1:0;});
  var resumo=await sha256Texto(JSON.stringify(copia));
  if(!resumo)throw erroCopiaNuvem("nuvem_integridade","A verificação SHA-256 não está disponível. Use um backup local e tente em uma página segura.");
  return resumo;
}
async function validarTextoCopiaNuvem(texto,estrito){
  var v=await verificarTextoBackup(texto);
  if(!v.ok||(estrito&&v.legado))throw erroCopiaNuvem("nuvem_integridade","A verificação SHA-256 da cópia falhou ou está ausente.");
  if(v.pacote&&v.pacote.versao===4){validarFormaNuvemV4(v.pacote);v.plano={avisos:[],total:0};return v;}
  var plano=validarBackupParaImportacao(v.pacote);
  if(estrito&&plano.avisos.length)throw erroCopiaNuvem("nuvem_integridade","A cópia contém referências a imagens ausentes. Preserve seus backups e confira as imagens.");
  v.plano=plano;return v;
}
async function lerTextoCopiaNuvem(c,caminho,origem){
  if(caminho!==c.uid+"/sincronizacao/atual.json"&&!caminhoVersaoCopia(caminho,c.uid))throw erroCopiaNuvem("nuvem_caminho","O caminho da cópia não pertence à conta atual.");
  await confirmarContaCopia(c);
  conferirContextoConta(c);
  var leitura=contextoLeituraCopia(c,origem);
  if(leitura.transporte&&leitura.transporte.provedor==="r2"){
    var textoR2=await lerArquivoCopiaR2(leitura,caminho);await confirmarContaCopia(c);conferirOperacaoR2(leitura);return textoR2;
  }
  var r=await esperarCopiaNuvem(c.client.storage.from("mesa-arquivos").download(caminho));if(r.error)throw r.error;
  if(!r.data||typeof r.data.text!=="function")throw erroCopiaNuvem("nuvem_integridade","A nuvem não retornou o arquivo esperado.");
  var texto=await esperarCopiaNuvem(r.data.text());await confirmarContaCopia(c);conferirContextoConta(c);return texto;
}
function programarCopiaNuvem(atraso){
  clearTimeout(temporizadorBackupNuvem);
  temporizadorBackupNuvem=setTimeout(function(){temporizadorBackupNuvem=null;enviarBackupNuvemAutomatico();},atraso);
}
function agendarBackupNuvem(){
  COPIA_NUVEM.revisao++;
  if(bloqueioCopiaNuvemAtivo()){
    clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;
    var pausado=el("estadoNuvem");if(pausado)pausado.textContent="Cópia não confirmada · "+COPIA_NUVEM.bloqueio.mensagem+" Envios automáticos pausados; confira Backup.";
    return;
  }
  COPIA_NUVEM.tentativas=0;
  if(!contaNuvemPronta) return;
  programarCopiaNuvem(120000);
}
/* O editor usa este ponto de entrada depois de confirmar uma transação. */
window.agendarBackupNuvem=agendarBackupNuvem;
async function enviarBackupNuvemAutomatico(forcar){
  try{if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();}catch(e){var pend=el("estadoNuvem");if(pend)pend.textContent="Importação em recuperação · cópia adiada";return false;}
  if(backupNuvemEmCurso)return false;
  var alvo=el("estadoNuvem");
  if(forcar!==true&&bloqueioCopiaNuvemAtivo())return false;
  if(!navigator.onLine){if(alvo)alvo.textContent="Sem internet · cópia pendente";return false;}
  if(!contaNuvemPronta&&forcar!==true)return false;
  clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;
  if(forcar===true){COPIA_NUVEM.tentativas=0;COPIA_NUVEM.pendente=null;COPIA_NUVEM.bloqueio=null;limparFalhaCopiaNuvem();}
  backupNuvemEmCurso=true;
  var revisao=COPIA_NUVEM.revisao,geracaoEnvio=CONTA_NUVEM.geracao,adiar=false,falhou=false,confirmou=false;
  try{
    var c=await contextoCopiaNuvem(true),p=COPIA_NUVEM.pendente;
    conferirContextoConta(c);
    if(p&&(p.uid!==c.uid||!mesmoDestinoCopia(p,c))){COPIA_NUVEM.pendente=null;p=null;}
    if(p)revisao=p.revisao;
    if(!p){
      if(alvo)alvo.textContent="Preparando versão da nuvem…";
      var pacote=await criarBackup();
      conferirContextoConta(c);
      if(!backupNuvemTemConteudo(pacote)){if(alvo)alvo.textContent="Nenhum trabalho local · cópias anteriores preservadas";return false;}
      var formaResumo=usarMidiaNuvem(c)?(await formaNuvemComMidia(pacote,c)).pacote:pacote;var resumo=await resumoCopiaNuvem(formaResumo),anterior=COPIA_NUVEM.ultima;
      conferirContextoConta(c);
      if(!anterior)try{anterior=lerMetaLocal("backup-nuvem-versao-v1");}catch(e){anterior=null;}
      if(forcar!==true&&anterior&&anterior.uid===c.uid&&mesmoDestinoCopia(anterior,c)&&anterior.resumo===resumo&&caminhoVersaoCopia(anterior.caminho,c.uid)){
        var antiga=await validarTextoCopiaNuvem(await lerTextoCopiaNuvem(c,anterior.caminho),true);
        var resumoAnterior=await resumoCopiaNuvem(antiga.pacote);conferirContextoConta(c);
        if(resumoAnterior!==resumo)throw erroCopiaNuvem("nuvem_integridade","A cópia anterior não corresponde aos trabalhos locais. Use Enviar cópia agora para criar outra versão.");
        if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
        COPIA_NUVEM.ultima=anterior;COPIA_NUVEM.tentativas=0;
        confirmou=true;limparFalhaCopiaNuvem();
        if(alvo)alvo.textContent="Cópia anterior verificada · sem novas alterações";return true;
      }
      var forma=usarMidiaNuvem(c)?await formaNuvemComMidia(pacote,c):{pacote:pacote,pendentes:[]};for(var pi=0;pi<forma.pendentes.length;pi++){await midiaEnviar(c,forma.pendentes[pi]);conferirContextoConta(c);}var texto=await prepararBackup(forma.pacote);await validarTextoCopiaNuvem(texto,true);
      conferirContextoConta(c);
      p=Object.assign({uid:c.uid,caminho:c.uid+"/sincronizacao/versoes/"+nomeVersaoCopia(),texto:texto,resumo:resumo,revisao:revisao,enviada:false},referenciaDestinoCopia(c));
      COPIA_NUVEM.pendente=p;
    }
    await confirmarContaCopia(c);
    conferirContextoConta(c);
    if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
    if(!p.enviada){
      if(alvo)alvo.textContent="Enviando nova versão da nuvem…";
      var arquivoEnvio=new Blob([p.texto],{type:"application/json"}), falhaEnvio=null;
      try{
        var r=await enviarArquivoCopiaNuvem(c,p,arquivoEnvio);
        if(r.error)falhaEnvio=r.error;
      }catch(erroEnvio){falhaEnvio=erroEnvio;}
      conferirContextoConta(c);
      if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
      if(falhaEnvio){
        var causaEnvio=normalizarErroEnvioNuvem(falhaEnvio,arquivoEnvio.size);
        if(causaEnvio.permanente)throw causaEnvio;
        /* Uma resposta perdida pode esconder um upload já concluído. Não troque o caminho. */
        var existente;
        try{existente=await lerTextoCopiaNuvem(c,p.caminho);}catch(erroReleitura){
          conferirContextoConta(c);
          if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
          if(erroReleitura&&(erroReleitura.code==="nuvem_conta"||erroReleitura.pendente))throw erroReleitura;
          causaEnvio.falhaReleitura=erroReleitura;throw causaEnvio;
        }
        if(existente!==p.texto)throw erroCopiaNuvem("nuvem_integridade","O arquivo remoto não corresponde ao envio. Nenhuma cópia foi substituída.");
      }
      conferirContextoConta(c);p.enviada=true;
    }
    if(alvo)alvo.textContent="Conferindo a versão enviada…";
    var relido=await lerTextoCopiaNuvem(c,p.caminho);
    conferirContextoConta(c);
    if(relido!==p.texto)throw erroCopiaNuvem("nuvem_integridade","A releitura da nuvem divergiu do arquivo enviado. A cópia não foi confirmada.");
    await validarTextoCopiaNuvem(relido,true);await confirmarContaCopia(c);
    conferirContextoConta(c);
    if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
    var meta=Object.assign({uid:c.uid,resumo:p.resumo,caminho:p.caminho,em:Date.now()},referenciaDestinoCopia(c));
    COPIA_NUVEM.ultima=meta;COPIA_NUVEM.pendente=null;COPIA_NUVEM.tentativas=0;
    gravarMetaLocal("backup-nuvem-versao-v1",meta);
    confirmou=true;limparFalhaCopiaNuvem();
    if(alvo)alvo.textContent="Versão na nuvem verificada · "+horaCurta(meta.em);
    return true;
  }catch(e){
    if((c?c.geracao:geracaoEnvio)!==CONTA_NUVEM.geracao)return false;
    if(e&&e.code==="nuvem_destino_alterado"||c&&!destinoCopiaVigente(c)){COPIA_NUVEM.pendente=null;if(alvo)alvo.textContent="O destino mudou. Atualize a conta e a lista antes de tentar novamente.";return false;}
    if(e&&e.code==="nuvem_conta"){if(alvo)alvo.textContent="Conta não confirmada · confira a sessão antes de tentar novamente";return false;}
    if(e&&e.pendente){COPIA_NUVEM.pendente=null;adiar=true;if(alvo)alvo.textContent="Importação em recuperação · cópia adiada";return false;}
    if(e&&e.code==="backup_ocupado"){adiar=true;if(alvo)alvo.textContent="Cópia adiada · operação local em andamento";return false;}
    falhou=true;COPIA_NUVEM.tentativas++;
    var leituraLocal=e&&/^(leitura_local|leitura_imagem|registro_imagem|desenho_ausente)$/.test(e.code||"");
    var detalhe=e&&(leituraLocal||/^(nuvem_|backup_)/.test(e.code||""))?e.message:"Confira conexão, conta, espaço e permissões do bucket mesa-arquivos.";
    if(e&&e.permanente===true){
      COPIA_NUVEM.pendente=null;
      COPIA_NUVEM.bloqueio={uid:c.uid,geracao:c.geracao,mensagem:detalhe,assinaturaDestino:c.assinaturaDestino};
    }
    if(alvo)alvo.textContent="Cópia não confirmada · "+(leituraLocal?"falha na leitura local: ":"")+detalhe;
    registrarFalhaCopiaNuvem("Cópia não confirmada. "+detalhe+(bloqueioCopiaNuvemAtivo()?" Envios automáticos pausados. Após corrigir o problema, use Enviar cópia agora.":" As versões anteriores permanecem preservadas."));
    aviso("A nova cópia na nuvem não foi confirmada. As versões anteriores permanecem preservadas. Use Backup para tentar novamente.");return false;
  }finally{
    backupNuvemEmCurso=false;
    if((c?c.geracao:geracaoEnvio)===CONTA_NUVEM.geracao&&(!c||destinoCopiaVigente(c))){
    if(confirmou&&COPIA_NUVEM.revisao!==revisao&&alvo)alvo.textContent="Versão verificada · novas alterações aguardando cópia";
    if(bloqueioCopiaNuvemAtivo()){clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;if(alvo)alvo.textContent+=" Envios automáticos pausados; confira Backup.";}
    else if(contaNuvemPronta&&adiar)programarCopiaNuvem(120000);
    else if(contaNuvemPronta&&falhou&&COPIA_NUVEM.tentativas<5)programarCopiaNuvem(Math.min(120000*Math.pow(2,COPIA_NUVEM.tentativas-1),900000));
    else if(falhou){clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;if(alvo)alvo.textContent+=" Tentativas automáticas pausadas; use Enviar cópia agora.";}
    else if(contaNuvemPronta&&COPIA_NUVEM.revisao!==revisao)programarCopiaNuvem(120000);
    }
  }
}
async function restaurarBackupDaNuvem(){
  return listarCopiasNuvem(false);
}
async function listarCopiasNuvem(mais){
  if(COPIA_NUVEM.consultando||COPIA_NUVEM.baixando)return false;
  COPIA_NUVEM.consultando=true;
  var alvo=el("estadoCopiasNuvem"),botao=el("btMaisCopiasNuvem"),geracaoLista=CONTA_NUVEM.geracao;
  try{
    alvo.textContent="Consultando cópias da conta…";
    var c=await contextoCopiaNuvem();
    conferirContextoConta(c);
    if(!mais||!COPIA_NUVEM.contextoLista||COPIA_NUVEM.contextoLista.uid!==c.uid||COPIA_NUVEM.contextoLista.client!==c.client||COPIA_NUVEM.contextoLista.cfg!==c.cfg||COPIA_NUVEM.contextoLista.assinaturaDestino!==c.assinaturaDestino){COPIA_NUVEM.lista=[];COPIA_NUVEM.offset=0;COPIA_NUVEM.cursorR2=null;COPIA_NUVEM.fimR2=false;COPIA_NUVEM.fimSupabase=false;COPIA_NUVEM.contextoLista=c;}
    if(c.transporte.provedor==="r2")return await listarCopiasR2ComLegado(c,alvo,botao);
    var r=await esperarCopiaNuvem(c.client.storage.from("mesa-arquivos").list(c.uid+"/sincronizacao/versoes",{limit:50,offset:COPIA_NUVEM.offset,sortBy:{column:"name",order:"desc"}}));if(r.error)throw r.error;
    if(!Array.isArray(r.data))throw erroCopiaNuvem("nuvem_integridade","A listagem da nuvem está incompleta.");
    await confirmarContaCopia(c);
    conferirContextoConta(c);
    r.data.forEach(function(v){var caminho=c.uid+"/sincronizacao/versoes/"+v.name;if(caminhoVersaoCopia(caminho,c.uid)&&!COPIA_NUVEM.lista.some(function(a){return a.caminho===caminho;}))COPIA_NUVEM.lista.push({provedor:"supabase",destino:c.cfg.url,caminho:caminho,nome:v.name,data:v.created_at||"",legado:false});});
    COPIA_NUVEM.offset+=r.data.length;
    botao.classList.toggle("oculto",r.data.length<50);
    /* O arquivo usado pelas versões antigas permanece disponível, sem ser regravado. */
    if(!COPIA_NUVEM.lista.some(function(v){return v.legado;}))COPIA_NUVEM.lista.push({provedor:"supabase",destino:c.cfg.url,caminho:c.uid+"/sincronizacao/atual.json",nome:"Cópia antiga (se disponível)",legado:true});
    renderCopiasNuvem();alvo.textContent="Selecione uma cópia para baixar e verificar. O download não altera os trabalhos locais.";return true;
  }catch(e){
    if((c?c.geracao:geracaoLista)!==CONTA_NUVEM.geracao)return false;
    COPIA_NUVEM.lista=[];COPIA_NUVEM.contextoLista=null;botao.classList.add("oculto");renderCopiasNuvem();
    alvo.textContent="Não foi possível consultar as cópias. Confira sua conta, conexão e permissões; uma lista vazia não comprova ausência de backups.";return false;
  }finally{COPIA_NUVEM.consultando=false;}
}
function renderCopiasNuvem(){
  var lista=el("listaCopiasNuvem");lista.replaceChildren();
  COPIA_NUVEM.lista.forEach(function(v,i){
    var linha=document.createElement("p"),texto=document.createElement("span"),bt=document.createElement("button");
    texto.textContent=v.legado?v.nome:((v.provedor==="r2"?"R2 · ":COPIA_NUVEM.contextoLista&&COPIA_NUVEM.contextoLista.transporte&&COPIA_NUVEM.contextoLista.transporte.provedor==="r2"?"Supabase · ":"")+"Versão "+(v.data?dataNota(v.data,true):v.nome));
    bt.type="button";bt.className="bt mini";bt.textContent="Baixar e verificar";
    bt.onclick=function(){return baixarCopiaNuvem(i);};linha.append(texto,document.createTextNode(" "),bt);lista.appendChild(linha);
  });
}
async function baixarCopiaNuvem(indice){
  if(COPIA_NUVEM.baixando||COPIA_NUVEM.consultando)return false;
  var item=COPIA_NUVEM.lista[indice],c=COPIA_NUVEM.contextoLista,alvo=el("estadoCopiasNuvem");if(!item||!c)return false;
  COPIA_NUVEM.baixando=true;
  try{
    if(!baixador)throw erroCopiaNuvem("nuvem_download","Download indisponível neste navegador.");
    alvo.textContent="Baixando e verificando a cópia…";
    var texto=await lerTextoCopiaNuvem(c,item.caminho,item),ver=await validarTextoCopiaNuvem(texto,!item.legado);await confirmarContaCopia(c);if(ver.pacote.versao===4){var arquivoV3=await hidratarNuvemParaArquivo(ver.pacote,c);conferirContextoConta(c);texto=await prepararBackup(arquivoV3);ver=await validarTextoCopiaNuvem(texto,true);}
    conferirContextoConta(c);
    var p=ver.pacote,resumo=(p.obras||[]).length+" obra(s), "+(p.capitulos||[]).length+" capítulo(s), "+(p.notas||[]).length+" nota(s), "+(p.desenhos||[]).length+" desenho(s).";
    await baixador.save({filename:item.legado?"mesa-de-roteiro-copia-antiga.json":"mesa-de-roteiro-"+item.nome,data:texto});
    if(c.geracao!==CONTA_NUVEM.geracao)return true;
    alvo.textContent=(ver.legado?"Cópia antiga baixada sem SHA-256; confira o conteúdo.":"Arquivo verificado por SHA-256 e preparado para download.")+" "+resumo+(ver.plano.avisos.length?" Atenção: "+ver.plano.avisos.join("; ")+".":"")+" Preserve um backup local antes de usar Importar backup.";
    return true;
  }catch(e){if(c.geracao===CONTA_NUVEM.geracao)alvo.textContent="O download não foi confirmado. A cópia pode estar ausente, inacessível ou inválida. Seus trabalhos locais permanecem intactos.";return false;}
  finally{COPIA_NUVEM.baixando=false;}
}
async function iniciarArmazenamento(){
  dbLocal=window.__mesaArmazenamento.db;
  db=dbLocal; base=baseLocal;
  baixador=window.__mesaArmazenamento.baixador;
  if(!window.__mesaArmazenamento.temLocalStorage){
    aviso("Este navegador bloqueou o armazenamento local — as mudanças não vão persistir ao recarregar.");
  }
  if(window.__mesaFalhaIndexedDB){
    aviso("O armazenamento de imagens/desenhos falhou e está apenas temporário nesta sessão. Faça um backup e não feche a página antes de resolver.");
  }
  try{ await iniciarContaNuvem(); }catch(e){ var estadoN=el("estadoNuvem"); if(estadoN) estadoN.textContent="Nuvem indisponível"; }
}

function colObras(){ return db.collection(base+"/obras"); }
function colCaps(){ return db.collection(base+"/capitulos"); }
function colNotas(){ return db.collection(base+"/notas"); }

/* Backup portátil completo. A versão 3 acrescenta preferências locais e uma soma
   SHA-256 do conteúdo; as versões antigas continuam aceitas na importação. */
function preferenciasBackup(){
  var out=[], prefixos=["mesa:","mesa.ed."];
  if(window.__mesaArmazenamento&&window.__mesaArmazenamento.modoMemoria)return out;
  /* Textos (roteiros/local/...) já vão em obras/capitulos/notas e o cache offline é derivado; não os duplicamos aqui. */
  try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(typeof k!=="string")throw erroLeituraLocal();if(prefixos.some(function(p){return k.indexOf(p)===0;})&&k.indexOf("mesa:roteiros/")!==0&&k!=="mesa:offline-cache"){var valor=localStorage.getItem(k);if(valor===null)throw erroLeituraLocal();out.push({chave:k,valor:valor});}}}catch(e){throw erroLeituraLocal("Não foi possível ler todas as preferências e bibliotecas locais. O backup completo foi interrompido.");}
  return out;
}
async function sha256Texto(texto){
  if(!window.crypto||!crypto.subtle||!window.TextEncoder) return null;
  var b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(texto));
  return Array.prototype.map.call(new Uint8Array(b),function(x){return x.toString(16).padStart(2,"0");}).join("");
}
async function prepararBackup(pacote){
  var texto=JSON.stringify(pacote), soma=await sha256Texto(texto);
  pacote.integridade={algoritmo:soma?"SHA-256":"indisponivel",conteudo:soma,tamanho:texto.length};
  return JSON.stringify(pacote,null,2);
}
async function verificarTextoBackup(texto){
  var p=JSON.parse(texto), i=p.integridade;
  if(!i||i.algoritmo!=="SHA-256"||!i.conteudo) return {ok:true,legado:true,pacote:p};
  var copia={}; Object.keys(p).forEach(function(k){if(k!=="integridade") copia[k]=p[k];});
  var soma=await sha256Texto(JSON.stringify(copia));
  return {ok:!!soma&&soma===i.conteudo,legado:false,pacote:p};
}
function atualizarPastaBackup(){
  var alvo=el("pastaBackup"), bt=el("btSalvarNaPasta"), ar=window.__mesaArmazenamento;
  if(!alvo||!ar) return;
  if(!ar.suportaPasta){ alvo.textContent="Pasta de backup: este navegador não oferece a escolha de pasta. Use “Baixar backup”."; if(bt) bt.disabled=true; return; }
  ar.nomePastaBackup().then(function(n){ alvo.textContent=n?"Pasta de backup: "+n+". O navegador poderá pedir autorização novamente.":"Pasta de backup: não escolhida."; if(bt) bt.disabled=!n; });
}
/* Os pixels das camadas e as imagens das notas seguem juntos no arquivo. */
async function criarBackup(){
  if(acaoTextoAtiva){var ocupado=new Error("Backup adiado: uma operação local ainda está em andamento.");ocupado.code="backup_ocupado";throw ocupado;}
  var pacote=await executarAcaoTexto(criarBackupSalvo,true);
  if(!pacote)throw new Error("Backup interrompido: aguarde a operação em andamento e confirme o salvamento das alterações antes de tentar novamente.");
  return pacote;
}
async function criarBackupSalvo(){
  /* Salvar o desenho pode atualizar os metadados do capítulo via aoMudar. */
  var desenhos=window.EditorDesenho&&window.EditorDesenho.exportarDados?await window.EditorDesenho.exportarDados():[];
  if(await salvarPendenciasTexto()!==true)throw new Error("Backup interrompido: não foi possível confirmar os metadados após salvar o desenho.");
  var livresConfirmados=dadosProfundos(lerListaEssencial("desenhos-livres"));lerListaEssencial("fichas-personagem-v1");
  var grupos=["obras","capitulos","notas"], pacote={versao:3,formato:"mesa-de-roteiro-backup",criadoEm:Date.now(),obras:[],capitulos:[],notas:[],desenhos:desenhos,desenhosLivres:livresConfirmados,preferenciasLocal:preferenciasBackup()};
  for(var i=0;i<grupos.length;i++){
    var grupo=grupos[i], lista=await db.collection(base+"/"+grupo).get();
    pacote[grupo]=lista.docs.map(function(item){ return {id:item.id,dados:dadosProfundos(item.data())}; });
  }
  for(var ci=0;ci<pacote.capitulos.length;ci++){
    var cd=pacote.capitulos[ci].dados;
  }
  for(var ni=0;ni<pacote.notas.length;ni++){
    var nd=pacote.notas[ni].dados, refs=Array.isArray(nd.imagens)?nd.imagens:[]; nd.imagensDados=[];
    for(var nj=0;nj<refs.length;nj++){var rec=await bdLer(notaImagemChave(pacote.notas[ni].id,refs[nj].id));if(!rec||!rec.src){var erro=new Error("Backup interrompido: uma imagem da nota não está disponível. Preserve os backups anteriores e verifique a nota antes de tentar novamente.");erro.code="backup_incompleto";throw erro;}nd.imagensDados.push({meta:refs[nj],src:rec.src});}
  }
  conferirDesenhosReferenciados(pacote);
  pacote.fichasPersonagem=await exportarFichasPersonagem();
  return pacote;
}
function conferirDesenhosReferenciados(pacote){
  var encontrados=Object.create(null);
  (pacote.desenhos||[]).forEach(function(v){if(v&&v.rec&&Array.isArray(v.rec.camadas)&&v.rec.camadas.length&&v.rec.camadas.every(function(c){return c&&c.blob;}))encontrados[String(v.id)]=true;});
  (pacote.capitulos||[]).forEach(function(c){((c.dados&&c.dados.paginas)||[]).forEach(function(pg){(pg.paineis||[]).forEach(function(pn){if(pn.temDesenho&&!encontrados[String(pn.id)]){var erro=new Error("Um painel referencia um desenho indisponível. O backup completo foi interrompido; preserve suas cópias anteriores.");erro.code="backup_incompleto";throw erro;}});});});
}
async function baixarBackup(){
  if(!baixador){ aviso("Download indisponível neste navegador."); return; }
  try{
    var pacote=await criarBackup(), texto=await prepararBackup(pacote), conf=await verificarTextoBackup(texto);
    if(!conf.ok) throw new Error("verificacao_falhou");
    await baixador.save({filename:window.__mesaArmazenamento.nomeVersao("mesa-de-roteiro-backup"),data:texto});
    registrarBackup(pacote,"download");
    el("integridadeBackup").textContent=conf.legado?"Backup baixado; este navegador não conseguiu calcular a verificação.":"Backup completo verificado (SHA-256) antes do download.";
    aviso("Backup baixado e verificado. Guarde uma cópia fora do computador.");
  }catch(e){ el("integridadeBackup").textContent="Falha ao criar/verificar o backup: "+(e&&e.message?e.message:"erro desconhecido")+"."; aviso("O backup não foi confirmado. Seus dados atuais não foram alterados."); }
}
async function salvarBackupNaPasta(){
  try{
    var pacote=await criarBackup(), texto=await prepararBackup(pacote), ar=window.__mesaArmazenamento, nome=ar.nomeVersao("mesa-de-roteiro-backup"), r=await ar.salvarEmPasta(nome,texto,async function(t){return (await verificarTextoBackup(t)).ok;});
    registrarBackup(pacote,"pasta"); el("integridadeBackup").textContent="Versão "+r.arquivo+" gravada e relida com verificação SHA-256."; aviso("Backup completo salvo e verificado na pasta escolhida.");
  }catch(e){ el("integridadeBackup").textContent="Falha ao salvar na pasta: "+(e&&e.message?e.message:"erro desconhecido")+". Nenhum dado existente foi removido."; aviso("A versão não foi confirmada; tente novamente ou use Baixar backup."); }
}
/* Pré-validação pura: não grava, não normaliza IDs e preserva campos desconhecidos. */
function validarBackupParaImportacao(pacote){
  var avisos=[], faltasNotas=0, faltasFichas=0, fichasLegadas=null;
  function falha(campo,motivo){var e=new Error(campo+": "+motivo);e.code="backup_formato";throw e;}
  function objeto(v,c){if(!v||typeof v!=="object"||Array.isArray(v))falha(c,"deve ser um objeto");}
  function identificador(v,c){if(!((typeof v==="string"&&v.length)||(typeof v==="number"&&isFinite(v)&&v!==0)))falha(c,"identificador inválido");}
  function texto(v,c){if(v!=null&&typeof v!=="string")falha(c,"deve ser texto");}
  function numero(v,c){if(v!=null&&!((typeof v==="number"&&isFinite(v))||(typeof v==="string"&&v.trim()!==""&&isFinite(Number(v)))))falha(c,"deve ser um número finito");}
  function data(v,c){if(v!=null&&!(typeof v==="string"||(typeof v==="number"&&isFinite(v))))falha(c,"data inválida");}
  function escalar(v,c){if(v!=null&&!(typeof v==="string"||typeof v==="boolean"||(typeof v==="number"&&isFinite(v))))falha(c,"deve ser um valor simples");}
  function campos(v,chaves,c,validar){chaves.forEach(function(k){if(Object.prototype.hasOwnProperty.call(v,k))validar(v[k],c+"."+k);});}
  function lista(v,c,validar){if(v==null)return [];if(!Array.isArray(v))falha(c,"deve ser uma lista");v.forEach(function(x,i){validar(x,c+"["+(i+1)+"]");});return v;}
  function registros(v,c,validar,exigirId){
    var vistos=new Set();return lista(v,c,function(x,p){objeto(x,p);if(exigirId||x.id!=null){identificador(x.id,p+".id");var chave=String(x.id);if(vistos.has(chave))falha(p+".id","identificador repetido na mesma lista");vistos.add(chave);}validar(x,p);});
  }
  function textos(v,c){lista(v,c,function(x,p){texto(x,p);});}
  function imagem(v,c){
    if(typeof v!=="string")falha(c,"a imagem deve estar embutida como texto data:image");
    var separador=v.indexOf(",");
    if(separador<0||!/^data:image\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[a-z0-9.+-]+)*;base64$/i.test(v.slice(0,separador)))falha(c,"formato de imagem embutida inválido");
    var dados=v.slice(separador+1).replace(/\s/g,"");
    if(!dados||!/^[A-Za-z0-9+/]*={0,2}$/.test(dados)||dados.length%4===1||(dados.indexOf("=")>=0&&dados.length%4!==0))falha(c,"conteúdo Base64 inválido");
  }
  function metaImagem(m,c){objeto(m,c);identificador(m.id,c+".id");campos(m,["nome","tipo"],c,texto);campos(m,["tamanho"],c,numero);campos(m,["criadoEm"],c,data);}
  function anexos(d,c){
    var referencias=registros(d.imagens,c+".imagens",metaImagem,true), recebidas=new Set();
    registros(d.imagensDados,c+".imagensDados",function(im,p){metaImagem(im.meta,p+".meta");imagem(im.src,p+".src");var chave=String(im.meta.id);if(recebidas.has(chave))falha(p+".meta.id","imagem repetida");recebidas.add(chave);},false);
    referencias.forEach(function(im){if(!recebidas.has(String(im.id)))faltasNotas++;});
  }
  function tracos(v,c){lista(v,c,function(t,p){objeto(t,p);campos(t,["t","c"],p,texto);campos(t,["w"],p,numero);lista(t.p,p+".p",function(pt,pp){if(!Array.isArray(pt)||pt.length<2)falha(pp,"ponto inválido");pt.forEach(function(n,i){numero(n,pp+"["+(i+1)+"]");});});});}
  function visual(v,c){
    if(v==null)return;objeto(v,c);campos(v,["ativo"],c,texto);if(v.dados==null)return;objeto(v.dados,c+".dados");
    Object.keys(v.dados).forEach(function(k){var d=v.dados[k],p=c+".dados[layout]";objeto(d,p);lista(d.r,p+".r",numero);if(d.s!=null){objeto(d.s,p+".s");Object.keys(d.s).forEach(function(n){tracos(d.s[n],p+".s[quadro]");});}tracos(d.o,p+".o");});
  }
  function painel(p,c){
    campos(p,["enquadramento","tipoPainel","enq","distancia","plano","angulo","tamanho","acao","sfx","nota","miniatura"],c,texto);
    textos(p.personagens,c+".personagens");registros(p.falas,c+".falas",function(f,ff){campos(f,["quem","tipo","texto"],ff,texto);},false);
    lista(p.forma,c+".forma",numero);
  }
  function pagina(pg,c){
    campos(pg,["layoutPag"],c,texto);registros(pg.paineis,c+".paineis",painel,false);visual(pg.visual,c+".visual");
    if(pg.composicaoLivre!=null){objeto(pg.composicaoLivre,c+".composicaoLivre");Object.keys(pg.composicaoLivre).forEach(function(k){var q=pg.composicaoLivre[k],p=c+".composicaoLivre[quadro]";objeto(q,p);campos(q,["x","y","w","h","z"],p,numero);});}
  }
  function documento(d,c,grupo){
    campos(d,["titulo"],c,texto);campos(d,["criadoEm","atualizadoEm"],c,data);
    if(grupo==="obras")textos(d.personagens,c+".personagens");
    if(grupo==="capitulos"){
      campos(d,["status"],c,texto);campos(d,["numero","progresso","nPaineis","nPaginas"],c,numero);
      registros(d.paginas,c+".paginas",pagina,false);
      if(d.paginasSeparadas&&(!Array.isArray(d.paginas)||!d.paginas.length))falha(c+".paginas","as páginas externas não estão incluídas no arquivo");
    }
    if(grupo==="notas"){campos(d,["texto","tipo"],c,texto);if(typeof d.tags!=="string")textos(d.tags,c+".tags");}
    anexos(d,c);
  }
  function desenhos(v,c){
    registros(v,c,function(item,p){
      if(/^(nota-imagem|ficha-imagem)\//.test(String(item.id)))falha(p+".id","esta chave é reservada às imagens de notas e fichas");
      objeto(item.rec,p+".rec");var r=item.rec;campos(r,["w","h"],p+".rec",numero);
      registros(r.camadas,p+".rec.camadas",function(l,lc){
        campos(l,["nome","tipo","modo"],lc,texto);campos(l,["op"],lc,numero);
        ["blob","originalBlob"].forEach(function(k){if(l[k]!=null&&l[k]!=="")imagem(l[k],lc+"."+k);});
        if(l.manequim3d!=null){objeto(l.manequim3d,lc+".manequim3d");["estado","local"].forEach(function(k){if(l.manequim3d[k]!=null)objeto(l.manequim3d[k],lc+".manequim3d."+k);});}
      },false);
      registros(r.baloes,p+".rec.baloes",function(b,bc){campos(b,["txt","tipo","fonte","cor","contorno"],bc,texto);campos(b,["x","y","w","h","px","py","fs","rot","esp"],bc,numero);},false);
    },true);
  }
  function fichas(v,c){
    objeto(v,c);if(!Array.isArray(v.fichas))falha(c+".fichas","deve ser uma lista");var esperadas=new Set(),recebidas=new Set();
    registros(v.fichas,c+".fichas",function(f,p){
      // Preserva as conversões simples que as fichas antigas já aceitavam.
      campos(f,["nome","obraId","atualizadoEm"],p,escalar);
      if(f.notas!=null){objeto(f.notas,p+".notas");campos(f.notas,["geral","vistas","expressoes","roupas","detalhes"],p+".notas",escalar);}
      registros(f.imagens,p+".imagens",function(im,ip){campos(im,["nome","vista"],ip,escalar);var chave="ficha-imagem/"+f.id+"/"+im.id;if(esperadas.has(chave))falha(ip+".id","duas referências usam o mesmo destino de imagem");esperadas.add(chave);},true);
    },true);
    lista(v.imagens,c+".imagens",function(im,p){objeto(im,p);if(typeof im.chave!=="string"||!esperadas.has(im.chave))falha(p+".chave","imagem sem referência correspondente na ficha");if(recebidas.has(im.chave))falha(p+".chave","imagem repetida");recebidas.add(im.chave);campos(im,["nome"],p,escalar);imagem(im.src,p+".src");});
    esperadas.forEach(function(chave){if(!recebidas.has(chave))faltasFichas++;});
  }
  objeto(pacote,"backup");
  if(pacote.formato!=null&&pacote.formato!=="mesa-de-roteiro-backup")falha("formato","este arquivo pertence a outro formato");
  if(pacote.versao!=null&&!((typeof pacote.versao==="number"||typeof pacote.versao==="string")&&/^[123]$/.test(String(pacote.versao))))falha("versao","versão de backup não suportada");
  if(pacote.integridade!=null){
    var integ=pacote.integridade;objeto(integ,"integridade");
    if(integ.algoritmo==="SHA-256"){if(typeof integ.conteudo!=="string"||!/^[a-f0-9]{64}$/i.test(integ.conteudo))falha("integridade.conteudo","soma SHA-256 ausente ou inválida");}
    else if(integ.algoritmo!=="indisponivel")falha("integridade.algoritmo","algoritmo não suportado");
  }
  var total=0;["obras","capitulos","notas"].forEach(function(g){
    if(!Array.isArray(pacote[g]))falha(g,"grupo obrigatório ausente ou inválido");
    registros(pacote[g],g,function(item,p){if(String(item.id).indexOf("/")>=0)falha(p+".id","identificadores de documentos não podem conter barra");objeto(item.dados,p+".dados");documento(item.dados,p+".dados",g);},true);total+=pacote[g].length;
  });
  desenhos(pacote.desenhos,"desenhos");
  registros(pacote.desenhosLivres,"desenhosLivres",function(d,c){if(typeof d.titulo!=="string"||!d.titulo)falha(c+".titulo","nome do desenho ausente ou inválido");campos(d,["criadoEm","atualizadoEm"],c,data);},true);
  if(pacote.fichasPersonagem!=null)fichas(pacote.fichasPersonagem,"fichasPersonagem");
  lista(pacote.preferenciasLocal,"preferenciasLocal",function(p,c){
    objeto(p,c);if(typeof p.chave!=="string"||!p.chave)falha(c+".chave","chave de preferência inválida");texto(p.valor,c+".valor");
    if(p.chave==="mesa:fichas-personagem-v1"&&pacote.fichasPersonagem==null&&fichasLegadas===null){
      try{fichasLegadas=JSON.parse(p.valor||"[]");}catch(e){falha(c+".valor","JSON das fichas antigas inválido");}
      fichas({fichas:fichasLegadas,imagens:[]},c+".fichasAntigas");
    }
  });
  if(faltasNotas)avisos.push(faltasNotas+" referência(s) de nota sem imagem embutida");
  if(faltasFichas)avisos.push(faltasFichas+" referência(s) de ficha sem imagem embutida");
  return {total:total,fichasLegadas:fichasLegadas,avisos:avisos};
}
async function importarBackupArquivo(arquivo){
  if(!arquivo) return;
  return executarAcaoTexto(function(){return importarBackupSalvo(arquivo);});
}
function prepararPlanoImportacao(pacote,plano){
  var textos=[],imagens=[],chavesTexto=Object.create(null),chavesImagem=Object.create(null);
  function texto(chave,valor){if(chavesTexto[chave])throw new Error("O backup usa o mesmo destino de texto mais de uma vez.");chavesTexto[chave]=true;textos.push({chave:chave,valor:JSON.stringify(valor)});}
  function imagem(idImagem,rec){var k=typeof idImagem+":"+idImagem;if(chavesImagem[k])throw new Error("O backup usa o mesmo destino de imagem mais de uma vez.");chavesImagem[k]=true;imagens.push({id:idImagem,rec:rec});}
  var ed=window.EditorDesenho;
  if((pacote.desenhos||[]).length&&(!ed||!ed.prepararDadosImportacao))throw new Error("O importador de desenhos não está disponível.");
  (ed&&ed.prepararDadosImportacao?ed.prepararDadosImportacao(pacote.desenhos||[]):[]).forEach(function(v){imagem(v.id,v.rec);});
  var pf=pacote.fichasPersonagem||(plano.fichasLegadas!==null?{fichas:plano.fichasLegadas,imagens:[]}:null);
  if(pf){
    var fichas=lerListaEssencial("fichas-personagem-v1").map(normalizarFichaPersonagem);
    pf.fichas.map(normalizarFichaPersonagem).forEach(function(f){if(!f)throw erroLeituraLocal();var pos=fichas.findIndex(function(v){return v.id===f.id;});if(pos<0)fichas.push(f);else fichas[pos]=f;});
    texto("mesa:fichas-personagem-v1",fichas);
    (pf.imagens||[]).forEach(function(im){imagem(im.chave,{src:im.src,nome:String(im.nome||"Referência")});});
  }
  /* Mescla por id: desenhos livres que existem só neste aparelho continuam listados.
     Em caso de mesmo id, vale o registro com atualização mais recente. Uma lista local ilegível interrompe a importação (lerListaEssencial lança erro). */
  if(Array.isArray(pacote.desenhosLivres)){
    var porId=Object.create(null);
    lerListaEssencial("desenhos-livres").concat(pacote.desenhosLivres).forEach(function(v){
      var k=String(v.id), antes=porId[k];
      if(!antes||(Number(v.atualizadoEm)||0)>=(Number(antes.atualizadoEm)||0))porId[k]=v;
    });
    var livresMesclados=Object.keys(porId).map(function(k){return porId[k];}).sort(function(a,b){return (Number(b.atualizadoEm)||0)-(Number(a.atualizadoEm)||0);});
    texto("mesa:desenhos-livres",dadosProfundos(livresMesclados));
  }
  ["obras","capitulos","notas"].forEach(function(grupo){pacote[grupo].forEach(function(item){
    var dadosItem=dadosProfundos(item.dados);
    if(Array.isArray(dadosItem.imagensDados)){
      dadosItem.imagens=Array.isArray(dadosItem.imagens)?dadosItem.imagens.slice():[];
      dadosItem.imagensDados.forEach(function(im){var meta=im.meta;imagem(notaImagemChave(item.id,meta.id),{src:im.src,nome:meta.nome||"Imagem",tipo:meta.tipo||"image/*",tamanho:meta.tamanho||0,criadoEm:meta.criadoEm||Date.now()});var pos=dadosItem.imagens.findIndex(function(v){return String(v.id)===String(meta.id);});if(pos<0)dadosItem.imagens.push(meta);else dadosItem.imagens[pos]=meta;});
      delete dadosItem.imagensDados;
    }
    texto("mesa:roteiros/local/"+grupo+"/"+item.id,dadosItem);
  });});
  return{textos:textos,imagens:imagens};
}
function comTravaImportacao(acao){
  if(navigator.locks&&navigator.locks.request)return navigator.locks.request("mesa-importacao-local-v1",{mode:"exclusive",ifAvailable:true},function(trava){if(!trava){var e=new Error("Outra aba está importando ou recuperando dados. Aguarde e tente novamente.");e.code="trava_recuperacao_ocupada";throw e;}return acao();});
  return Promise.resolve().then(acao);
}
function mostrarBloqueioImportacao(){
  var r=window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao;if(r)r.estado.bloqueada=true;
  var box=el("avisoRecuperacao"),app=document.querySelector(".app");if(box)box.classList.remove("oculto");if(app)app.inert=true;
  estado.textContent="recuperação pendente";
}
function mostrarFalhaRecuperacaoInicial(erro,etapa){
  var motivo,texto,status;
  if(etapa==="consulta"){
    motivo="leitura_recuperacao_indisponivel";status="armazenamento não verificado";
    texto="Não foi possível verificar o armazenamento deste navegador. A biblioteca foi protegida contra alterações. Isso não confirma uma operação interrompida nem perda de dados. Preserve seus backups e não limpe os dados do navegador.";
  }else if(etapa==="trava"){
    var ocupada=erro&&erro.code==="trava_recuperacao_ocupada";
    motivo=ocupada?"trava_recuperacao_ocupada":"trava_recuperacao_indisponivel";status=ocupada?"aguardando outra aba":"recuperação indisponível";
    texto=ocupada?"Existe um aviso local de recuperação, mas outra aba está usando a proteção de armazenamento. Aguarde essa operação terminar e tente abrir novamente. Os registros locais não foram alterados por esta tentativa.":"Existe um aviso local de recuperação, mas não foi possível obter a proteção de armazenamento do navegador. A recuperação não foi iniciada. Preserve seus backups e tente abrir novamente, sem limpar os dados do navegador.";
  }else{
    motivo="recuperacao_pendente";status="recuperação pendente";
    texto="Uma operação local ainda precisa ser recuperada antes de editar. Não foi possível concluir a recuperação nesta abertura. Preserve os registros, mantenha seus backups e não limpe os dados do navegador.";
  }
  el("textoRecuperacao").textContent=texto;
  el("btRetomarRecuperacao").textContent="Tentar abrir novamente";
  el("avisoRecuperacao").dataset.motivo=motivo;
  mostrarBloqueioImportacao();estado.textContent=status;
}
window.__mesaImportarPacote=function(pacote){return importarBackupArquivo({text:async function(){return JSON.stringify(pacote);}});};
async function importarBackupSalvo(arquivo){
  var importacaoIniciada=false,confirmada=false;
  try{
    var ver=await verificarTextoBackup(await arquivo.text()), pacote=ver.pacote;
    if(!ver.ok) throw new Error("A verificação SHA-256 falhou; a importação foi cancelada.");
    if(ver.pacote&&ver.pacote.versao===4) throw new Error("Esta é uma cópia da nuvem com mídia guardada na nuvem. Use Baixar cópia da nuvem e importe o arquivo baixado.");
    var plano=validarBackupParaImportacao(pacote), mensagem="Importar "+plano.total+" item(ns)? Itens com o mesmo identificador serão substituídos.";
    if(Array.isArray(pacote.desenhosLivres))mensagem+=" A lista de desenhos livres será combinada com a do arquivo; nenhum desenho livre deste aparelho será removido da lista.";
    if(plano.avisos.length)mensagem+="\n\nAtenção: "+plano.avisos.join("; ")+". As referências serão preservadas, mas as imagens ausentes não podem ser recuperadas deste arquivo.";
    mensagem+="\n\nFeche outras abas da Mesa de Roteiro antes de continuar. Se houver falha, será tentada a recuperação dos registros anteriores.";
    if(!window.confirm(mensagem)) return false;
    if(backupNuvemEmCurso||FICHAS.importando)throw new Error("Aguarde o envio da nuvem ou a importação de referências terminar antes de importar.");
    var ed=window.EditorDesenho;
    if(ed&&ed.aguardarOperacoes&&await ed.aguardarOperacoes()!==true)throw new Error("Salve o desenho aberto antes de importar.");
    if(ed&&ed.estaAberto&&ed.estaAberto()&&await ed.fechar()!==true)throw new Error("Não foi possível fechar com segurança o desenho aberto.");
    if(!await salvarPendenciasTexto())throw new Error("Há textos ainda não salvos.");
    if(FICHAS.pendente&&!fichasGravar())throw new Error("Há fichas ainda não salvas.");
    var ar=window.__mesaArmazenamento;if(!ar||!ar.recuperacao)throw new Error("A recuperação de importação não está disponível.");
    var operacoes=prepararPlanoImportacao(pacote,plano);
    estado.textContent="importando backup…";
    importacaoIniciada=true;
    clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;
    var resultado=await comTravaImportacao(function(){if(backupNuvemEmCurso)throw new Error("Aguarde a cópia da nuvem terminar.");return ar.recuperacao.executar(operacoes.textos,operacoes.imagens);});
    if(!resultado||resultado.importado!==true)throw new Error("Não foi possível confirmar a importação.");
    confirmada=true;
    if(typeof COPIA_NUVEM!=="undefined")COPIA_NUVEM.pendente=null;
    /* Modelos antigos não podem voltar a gravar por cima da versão confirmada. */
    obraAtual=null;capAtual=null;doc=null;notaAtual=null;modoNotas=false;sujo=false;notaSuja=false;
    FICHAS.lista=null;FICHAS.atual=null;FICHAS.pendente=false;fecharFichasPersonagem();carregarDesenhosLivres();
    await carregarListas();
    mostrarEntradaInicial();
    el("integridadeBackup").textContent=ver.legado?"Backup antigo importado sem soma de verificação.":"Backup verificado por SHA-256 e importado.";
    if(plano.avisos.length)el("integridadeBackup").textContent+=" Atenção: "+plano.avisos.join("; ")+". As referências foram preservadas.";
    aviso("Backup importado com sucesso.");
    agendarBackupNuvem();
    return true;
  }catch(e){
    if(e&&e.importado){confirmada=true;obraAtual=null;capAtual=null;doc=null;notaAtual=null;modoNotas=false;sujo=false;notaSuja=false;FICHAS.lista=null;FICHAS.atual=null;FICHAS.pendente=false;fecharFichasPersonagem();}
    var detalhe=e&&e.code==="backup_formato"?"Backup inválido em "+e.message:(e&&e.message&&e.message.indexOf("SHA-256")>=0?e.message:"Não foi possível ler ou importar esse arquivo.");
    var texto=confirmada?(e&&e.pendente?"Os dados foram importados e confirmados. Falta concluir a limpeza do aviso de recuperação; tente recuperar novamente antes de editar.":"Os dados do backup foram importados e confirmados, mas a tela não pôde ser atualizada. Reabra a página para carregar a biblioteca."):e&&e.pendente?"A importação foi interrompida e a recuperação ainda não foi confirmada. Os registros de recuperação foram preservados. Não limpe os dados do navegador; tente recuperar novamente.":e&&e.recuperado?"A importação falhou. Os registros anteriores foram recuperados e conferidos. Nenhum item deste backup permaneceu aplicado.":detalhe+" Nenhum item deste backup foi confirmado.";
    el("integridadeBackup").textContent=texto;if(importacaoIniciada)estado.textContent=confirmada?"importado · reabra a página":e&&e.pendente?"recuperação pendente":"importação cancelada";
    if((e&&e.pendente)||confirmada){if(confirmada)el("textoRecuperacao").textContent=texto;mostrarBloqueioImportacao();}aviso(texto);return confirmada;
  }
}

async function carregarListas(){
  if(!db) return;
  try{
    var so=await colObras().orderBy("criadoEm","asc").get();
    var sc=await colCaps().orderBy("numero","asc").get();
    var sn=await colNotas().orderBy("atualizadoEm","desc").get();
    var novasObras=so.docs.map(function(d){var v=validarDocumentoLocal(d.data());v.id=d.id;v.personagens=v.personagens||[];return v;});
    var capsBrutos=sc.docs.map(function(d){var v=validarDocumentoLocal(d.data());v.id=d.id;return v;});
    var novosCaps=capsBrutos.map(function(v){
      return {id:v.id,obraId:v.obraId,numero:v.numero,titulo:v.titulo,
        nPaineis:v.nPaineis||contarPaineis(v.paginas),paginas:v.nPaginas||((v.paginas||[]).length),status:statusCapitulo(v.status),progresso:progressoCapitulo(v.progresso),atualizadoEm:v.atualizadoEm||0};
    });
    var novasNotas=sn.docs.map(function(d){var v=validarDocumentoLocal(d.data()),tags=tagsNota(v.tags),somenteImagens=v.tipo==="imagens"||tags.some(function(t){return String(t).toLocaleLowerCase("pt-BR")==="imagens";});return Object.assign(v,{id:d.id,titulo:v.titulo||"",texto:somenteImagens?"":(v.texto||""),tags:tags,imagens:Array.isArray(v.imagens)?v.imagens:[],tipo:somenteImagens?"imagens":"texto",criadoEm:v.criadoEm||0,atualizadoEm:v.atualizadoEm||0});});
    obras=novasObras;caps=novosCaps;notas=novasNotas;window.__mesaCapsOffline=capsBrutos;BIBLIOTECA_TEXTOS_OK=true;
    limparFalhaLocal("textos");salvarCacheOffline({obras:novasObras,caps:capsBrutos,notas:novasNotas});return true;
  }catch(e){
    BIBLIOTECA_TEXTOS_OK=false;registrarFalhaLocal("textos","A biblioteca de textos não foi carregada por completo. A cópia de consulta não será aberta para edição.");throw e;
  }
}
function validarDocumentoLocal(v){
  function objeto(x){if(!x||typeof x!=="object"||Array.isArray(x))throw erroLeituraLocal();}
  function textos(x,campos){campos.forEach(function(k){if(x[k]!=null&&typeof x[k]!=="string")throw erroLeituraLocal();});}
  function lista(x,visitar){if(x==null)return;if(!Array.isArray(x))throw erroLeituraLocal();x.forEach(visitar);}
  function nome(x){if(typeof x!=="string")throw erroLeituraLocal();}
  function painel(pn){
    objeto(pn);textos(pn,["enquadramento","tipoPainel","enq","distancia","plano","angulo","tamanho","acao","sfx","nota","miniatura"]);
    lista(pn.personagens,nome);lista(pn.falas,function(f){objeto(f);textos(f,["quem","tipo","texto"]);});
  }
  objeto(v);textos(v,["titulo","texto","tipo","status"]);lista(v.personagens,nome);
  if(v.tags!=null&&typeof v.tags!=="string")lista(v.tags,nome);
  lista(v.imagens,function(im){objeto(im);textos(im,["nome","tipo"]);});
  lista(v.paginas,function(pg){objeto(pg);textos(pg,["layoutPag"]);lista(pg.paineis,painel);});
  return dadosProfundos(v);
}
function consultarCacheTextos(){
  try{
    var l=lerJsonLocal("offline-cache");if(!l.existe)throw erroLeituraLocal("Não há cópia de textos no cache deste navegador.");var cache=l.valor;
    if(!cache||typeof cache!=="object"||!["obras","caps","notas"].every(function(k){return Array.isArray(cache[k]);}))throw erroLeituraLocal("A cópia de consulta está incompleta ou inválida.");
    ["obras","caps","notas"].forEach(function(k){cache[k].forEach(function(v){validarDocumentoLocal(v);if(!v.id)throw erroLeituraLocal();});});
    CACHE_CONSULTA=dadosProfundos(cache);el("conteudoConsultaCache").value=JSON.stringify(CACHE_CONSULTA,null,2);el("estadoConsultaCache").textContent="Cópia apenas para consulta · "+(cache.em?dataNota(cache.em,true):"data não registrada")+". Nenhum registro local foi substituído.";
    el("dlgConsultaCache").showModal();return true;
  }catch(e){aviso(e.message||"Não foi possível ler a cópia de consulta.");return false;}
}
async function baixarCacheConsulta(){
  if(!CACHE_CONSULTA||!baixador)return false;
  try{await baixador.save({filename:"mesa-de-roteiro-cache-para-recuperacao.json",data:JSON.stringify({formato:"mesa-de-roteiro-cache-consulta",cache:CACHE_CONSULTA},null,2)});el("estadoConsultaCache").textContent="Cópia preparada para download. Confira a pasta de downloads. Este arquivo é para recuperação dos textos, não um backup completo de imagens.";return true;}catch(e){aviso("Não foi possível preparar o download da cópia de consulta.");return false;}
}
async function tentarRelerDadosLocais(){
  if(window.EditorDesenho&&window.EditorDesenho.temAlteracoes&&window.EditorDesenho.temAlteracoes()){aviso("Salve o desenho aberto antes de recarregar a biblioteca.");return false;}
  return executarAcaoTexto(async function(){
    if(FICHAS.pendente&&!fichasGravar())return false;
    try{carregarDesenhosLivres();}catch(e){}
    if(FALHAS_LEITURA_LOCAL.fichas&&!FICHAS.pendente){FICHAS.lista=null;try{fichasLer();}catch(e){}}
    await carregarListas();
    if(capAtual&&caps.some(function(c){return c.id===capAtual;}))await abrirCapituloSalvo(capAtual);
    else if(modoNotas&&notaObj(notaAtual)){desenharLateral();desenhar();}
    else mostrarEntradaInicial();return true;
  });
}
function contarPaineis(pgs){
  var n=0,i; if(!pgs) return 0;
  for(i=0;i<pgs.length;i++) n+=(pgs[i].paineis||[]).length;
  return n;
}

function obraObjAtual(){
  return obras.filter(function(o){return o.id===obraAtual;})[0]||null;
}

/* As revisões são apenas desta sessão. Cada set recebe uma cópia independente. */
function rotuloSalvoTexto(){
  return window.__mesaArmazenamento&&window.__mesaArmazenamento.temLocalStorage===false
    ? "temporário nesta aba · baixe um backup" : "salvo neste aparelho";
}
function mostrarEstadoTextoSalvo(){
  estado.textContent=sujo||notaSuja?"alterações pendentes":rotuloSalvoTexto();
}
function atualizarTentativaTexto(){
  if(typeof atualizarConexao==="function")atualizarConexao();
  var bt=el("btTentarSalvarTexto"); if(!bt)return;
  bt.classList.toggle("oculto",!(sujo||notaSuja));
  bt.disabled=!!(salvando||salvandoNota||acaoTextoAtiva);
}
function falhaSalvarTexto(e,nota){
  estado.textContent="erro ao salvar · alterações pendentes";
  atualizarTentativaTexto();
  aviso(e&&e.code==="quota_exceeded"
    ? "O armazenamento está cheio. As alterações continuam nesta aba. Preserve um backup anterior e libere espaço antes de tentar salvar novamente."
    : "Não foi possível salvar "+(nota?"a nota":"o capítulo")+". As alterações continuam nesta aba. Use Tentar salvar e não feche a página.");
}
async function gravarTexto(grupo,chave,corpo){
  /* A biblioteca usada é sempre a local deste aparelho (db === dbLocal). Falhas de escrita são repassadas ao chamador. */
  await db.collection(base+"/"+grupo).doc(chave).set(corpo);
}
async function salvarPendenciasTexto(){
  clearTimeout(pendente); clearTimeout(pendenteNota);
  if(await salvar()!==true)return false;
  if(await salvarNota()!==true)return false;
  return !sujo&&!notaSuja&&!salvando&&!salvandoNota;
}
async function executarAcaoTexto(acao,propagarErro){
  if(typeof RECUPERACAO_INICIAL!=="undefined"&&RECUPERACAO_INICIAL){aviso("Aguarde a verificação de recuperação antes de editar.");return false;}
  if(acaoTextoAtiva){aviso("Aguarde a operação de salvamento em andamento.");return false;}
  acaoTextoAtiva=true; atualizarTentativaTexto();
  var foco=document.activeElement, travas=[];
  /* Impede editar o item anterior enquanto uma leitura/criação assíncrona termina. */
  document.querySelectorAll("body > :not(script):not(style)").forEach(function(no){travas.push({no:no,inert:no.inert});no.inert=true;});
  try{
    if(!await salvarPendenciasTexto())return false;
    return await acao();
  }catch(e){
    if(propagarErro)throw e;
    aviso("A operação não foi concluída. Preserve esta aba e seus backups antes de tentar novamente.");return false;
  }finally{
    travas.forEach(function(t){t.no.inert=t.inert;});
    if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao&&window.__mesaArmazenamento.recuperacao.estado.bloqueada)mostrarBloqueioImportacao();
    acaoTextoAtiva=false; atualizarTentativaTexto();
    if((sujo||notaSuja)&&foco&&foco.isConnected&&foco.focus)foco.focus({preventScroll:true});
  }
}
/* Atalhos e colagem também podem chegar ao document sem foco em um controle. */
["keydown","beforeinput","paste","drop","pointerdown","click"].forEach(function(tipo){
  document.addEventListener(tipo,function(ev){var recuperacao=window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao;if(RECUPERACAO_INICIAL||acaoTextoAtiva||(recuperacao&&recuperacao.estado.bloqueada&&!(ev.target.closest&&ev.target.closest("#avisoRecuperacao")))){ev.preventDefault();ev.stopImmediatePropagation();}},true);
});
function marcarSujo(){
  sujo=true; revisaoCapitulo++; estado.textContent="não salvo"; atualizarTentativaTexto();
  clearTimeout(pendente);
  pendente=setTimeout(salvar,700);
}

async function salvar(){
  if(salvando)return salvando;
  clearTimeout(pendente);
  if(!sujo)return true;
  if(!db||!doc){falhaSalvarTexto(null,false);return false;}
  var alvo=doc, chave=alvo.id;
  var tarefa=(async function(){
    /* A primeira microtarefa garante que salvando seja definido antes da escrita. */
    await Promise.resolve();
    try{
      do{
        if(doc!==alvo)throw new Error("O capítulo ativo mudou durante o salvamento.");
        var revisao=revisaoCapitulo;
        alvo.atualizadoEm=Date.now();
        var corpo=JSON.parse(JSON.stringify(alvo));delete corpo.id;
        estado.textContent="salvando…";
        await gravarTexto("capitulos",chave,corpo);
        if(doc!==alvo)throw new Error("O capítulo ativo mudou durante o salvamento.");
        if(revisao!==revisaoCapitulo)continue;
        sujo=false;
        if(window.__mesaArmazenamento&&window.__mesaArmazenamento.temLocalStorage===false)textosVolateis=true;
        var c=caps.filter(function(x){return x.id===chave;})[0];
        if(c){c.titulo=corpo.titulo;c.numero=corpo.numero;c.nPaineis=contarPaineis(corpo.paginas);c.paginas=(corpo.paginas||[]).length;c.status=statusCapitulo(corpo.status);c.progresso=progressoCapitulo(corpo.progresso);c.atualizadoEm=corpo.atualizadoEm;}
      }while(sujo);
    }catch(e){sujo=true;falhaSalvarTexto(e,false);return false;}
    mostrarEstadoTextoSalvo();
    try{salvarCacheOffline();desenharLateral();agendarBackupNuvem();}catch(e){}
    return true;
  })();
  salvando=tarefa; atualizarTentativaTexto();
  try{return await tarefa;}finally{if(salvando===tarefa)salvando=false;atualizarTentativaTexto();}
}

/* ========== notas livres ========== */
function notaObj(idNota){
  return notas.filter(function(n){ return n.id===idNota; })[0]||null;
}
function notaSomenteImagens(n){
  if(!n) return false;
  if(n.tipo==="imagens") return true;
  return tagsNota(n.tags).some(function(t){ return String(t).toLocaleLowerCase("pt-BR")==="imagens"; });
}
function notasDeImagens(){
  return notas.filter(function(n){ return notaSomenteImagens(n)&&(n.imagens||[]).length>0; }).sort(function(a,b){ return (b.atualizadoEm||0)-(a.atualizadoEm||0); });
}
function dataNota(v,completa){
  if(!v) return "agora";
  try{
    return new Date(v).toLocaleString("pt-BR",completa
      ? {day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}
      : {day:"2-digit",month:"2-digit"});
  }catch(e){ return "agora"; }
}
function marcarNotaSuja(){
  notaSuja=true; revisaoNota++; estado.textContent="não salvo"; atualizarTentativaTexto();
  clearTimeout(pendenteNota);
  pendenteNota=setTimeout(salvarNota,700);
}
function notaImagemChave(idNota,idImagem){ return "nota-imagem/"+idNota+"/"+idImagem; }
function arquivoDataUrl(arquivo){
  return new Promise(function(resolve,reject){
    var leitor=new FileReader(); leitor.onload=function(){resolve(String(leitor.result||""));}; leitor.onerror=reject; leitor.readAsDataURL(arquivo);
  });
}
function htmlNotaImagens(n){
  var lista=Array.isArray(n.imagens)?n.imagens:[];
  if(!lista.length) return '<div class="nota-imagens-vazio">Nenhuma imagem ainda. Adicione referências, esboços ou fotos para consultar junto da nota.</div>';
  return '<div class="nota-imagens-grid">'+lista.map(function(im){
    return '<figure class="nota-imagem-item" data-nota-img-id="'+esc(im.id)+'"><div class="nota-imagem-carregando">Carregando…</div><figcaption class="nota-imagem-nome" title="'+esc(im.nome||"Imagem")+'">'+esc(im.nome||"Imagem")+'</figcaption><button type="button" class="bt mini nota-imagem-remover" data-nota-acao="remover-imagem" data-nota-img-id="'+esc(im.id)+'" aria-label="Remover '+esc(im.nome||"imagem")+'">✕</button></figure>';
  }).join("")+'</div>';
}
async function hidratarImagensNota(n){
  var lista=Array.isArray(n.imagens)?n.imagens:[];
  for(var i=0;i<lista.length;i++){
    var im=lista[i], host=null, caixas=tela.querySelectorAll("[data-nota-img-id]"), j;
    for(j=0;j<caixas.length;j++) if(caixas[j].getAttribute("data-nota-img-id")===String(im.id)){host=caixas[j];break;}
    if(!host) continue;
    var rec=null,falhou=false;try{rec=await bdLer(notaImagemChave(n.id,im.id));}catch(e){falhou=true;}
    if(!host.isConnected||notaAtual!==n.id)return;
    var carregando=host.querySelector(".nota-imagem-carregando");if(!carregando)continue;
    if(falhou){carregando.textContent="Falha ao ler a imagem. Reabra a nota para tentar novamente.";continue;}
    if(rec&&rec.src){var img=document.createElement("img");img.alt=im.nome||"Imagem da nota";img.onerror=function(){if(this.isConnected){var erro=document.createElement("div");erro.className="nota-imagem-carregando";erro.textContent="Não foi possível abrir esta imagem. Os dados armazenados foram preservados.";this.replaceWith(erro);}};img.src=rec.src;carregando.replaceWith(img);}
    else carregando.textContent="Imagem referenciada não encontrada";
  }
}
function renderReferenciasEditor(host,opcoes){
  if(!host) return;
  var token={};host.__mesaReferenciasToken=token;
  opcoes=opcoes||{};
  var grupos=notasDeImagens(), referencias=[], dados={};
  grupos.forEach(function(n){
    (Array.isArray(n.imagens)?n.imagens:[]).forEach(function(im){
      var chave="r"+referencias.length;
      referencias.push({chave:chave,nota:n,meta:im});
    });
  });
  var corpo=grupos.length?grupos.map(function(n){
    var imagens=(n.imagens||[]).map(function(im){
      var item=referencias.filter(function(r){return r.nota.id===n.id&&r.meta.id===im.id;})[0], chave=item?item.chave:"";
      return '<button type="button" class="ed-ref-card" data-ref-inserir="'+esc(chave)+'" data-ref-pesquisa="'+esc(((im.nome||"")+" "+(n.titulo||"")).toLocaleLowerCase("pt-BR"))+'" disabled><img class="oculto" data-ref-img="'+esc(chave)+'" alt="'+esc(im.nome||"Imagem de referência")+'"><span class="ed-ref-carregando">Carregando…</span><strong title="'+esc(im.nome||"Imagem")+'">'+esc(im.nome||"Imagem")+'</strong><small>Estudar referência</small></button>';
    }).join("");
    return '<section class="ed-ref-grupo"><h3>'+esc((n.titulo||"Biblioteca de imagens").trim()||"Biblioteca de imagens")+'</h3><div class="ed-ref-grid">'+imagens+'</div></section>';
  }).join(""):'<p class="ed-ref-vazio">Nenhuma nota de imagens foi criada ainda. Crie uma em Notas e guarde referências para reutilizar nos desenhos.</p>';
  host.innerHTML='<div class="ed-ref-cab"><div><h2>Referências · notas de imagens</h2><p>Clique numa miniatura para estudar a referência sem colocá-la no papel. No visualizador separado você pode ajustar a opacidade, desenhar na folha e inserir uma cópia somente se quiser.</p></div><button type="button" class="bt mini" data-ed="referencias-fechar">Fechar</button></div><div class="ed-ref-acoes"><input class="ed-ref-busca" type="search" data-ref-busca placeholder="Buscar por nome da imagem ou nota" aria-label="Buscar referências"><span class="ed-ref-contagem" data-ref-contagem>'+referencias.length+' imagem(ns)</span><button type="button" class="bt mini ed-ref-bt" data-ref-abrir-notas>Gerenciar notas de imagens</button></div><div class="ed-ref-grid">'+corpo+'</div>';
  host.onclick=function(ev){
    var card=ev.target.closest&&ev.target.closest("[data-ref-inserir]");
    if(card&&host.contains(card)){
      var ref=referencias.filter(function(r){return r.chave===card.getAttribute("data-ref-inserir");})[0], dado=ref&&dados[ref.chave];
      if(!dado||!dado.src){ aviso("Esta referência ainda está carregando."); return; }
      if(opcoes.estudar&&opcoes.estudar(dado.src,ref.meta.nome,ref.meta.tipo)) aviso("Referência aberta para estudo. Ela não foi colocada no papel.");
      else if(opcoes.inserir&&opcoes.inserir(dado.src,ref.meta.nome,ref.meta.tipo)) aviso("Referência inserida como nova camada.");
      return;
    }
    var gerenciar=ev.target.closest&&ev.target.closest("[data-ref-abrir-notas]");
    if(gerenciar&&host.contains(gerenciar)&&window.MesaReferencias&&window.MesaReferencias.abrirNotas) window.MesaReferencias.abrirNotas();
  };
  function aplicarFiltroReferencias(valor){
    var q=String(valor||"").toLocaleLowerCase("pt-BR").trim(), visiveis=0;
    Array.prototype.forEach.call(host.querySelectorAll(".ed-ref-grupo"),function(grupo){
      var grupoVisivel=0;
      Array.prototype.forEach.call(grupo.querySelectorAll(".ed-ref-card"),function(card){
        var ok=!q||String(card.getAttribute("data-ref-pesquisa")||"").indexOf(q)>-1;
        card.classList.toggle("oculto-filtro",!ok); if(ok) grupoVisivel++;
      });
      grupo.classList.toggle("oculto-filtro",grupoVisivel===0); visiveis+=grupoVisivel;
    });
    var contador=host.querySelector("[data-ref-contagem]"); if(contador) contador.textContent=visiveis+" imagem(ns)"+(q?" encontrada(s)":"");
  }
  host.oninput=function(ev){ if(ev.target&&ev.target.matches("[data-ref-busca]")) aplicarFiltroReferencias(ev.target.value); };
  referencias.forEach(function(ref){
    bdLer(notaImagemChave(ref.nota.id,ref.meta.id)).then(function(rec){
      if(host.__mesaReferenciasToken!==token||!host.isConnected)return;
      var img=host.querySelector('[data-ref-img="'+ref.chave+'"]'), card=img&&img.closest("[data-ref-inserir]"), carregando=card&&card.querySelector(".ed-ref-carregando");
      if(!img||!card) return;
      if(rec&&rec.src){img.onload=function(){if(host.__mesaReferenciasToken!==token||!img.isConnected)return;dados[ref.chave]={src:rec.src,tipo:ref.meta.tipo||"image/png"};img.classList.remove("oculto");if(carregando)carregando.remove();card.disabled=false;};img.onerror=function(){if(host.__mesaReferenciasToken===token&&carregando)carregando.textContent="Falha ao abrir a imagem. Tente reabrir as referências.";};img.src=rec.src;}
      else if(carregando) carregando.textContent="Imagem referenciada não encontrada";
    }).catch(function(){if(host.__mesaReferenciasToken!==token||!host.isConnected)return;var img=host.querySelector('[data-ref-img="'+ref.chave+'"]'),card=img&&img.closest("[data-ref-inserir]"),texto=card&&card.querySelector(".ed-ref-carregando");if(texto)texto.textContent="Falha ao ler. Reabra as referências para tentar novamente.";});
  });
}
async function abrirNotasDasReferencias(){
  try{
    var ok=window.EditorDesenho&&window.EditorDesenho.fechar?await window.EditorDesenho.fechar():true;
    if(ok===false)return false;return await abrirNotas()!==false;
  }catch(e){aviso("Não foi possível abrir as notas de referência. Confira o salvamento do desenho antes de tentar novamente.");return false;}
}
window.MesaReferencias={
  render:renderReferenciasEditor,
  abrirNotas:abrirNotasDasReferencias
};
async function enviarImagemNota(){ return null; }
async function apagarImagemNotaNuvem(){ return; }
async function sincronizarImagensNuvem(){ return; }
async function anexarImagensNota(arquivos){
  /* FileList é um objeto "vivo": limpar o <input> logo após a seleção no
     celular pode zerá-lo antes de o processamento assíncrono terminar.
     Copie os arquivos para um Array comum antes do primeiro await. */
  var selecionados=[];
  try{ selecionados=Array.prototype.slice.call(arquivos||[]); }catch(e){ selecionados=[]; }
  var n=notaObj(notaAtual); if(!n||!selecionados.length)return false;
  return executarAcaoTexto(async function(){
    if(notaObj(notaAtual)!==n)return false;
    if(!Array.isArray(n.imagens))n.imagens=[];
    var adicionadas=0, falhas=0;
    estado.textContent="guardando imagens…";
    for(var i=0;i<selecionados.length;i++){
      var arquivo=selecionados[i];if(!arquivo||!/^image\//i.test(arquivo.type||""))continue;
      try{
        var iid=id("ni"),src=await arquivoDataUrl(arquivo),meta={id:iid,nome:arquivo.name||"Imagem",tipo:arquivo.type||"image/*",tamanho:arquivo.size||0,criadoEm:Date.now()};
        if(!src||await bdGravar(notaImagemChave(n.id,iid),{src:src,nome:meta.nome,tipo:meta.tipo,tamanho:meta.tamanho,criadoEm:meta.criadoEm})!==true)throw new Error("Imagem não confirmada.");
        n.imagens.push(meta);adicionadas++;marcarNotaSuja();
      }catch(e){falhas++;}
    }
    var salvo=!adicionadas||await salvarNota()===true;
    if(adicionadas)desenharNotas();
    if(falhas)aviso(falhas+" imagem(ns) não foram anexadas porque a gravação falhou. Selecione esses arquivos novamente após resolver o armazenamento.");
    if(adicionadas&&salvo)aviso(adicionadas+" imagem(ns) anexada(s). "+rotuloSalvoTexto()+".");
    if(!adicionadas)estado.textContent=rotuloSalvoTexto();
    if(falhas)estado.textContent="falha ao anexar imagens · selecione os arquivos novamente";
    return salvo&&!falhas;
  });
}
async function removerImagemNota(idImagem){
  var n=notaObj(notaAtual);if(!n||!idImagem)return false;
  return executarAcaoTexto(async function(){
    if(notaObj(notaAtual)!==n)return false;
    var anteriores=(n.imagens||[]).slice(),alvo=anteriores.filter(function(im){return im.id===idImagem;})[0];if(!alvo)return false;
    n.imagens=anteriores.filter(function(im){return im.id!==idImagem;});marcarNotaSuja();
    if(await salvarNota()!==true){
      /* A referência e os pixels continuam recuperáveis quando o set falha. */
      n.imagens=anteriores;marcarNotaSuja();clearTimeout(pendenteNota);desenharNotas();return false;
    }
    /* Só limpamos pixels depois de confirmar os metadados. */
    var limpo=false;
    try{await apagarImagemNotaNuvem(n,idImagem);limpo=await bdApagar(notaImagemChave(n.id,idImagem))===true;}catch(e){}
    desenharNotas();aviso(limpo?"Imagem removida da nota.":"Referência removida da nota. Não foi possível confirmar a limpeza do arquivo de imagem neste aparelho.");return true;
  });
}
async function salvarNota(){
  if(salvandoNota)return salvandoNota;
  clearTimeout(pendenteNota);
  if(!notaSuja)return true;
  var n=notaObj(notaAtual);if(!db||!n){falhaSalvarTexto(null,true);return false;}
  var chave=n.id;
  var tarefa=(async function(){
    await Promise.resolve();
    try{
      do{
        if(notaObj(notaAtual)!==n)throw new Error("A nota ativa mudou durante o salvamento.");
        var revisao=revisaoNota;n.atualizadoEm=Date.now();
        var imagemApenas=notaSomenteImagens(n),corpo=JSON.parse(JSON.stringify({titulo:n.titulo||"",texto:imagemApenas?"":(n.texto||""),tags:imagemApenas?["imagens"]:tagsNota(n.tags),tipo:imagemApenas?"imagens":"texto",imagens:Array.isArray(n.imagens)?n.imagens:[],criadoEm:n.criadoEm||n.atualizadoEm,atualizadoEm:n.atualizadoEm}));
        estado.textContent="salvando…";
        await gravarTexto("notas",chave,corpo);
        if(notaObj(notaAtual)!==n)throw new Error("A nota ativa mudou durante o salvamento.");
        if(revisao!==revisaoNota)continue;
        notaSuja=false;
        if(window.__mesaArmazenamento&&window.__mesaArmazenamento.temLocalStorage===false)textosVolateis=true;
      }while(notaSuja);
    }catch(e){notaSuja=true;falhaSalvarTexto(e,true);return false;}
    mostrarEstadoTextoSalvo();
    try{salvarCacheOffline();notas.sort(function(a,b){return(b.atualizadoEm||0)-(a.atualizadoEm||0);});desenharNotasLateral();agendarBackupNuvem();}catch(e){}
    return true;
  })();
  salvandoNota=tarefa;atualizarTentativaTexto();
  try{return await tarefa;}finally{if(salvandoNota===tarefa)salvandoNota=false;atualizarTentativaTexto();}
}
async function abrirNotas(){
  return executarAcaoTexto(abrirNotasSalvas);
}
async function abrirNotasSalvas(){
  modoNotas=true;
  if(!notaAtual&&notas.length) notaAtual=notas[0].id;
  desenharLateral(); desenhar(); alternarLateral(false);
}
async function criarNota(opcoes){
  if(!db){ aviso("Sem armazenamento disponível nesta visualização."); return; }
  return executarAcaoTexto(function(){return criarNotaSalva(opcoes);});
}
async function criarNotaSalva(opcoes){
  var cfg=opcoes||{}, agora=Date.now(), somenteImagens=cfg.tipo==="imagens", n={titulo:cfg.titulo||"Sem título",texto:somenteImagens?"":(cfg.texto||""),tags:somenteImagens?["imagens"]:(Array.isArray(cfg.tags)?cfg.tags:[]),tipo:somenteImagens?"imagens":"texto",imagens:[],criadoEm:agora,atualizadoEm:agora};
  var ref=colNotas().doc(id("n"));
  try{ await ref.set(n); }
  catch(e){
    var idNotaLocal=ref.path.split("/").pop();
    try{ await dbLocal.collection(baseLocal+"/notas").doc(idNotaLocal).set(n); }catch(localErr){ aviso("Não foi possível criar a nota neste aparelho."); return; }
    aviso("Nota criada e guardada neste aparelho.");
  }
  n.id=ref.path.split("/").pop(); notas.unshift(n);
  modoNotas=true; notaAtual=n.id; notaSuja=false;
  reiniciarMarcaNota();
  estado.textContent=rotuloSalvoTexto();
  desenharLateral(); desenhar(); alternarLateral(false);
  requestAnimationFrame(function(){ var campo=el("notaTitulo"); if(campo){ campo.focus(); campo.select(); } });
}
async function abrirNota(idNota){
  if(!notaObj(idNota)) return;
  return executarAcaoTexto(function(){return abrirNotaSalva(idNota);});
}
async function abrirNotaSalva(idNota){
  if(idNota!==notaAtual)reiniciarMarcaNota();
  modoNotas=true; notaAtual=idNota; notaSuja=false;
  estado.textContent=rotuloSalvoTexto();
  desenharLateral(); desenhar(); alternarLateral(false);
}
async function voltarEntrada(){
  return executarAcaoTexto(voltarEntradaSalva);
}
async function voltarEntradaSalva(){
  modoNotas=false; doc=null; capAtual=null; pgAtual=0; selPainel=null;
  reiniciarMarcaNota();
  estado.textContent="";
  desenharLateral(); desenhar();
  tela.scrollTop=0;
}
async function apagarNota(idNota){
  if(!db||!notaObj(idNota)) return;
  return executarAcaoTexto(function(){return apagarNotaSalva(idNota);});
}
async function apagarNotaSalva(idNota){
  var notaApagada=notaObj(idNota);
  try{ await colNotas().doc(idNota).delete(); }
  catch(e){ try{ await dbLocal.collection(baseLocal+"/notas").doc(idNota).delete(); }catch(localErr){ aviso("Não foi possível apagar a nota neste aparelho."); return; } }
  for(var ii=0;ii<((notaApagada&&notaApagada.imagens)||[]).length;ii++){ await apagarImagemNotaNuvem(notaApagada,notaApagada.imagens[ii].id); await bdApagar(notaImagemChave(idNota,notaApagada.imagens[ii].id)); }
  notas=notas.filter(function(n){ return n.id!==idNota; }); salvarCacheOffline();
  if(notaAtual===idNota){notaAtual=notas.length?notas[0].id:null;reiniciarMarcaNota();}
  notaSuja=false; estado.textContent=rotuloSalvoTexto();
  desenharLateral(); if(modoNotas) desenhar();
  aviso("Nota apagada.");
}
function regexBuscaNota(valor){
  return String(valor||"").replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
}
function normalizarBuscaNota(valor){return String(valor||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("pt-BR");}
function caractereAntesBuscaNota(texto,indice){if(indice<1)return "";var fim=indice,inicio=indice-1,code=texto.charCodeAt(inicio);if(code>=0xdc00&&code<=0xdfff&&inicio>0){var anterior=texto.charCodeAt(inicio-1);if(anterior>=0xd800&&anterior<=0xdbff)inicio--;}return texto.slice(inicio,fim);}
function caractereDepoisBuscaNota(texto,indice){return indice<texto.length?String.fromCodePoint(texto.codePointAt(indice)):"";}
function mapaBuscaNota(valor){
  var original=String(valor||""), texto="", inicios=[], finais=[], pos=0;
  Array.from(original).forEach(function(ch){var norm=normalizarBuscaNota(ch);if(!norm&&finais.length)finais[finais.length-1]=pos+ch.length;for(var k=0;k<norm.length;k++){inicios.push(pos);finais.push(pos+ch.length);}texto+=norm;pos+=ch.length;});
  return {original:original,texto:texto,inicios:inicios,finais:finais};
}
function faixasBuscaNota(valor,termo,inteira){
  var mapa=mapaBuscaNota(valor),q=normalizarBuscaNota(String(termo||"").trim()),saida=[],pos=0,achou;
  if(!q)return saida;
  function palavra(ch){return /[\p{L}\p{N}_]/u.test(ch||"");}
  while((achou=mapa.texto.indexOf(q,pos))>-1){var fim=achou+q.length,ok=!inteira||((!palavra(caractereDepoisBuscaNota(q,0))||!palavra(caractereAntesBuscaNota(mapa.texto,achou)))&&(!palavra(caractereAntesBuscaNota(q,q.length))||!palavra(caractereDepoisBuscaNota(mapa.texto,fim))));if(ok)saida.push({inicio:mapa.inicios[achou],fim:mapa.finais[fim-1]});pos=fim;}
  return saida;
}
function notasFiltradas(){return notas.slice().sort(function(a,b){return(b.atualizadoEm||0)-(a.atualizadoEm||0);});}
function atualizarNavegadorNotas(){
  var lista=el("notasNavegadorLista");if(lista)lista.innerHTML=htmlListaNavegadorNotas();
  var cont=el("notasNavegadorContagem");if(cont)cont.textContent=' · '+notasFiltradas().length+' nota(s)';
}
function faixasEtiquetaNota(valor,etiqueta){
  var tag=normalizarBuscaNota(String(etiqueta||"").trim().replace(/^#+/,"")),cap=tag.match(/^(?:capitulo|cap)\.?\s*(\d+)$/);
  if(!cap)return faixasBuscaNota(valor,etiqueta,true);
  var mapa=mapaBuscaNota(valor),re=/(?:capitulo|cap)\.?\s*(\d+)/g,saida=[],m;
  function palavra(ch){return /[\p{L}\p{N}_]/u.test(ch||"");}
  while((m=re.exec(mapa.texto))){var fim=m.index+m[0].length;if(m[1]===cap[1]&&!palavra(caractereAntesBuscaNota(mapa.texto,m.index))&&!palavra(caractereDepoisBuscaNota(mapa.texto,fim)))saida.push({inicio:mapa.inicios[m.index],fim:mapa.finais[fim-1]});}
  return saida;
}
function htmlTextoEtiquetaNota(texto,faixas){
  var pos=0,saida="";faixas.forEach(function(f,i){saida+=esc(texto.slice(pos,f.inicio))+'<mark class="nota-busca-marca" data-nota-ocorrencia="'+i+'">'+esc(texto.slice(f.inicio,f.fim))+'</mark>';pos=f.fim;});return saida+esc(texto.slice(pos));
}
function atualizarEstadoMarcaNota(rolar){
  var box=el("notaBuscaGrifos");if(!box||MARCA_NOTA.notaId!==notaAtual)return;
  var marcas=box.querySelectorAll('[data-nota-ocorrencia]'),total=marcas.length;
  MARCA_NOTA.indice=total?((MARCA_NOTA.indice%total)+total)%total:0;
  Array.prototype.forEach.call(marcas,function(m,i){m.classList.toggle('nota-ocorrencia-atual',i===MARCA_NOTA.indice);m.setAttribute('aria-current',i===MARCA_NOTA.indice?'true':'false');});
  var status=box.querySelector('[data-nota-marca-status]');if(status)status.textContent=(total?(MARCA_NOTA.indice+1)+' de '+total:'Nenhuma ocorrência')+' · etiqueta “'+MARCA_NOTA.termo+'”';
  Array.prototype.forEach.call(box.querySelectorAll('[data-nota-acao="marca-anterior"],[data-nota-acao="marca-proxima"]'),function(b){b.disabled=total<2;});
  if(rolar&&total){var atual=marcas[MARCA_NOTA.indice];if(atual.scrollIntoView)atual.scrollIntoView({behavior:'smooth',block:'center',inline:'nearest'});}
}
function atualizarBuscaNotaEditor(){
  var box=el("notaBuscaGrifos"),n=notaObj(notaAtual),textarea=el("notaTexto");
  if(!box||!n||!textarea)return;
  var mostrar=MARCA_NOTA.notaId===n.id&&!!MARCA_NOTA.termo;
  box.classList.toggle("oculto",!mostrar);textarea.classList.toggle("oculto",mostrar);
  if(mostrar){MARCA_NOTA.faixas=faixasEtiquetaNota(n.texto||"",MARCA_NOTA.termo);box.innerHTML='<div class="nota-grifos-cab"><span data-nota-marca-status role="status"></span><div class="nota-grifos-acoes"><button class="bt mini" type="button" data-nota-acao="marca-anterior">Anterior</button><button class="bt mini" type="button" data-nota-acao="marca-proxima">Próxima</button><button class="bt mini" type="button" data-nota-acao="limpar-grifos">Limpar grifos</button><button class="bt mini" type="button" data-nota-acao="editar-texto">Voltar a escrever</button></div></div><div class="nota-grifos-conteudo" tabindex="0" aria-label="Conteúdo da nota com etiquetas grifadas">'+htmlTextoEtiquetaNota(n.texto||"",MARCA_NOTA.faixas)+'</div>';atualizarEstadoMarcaNota(false);}
}
function atualizarChipsEtiquetaNota(n){
  var host=el('notaTagsChips');if(!host||!n)return;
  var tags=tagsNota(n.tags),lista=host.querySelector('.nota-tags');
  if(!tags.length){host.textContent='';return;}
  if(!lista){lista=document.createElement('div');lista.className='nota-tags';lista.setAttribute('aria-label','Etiquetas');host.appendChild(lista);}
  var anteriores=Array.prototype.slice.call(lista.children),mantidos=[];
  tags.forEach(function(tag,i){
    var b=anteriores.find(function(item){return item.getAttribute('data-nota-tag')===tag&&item.getAttribute('data-nota-tag-id')===n.id;});
    if(!b){b=document.createElement('button');b.type='button';b.className='nota-tag';b.setAttribute('data-nota-tag',tag);b.setAttribute('data-nota-tag-id',n.id);b.title='Grifar e ir até esta etiqueta no texto da nota';b.textContent='#'+tag;}
    b.disabled=notaSomenteImagens(n);b.setAttribute('aria-pressed',String(MARCA_NOTA.notaId===n.id&&normalizarBuscaNota(tag)===normalizarBuscaNota(MARCA_NOTA.termo)));
    mantidos.push(b);if(lista.children[i]!==b)lista.insertBefore(b,lista.children[i]||null);
  });
  anteriores.forEach(function(b){if(mantidos.indexOf(b)===-1)b.remove();});
}
function levarMarcaNotaAoTrecho(aguardarTeclado){
  var marca=MARCA_NOTA,indice=marca.indice,vv=window.visualViewport,timer,limite;
  function rolar(){if(MARCA_NOTA!==marca||marca.indice!==indice)return;var cab=tela.querySelector('.notas-cabeca');if(cab)tela.style.setProperty('--nota-cab-altura',cab.getBoundingClientRect().height+'px');atualizarEstadoMarcaNota(true);}
  if(!aguardarTeclado){requestAnimationFrame(rolar);return;}
  function pronto(){clearTimeout(timer);clearTimeout(limite);if(vv)vv.removeEventListener('resize',redimensionou);requestAnimationFrame(rolar);}
  function redimensionou(){clearTimeout(timer);timer=setTimeout(pronto,140);}
  if(vv)vv.addEventListener('resize',redimensionou);
  timer=setTimeout(pronto,300);limite=setTimeout(pronto,800);
}
function confirmarEtiquetaNota(){
  var campo=el('notaTags');if(!campo)return;
  campo.blur();var tags=tagsNota(campo.value);
  if(!tags.length){aviso('Digite uma palavra ou trecho em Etiquetas.');campo.focus();return;}
  return ativarEtiquetaNota(tags[tags.length-1],notaAtual,true);
}
function reiniciarMarcaNota(){MARCA_NOTA={notaId:null,termo:"",faixas:[],indice:0,cursor:null};}
function limparMarcaNota(focar){
  var cursor=MARCA_NOTA.cursor,textarea=el('notaTexto');reiniciarMarcaNota();atualizarBuscaNotaEditor();
  atualizarChipsEtiquetaNota(notaObj(notaAtual));desenharNotasLateral();
  if(focar&&textarea){if(cursor){textarea.setSelectionRange(cursor.inicio,cursor.fim,cursor.direcao||'none');textarea.scrollTop=cursor.scroll||0;}textarea.focus({preventScroll:true});var rc=textarea.getBoundingClientRect();if(rc.bottom<0||rc.top>window.innerHeight)textarea.scrollIntoView({block:'center'});}
}
async function ativarEtiquetaNota(termo,idNota,aguardarTeclado){
  var alvo=idNota||notaAtual;if(!alvo||!notaObj(alvo))return;
  if(alvo!==notaAtual||!modoNotas)await abrirNota(alvo);
  var n=notaObj(alvo),textarea=el('notaTexto');if(notaAtual!==alvo||!modoNotas||!n||notaSomenteImagens(n)||!textarea)return;
  termo=String(termo||'').trim().replace(/^#+/,'');if(!termo)return;
  var cursor=MARCA_NOTA.notaId===alvo?MARCA_NOTA.cursor:{inicio:textarea.selectionStart,fim:textarea.selectionEnd,direcao:textarea.selectionDirection,scroll:textarea.scrollTop};
  var foco=document.activeElement;if(foco&&foco.matches&&foco.matches('#notaTags,#notaTexto,#notaTitulo')){aguardarTeclado=true;foco.blur();}
  MARCA_NOTA={notaId:alvo,termo:termo,faixas:[],indice:0,cursor:cursor};atualizarBuscaNotaEditor();
  atualizarChipsEtiquetaNota(n);desenharNotasLateral();
  levarMarcaNotaAoTrecho(aguardarTeclado);
}
function navegarMarcaNota(passo){MARCA_NOTA.indice+=passo;atualizarEstadoMarcaNota(true);}
function htmlListaNavegadorNotas(){
  var lista=notasFiltradas();return lista.length?lista.map(function(item){
    var titulo=(item.titulo||"").trim()||"Sem título", imagens=(item.imagens||[]).length, etiquetas=tagsNota(item.tags), etiqueta=etiquetas.length?'#'+esc(etiquetas[0])+' · ':"", tipo=notaSomenteImagens(item)?"Biblioteca de imagens · ":"";
    return '<button type="button" class="nota-navegador-item" data-nota-interna="'+esc(item.id)+'" aria-current="'+(notaAtual===item.id)+'"><strong>'+esc(titulo)+'</strong><small>'+tipo+((imagens?imagens+' imagem'+(imagens===1?'':'ns')+' · ':'')+etiqueta+esc(dataNota(item.atualizadoEm||item.criadoEm||Date.now(),false)))+'</small></button>';
  }).join(""):'<p class="notas-navegador-vazio">Nenhuma nota criada ainda.</p>';
}
function htmlNotasNavegador(){
  return '<section class="notas-navegador" aria-labelledby="notasNavegadorTitulo"><div class="notas-navegador-cab"><div><strong id="notasNavegadorTitulo">Suas notas</strong><span id="notasNavegadorContagem"> · '+notasFiltradas().length+' nota(s)</span></div><button type="button" class="bt mini" data-nota-acao="nova">+ Nova nota</button></div><div class="notas-navegador-lista" id="notasNavegadorLista">'+htmlListaNavegadorNotas()+'</div></section>';
}
function desenharNotas(){
  if(MARCA_NOTA.notaId&&MARCA_NOTA.notaId!==notaAtual)reiniciarMarcaNota();
  tela.classList.remove("modo-pag"); tela.classList.add("modo-notas");
  el("blocoPaginas").classList.add("oculto");
  el("blocoInfo").classList.add("oculto");
  el("tituloCap").disabled=true;
  el("tituloCap").value="Notas";
  el("btExportar").disabled=true;
  var n=notaObj(notaAtual);
  if(!n){
    tela.innerHTML='<div class="centro"><button type="button" class="bt" data-nota-acao="entrada">← Voltar à entrada</button><h2 style="margin-top:18px">Suas notas</h2><p>Guarde ideias, lembretes ou qualquer texto em notas separadas.</p>'+htmlNotasNavegador()+'<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap"><button type="button" class="bt forte" data-nota-acao="nova">Criar nota</button><button type="button" class="bt" data-nota-acao="nova-imagens">Nota de imagens</button></div></div>';
    return;
  }
  var somenteImagens=notaSomenteImagens(n), camposNota=somenteImagens
    ? '<p class="nota-referencia-aviso">Biblioteca de imagens e referências. Esta nota não possui campo de texto; adicione imagens e consulte-as no editor de obras ou desenho livre.</p>'
    : '<div class="nota-etiquetas"><label for="notaTags">Etiquetas</label><div class="nota-etiqueta-confirmacao"><input id="notaTags" type="text" enterkeyhint="search" data-nota-campo="tags" value="'+esc(textoTags(n.tags))+'" placeholder="Palavra ou trecho" aria-label="Etiquetas separadas por vírgula" aria-describedby="notaEtiquetaAjuda"><button type="button" class="bt" data-nota-acao="buscar-etiqueta">Ir ao trecho</button></div><p class="nota-etiqueta-ajuda" id="notaEtiquetaAjuda">Digite e toque em Ir ao trecho. O botão busca a última etiqueta; para escolher outra, toque nela abaixo.</p><div id="notaTagsChips">'+htmlTags(n.tags,n.id)+'</div></div><div class="nota-grifos oculto" id="notaBuscaGrifos"></div><textarea id="notaTexto" data-nota-campo="texto" placeholder="Escreva o que quiser…" aria-label="Conteúdo da nota">'+esc(n.texto)+'</textarea>';
  tela.innerHTML='<div class="folha notas-tela">'+
    '<div class="notas-cabeca"><button type="button" class="bt" data-nota-acao="entrada">← Entrada</button><h2>Notas</h2><button type="button" class="bt forte" data-nota-acao="nova">+ Nova nota</button><button type="button" class="bt" data-nota-acao="nova-imagens">+ Nota de imagens</button><button type="button" class="bt risco" data-nota-acao="apagar" data-nota-id="'+esc(n.id)+'">Apagar</button></div>'+
    htmlNotasNavegador()+
    '<article class="nota-editor">'+
      '<input id="notaTitulo" type="text" data-nota-campo="titulo" value="'+esc(n.titulo)+'" placeholder="Título da nota" aria-label="Título da nota">'+
      camposNota+
      '<section class="nota-anexos" aria-labelledby="notaImagensTitulo"><div class="nota-anexos-cab"><strong id="notaImagensTitulo">Imagens da nota · '+((n.imagens||[]).length)+'</strong><span>Adicione quantas quiser. Elas ficam guardadas neste aparelho e entram no backup.</span><button type="button" class="bt mini" data-nota-acao="anexar-imagens">+ Adicionar imagens</button><input id="notaImagens" type="file" accept="image/*" multiple data-nota-anexos></div><div class="nota-imagens-soltar" data-nota-soltar-imagens>Arraste imagens para cá ou cole uma imagem copiada.</div><div id="notaImagensGrade">'+htmlNotaImagens(n)+'</div></section>'+ 
      '<p class="nota-meta">Salvamento automático · última alteração '+esc(dataNota(n.atualizadoEm,true))+'</p>'+ 
    '</article></div>';
  hidratarImagensNota(n);
  atualizarBuscaNotaEditor();atualizarNavegadorNotas();
}
function desenharNotasLateral(){
  var host=el("listaNotas"); if(!host) return;
  var lista=notasFiltradas();
  host.innerHTML=lista.length ? lista.map(function(n){
    var titulo=(n.titulo||"").trim()||"Sem título", tags=tagsNota(n.tags);
    return '<div class="nota-item-wrap">'+
      '<button type="button" class="item" data-nota="'+esc(n.id)+'" aria-current="'+(modoNotas&&notaAtual===n.id)+'">'+
        '<span class="rotulo">'+esc(titulo)+'</span><span class="contagem">'+((n.imagens||[]).length?((n.imagens||[]).length+' img · '):'')+esc(dataNota(n.atualizadoEm,false))+'</span></button>'+ 
      '<button type="button" class="bt-texto risco" data-nota-acao="apagar" data-nota-id="'+esc(n.id)+'" aria-label="Apagar nota" title="Apagar nota">apagar</button>'+ 
    '</div>'+htmlTags(tags,n.id);
  }).join("") : '<p class="vazio-lateral">'+(notas.length?"Nenhuma nota encontrada.":"Nenhuma nota ainda.")+"</p>";
}
/* ========== lateral ========== */
function atualizarContextoLateral(){
  document.body.classList.toggle("lateral-em-obra",!!obraAtual&&!modoNotas);
  document.body.classList.toggle("lateral-em-notas",!!modoNotas);
}
function desenharLateral(){
  atualizarContextoLateral();
  desenharNotasLateral();
  var lo=el("listaObras");
  if(!obras.length){
    lo.innerHTML='<p class="vazio-lateral">Nenhuma obra ainda. Crie a primeira para começar.</p>';
  }else{
    lo.innerHTML=obras.map(function(o){
      var n=caps.filter(function(c){return c.obraId===o.id;}).length;
      return '<div class="obra-item-wrap">'+
        '<button class="item" data-obra="'+esc(o.id)+'" aria-current="'+(obraAtual===o.id)+'">'+
          '<span class="rotulo">'+esc(o.titulo||"Sem título")+'</span>'+
          '<span class="contagem">'+n+' cap.</span>'+
        '</button>'+
        '<button type="button" class="bt-texto acao-obra" data-acao="rename-obra" data-obra-id="'+esc(o.id)+'" title="Renomear obra" aria-label="Renomear obra">renomear</button>'+
        '<button type="button" class="bt-texto risco acao-obra" data-acao="del-obra" data-obra-id="'+esc(o.id)+'" title="Apagar obra" aria-label="Apagar obra">apagar</button>'+
      '</div>';
    }).join("");
  }
  var bloco=el("blocoCapitulos"), lc=el("listaCaps");
  if(!obraAtual){ bloco.classList.add("oculto"); }
  else{
    bloco.classList.remove("oculto");
    var meus=caps.filter(function(c){return c.obraId===obraAtual;});
    var media=meus.length?Math.round(meus.reduce(function(s,c){return s+progressoCapitulo(c.progresso);},0)/meus.length):0;
    var nomeObra=obraObjAtual();
    lc.innerHTML = (nomeObra?'<p class="lateral-contexto">Da obra <b>'+esc(nomeObra.titulo||"Sem título")+'</b></p>':'')+(meus.length ? '<div class="cap-resumo"><span>Andamento da obra</span><strong>'+media+'%</strong></div>'+meus.map(function(c){
      var st=statusCapitulo(c.status), pr=progressoCapitulo(c.progresso);
      return '<button class="item cap" data-cap="'+esc(c.id)+'" aria-current="'+(capAtual===c.id)+'">'+
        '<span class="rotulo">'+esc((c.numero?("#"+c.numero+" "):"")+(c.titulo||"Sem título"))+'</span>'+
        '<span class="contagem">'+pr+'%</span></button><div class="cap-resumo">'+seloCapitulo(st)+'<span>'+esc(c.nPaineis)+' painel(is) · '+esc(c.paginas||1)+' pág.</span></div>';
    }).join("") : '<p class="vazio-lateral">Sem capítulos nesta obra.</p>');
  }
  var blocoP=el("blocoPersonagens"), lp=el("listaPersonagens");
  if(!obraAtual){ blocoP.classList.add("oculto"); }
  else{
    blocoP.classList.remove("oculto");
    var o=obraObjAtual();
    var pers=(o&&o.personagens)||[];
    lp.innerHTML = pers.length ? pers.map(function(n){
      return '<div class="personagem-item"><button type="button" class="bt-texto rotulo" data-ficha-personagem="'+esc(n)+'" title="Abrir ficha visual de '+esc(n)+'">'+esc(n)+'</button>'+
        '<button class="bt-texto risco" data-acao="del-personagem" data-nome="'+esc(n)+'">remover</button></div>';
    }).join("") : '<p class="vazio-lateral">Nenhum personagem cadastrado.</p>';
  }
}

/* ========== criação ========== */
function abrirFormObra(){
  el("formObra").classList.remove("oculto");
  el("campoObra").value="";
  el("campoObra").focus();
}
function fecharFormObra(){
  el("formObra").classList.add("oculto");
}

async function criarObra(t){
  t=(t||"").trim(); if(!t) return;
  if(!db){ aviso("Sem armazenamento disponível nesta visualização."); return; }
  return executarAcaoTexto(function(){return criarObraSalva(t);});
}
async function criarObraSalva(t){
  var o={titulo:t,criadoEm:Date.now(),personagens:[]};
  var ref=colObras().doc(id("o"));
  try{ await ref.set(o); }
  catch(e){
    var idObraLocal=ref.path.split("/").pop();
    try{ await dbLocal.collection(baseLocal+"/obras").doc(idObraLocal).set(o); }catch(localErr){ aviso("Não deu para criar a obra neste aparelho."); return; }
    aviso("Obra criada e guardada neste aparelho.");
  }
  o.id=ref.path.split("/").pop(); try{ await dbLocal.collection(baseLocal+"/obras").doc(o.id).set(o); }catch(localErr){} obras.push(o);
  modoNotas=false;obraAtual=o.id; capAtual=null; doc=null;
  desenharLateral(); desenhar();
  await criarCapituloSalvo();
}

async function renomearObra(obraId){
  if(!db||!obraId) return;
  var alvo=obras.filter(function(o){return o.id===obraId;})[0];
  if(!alvo) return;
  var novo=window.prompt("Novo nome da obra:", alvo.titulo||"");
  if(novo===null) return;
  novo=novo.trim();
  if(!novo){ aviso("O nome da obra não pode ficar vazio."); return; }
  if(novo===alvo.titulo) return;
  var anterior=alvo.titulo;
  try{ await colObras().doc(obraId).update({titulo:novo}); }
  catch(e){ try{ alvo.titulo=novo; await dbLocal.collection(baseLocal+"/obras").doc(obraId).set(alvo); }catch(localErr){ aviso("Não foi possível renomear a obra neste aparelho."); return; } }
  alvo.titulo=novo;
  desenharLateral();
  if(doc && obraAtual===obraId) desenhar();
  aviso("Obra renomeada.");
}

async function apagarObra(obraId){
  if(!db||!obraId) return;
  return executarAcaoTexto(function(){return apagarObraSalva(obraId);});
}
async function apagarObraSalva(obraId){return executarExclusaoObra(obraId);}

async function adicionarPersonagem(nome){
  nome=(nome||"").trim(); if(!nome) return;
  var o=obraObjAtual(); if(!o){ aviso("Selecione uma obra primeiro."); return; }
  o.personagens=o.personagens||[];
  if(o.personagens.indexOf(nome)>-1){ aviso("Esse personagem já existe."); return; }
  o.personagens.push(nome);
  try{ await colObras().doc(o.id).update({personagens:o.personagens}); }
  catch(e){ try{ await dbLocal.collection(baseLocal+"/obras").doc(o.id).set(o); }catch(localErr){ o.personagens.pop(); aviso("Não foi possível salvar o personagem neste aparelho."); return; } }
  desenharLateral(); desenhar(); atualizarPersonagens();
}

async function removerPersonagem(nome){
  var o=obraObjAtual(); if(!o) return;
  var anterior=o.personagens||[];
  o.personagens=anterior.filter(function(n){return n!==nome;});
  try{ await colObras().doc(o.id).update({personagens:o.personagens}); }
  catch(e){ try{ await dbLocal.collection(baseLocal+"/obras").doc(o.id).set(o); }catch(localErr){ o.personagens=anterior; aviso("Não foi possível remover o personagem neste aparelho."); return; } }
  desenharLateral(); desenhar(); atualizarPersonagens();
}

async function criarCapitulo(){
  if(!obraAtual||!db) return;
  return executarAcaoTexto(criarCapituloSalvo);
}
async function criarCapituloSalvo(){
  var meus=caps.filter(function(c){return c.obraId===obraAtual;});
  var novo={
    obraId:obraAtual, numero:meus.length+1, titulo:"", status:"roteiro", progresso:0,
    paginas:[novaPagina()], atualizadoEm:Date.now()
  };
  var ref=colCaps().doc(id("c"));
  try{ await ref.set(novo); }
  catch(e){
    var idCapLocal=ref.path.split("/").pop();
    try{ await dbLocal.collection(baseLocal+"/capitulos").doc(idCapLocal).set(novo); }catch(localErr){ aviso("Não deu para criar o capítulo neste aparelho."); return; }
    aviso("Capítulo criado e guardado neste aparelho.");
  }
  novo.id=ref.path.split("/").pop(); try{ await dbLocal.collection(baseLocal+"/capitulos").doc(novo.id).set(novo); }catch(localErr){}
  caps.push({id:novo.id,obraId:obraAtual,numero:novo.numero,titulo:"",nPaineis:1,paginas:1,status:"roteiro",progresso:0,atualizadoEm:novo.atualizadoEm});
  modoNotas=false;doc=novo; capAtual=novo.id;
  desenharLateral(); desenhar();
}

/* Prepara apenas metadados e registros de imagem. O chamador confirma o plano
   completo antes de publicar o capítulo ou mostrar a duplicação como salva. */
function erroDuplicacaoEstrutura(mensagem){var e=new Error(mensagem);e.code="estrutura_incompleta";return e;}
function validarRegistroDuplicacao(rec,obrigatorio){
  if(!rec||typeof rec!=="object"||Array.isArray(rec)||!Array.isArray(rec.camadas)||(obrigatorio&&!rec.camadas.length)||(rec.baloes!=null&&!Array.isArray(rec.baloes))||!rec.camadas.every(function(c){return c&&typeof c==="object"&&c.blob;}))throw erroDuplicacaoEstrutura("O desenho original está incompleto. Nenhuma duplicação foi aplicada.");
}
async function duplicarPainelSeguro(pn,imagens){
  if(!pn||typeof pn!=="object"||Array.isArray(pn)||!Array.isArray(imagens))throw erroDuplicacaoEstrutura("Não foi possível preparar o painel para duplicação.");
  var c=dadosProfundos(pn);c.id=id("p");
  /* A flag pode estar antiga: existência só é confirmada pela leitura do banco. */
  var rec=await bdLer(pn.id);
  if(rec===null){if(pn.temDesenho)throw erroDuplicacaoEstrutura("O desenho do painel original não está disponível. Nenhuma duplicação foi aplicada.");}
  else{validarRegistroDuplicacao(rec,!!pn.temDesenho);imagens.push({id:c.id,rec:rec});if(rec.camadas.length)c.temDesenho=true;}
  return c;
}
async function duplicarPaginaSegura(pg,imagens){
  if(!pg||typeof pg!=="object"||Array.isArray(pg)||!Array.isArray(pg.paineis)||!Array.isArray(imagens))throw erroDuplicacaoEstrutura("Não foi possível preparar a página para duplicação.");
  var c=dadosProfundos(pg),novosPorId=Object.create(null);c.id=id("pg");c.paineis=[];
  for(var i=0;i<pg.paineis.length;i++){
    var anterior=pg.paineis[i],chave=String(anterior&&anterior.id);
    if(Object.prototype.hasOwnProperty.call(novosPorId,chave))throw erroDuplicacaoEstrutura("A página contém identificadores repetidos. A duplicação não foi aplicada.");
    var novo=await duplicarPainelSeguro(anterior,imagens);novosPorId[chave]=novo.id;c.paineis.push(novo);
  }
  if(pg.composicaoLivre!=null){
    if(typeof pg.composicaoLivre!=="object"||Array.isArray(pg.composicaoLivre))throw erroDuplicacaoEstrutura("A composição da página está inválida. A duplicação não foi aplicada.");
    var composicao=Object.create(null);
    Object.keys(pg.composicaoLivre).forEach(function(chave){
      var destino=Object.prototype.hasOwnProperty.call(novosPorId,chave)?novosPorId[chave]:chave;
      if(Object.prototype.hasOwnProperty.call(composicao,destino))throw erroDuplicacaoEstrutura("Dois registros da composição usariam o mesmo destino. A duplicação não foi aplicada.");
      composicao[destino]=dadosProfundos(pg.composicaoLivre[chave]);
    });
    c.composicaoLivre=composicao;
  }
  /* A sobreposição do editor de página tem um registro independente dos painéis. */
  var arte=await bdLer(idArtePagina(pg));
  if(arte!==null){validarRegistroDuplicacao(arte,false);imagens.push({id:idArtePagina(c),rec:arte});}
  return c;
}
function erroEstrutura(mensagem){var e=new Error(mensagem);e.code="estrutura_incompleta";return e;}
function chaveArteValida(v){return(typeof v==="string"&&v.length>0)||(typeof v==="number"&&isFinite(v));}
function chavesArtePaginas(paginas,exigirIds){
  var chaves=new Set();(paginas||[]).forEach(function(pg){
    if(!chaveArteValida(pg.id)){if(exigirIds)throw erroEstrutura("Não foi possível confirmar todos os identificadores das páginas.");}else chaves.add(idArtePagina(pg));
    (pg.paineis||[]).forEach(function(pn){if(!chaveArteValida(pn.id)){if(exigirIds)throw erroEstrutura("Não foi possível confirmar todos os identificadores dos quadros.");}else chaves.add(pn.id);});
  });return chaves;
}
async function referenciasArtePersistidas(exigirIds){
  var referencias=new Set(),sc=await colCaps().get(),sn=await colNotas().get();
  sc.docs.forEach(function(d){var v=validarDocumentoLocal(d.data());if(v.paginasSeparadas)throw erroEstrutura("Há páginas externas que não puderam ser inventariadas.");chavesArtePaginas(v.paginas,exigirIds).forEach(function(k){referencias.add(k);});});
  sn.docs.forEach(function(d){var v=validarDocumentoLocal(d.data());(v.imagens||[]).forEach(function(im){if(!chaveArteValida(im.id))throw erroEstrutura("Uma referência de nota não pôde ser conferida.");referencias.add(notaImagemChave(d.id,im.id));});});
  lerListaEssencial("desenhos-livres").forEach(function(v){referencias.add(v.id);});
  lerListaEssencial("fichas-personagem-v1").forEach(function(f){(f.imagens||[]).forEach(function(im){if(!chaveArteValida(im.id))throw erroEstrutura("Uma referência de ficha não pôde ser conferida.");referencias.add(fichaImagemChave(f.id,im.id));});});
  return referencias;
}
async function limparArteSemReferencias(chaves){
  var lista=Array.from(new Set(chaves||[]));if(!lista.length)return{pendentes:0,compartilhados:0};
  var referencias;try{referencias=await referenciasArtePersistidas(true);}catch(e){return{pendentes:lista.length,compartilhados:0};}
  var pendentes=0,compartilhados=0;
  for(var i=0;i<lista.length;i++){
    if(referencias.has(lista[i])){compartilhados++;continue;}
    try{if(await window.EditorDesenho.apagar(lista[i])!==true)pendentes++;}catch(e){pendentes++;}
  }
  return{pendentes:pendentes,compartilhados:compartilhados};
}
function validarIdsEstrutura(c){
  var paginas=new Set(),paineis=new Set();(c.paginas||[]).forEach(function(pg){
    if(!chaveArteValida(pg.id)||paginas.has(String(pg.id)))throw erroEstrutura("Há identificadores de página ausentes ou repetidos. A operação foi interrompida para preservar os registros.");paginas.add(String(pg.id));
    (pg.paineis||[]).forEach(function(p){if(!chaveArteValida(p.id)||paineis.has(String(p.id)))throw erroEstrutura("Há identificadores de quadro ausentes ou repetidos. A operação foi interrompida para preservar os desenhos.");paineis.add(String(p.id));});
  });
}
async function prepararEdicaoEstrutural(origem,tipo,valor){
  valor=valor||{};var c=validarDocumentoLocal(origem);validarIdsEstrutura(c);
  var i=c.paginas.findIndex(function(p){return String(p.id)===String(valor.paginaId);});if(i<0)throw erroEstrutura("A página escolhida não está mais disponível.");
  var pg=c.paginas[i],imagens=[],limpar=[],res={indice:i,trocar:true},n=Math.max(1,Math.min(24,parseInt(valor.quantidade,10)||1));
  function painelPorId(pid){for(var pi=0;pi<c.paginas.length;pi++){var p=c.paginas[pi].paineis.find(function(pn){return String(pn.id)===String(pid);});if(p)return p;}return null;}
  if(tipo==="painel"){
    var alvo=valor.destinoId!=null?c.paginas.find(function(p){return String(p.id)===String(valor.destinoId);}):pg;if(!alvo)throw erroEstrutura("A página de destino não está mais disponível.");
    if(valor.duplicarId){var fonte=painelPorId(valor.duplicarId);if(!fonte)throw erroEstrutura("O quadro original não está mais disponível.");alvo.paineis.push(await duplicarPainelSeguro(fonte,imagens));}
    else for(var q=0;q<n;q++)alvo.paineis.push(novoPainel());
    if(alvo.composicaoLivre)garantirComposicaoLivre(alvo);
  }else if(tipo==="painel-duplicar"){
    var ip=pg.paineis.findIndex(function(p){return String(p.id)===String(valor.painelId);});if(ip<0)throw erroEstrutura("O quadro original não está mais disponível.");
    pg.paineis.splice(ip+1,0,await duplicarPainelSeguro(pg.paineis[ip],imagens));if(pg.composicaoLivre)garantirComposicaoLivre(pg);
  }else if(tipo==="painel-apagar"){
    var ap=pg.paineis.findIndex(function(p){return String(p.id)===String(valor.painelId);});if(ap<0)throw erroEstrutura("O quadro escolhido não está mais disponível.");
    if(valor.manterUm&&pg.paineis.length<2)throw erroEstrutura("Mantenha pelo menos um painel nesta página.");
    var removido=pg.paineis.splice(ap,1)[0];limpar.push(removido.id);if(pg.composicaoLivre)delete pg.composicaoLivre[removido.id];
  }else if(tipo==="duplicar"){
    c.paginas.splice(i+1,0,await duplicarPaginaSegura(pg,imagens));res.indice=i+1;
  }else if(tipo==="apagar"){
    if(valor.manterUma&&c.paginas.length<2)throw erroEstrutura("Mantenha pelo menos uma página no capítulo.");
    limpar=Array.from(chavesArtePaginas([pg],true));c.paginas.splice(i,1);if(!c.paginas.length)c.paginas.push(novaPagina());res.indice=Math.min(i,c.paginas.length-1);
  }else if(tipo==="nova")c.paginas.splice(i+1,0,novaPagina(n));
  else if(tipo==="layout"){
    var arvore=arvoreDoLayout(valor.layout);if(!arvore||folhasDoLayout(arvore)<pg.paineis.length)throw erroEstrutura("Esse layout não comporta todos os quadros da página.");pg.layoutPag=valor.layout;
  }else throw erroEstrutura("A operação escolhida não é reconhecida.");
  validarIdsEstrutura(c);return{capitulo:c,imagens:imagens,limpar:limpar,res:res};
}
async function prepararAmbienteEstrutural(doEditor){
  if(db!==dbLocal)throw erroEstrutura("A operação protegida requer a biblioteca local deste aparelho.");
  if(backupNuvemEmCurso||FICHAS.importando)throw erroEstrutura("Aguarde a cópia da nuvem ou a gravação de referências terminar.");
  var ed=window.EditorDesenho;if(!ed)throw erroEstrutura("O armazenamento de desenhos não está disponível.");
  if(ed.aguardarOperacoes&&await ed.aguardarOperacoes()!==true)throw erroEstrutura("Salve o desenho aberto antes de alterar a estrutura.");
  if(!doEditor&&ed.estaAberto&&ed.estaAberto()&&await ed.fechar()!==true)throw erroEstrutura("Não foi possível fechar o desenho com segurança.");
  if(!await salvarPendenciasTexto())throw erroEstrutura("Há textos que ainda não puderam ser salvos.");
  if(FICHAS.pendente&&!fichasGravar())throw erroEstrutura("Há fichas que ainda não puderam ser salvas.");
}
function informarFalhaEstrutural(e,confirmada){
  var concluida=confirmada||!!(e&&e.importado),texto=concluida?(e&&e.editorPendente?"A estrutura foi salva, mas o desenho ainda aberto não pôde ser fechado com segurança. Preserve esta aba e baixe o PNG antes de reabrir a página.":"A alteração foi confirmada, mas a atualização da tela ou a limpeza do aviso não terminou. Reabra a página antes de editar."):e&&e.pendente?"A operação foi interrompida e a recuperação está pendente. Preserve os dados do navegador e tente recuperar novamente.":e&&e.recuperado?"A operação falhou. Os registros anteriores foram recuperados; nenhuma alteração estrutural foi aplicada.":((e&&e.code==="estrutura_incompleta"&&e.message)||"Não foi possível confirmar a operação. Os registros anteriores foram preservados.");
  estado.textContent=concluida?"alteração confirmada · reabra a página":e&&e.pendente?"recuperação pendente":"alteração não aplicada";
  if(concluida||(e&&e.pendente)){el("textoRecuperacao").textContent=texto;el("btExportarDesenhoPendente").classList.toggle("oculto",!(window.EditorDesenho&&window.EditorDesenho.estaAberto&&window.EditorDesenho.estaAberto()));mostrarBloqueioImportacao();}aviso(texto);return false;
}
async function confirmarPlanoEstrutural(textos,imagens){
  if(backupNuvemEmCurso)throw erroEstrutura("Aguarde a cópia da nuvem terminar.");
  var rec=window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao;if(!rec)throw erroEstrutura("A recuperação local não está disponível.");
  clearTimeout(temporizadorBackupNuvem);temporizadorBackupNuvem=null;
  var resultado=await rec.executar(textos,imagens);if(!resultado||resultado.importado!==true)throw erroEstrutura("A gravação da estrutura não foi confirmada.");
  COPIA_NUVEM.pendente=null;
}
async function executarEstruturaCapitulo(tipo,valor,doEditor){
  return executarAcaoTexto(async function(){var confirmada=false;try{
    await prepararAmbienteEstrutural(!!doEditor);if(!doc||!capAtual)throw erroEstrutura("Abra o capítulo antes de alterar a estrutura.");
    if(doc.paginasSeparadas)throw erroEstrutura("As páginas externas precisam de um backup completo antes de alterar a estrutura.");
    var alvo=doc,chave=capAtual,preparado=await prepararEdicaoEstrutural(alvo,tipo,valor);
    var paginasAntes=new Set(),paineisAntes=new Set(),destinos=[];
    alvo.paginas.forEach(function(pg){paginasAntes.add(String(pg.id));pg.paineis.forEach(function(p){paineisAntes.add(String(p.id));});});
    preparado.capitulo.paginas.forEach(function(pg){if(!paginasAntes.has(String(pg.id)))destinos.push(idArtePagina(pg));pg.paineis.forEach(function(p){if(!paineisAntes.has(String(p.id)))destinos.push(p.id);});});
    var refs=destinos.length?await referenciasArtePersistidas(false):new Set(),destinosVistos=new Set();for(var k of destinos){if(destinosVistos.has(k)||refs.has(k)||await bdLer(k)!==null)throw erroEstrutura("Um identificador novo já está em uso. A operação foi cancelada; tente novamente.");destinosVistos.add(k);}
    if(doc!==alvo||capAtual!==chave)throw erroEstrutura("O capítulo ativo mudou antes da confirmação.");
    var c=preparado.capitulo;c.atualizadoEm=Date.now();c.nPaineis=contarPaineis(c.paginas);delete c.nPaginas;delete c.paginasSeparadas;
    var corpo=dadosProfundos(c);delete corpo.id;
    return await comTravaImportacao(async function(){
      await confirmarPlanoEstrutural([{chave:"mesa:roteiros/local/capitulos/"+chave,valor:JSON.stringify(corpo)}],preparado.imagens);confirmada=true;
      preparado.res.confirmada=true;
      doc=c;doc.id=chave;sujo=false;pgAtual=preparado.res.indice;selPainel=null;
      await carregarListas();var limpeza=await limparArteSemReferencias(preparado.limpar);
      if(!doEditor){desenharLateral();desenhar();atualizarPersonagens();}mostrarEstadoTextoSalvo();agendarBackupNuvem();
      aviso(limpeza.pendentes?"A estrutura foi salva. Alguns pixels sem referência foram preservados porque a limpeza não pôde ser confirmada.":"Alteração salva neste aparelho.");
      return preparado.res;
    });
  }catch(e){return informarFalhaEstrutural(e,confirmada);}});
}
async function executarExclusaoObra(obraId){
  var confirmada=false;try{
    await prepararAmbienteEstrutural(false);
    var obra=await colObras().doc(obraId).get();if(!obra.exists)throw erroEstrutura("A obra escolhida não está mais disponível.");validarDocumentoLocal(obra.data());
    var sc=await colCaps().get(),textos=[],limpar=[];
    sc.docs.forEach(function(d){var c=validarDocumentoLocal(d.data());if(chaveArteValida(c.obraId)&&String(c.obraId)===String(obraId)){if(c.paginasSeparadas)throw erroEstrutura("As páginas externas precisam de um backup completo antes de excluir esta obra.");textos.push({chave:"mesa:roteiros/local/capitulos/"+d.id,valor:null});chavesArtePaginas(c.paginas,false).forEach(function(k){limpar.push(k);});}});
    textos.push({chave:"mesa:roteiros/local/obras/"+obraId,valor:null});
    return await comTravaImportacao(async function(){
      await confirmarPlanoEstrutural(textos,[]);confirmada=true;
      if(chaveArteValida(obraAtual)&&String(obraAtual)===String(obraId)){obraAtual=null;capAtual=null;doc=null;notaAtual=null;modoNotas=false;sujo=false;}
      await carregarListas();var limpeza=await limparArteSemReferencias(limpar);desenharLateral();desenhar();atualizarPersonagens();alternarLateral(false);agendarBackupNuvem();
      aviso(limpeza.pendentes?"Obra excluída. Alguns pixels sem referência foram preservados porque a limpeza não pôde ser confirmada.":"Obra apagada.");return true;
    });
  }catch(e){return informarFalhaEstrutural(e,confirmada);}
}
function novoPainel(){
  return {
    id:id("p"), enquadramento:"", distancia:"", plano:"", angulo:"", tamanho:"",
    personagens:[], acao:"", falas:[{quem:"",tipo:"fala",texto:""}], sfx:"", nota:""
  };
}
function resumoPainel(pn){
  var t=(pn.acao||"").trim();
  if(!t && pn.falas && pn.falas.length) t=(pn.falas[0].texto||"").trim();
  if(!t) return "(painel vazio)";
  return t.length>36 ? t.slice(0,36)+"…" : t;
}
function novaPagina(qtd){
  var n=qtd||1, paineis=[], i;
  for(i=0;i<n;i++) paineis.push(novoPainel());
  return {id:id("pg"),paineis:paineis};
}
/* atalhos de composição disponíveis diretamente nas informações do painel */
var FORMAS_RAPIDAS_PAINEL={
  ret:null,
  diagonal:[0.16,0,1,0,0.84,1,0,1],
  trapezio:[0.18,0,0.82,0,1,1,0,1],
  estilha:[0.13,0,0.88,0,1,0.24,0.83,1,0.13,1,0,0.76]
};
function mesmaFormaRapida(a,b){
  if(!a&&!b) return true;
  if(!a||!b||a.length!==b.length) return false;
  for(var i=0;i<a.length;i++) if(Math.abs(a[i]-b[i])>0.0001) return false;
  return true;
}
function formaRapidaAtual(pn){
  var f=formaPainel(pn), ks=Object.keys(FORMAS_RAPIDAS_PAINEL);
  for(var i=0;i<ks.length;i++) if(mesmaFormaRapida(f,FORMAS_RAPIDAS_PAINEL[ks[i]])) return ks[i];
  return "custom";
}
function aplicarFormaRapida(pn,chave){
  var f=FORMAS_RAPIDAS_PAINEL[chave];
  if(f) pn.forma=f.slice(); else delete pn.forma;
}

/* Constrói a frase-resumo de um painel a partir das escolhas feitas nele. */
function fraseResumoPainel(pn){
  var pessoas=(pn.personagens||[]).filter(Boolean);
  var descricao=[];
  if(pn.plano) descricao.push(pn.plano.toLowerCase());
  if(pn.angulo) descricao.push(pn.angulo.toLowerCase());
  if(pn.distancia) descricao.push(pn.distancia.toLowerCase());
  if(pn.enquadramento) descricao.push(pn.enquadramento.toLowerCase());
  if(pn.tamanho&&TAMANHOS[pn.tamanho]) descricao.push("painel "+nomeTamanho(pn.tamanho).toLowerCase());

  var partes=[];
  if(pessoas.length) partes.push(pessoas.join(" e "));
  if(descricao.length) partes.push(descricao.join(", "));
  var abertura=partes.join(" — ");
  if(!abertura && pn.acao) abertura=pn.acao.trim().slice(0,60);

  var falantes=(pn.falas||[]).filter(function(f){return f.texto && f.texto.trim();}).map(function(f){
    var nome=(f.quem&&f.quem.trim())?f.quem.trim():"Alguém";
    var t=f.texto.trim();
    return nome+' diz: "'+(t.length>40?t.slice(0,40)+"…":t)+'"';
  });

  var s=abertura;
  if(falantes.length) s=(s?s+". ":"")+falantes.join("; ");
  if(pn.sfx && pn.sfx.trim()) s=(s?s+" ":"")+"["+pn.sfx.trim()+"]";
  return s || "Painel em branco — escolha um enquadramento ou escreva a cena.";
}

/* Converte o antigo campo único de enquadramento, sem perder roteiros já salvos. */
function normalizarPainel(pn){
  if(!pn) return;
  pn.enquadramento=pn.enquadramento||pn.tipoPainel||"";
  pn.distancia=pn.distancia||"";
  pn.plano=pn.plano||"";
  pn.angulo=pn.angulo||"";
  pn.tamanho=TAMANHOS[pn.tamanho]?pn.tamanho:"";
  pn.personagens=pn.personagens||[];
  pn.nota=pn.nota||"";
  pn.falas=pn.falas||[];
  if(!pn.falas.length) pn.falas.push({quem:"",tipo:"fala",texto:""});
  pn.falas.forEach(function(f){ f.quem=f.quem||""; f.tipo=f.tipo||"fala"; f.texto=f.texto||""; });
  var antigo=pn.enq||"";
  if(!antigo) return;
  if(!pn.plano && PLANOS.indexOf(antigo)>-1) pn.plano=antigo;
  else if(!pn.angulo && ANGULOS_CAMERA.indexOf(antigo)>-1) pn.angulo=antigo;
  else if(!pn.enquadramento && ENQUADRAMENTOS.indexOf(antigo)>-1) pn.enquadramento=antigo;
}
function normalizarDocumento(d){
  d.status=statusCapitulo(d.status); d.progresso=progressoCapitulo(d.progresso);
  (d.paginas||[]).forEach(function(pg){
    (pg.paineis||[]).forEach(normalizarPainel);
  });
}

async function abrirCapitulo(cid){
  return executarAcaoTexto(function(){return abrirCapituloSalvo(cid);});
}
async function abrirObra(oid){
  return executarAcaoTexto(async function(){
    var meus=caps.filter(function(c){return c.obraId===oid;});
    if(meus.length)return abrirCapituloSalvo(meus[0].id);
    modoNotas=false;obraAtual=oid;capAtual=null;doc=null;
    desenharLateral();desenhar();alternarLateral(false);
  });
}
async function abrirCapituloSalvo(cid){
  try{
    var s=await colCaps().doc(cid).get();
    if(!s.exists){ aviso("Capítulo não encontrado."); return; }
    var aberto=validarDocumentoLocal(s.data());aberto.id=cid;
    if(!aberto.paginas||!aberto.paginas.length)aberto.paginas=[novaPagina()];normalizarDocumento(aberto);
    doc=aberto;modoNotas=false;capAtual=cid;obraAtual=aberto.obraId;
    pgAtual=0; selPainel=null;
    estado.textContent=rotuloSalvoTexto();
    desenharLateral(); desenhar(); atualizarPersonagens();
    alternarLateral(false);
    el("tela").scrollTop=0;
    limparFalhaLocal("abertura");
  }catch(e){BIBLIOTECA_TEXTOS_OK=false;registrarFalhaLocal("abertura","A abertura do capítulo não foi concluída. Seus registros foram preservados e a cópia de consulta continua separada.");aviso("Não foi possível abrir o capítulo. A cópia antiga não será aberta para edição.");return false;}
}

/* ========== desenho do roteiro ========== */
/* ===== layouts de página: árvore de divisões ("v" = lado a lado, "h" = um sobre o outro; ratio = fatia do primeiro) ===== */
function LF(){ return {leaf:true}; }
function LS(d,r,a,b){ return {dir:d,ratio:r,a:a,b:b}; }
var LAYOUTS_PAG={
  U6:{n:6,nome:"6 · 3 à esquerda + alto + 2 embaixo",build:function(){
    return LS("h",0.64,LS("v",0.47,LS("h",0.34,LF(),LS("h",0.44,LF(),LF())),LF()),LS("v",0.71,LF(),LF()));}},
  U1:{n:1,nome:"Splash page · página inteira",build:function(){ return LF(); }},
  U2:{n:2,nome:"2 · um sobre o outro",build:function(){ return LS("h",0.5,LF(),LF()); }},
  U3:{n:3,nome:"3 · tiras",build:function(){ return LS("h",0.34,LF(),LS("h",0.5,LF(),LF())); }},
  U3b:{n:3,nome:"3 · 1 grande + 2",build:function(){ return LS("h",0.6,LF(),LS("v",0.5,LF(),LF())); }},
  U4:{n:4,nome:"4 · grade 2×2",build:function(){ return LS("h",0.5,LS("v",0.5,LF(),LF()),LS("v",0.5,LF(),LF())); }},
  U5:{n:5,nome:"5 · 2 em cima + 2 e 1 alto",build:function(){
    return LS("h",0.34,LS("v",0.5,LF(),LF()),LS("v",0.55,LS("h",0.5,LF(),LF()),LF()));}},
  U6b:{n:6,nome:"6 · A",build:function(){
    return LS("h",0.54,LS("v",0.6,LS("h",0.5,LF(),LF()),LF()),LS("v",0.4,LF(),LS("h",0.5,LF(),LF())));}},
  U6c:{n:6,nome:"6 · B",build:function(){
    return LS("h",0.55,LS("h",0.5,LS("v",0.27,LF(),LF()),LS("v",0.7,LF(),LF())),LS("v",0.3,LF(),LF()));}}
};
function arvoreGrade(n){
  var linhas=Math.ceil(n/2);
  function lin(k){ var par=LS("v",0.5,LF(),LF()); return k===1?par:LS("h",1/k,par,lin(k-1)); }
  return lin(linhas);
}
function arvoreDoLayout(id){
  if(LAYOUTS_PAG[id]) return LAYOUTS_PAG[id].build();
  var m=/^GR(\d+)$/.exec(id||""); return m?arvoreGrade(parseInt(m[1],10)):null;
}
function folhasDoLayout(no){ return no.leaf?1:folhasDoLayout(no.a)+folhasDoLayout(no.b); }
function rectsArvore(no,x,y,w,h,out){
  if(no.leaf){ out.push({x:x,y:y,w:w,h:h}); return; }
  if(no.dir==="v"){ var wa=w*no.ratio; rectsArvore(no.a,x,y,wa,h,out); rectsArvore(no.b,x+wa,y,w-wa,h,out); }
  else{ var ha=h*no.ratio; rectsArvore(no.a,x,y,w,ha,out); rectsArvore(no.b,x,y+ha,w,h-ha,out); }
}
/* escolhe o layout da página: mantém o salvo se ainda couber, senão o padrão (o primeiro, de 6 quadros, ou uma grade) */
function layoutDaPagina(pg,np){
  var no=pg.layoutPag?arvoreDoLayout(pg.layoutPag):null;
  if(!no||folhasDoLayout(no)<np){
    pg.layoutPag=np<=6?"U6":"GR"+(np+(np%2));
    no=arvoreDoLayout(pg.layoutPag);
  }
  return no;
}
function celulasBase(pg,np){
  var out=[]; rectsArvore(layoutDaPagina(pg,np),7,5,86,90,out); return out;
}
function limitarNumero(v,min,max){ return Math.max(min,Math.min(max,v)); }
function garantirComposicaoLivre(pg){
  var mapa=pg.composicaoLivre||(pg.composicaoLivre={}), base=celulasBase(pg,(pg.paineis||[]).length);
  (pg.paineis||[]).forEach(function(pn,i){
    if(mapa[pn.id]) return;
    var c=base[i]||{x:7,y:5,w:86,h:90};
    mapa[pn.id]={x:c.x,y:c.y,w:c.w,h:c.h,z:i+1};
  });
  return mapa;
}
function celulasPagina(pg,np){
  var base=celulasBase(pg,np), mapa=pg.composicaoLivre, paineis=pg.paineis||[];
  if(!mapa) return base;
  return base.map(function(c,i){
    var q=paineis[i]&&mapa[paineis[i].id]; if(!q) return c;
    var w=limitarNumero(+q.w||c.w,8,98), h=limitarNumero(+q.h||c.h,8,98);
    return {x:limitarNumero(+q.x||c.x,1,99-w),y:limitarNumero(+q.y||c.y,1,99-h),w:w,h:h,z:+q.z||i+1};
  });
}
function opcoesLayoutPag(pg,np){
  var ids=Object.keys(LAYOUTS_PAG);
  if(/^GR\d+$/.test(pg.layoutPag||"")) ids.push(pg.layoutPag);
  return ids.map(function(k){
    var nome=LAYOUTS_PAG[k]?LAYOUTS_PAG[k].nome:("grade · "+k.slice(2)+" quadros");
    var n=LAYOUTS_PAG[k]?LAYOUTS_PAG[k].n:parseInt(k.slice(2),10);
    return '<option value="'+k+'"'+(k===pg.layoutPag?" selected":"")+(n<np?" disabled":"")+'>'+esc(nome)+'</option>';
  }).join("");
}
var pgAtual=0, selPainel=null;
function desenhar(){
  atualizarContextoLateral();
  if(modoLeitura){ modoLeitura=false; document.body.classList.remove("em-leitura"); }
  if(modoNotas){ desenharNotas(); return; }
  tela.classList.remove("modo-pag","modo-notas");
  el("blocoPaginas").classList.add("oculto"); el("blocoInfo").classList.add("oculto");
  el("tituloCap").disabled=!doc;
  el("btExportar").disabled=!doc;
  el("tituloCap").value=doc?(doc.titulo||""):"";

  if(!doc){
    if(!obras.length){
      /* tela inicial: três caminhos claros para começar */
      tela.innerHTML=
        '<div class="centro entrada">'+
        '<p class="entrada-sobrancelha">Mesa de Roteiro</p>'+
        '<h2>Por onde você quer começar?</h2>'+
        '<p class="entrada-intro">Crie sua história, registre uma ideia em uma nota ou comece a desenhar. Você pode alternar entre essas opções quando quiser.</p>'+
        '<section class="entrada-criar" aria-labelledby="entradaCriarTitulo">'+
          '<h3 id="entradaCriarTitulo">Criar uma obra</h3>'+
          '<p>Use uma obra para organizar capítulos, personagens, páginas e painéis.</p>'+
          '<form id="formBoasVindas" class="entrada-form" autocomplete="off">'+
            '<div style="flex:1 1 260px"><label for="campoBoasVindas">Nome da obra</label><input type="text" id="campoBoasVindas" placeholder="Ex.: Minha história" maxlength="120" required></div>'+
            '<button type="submit" class="bt forte">Criar obra</button>'+
          '</form>'+
        '</section>'+
        '<section class="entrada-acoes" aria-label="Outras formas de começar">'+
          '<button type="button" class="entrada-acao" id="boasVindasNotas">'+
            '<span class="entrada-icone" aria-hidden="true">▤</span><span class="entrada-texto"><strong>Notas</strong><small>Escreva ideias, lembretes ou qualquer texto.</small></span><span class="entrada-seta" aria-hidden="true">→</span>'+
          '</button>'+
          '<button type="button" class="entrada-acao" id="boasVindasDesenho">'+
            '<span class="entrada-icone" aria-hidden="true">✎</span><span class="entrada-texto"><strong>Desenho livre</strong><small>Desenhe sem criar uma obra antes.</small></span><span class="entrada-seta" aria-hidden="true">→</span>'+
          '</button>'+
        '</section>'+htmlEntradaBiblioteca()+'</div>';
      el("boasVindasNotas").onclick=abrirNotas;
      el("boasVindasDesenho").onclick=abrirDesenhoLivre;
      ligarEntradaBiblioteca();
      el("formBoasVindas").addEventListener("submit",function(ev){
        ev.preventDefault();
        var t=el("campoBoasVindas").value;
        if(!t.trim()){ el("campoBoasVindas").focus(); return; }
        criarObra(t);
      });
      return;
    }
    var acaoRoteiro=obraAtual
      ? '<button type="button" class="entrada-acao entrada-acao-principal" id="comecar"><span class="entrada-icone" aria-hidden="true">+</span><span class="entrada-texto"><strong>Novo capítulo</strong><small>Crie o próximo capítulo da obra selecionada.</small></span><span class="entrada-seta" aria-hidden="true">→</span></button>'
      : '<button type="button" class="entrada-acao entrada-acao-principal" id="escolherObra"><span class="entrada-icone" aria-hidden="true">☰</span><span class="entrada-texto"><strong>Escolher uma obra</strong><small>Abra o menu para selecionar uma obra ou criar uma nova.</small></span><span class="entrada-seta" aria-hidden="true">→</span></button>';
    tela.innerHTML=
      '<div class="centro entrada">'+
      '<p class="entrada-sobrancelha">Mesa de Roteiro</p>'+
      '<h2>Continue por onde preferir</h2>'+
      '<p class="entrada-intro">Abra uma obra, crie um capítulo, registre uma ideia em Notas ou desenhe sem vínculo com o roteiro.</p>'+
      '<section class="entrada-acoes" aria-label="Ações principais">'+
        acaoRoteiro+
        '<button type="button" class="entrada-acao" id="comecarNotas"><span class="entrada-icone" aria-hidden="true">▤</span><span class="entrada-texto"><strong>Notas</strong><small>Crie e organize anotações livres.</small></span><span class="entrada-seta" aria-hidden="true">→</span></button>'+
        '<button type="button" class="entrada-acao" id="comecarDesenhoLivre"><span class="entrada-icone" aria-hidden="true">✎</span><span class="entrada-texto"><strong>Desenho livre</strong><small>Abra uma folha para desenhar agora.</small></span><span class="entrada-seta" aria-hidden="true">→</span></button>'+
      '</section>'+htmlEntradaBiblioteca()+'</div>';
    var b=el("comecar");
    if(b) b.onclick=criarCapitulo;
    var eo=el("escolherObra"); if(eo) eo.onclick=function(){ alternarLateral(true); };
    var bn=el("comecarNotas"); if(bn) bn.onclick=abrirNotas;
    var bl=el("comecarDesenhoLivre"); if(bl) bl.onclick=abrirDesenhoLivre;
    ligarEntradaBiblioteca();
    return;
  }

  if(pgAtual>=doc.paginas.length) pgAtual=doc.paginas.length-1;
  if(pgAtual<0) pgAtual=0;
  var ip=pgAtual, pg=doc.paginas[ip], np=(pg.paineis||[]).length, status=statusCapitulo(doc.status), progresso=progressoCapitulo(doc.progresso);
  var html='<div class="folha pag"><section class="pagina" data-pg="'+esc(pg.id)+'">'+
    '<div class="cabeca-pagina">'+
      '<h2>Painéis</h2>'+
      '<span class="troca-pagina" aria-label="Trocar página"><button type="button" class="bt mini" data-acao="pagina-anterior" title="Página anterior (Alt + Page Up)"'+(ip===0?" disabled":"")+'>‹</button><span class="rotulo">Página '+(ip+1)+'/'+doc.paginas.length+'</span><button type="button" class="bt mini" data-acao="pagina-proxima" title="Próxima página (Alt + Page Down)"'+(ip===doc.paginas.length-1?" disabled":"")+'>›</button></span>'+
      '<select class="ir-pagina-select" data-ir-pagina aria-label="Ir para uma página">'+doc.paginas.map(function(_pagina,i){return '<option value="'+i+'"'+(i===ip?' selected':'')+'>Página '+(i+1)+' · '+((_pagina.paineis||[]).length)+' painel(is)</option>';}).join("")+'</select>'+
      '<button class="bt mini" data-acao="abrir-leitura" title="Ler o capítulo sem ferramentas">Ler capítulo</button>'+
      '<button class="bt mini forte" data-acao="abrir-editor-capitulo" title="Abrir a página composta no editor completo">Abrir no editor</button>'+
      '<button class="bt mini forte" data-acao="add-painel" data-pg="'+esc(pg.id)+'" aria-label="Adicionar painel" title="Adicionar painel">+</button>'+
      '<span class="info">Página '+(ip+1)+' · '+np+(np===1?" painel":" painéis")+'</span>'+
      '<select class="sel-layout" data-layout-pag="'+esc(pg.id)+'" aria-label="Layout da página">'+opcoesLayoutPag(pg,np)+'</select>'+
      (np>0?'<button class="bt-texto" data-acao="duplicar-pagina" data-pg="'+esc(pg.id)+'">duplicar página</button>':'')+
      (doc.paginas.length>1?'<button class="bt-texto" data-acao="del-pagina" data-pg="'+esc(pg.id)+'">apagar página</button>':'')+
    '</div>'+
    '<div class="cap-controles" aria-label="Andamento do capítulo">'+
      '<label>Etapa <select data-cap-campo="status" aria-label="Etapa do capítulo">'+opcoesStatusCap(status)+'</select></label>'+
      '<label>Progresso <input type="range" min="0" max="100" step="5" value="'+progresso+'" data-cap-campo="progresso" aria-label="Progresso do capítulo"></label>'+
      '<output class="cap-progresso-num" data-cap-progresso>'+progresso+'%</output><span class="barra-progresso" aria-hidden="true"><i style="width:'+progresso+'%"></i></span>'+
    '</div>'+
    '<div class="quadros" id="quadros"><div class="pag-papel" id="papel">';
  celulasPagina(pg,np).forEach(function(c,k){
    var pn=(pg.paineis||[])[k];
    html+='<div class="cel" style="left:'+c.x+'%;top:'+c.y+'%;width:'+c.w+'%;height:'+c.h+'%;z-index:'+(c.z||k+1)+'">'+
      (pn?htmlPainel(pn,k,ip,np):'<button type="button" class="quadro vazio-cel" data-acao="add-um" data-pg="'+esc(pg.id)+'" aria-label="Adicionar o painel '+(k+1)+'" title="Adicionar painel">+</button>')+
      '</div>';
  });
  html+='</div></div>'+ 
    '</section></div>';
  tela.innerHTML=html;
  tela.classList.add("modo-pag");
  carregarPrevias();
  desenharPaginasLat();
  mostrarInfo();
  ajustarQuadros();
}

/* prévia grande do desenho: fica guardada no navegador; enquanto carrega, vale a miniatura pequena */
var previas={};
function carregarPrevias(){
  Array.prototype.forEach.call(tela.querySelectorAll("img[data-prev]"),function(img){
    var pid=img.getAttribute("data-prev");
    if(previas[pid]){ img.src=previas[pid]; return; }
    if(!window.EditorDesenho.previa) return;
    window.EditorDesenho.previa(pid,acharPainelPorId(pid)).then(function(b){
      if(!b) return;
      var u=URL.createObjectURL(b);
      if(previas[pid]) URL.revokeObjectURL(previas[pid]);
      previas[pid]=u;
      if(img.isConnected) img.src=u;
    }).catch(function(){if(img.isConnected){img.title="Falha ao ler a prévia. A miniatura anterior foi preservada; tente abrir o desenho novamente.";img.setAttribute("data-prev-falha","1");}});
  });
}
function soltarPrevia(pid){
  if(previas[pid]){ URL.revokeObjectURL(previas[pid]); delete previas[pid]; }
}

function opcoesSelect(opcoes, valor, vazio){
  return opcoes.map(function(opcao){
    return '<option value="'+esc(opcao)+'"'+(valor===opcao?" selected":"")+'>'+
      (opcao||vazio)+'</option>';
  }).join("");
}

/* forma (corte) do painel: lista plana [x0,y0,x1,y1,...] em frações 0–1 do quadro; sem forma = retângulo */
function formaValida(f){
  if(!Array.isArray(f)||f.length<6||f.length%2) return false;
  for(var i=0;i<f.length;i++) if(typeof f[i]!=="number"||!isFinite(f[i])) return false;
  return true;
}
function formaPainel(pn){ return pn&&formaValida(pn.forma)?pn.forma:null; }
function umaCasa(v){ return +(Math.min(1,Math.max(0,v))*100).toFixed(3); }
function formaPts100(f){
  var o=[],i; for(i=0;i<f.length;i+=2) o.push(umaCasa(f[i])+","+umaCasa(f[i+1])); return o.join(" ");
}
function formaCss(f){
  var o=[],i; for(i=0;i<f.length;i+=2) o.push(umaCasa(f[i])+"% "+umaCasa(f[i+1])+"%"); return "polygon("+o.join(",")+")";
}
function trilhaQuadro(ctx,fm,fx,fy,fw,fh){
  var j, px, py;
  ctx.beginPath();
  if(fm){
    for(j=0;j<fm.length;j+=2){
      px=fx+Math.min(1,Math.max(0,fm[j]))*fw; py=fy+Math.min(1,Math.max(0,fm[j+1]))*fh;
      if(j) ctx.lineTo(px,py); else ctx.moveTo(px,py);
    }
    ctx.closePath();
  }else ctx.rect(fx,fy,fw,fh);
}

function htmlPainel(pn,i,ip,np){
  var tm=TAMANHOS[pn.tamanho]||TAMANHOS.horizontal, fm=formaPainel(pn);
  var semBorda=typeof pn.borda==="number"&&pn.borda<=0, svg="";
  if(fm){
    var pts=formaPts100(fm), cid="fc-"+String(pn.id).replace(/[^\w-]/g,"");
    svg='<svg class="quadro-forma" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">'+
      '<defs><clipPath id="'+cid+'"><polygon points="'+pts+'"/></clipPath></defs>'+
      '<polygon points="'+pts+'" clip-path="url(#'+cid+')"/></svg>';
  }
  return '<article class="painel quadro'+(fm?" forma":"")+(semBorda?" sem-borda":"")+(pn.sobreposto?" sobreposto":"")+(pn.id===selPainel?" sel":"")+'" data-pn="'+esc(pn.id)+'" data-pg-idx="'+ip+'" style="--r:'+(tm.w/tm.h)+'">'+
    '<button type="button" class="palco-painel'+(pn.miniatura?"":" vazio")+'"'+(fm?' style="clip-path:'+formaCss(fm)+'"':'')+' data-acao="desenhar-painel" aria-label="Abrir o editor de desenho do painel '+(i+1)+'">'+
      (pn.miniatura?'<img src="'+esc(pn.miniatura)+'" data-prev="'+esc(pn.id)+'" alt="Desenho do painel '+(i+1)+'">':(fm?'<span title="Sem desenho. Clique para desenhar.">✎</span>':'<span>Sem desenho.<br>Clique para desenhar.</span>'))+
    '</button>'+
    svg+
    '<div class="quadro-topo">'+
      '<button type="button" class="num" data-acao="sel-painel" title="Ver as informações deste painel" aria-label="Informações do painel '+(i+1)+'">'+(i+1)+'</button>'+
      '<div class="acoes">'+
        '<button class="bt mini" data-acao="subir" '+(i===0?"disabled":"")+' aria-label="Mover para trás" title="Mover para trás">←</button>'+
        '<button class="bt mini" data-acao="descer" '+(i===np-1?"disabled":"")+' aria-label="Mover para frente" title="Mover para frente">→</button>'+
        '<button type="button" class="bt mini mover-painel" data-mover-painel="'+esc(pn.id)+'" aria-label="Arraste para mover este painel na página" title="Arraste para mover na página">mover</button>'+
        '<button class="bt mini" data-acao="duplicar-painel" aria-label="Duplicar este painel" title="Duplicar">⧉</button>'+
        '<button class="bt mini risco" data-acao="del-painel" aria-label="Apagar painel">✕</button>'+
      '</div>'+
    '</div></article>';
}

function htmlInfo(pn,i,ip){
  var obraChars=(obraObjAtual()&&obraObjAtual().personagens)||[];
  var semBorda=typeof pn.borda==="number"&&pn.borda<=0, formaAtual=formaRapidaAtual(pn);
  var h='<div class="painel info-lat" data-pn="'+esc(pn.id)+'" data-pg-idx="'+ip+'">'+
    '<div class="info-painel">'+
      '<div class="frase-resumo" data-frase>'+esc(fraseResumoPainel(pn))+'</div>'+
      '<div class="campos-painel">'+
        '<div class="campo"><label>Enquadramento</label>'+
          '<select data-campo="enquadramento" aria-label="Enquadramento do painel '+(i+1)+'">'+
            opcoesSelect(ENQUADRAMENTOS,pn.enquadramento,"Escolha o enquadramento")+
          '</select></div>'+
        '<div class="campo"><label>Distância</label>'+
          '<select data-campo="distancia" aria-label="Distância do painel '+(i+1)+'">'+
            opcoesSelect(DISTANCIAS,pn.distancia,"Escolha a distância")+
          '</select></div>'+
        '<div class="campo"><label>Plano</label>'+
          '<select data-campo="plano" aria-label="Plano do painel '+(i+1)+'">'+
            opcoesSelect(PLANOS,pn.plano,"Escolha o plano")+
          '</select></div>'+
        '<div class="campo"><label>Ângulo</label>'+
          '<select data-campo="angulo" aria-label="Ângulo do painel '+(i+1)+'">'+
            opcoesSelect(ANGULOS_CAMERA,pn.angulo,"Escolha o ângulo")+
          '</select></div>'+
        '<div class="campo"><label>Tamanho do painel</label>'+
          '<select data-campo="tamanho" aria-label="Tamanho do painel '+(i+1)+'">'+
            opcoesTamanho(pn.tamanho)+
          '</select></div>'+
      '</div>'+
      '<fieldset class="opcoes-quadro"><legend>Quadro e diagramação</legend>'+
        '<p>Arraste <b>mover</b> no próprio painel para reposicioná-lo. Use formas irregulares, deixe-o flutuar sobre os demais ou desenhe por cima em “Layout visual da página”.</p>'+
        '<div class="chips">'+
          '<button type="button" class="chip'+(semBorda?" ativo":"")+'" data-acao="toggle-borda" aria-pressed="'+(semBorda?"true":"false")+'">'+(semBorda?"Adicionar borda":"Sem borda")+'</button>'+
          '<button type="button" class="chip'+(pn.sobreposto?" ativo":"")+'" data-acao="toggle-sobreposto" aria-pressed="'+(pn.sobreposto?"true":"false")+'">'+(pn.sobreposto?"Painel flutuante":"Flutuar por cima")+'</button>'+
          '<button type="button" class="chip'+(formaAtual==="ret"?" ativo":"")+'" data-acao="forma-painel" data-forma="ret">Retangular</button>'+
          '<button type="button" class="chip'+(formaAtual==="diagonal"?" ativo":"")+'" data-acao="forma-painel" data-forma="diagonal">Diagonal</button>'+
          '<button type="button" class="chip'+(formaAtual==="trapezio"?" ativo":"")+'" data-acao="forma-painel" data-forma="trapezio">Trapézio</button>'+
          '<button type="button" class="chip'+(formaAtual==="estilha"?" ativo":"")+'" data-acao="forma-painel" data-forma="estilha">Irregular</button>'+
        '</div>'+ 
      '</fieldset>'+
      '<div class="campo"><label>Personagens em cena</label><div class="chips" data-chips>'+
        (obraChars.length ? obraChars.map(function(nome){
          var ativo=(pn.personagens||[]).indexOf(nome)>-1;
          return '<button type="button" class="chip'+(ativo?" ativo":"")+'" data-acao="toggle-personagem" data-nome="'+esc(nome)+'">'+esc(nome)+'</button>';
        }).join("") : '<span style="color:var(--fraco);font-size:12.5px">Cadastre personagens na barra lateral para marcá-los aqui.</span>')+
      '</div></div>'+
      '<div class="campo"><label>Descrição da cena</label>'+
        '<textarea class="acao" data-campo="acao" placeholder="Descreva o que deve aparecer no desenho.">'+esc(pn.acao)+'</textarea></div>'+
      '<div class="campo"><label>Fala</label><div class="falas">';
  (pn.falas||[]).forEach(function(f,j){ h+=htmlFala(f,j); });
  h+='</div><button class="bt-texto" data-acao="add-fala">+ fala</button></div>'+
      '<div class="campo"><label>Onomatopeia</label>'+
        '<textarea class="sfx" data-campo="sfx" placeholder="DOOM, ZAAA, tum-tum…">'+esc(pn.sfx)+'</textarea></div>'+
      '<div class="campo"><label>Nota</label>'+
        '<textarea class="nota" data-campo="nota" placeholder="Anotações para o desenho: referências, luz, composição…">'+esc(pn.nota)+'</textarea></div>'+
    '</div></div>';
  return h;
}

function htmlFala(f,j){
  return '<div class="fala balao-'+esc(f.tipo||"fala")+'" data-fala="'+j+'">'+
    '<div class="quem"><input type="text" list="personagens" data-fala-campo="quem" aria-label="Quem fala '+(j+1)+'" placeholder="Personagem" value="'+esc(f.quem)+'"></div>'+
    '<div class="diz"><textarea data-fala-campo="texto" aria-label="Fala '+(j+1)+'" placeholder="Escreva a fala">'+esc(f.texto)+'</textarea></div>'+
    '<div class="tipo-balao"><select data-fala-campo="tipo" aria-label="Tipo de balão '+(j+1)+'">'+
      TIPOS_BALAO.map(function(t){
        return '<option value="'+t[0]+'"'+((f.tipo||"fala")===t[0]?" selected":"")+'>'+t[1]+'</option>';
      }).join("")+
    '</select></div>'+
    '<button class="bt mini risco rm" data-acao="del-fala" aria-label="Apagar fala">✕</button>'+
  '</div>';
}

/* ========== localizar dados a partir do DOM ========== */
/* Compara o valor original do atributo: IDs de backups não viram seletores CSS. */
function painelNoDOM(raiz,idPainel){
  var itens=raiz.querySelectorAll("[data-pn]"), valor=String(idPainel);
  for(var i=0;i<itens.length;i++) if(itens[i].getAttribute("data-pn")===valor) return itens[i];
  return null;
}
function acharPainel(node){
  var art=node.closest(".painel"); if(!art||!doc) return null;
  var pid=art.getAttribute("data-pn");
  for(var a=0;a<doc.paginas.length;a++){
    var lst=doc.paginas[a].paineis||[];
    for(var b=0;b<lst.length;b++) if(lst[b].id===pid)
      return {pagina:doc.paginas[a],ipg:a,painel:lst[b],ipn:b};
  }
  return null;
}
function acharPagina(pid){
  for(var a=0;a<doc.paginas.length;a++) if(doc.paginas[a].id===pid) return a;
  return -1;
}
function acharPainelPorId(pid){
  for(var a=0;a<doc.paginas.length;a++){
    var lst=doc.paginas[a].paineis||[];
    for(var b=0;b<lst.length;b++) if(lst[b].id===pid) return lst[b];
  }
  return null;
}
function listaDuplicaveis(limite){
  var out=[];
  doc.paginas.forEach(function(pg,ip){
    (pg.paineis||[]).forEach(function(pn,i){
      out.push({id:pn.id,rotulo:"P"+(ip+1)+"."+(i+1)+" — "+resumoPainel(pn)});
    });
  });
  out.reverse();
  return limite ? out.slice(0,limite) : out;
}

/* atualiza só a linha de resumo de um painel, sem redesenhar tudo (evita perder o foco ao digitar) */
/* ao trocar o tamanho, o quadro de prévia acompanha a nova proporção na hora */
function atualizarTamanhoPainel(pn){
  var art=painelNoDOM(tela,pn.id), tm=TAMANHOS[pn.tamanho]||TAMANHOS.horizontal;
  if(art) art.style.setProperty("--r",tm.w/tm.h);
  ajustarQuadros();
  if(pn.temDesenho){ soltarPrevia(pn.id); carregarPrevias(); }
}
function atualizarFraseResumo(loc){
  if(!loc) return;
  var art=painelNoDOM(el("infoPainel"),loc.painel.id);
  if(!art) return;
  var fr=art.querySelector('[data-frase]');
  if(fr) fr.textContent=fraseResumoPainel(loc.painel);
}

/* confirmação de duplo clique, sem depender de confirm() nativo (bloqueado em alguns visualizadores) */
function confirmarClique(btn, textoConfirmar, executar){
  if(btn.getAttribute("data-armado")==="1"){
    executar();
  }else{
    var original=btn.textContent;
    btn.setAttribute("data-armado","1");
    btn.textContent=textoConfirmar;
    setTimeout(function(){
      if(btn.isConnected){ btn.removeAttribute("data-armado"); btn.textContent=original; }
    },2600);
  }
}

/* ========== escolha de quantidade ao adicionar ========== */
var popQtd=document.createElement("div");
popQtd.className="pop-qtd oculto";
popQtd.setAttribute("role","menu");
document.body.appendChild(popQtd);
var popQtdCb=null, popQtdAncora=null;

function montarPopQtd(opts){
  opts=opts||{};
  var opcoes=[1,2,3,4,6];
  var html=
    '<div class="pop-qtd-titulo">'+(opts.duplicaveis&&opts.duplicaveis.length?"Em branco":"Quantos?")+'</div>'+
    opcoes.map(function(n){
      return '<button type="button" class="pop-qtd-item" data-n="'+n+'">'+n+(n===1?" painel":" painéis")+'</button>';
    }).join("")+
    '<div class="pop-qtd-outro">'+
      '<input type="number" min="1" max="24" step="1" id="popQtdNum" placeholder="Outro nº">'+
      '<button type="button" class="bt mini" id="popQtdNumOk">OK</button>'+
    '</div>';
  if(opts.duplicaveis && opts.duplicaveis.length){
    html+='<div class="pop-qtd-titulo pop-qtd-sep">Duplicar painel já escrito</div>'+
      opts.duplicaveis.map(function(d){
        return '<button type="button" class="pop-qtd-item" data-dup="'+esc(d.id)+'">'+esc(d.rotulo)+'</button>';
      }).join("");
  }
  popQtd.innerHTML=html;
}
function abrirEscolhaQtd(ancora,cb,opts){
  montarPopQtd(opts);
  popQtd.style.zIndex=document.body.classList.contains("ed-aberto")?"160":"60";
  popQtdCb=cb; popQtdAncora=ancora;
  var r=ancora.getBoundingClientRect();
  popQtd.classList.remove("oculto");
  var largura=popQtd.offsetWidth||170, altura=popQtd.offsetHeight||150;
  var topo=r.bottom+6;
  if(topo+altura>window.innerHeight-10) topo=Math.max(10,r.top-altura-6);
  var esquerda=Math.min(r.left,window.innerWidth-largura-10);
  popQtd.style.top=Math.round(topo)+"px";
  popQtd.style.left=Math.round(Math.max(10,esquerda))+"px";
}
function fecharEscolhaQtd(){
  popQtd.classList.add("oculto"); popQtdCb=null; popQtdAncora=null;
}
popQtd.addEventListener("click",function(ev){
  var it=ev.target.closest(".pop-qtd-item"); if(!it) return;
  var cb=popQtdCb;
  if(it.hasAttribute("data-dup")){
    var pid=it.getAttribute("data-dup"); fecharEscolhaQtd(); if(cb) cb(null,pid); return;
  }
  var n=parseInt(it.getAttribute("data-n"),10); fecharEscolhaQtd(); if(cb) cb(n,null);
});
popQtd.addEventListener("click",function(ev){
  if(ev.target.id==="popQtdNumOk"){
    var v=parseInt(el("popQtdNum").value,10); var cb=popQtdCb;
    if(v>0){ fecharEscolhaQtd(); if(cb) cb(v,null); }
  }
});
popQtd.addEventListener("keydown",function(ev){
  if(ev.key==="Enter" && ev.target.id==="popQtdNum"){
    ev.preventDefault(); el("popQtdNumOk").click();
  }
});
document.addEventListener("click",function(ev){
  if(popQtd.classList.contains("oculto")) return;
  if(popQtd.contains(ev.target)) return;
  if(popQtdAncora && popQtdAncora.contains(ev.target)) return;
  fecharEscolhaQtd();
});
document.addEventListener("keydown",function(ev){
  if(ev.key==="Escape") fecharEscolhaQtd();
  if(modoLeitura&&ev.key==="Escape"){
    ev.preventDefault();
    fecharLeituraCapitulo();
  }
});

/* ========== editor de desenho de um painel (tela 3) ========== */
/* Impede que uma composição antiga abra a página errada após outra seleção. */
var pedidoEditorPagina=0;
function listaPlana(){
  var out=[];
  doc.paginas.forEach(function(pg,ip){
    (pg.paineis||[]).forEach(function(pn,i){ out.push({pn:pn,ip:ip,i:i}); });
  });
  return out;
}
function abrirEditorDesenho(pid){
  if(!doc||!window.EditorDesenho) return;
  var lista=listaPlana(), k=-1;
  lista.forEach(function(x,j){ if(x.pn.id===pid) k=j; });
  if(k<0) return;
  pedidoEditorPagina++;
  selPainel=pid; pgAtual=lista[k].ip;
  var x=lista[k], ant=lista[k-1], prox=lista[k+1];
  window.EditorDesenho.abrir({
    painel:x.pn,
    titulo:"Página "+(x.ip+1)+" · Painel "+(x.i+1),
    arquivo:(nomeObra()+" p"+(x.ip+1)+" painel "+(x.i+1)).replace(/[^\wÀ-ÿ \-]/g,"").trim(),
    ant:ant?function(){ abrirEditorDesenho(ant.pn.id); }:null,
    prox:prox?function(){ abrirEditorDesenho(prox.pn.id); }:null,
    aviso:aviso,
    falas:function(){ return x.pn.falas||[]; },
    aoMudar:function(){ marcarSujo(); },
    aoFechar:function(p){ if(p) soltarPrevia(p.id); var st=tela.scrollTop; desenhar(); tela.scrollTop=st; }
  });
}

/* Página composta: os painéis ficam unidos na base; a arte criada aqui é uma sobreposição independente. */
function idArtePagina(pg){ return "pagina-inteira-"+pg.id; }
function painelInteiroDaPagina(pg){ return {id:idArtePagina(pg),tamanho:"pagina",borda:0,sobreposto:true}; }
function abrirEditorCapitulo(indice){
  if(!doc||!window.EditorDesenho) return;
  var ip=typeof indice==="number"?indice:pgAtual;
  if(ip<0||ip>=doc.paginas.length) return;
  var pg=doc.paginas[ip], documentoAbertura=doc, pedidoAbertura=++pedidoEditorPagina;
  pgAtual=ip; selPainel=null;
  var qtdPaineis=(pg.paineis||[]).length;
  var layoutAtual=pg.layoutPag||(qtdPaineis<=6?"U6":"GR"+(qtdPaineis+(qtdPaineis%2)));
  var arvoreAtual=arvoreDoLayout(layoutAtual);
  if(!arvoreAtual||folhasDoLayout(arvoreAtual)<qtdPaineis){
    layoutAtual=qtdPaineis<=6?"U6":"GR"+(qtdPaineis+(qtdPaineis%2));
  }
  var layoutsEditor=Object.keys(LAYOUTS_PAG).filter(function(chave){
    return LAYOUTS_PAG[chave].n>=qtdPaineis;
  }).map(function(chave){ return {id:chave,nome:LAYOUTS_PAG[chave].nome}; });
  if(qtdPaineis>6) layoutsEditor.push({id:layoutAtual,nome:"Grade · "+qtdPaineis+" quadros"});
  alternarLateral(false); aviso("Montando a página…");
  /* A base é a página já diagramada. Ela aparece bloqueada; todo traço novo entra nas camadas acima. */
  compPagina(pg,1143,true).then(function(base){
    if(pedidoAbertura!==pedidoEditorPagina||doc!==documentoAbertura||pgAtual!==ip||doc.paginas[ip]!==pg) return;
    window.EditorDesenho.abrir({
      painel:painelInteiroDaPagina(pg),
      titulo:"Capítulo "+(doc.numero||1)+" · Página "+(ip+1)+" · sobreposição",
      arquivo:(nomeObra()+" cap "+(doc.numero||1)+" pagina "+(ip+1)).replace(/[^\wÀ-ÿ \-]/g,"").trim(),
      rotuloVoltar:"← Roteiro",
      ariaVoltar:"Fechar o editor da página e voltar ao roteiro",
      fundoPagina:base,
      modoPagina:true,
      paginas:doc.paginas.map(function(p,i){ return {nome:"Página "+(i+1),ativa:i===ip,nPaineis:(p.paineis||[]).length}; }),
      layoutAtual:layoutAtual,
      layouts:layoutsEditor,
      obterPaginas:function(){
        return doc.paginas.map(function(p,i){ return {nome:"Página "+(i+1),ativa:i===ip,nPaineis:(p.paineis||[]).length}; });
      },
      obterMiniaturaPagina:function(indice){
        var alvo=doc&&doc.paginas[indice];
        return alvo?compPagina(alvo,260,false):null;
      },
      obterPaineisPagina:function(){
        return (pg.paineis||[]).map(function(p,i){ return {id:p.id,nome:"Painel "+(i+1)}; });
      },
      abrirPainel:function(id){
        if((pg.paineis||[]).some(function(p){ return p.id===id; })) abrirEditorDesenho(id);
      },
      obterLayoutAtual:function(){ return pg.layoutPag||layoutAtual; },
      obterLayouts:function(){
        var n=(pg.paineis||[]).length, atual=pg.layoutPag||(n<=6?"U6":"GR"+(n+(n%2)));
        var itens=Object.keys(LAYOUTS_PAG).filter(function(chave){ return LAYOUTS_PAG[chave].n>=n; }).map(function(chave){
          return {id:chave,nome:LAYOUTS_PAG[chave].nome};
        });
        if(n>6&&itens.filter(function(item){ return item.id===atual; }).length===0){
          itens.push({id:atual,nome:"Grade · "+n+" quadros"});
        }
        return itens;
      },
      escolherQuantidade:function(ancora,tipo,receber){
        if(tipo==="painel"){
          abrirEscolhaQtd(ancora,function(n,duplicarId){ receber({quantidade:n,duplicarId:duplicarId||""}); },{duplicaveis:listaDuplicaveis(20)});
        }else if(tipo==="nova"){
          abrirEscolhaQtd(ancora,function(n){ receber({quantidade:n}); });
        }
      },
      refazerFundoPagina:function(){ return compPagina(pg,1143,true); },
      editarPagina:function(tipo,valor){
        if(!doc||doc.paginas[ip]!==pg)return false;
        var cfg={paginaId:pg.id,manterUm:true,manterUma:true},lista=pg.paineis||[];
        if(tipo==="painel"){
          cfg.quantidade=valor&&valor.quantidade;cfg.duplicarId=valor&&valor.duplicarId;
          var destino=valor&&parseInt(valor.paginaDestino,10);if(destino>=0&&destino<doc.paginas.length)cfg.destinoId=doc.paginas[destino].id;
        }else if(tipo==="painel-apagar"||tipo==="painel-duplicar"){
          var indice=valor&&parseInt(valor.indice,10);
          if(tipo==="painel-apagar"&&!(indice>=0&&indice<lista.length))indice=lista.length-1;
          if(!(indice>=0&&indice<lista.length))return false;cfg.painelId=lista[indice].id;
        }else if(tipo==="nova")cfg.quantidade=valor&&valor.quantidade;
        else if(tipo==="layout")cfg.layout=valor;
        return executarEstruturaCapitulo(tipo,cfg,true);
      },
      irPagina:function(n){ abrirEditorCapitulo(n); },
      aoFalharEstrutura:function(){informarFalhaEstrutural({editorPendente:true},true);},
      aviso:aviso,
      falas:function(){ return []; },
      aoMudar:function(){ marcarSujo(); },
      aoFechar:function(){ var st=tela.scrollTop; desenhar(); tela.scrollTop=st; }
    });
  }).catch(function(err){
    if(pedidoAbertura!==pedidoEditorPagina||doc!==documentoAbertura)return;
    console.error("montar página:",err);
    aviso("Não foi possível abrir esta página no editor.");
  });
}
/* ========== modo de leitura: a história inteira, sem ferramentas ========== */
function limitarZoomLeitura(valor){var n=Number(valor);return Math.max(50,Math.min(250,isFinite(n)?n:100));}
function larguraBaseLeitura(){
  var largura=tela.clientWidth||window.innerWidth||800,altura=tela.clientHeight||window.innerHeight||700;
  return Math.round(Math.max(160,Math.min(560,(Math.max(240,altura-170))*5/7,(largura-24)*.92)));
}
function atualizarZoomLeitura(valor,recalcular){
  var raiz=tela.querySelector(".leitura");if(!modoLeitura||!raiz)return;
  var lista=Array.prototype.slice.call(raiz.querySelectorAll(".leitura-pagina")),area=tela.getBoundingClientRect(),cy=area.top+tela.clientHeight/2,cx=area.left+tela.clientWidth/2,ancora=null,dist=Infinity;
  lista.forEach(function(p){var r=p.getBoundingClientRect(),d=cy<r.top?r.top-cy:cy>r.bottom?cy-r.bottom:0;if(d<dist){dist=d;ancora={el:p,fx:Math.max(0,Math.min(1,(cx-r.left)/Math.max(1,r.width))),fy:Math.max(0,Math.min(1,(cy-r.top)/Math.max(1,r.height)))};}});
  LEITURA.zoom=limitarZoomLeitura(valor);if(recalcular)LEITURA.base=larguraBaseLeitura();
  raiz.style.setProperty("--leitura-largura",Math.round(LEITURA.base*LEITURA.zoom/100)+"px");
  var controle=raiz.querySelector("[data-leitura-zoom]"),saida=raiz.querySelector("[data-leitura-zoom-valor]");if(controle)controle.value=LEITURA.zoom;if(saida)saida.textContent=Math.round(LEITURA.zoom)+"%";
  if(ancora){var novo=ancora.el.getBoundingClientRect();tela.scrollTop+=novo.top+novo.height*ancora.fy-cy;tela.scrollLeft+=novo.left+novo.width*ancora.fx-cx;}
}
function esperarPintura(){
  return new Promise(function(resolver){ requestAnimationFrame(function(){ requestAnimationFrame(resolver); }); });
}
function fecharLeituraCapitulo(){
  if(!modoLeitura) return;
  modoLeitura=false;
  document.body.classList.remove("em-leitura");
  desenharLateral(); desenhar();
  tela.scrollTop=0;
}
async function abrirLeituraCapitulo(){
  if(!doc||modoLeitura) return;
  return executarAcaoTexto(abrirLeituraSalva);
}
async function abrirLeituraSalva(){
  if(!doc||!doc.paginas||!doc.paginas.length) return;
  var paginas=doc.paginas.slice(), titulo=doc.titulo||("Capítulo "+(doc.numero||1)), token=id("leitura");
  modoLeitura=true;
  document.body.classList.add("em-leitura");
  tela.classList.remove("modo-pag","modo-notas");
  tela.innerHTML='<section class="leitura" data-leitura="'+token+'">'+
    '<header class="leitura-cabeca"><button type="button" class="bt mini" data-acao="fechar-leitura">← Voltar</button><h2 id="leituraTitulo"></h2><span class="info">Esc para voltar</span><div class="leitura-zoom" role="group" aria-label="Zoom da leitura"><button type="button" class="bt mini" data-acao="leitura-menos" aria-label="Diminuir zoom da leitura">−</button><input type="range" min="50" max="250" step="10" value="100" data-leitura-zoom aria-label="Zoom da leitura"><output data-leitura-zoom-valor aria-live="polite">100%</output><button type="button" class="bt mini" data-acao="leitura-mais" aria-label="Aumentar zoom da leitura">+</button><button type="button" class="bt mini" data-acao="leitura-ajustar" title="Ajustar a página à área de leitura">Ajustar</button></div></header>'+
    '<div class="leitura-lista">'+paginas.map(function(_pg,i){return '<figure class="leitura-pagina"><figcaption>Página '+(i+1)+' de '+paginas.length+'</figcaption><div class="leitura-carregando" data-leitura-pagina="'+i+'">Preparando a página…</div></figure>';}).join("")+
    '</div></section>';
  el("leituraTitulo").textContent=titulo;
  LEITURA.base=larguraBaseLeitura();atualizarZoomLeitura(100);tela.scrollTop=0;tela.scrollLeft=0;
  var largura=Math.max(720,Math.min(1600,Math.round(Math.max(tela.clientWidth,window.innerWidth)*1.35)));
  for(var i=0;i<paginas.length;i++){
    if(!modoLeitura||!tela.querySelector('[data-leitura="'+token+'"]')) return;
    await esperarPintura();
    var espaco=tela.querySelector('[data-leitura-pagina="'+i+'"]');
    try{
      var imagem=await compPagina(paginas[i],largura,false);
      if(!modoLeitura||!espaco||!espaco.isConnected) return;
      var figura=document.createElement("img");
      figura.src=imagem.toDataURL("image/jpeg",0.92);
      figura.alt="Página "+(i+1)+" de "+titulo;
      espaco.replaceChildren(figura);
    }catch(e){
      if(espaco&&espaco.isConnected) espaco.textContent="Não foi possível preparar esta página.";
    }
  }
}
tela.addEventListener("input",function(ev){if(ev.target.matches("[data-leitura-zoom]"))atualizarZoomLeitura(ev.target.value);});
window.addEventListener("resize",function(){if(modoLeitura)atualizarZoomLeitura(LEITURA.zoom,true);});

/* ========== desenho livre, independente de obras e capítulos ========== */
async function abrirDesenhoLivre(registro){
  return executarAcaoTexto(function(){return abrirDesenhoLivreSalvo(registro);});
}
function abrirDesenhoLivreSalvo(registro){
  garantirDesenhosLivresLidos();
  if(!window.EditorDesenho) return;
  if(!registro||!registro.id){
    var nome=window.prompt("Nome do desenho livre:","Meu desenho");
    if(nome===null) return;
    nome=nome.trim(); if(!nome){ aviso("O nome do desenho não pode ficar vazio."); return; }
    /* Mantém o identificador antigo na primeira abertura para não perder um desenho
       criado em versões anteriores; os próximos recebem uma chave própria. */
    registro={id:desenhosLivres.length? id("livre"):"mesa-desenho-livre-principal",titulo:nome,criadoEm:Date.now()};
    registro=registrarDesenhoLivre(registro.id,registro.titulo,registro.criadoEm);if(!registro)return false;
  }else{registro=registrarDesenhoLivre(registro.id,registro.titulo,registro.criadoEm);if(!registro)return false;}
  alternarLateral(false);
  window.EditorDesenho.abrir({
    painel:{id:registro.id,tamanho:"pagina",borda:0},
    titulo:registro.titulo,
    arquivo:((registro.titulo||"desenho-livre").replace(/[^\wÀ-ÿ \-]/g,"").trim()||"desenho-livre"),
    modoLivre:true,
    rotuloVoltar:"← Entrada",
    ariaVoltar:"Fechar desenho livre e voltar à entrada",
    aviso:aviso,
    falas:function(){return [];},
    aoMudar:function(){ registrarDesenhoLivre(registro.id,registro.titulo,registro.criadoEm); },
    aoFechar:function(){ registrarDesenhoLivre(registro.id,registro.titulo,registro.criadoEm); voltarEntrada(); }
  });
}


/* ========== layout visual: frames de mangá para redimensionar e desenhar ========== */
/* Cada página pode ter um layout visual (pg.visual), salvo junto com o capítulo:
   pg.visual = { ativo:"A", dados:{ A:{ r:[razões das divisões], s:{ idxQuadro:[traços] } } } }
   Os desenhos de cada layout ficam guardados separadamente (trocar de layout não apaga nada). */
var vF=function(){return {leaf:true};};
var vS=function(dir,ratio,a,b){return {dir:dir,ratio:ratio,a:a,b:b};};
/* dir "v" = divide lado a lado; dir "h" = divide em cima/embaixo. Para criar outro layout, copie uma linha. */
var LAYOUTS_VISUAIS={
  A:{nome:"A · 6 quadros",build:function(){
    return vS("h",0.54,
      vS("v",0.6,vS("h",0.5,vF(),vF()),vF()),
      vS("v",0.4,vF(),vS("h",0.5,vF(),vF())));}},
  B:{nome:"B · 6 quadros",build:function(){
    return vS("h",0.55,
      vS("h",0.5,vS("v",0.27,vF(),vF()),vS("v",0.7,vF(),vF())),
      vS("v",0.3,vF(),vF()));}},
  C:{nome:"C · 3 tiras",build:function(){return vS("h",0.34,vF(),vS("h",0.5,vF(),vF()));}},
  D:{nome:"D · grade 2×2",build:function(){return vS("h",0.5,vS("v",0.5,vF(),vF()),vS("v",0.5,vF(),vF()));}},
  E:{nome:"E · 1 grande + 2",build:function(){return vS("h",0.6,vF(),vS("v",0.5,vF(),vF()));}},
  F:{nome:"F · Splash page (página inteira)",build:function(){return vF();}}
};
var LAYOUT_PADRAO="A";

function vDpr(){ return window.devicePixelRatio||1; }

function vDesenharTraco(ctx,s,cw,ch,esc){
  var pts=s.p, i; if(!pts||!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation=s.t==="e"?"destination-out":"source-over";
  ctx.strokeStyle=s.c; ctx.fillStyle=s.c;
  ctx.lineWidth=s.w*(esc||vDpr());
  ctx.lineCap="round"; ctx.lineJoin="round";
  if(pts.length===1){
    ctx.beginPath(); ctx.arc(pts[0][0]*cw,pts[0][1]*ch,ctx.lineWidth/2,0,Math.PI*2); ctx.fill();
  }else{
    ctx.beginPath(); ctx.moveTo(pts[0][0]*cw,pts[0][1]*ch);
    for(i=1;i<pts.length;i++) ctx.lineTo(pts[i][0]*cw,pts[i][1]*ch);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------- exportação: página composta e PDF do capítulo ---------- */
function novoCanvas(w,h){ var c=document.createElement("canvas"); c.width=w; c.height=h; return c; }
var PAG_REF=460;     /* largura de referência da página na tela (px), usada para escalar bordas e traços */

/* retângulos dos quadros da página (frações 0–1), na mesma ordem usada na tela */
function retsPagina(pg){
  var v=pg.visual||{}, key=LAYOUTS_VISUAIS[v.ativo]?v.ativo:LAYOUT_PADRAO;
  var dados=(v.dados&&v.dados[key])||{r:[],s:{}};
  var tree=LAYOUTS_VISUAIS[key].build(), splits=[], leaves=[];
  (function varrer(n){
    if(n.leaf){ n.idx=leaves.length; leaves.push(n); }
    else{ splits.push(n); varrer(n.a); varrer(n.b); }
  })(tree);
  if(dados.r&&dados.r.length===splits.length) splits.forEach(function(sp,i){ sp.ratio=dados.r[i]; });
  (function pos(n,x,y,w,h){
    n.rect={x:x,y:y,w:w,h:h};
    if(n.leaf) return;
    if(n.dir==="v"){ var w1=w*n.ratio; pos(n.a,x,y,w1,h); pos(n.b,x+w1,y,w-w1,h); }
    else{ var h1=h*n.ratio; pos(n.a,x,y,w,h1); pos(n.b,x,y+h1,w,h-h1); }
  })(tree,0,0,1,1);
  return {leaves:leaves,tracos:dados.s||{},sobre:dados.o||[]};
}

/* página inteira, igual ao que aparece na tela: o layout escolhido da página, cada painel preenchendo o
   seu quadro (recortado na forma, se tiver) com desenho e balões. Painel sem desenho mostra o rabisco do layout visual. */
async function compPagina(pg,W,semSobre){
  /* A fonte pode estar indisponível em um HTML local; não bloqueie a página esperando por ela. */
  try{ if(document.fonts&&document.fonts.load) document.fonts.load('700 24px "Comic Neue"').catch(function(){}); }catch(e){}
  var H=Math.round(W*7/5), k=W/PAG_REF, ins=4*k;
  var out=novoCanvas(W,H), cx=out.getContext("2d");
  cx.fillStyle="#fff"; cx.fillRect(0,0,W,H);
  var referencia=retsPagina(pg), lst=pg.paineis||[], cels=celulasPagina(pg,lst.length), tracos=referencia.tracos, sobre=referencia.sobre, i, c, pn;
  var itens=[];
  for(i=0;i<lst.length&&i<cels.length;i++) itens.push({cel:cels[i],painel:lst[i],ord:i});
  /* a mesma pilha escolhida no editor é preservada no arquivo exportado */
  itens.sort(function(a,b){ return (a.cel.z||a.ord+1)-(b.cel.z||b.ord+1); });
  for(i=0;i<itens.length;i++){
    c=itens[i].cel; pn=itens[i].painel;
    var fx=c.x/100*W+ins, fy=c.y/100*H+ins, fw=c.w/100*W-2*ins, fh=c.h/100*H-2*ins;
    if(fw<4||fh<4) continue;
    var fm=formaPainel(pn), bw=(typeof pn.borda==="number"&&pn.borda<=0)?0:2*k;
    var img=pn.temDesenho?await window.EditorDesenho.compor(pn.id,pn,1600,false):null;
    if(pn.temDesenho&&!img)throw new Error("Um desenho da página não pôde ser lido. A composição foi interrompida.");
    cx.save(); trilhaQuadro(cx,fm,fx,fy,fw,fh); cx.clip();
    /* painel flutuante preserva transparência para revelar os quadros abaixo */
    if(!pn.sobreposto){ cx.fillStyle="#fff"; cx.fillRect(fx,fy,fw,fh); }
    if(img){
      var sc=Math.max(fw/img.width,fh/img.height), dw=img.width*sc, dh=img.height*sc;
      cx.imageSmoothingQuality="high";
      cx.drawImage(img,fx+(fw-dw)/2,fy+(fh-dh)/2,dw,dh);
    }else{
      var lt=tracos[itens[i].ord];
      if(lt&&lt.length){
        var rb=novoCanvas(Math.max(1,Math.round(fw)),Math.max(1,Math.round(fh))), rc=rb.getContext("2d");
        lt.forEach(function(t){ vDesenharTraco(rc,t,rb.width,rb.height,k); });
        cx.drawImage(rb,fx,fy,fw,fh);
      }
    }
    cx.restore();
    if(bw>0){
      cx.save(); trilhaQuadro(cx,fm,fx,fy,fw,fh); cx.clip();
      trilhaQuadro(cx,fm,fx,fy,fw,fh);
      cx.strokeStyle="#111"; cx.lineWidth=bw*2; cx.lineJoin="miter"; cx.miterLimit=10; cx.stroke();
      cx.restore();
    }
  }
  /* traços de sobreposição já existentes ficam acima dos quadros e bordas */
  if(!semSobre&&sobre&&sobre.length) sobre.forEach(function(t){ vDesenharTraco(cx,t,W,H,k); });
  /* As camadas do editor de página formam a sobreposição final, sem alterar painel algum. */
  if(!semSobre){
    var artePagina=await window.EditorDesenho.compor(idArtePagina(pg),painelInteiroDaPagina(pg),1600,false);
    if(artePagina) cx.drawImage(artePagina,0,0,W,H);
  }
  return out;
}

function baixarArquivo(blob,nome){
  var a=document.createElement("a"), u=URL.createObjectURL(blob);
  a.href=u; a.download=nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(u); },2000);
}
function nomeSeguro(t){ return String(t).replace(/[^\wÀ-ÿ \-]/g,"").trim()||"roteiro"; }
function canvasBlob(cv,tipo,q){
  return new Promise(function(res){ cv.toBlob(res,tipo,q); });
}

/* PDF mínimo: uma imagem JPEG por folha (sem bibliotecas externas) */
function montarPDF(imgs,pw,ph){
  var enc=new TextEncoder(), partes=[], pos=0, offs=[], n=imgs.length, i;
  function put(x){ var b=typeof x==="string"?enc.encode(x):x; partes.push(b); pos+=b.length; }
  function obj(num,corpo){ offs[num]=pos; put(num+" 0 obj\n"); corpo(); put("\nendobj\n"); }
  put("%PDF-1.4\n");
  obj(1,function(){ put("<< /Type /Catalog /Pages 2 0 R >>"); });
  var kids=[]; for(i=0;i<n;i++) kids.push((3+3*i)+" 0 R");
  obj(2,function(){ put("<< /Type /Pages /Kids ["+kids.join(" ")+"] /Count "+n+" >>"); });
  imgs.forEach(function(im,j){
    var pg=3+3*j, ct=4+3*j, ig=5+3*j, cont="q "+pw+" 0 0 "+ph+" 0 0 cm /Im0 Do Q";
    obj(pg,function(){ put("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pw+" "+ph+"] /Resources << /XObject << /Im0 "+ig+" 0 R >> >> /Contents "+ct+" 0 R >>"); });
    obj(ct,function(){ put("<< /Length "+cont.length+" >>\nstream\n"+cont+"\nendstream"); });
    obj(ig,function(){
      put("<< /Type /XObject /Subtype /Image /Width "+im.w+" /Height "+im.h+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+im.bytes.length+" >>\nstream\n");
      put(im.bytes); put("\nendstream");
    });
  });
  var total=3+3*n, xr=pos;
  put("xref\n0 "+total+"\n0000000000 65535 f \n");
  for(i=1;i<total;i++) put(("0000000000"+offs[i]).slice(-10)+" 00000 n \n");
  put("trailer\n<< /Size "+total+" /Root 1 0 R >>\nstartxref\n"+xr+"\n%%EOF\n");
  return new Blob(partes,{type:"application/pdf"});
}

async function exportarCapituloPDF(btn){
  if(!doc||!doc.paginas.length){ aviso("Este capítulo ainda não tem páginas."); return; }
  var rot=btn.textContent, W=1500, imgs=[], i;
  btn.disabled=true;
  try{
    for(i=0;i<doc.paginas.length;i++){
      btn.textContent="Gerando página "+(i+1)+" de "+doc.paginas.length+"…";
      var cv=await compPagina(doc.paginas[i],W), bl=await canvasBlob(cv,"image/jpeg",0.92);
      imgs.push({bytes:new Uint8Array(await bl.arrayBuffer()),w:cv.width,h:cv.height});
    }
    baixarArquivo(montarPDF(imgs,360,504),nomeSeguro(nomeObra()+" cap "+(doc.numero||1))+".pdf");
    aviso("PDF gerado ("+imgs.length+(imgs.length===1?" página":" páginas")+").");
  }catch(e){
    console.error("exportar PDF:",e); aviso("Não foi possível gerar o PDF.");
  }
  btn.textContent=rot; btn.disabled=false;
}

/* ========== eventos ========== */
el("novaObra").onclick=abrirFormObra;
el("abrirDesenhoLivre").onclick=abrirDesenhoLivre;
el("voltarEntrada").onclick=voltarEntrada;
el("abrirNotas").onclick=abrirNotas;
el("novaNota").onclick=criarNota;
document.addEventListener("click",function(ev){var tag=ev.target.closest&&ev.target.closest("[data-nota-tag]");if(tag&&!tag.disabled){ev.preventDefault();ativarEtiquetaNota(tag.getAttribute("data-nota-tag"),tag.getAttribute("data-nota-tag-id"));}});
document.addEventListener("keydown",function(ev){if(ev.key!=="Enter"||ev.isComposing||ev.keyCode===229||!ev.target.matches||!ev.target.matches('#notaTags'))return;ev.preventDefault();confirmarEtiquetaNota();});
el("cancelarObra").onclick=fecharFormObra;
el("formObra").addEventListener("submit",function(ev){
  ev.preventDefault();
  var t=el("campoObra").value;
  fecharFormObra();
  criarObra(t);
});
el("novoCap").onclick=criarCapitulo;
function alternarLateral(abrir){
  var lat=el("lateral"), fundo=el("fundoLateral");
  var mostrar = abrir!==undefined ? abrir : !lat.classList.contains("aberta");
  lat.classList.toggle("aberta",mostrar);
  fundo.classList.toggle("aberta",mostrar);
}
el("btMenu").onclick=function(){ alternarLateral(); };
el("fundoLateral").onclick=function(){ alternarLateral(false); };

el("formPersonagem").addEventListener("submit",function(ev){
  ev.preventDefault();
  var v=el("campoPersonagem").value;
  el("campoPersonagem").value="";
  adicionarPersonagem(v);
});

el("tituloCap").addEventListener("input",function(){
  if(!doc) return; doc.titulo=this.value; marcarSujo();
});

document.querySelector(".rolagem").addEventListener("click",function(ev){
  var apagarNotaBt=ev.target.closest('[data-nota-acao="apagar"]');
  if(apagarNotaBt){
    ev.preventDefault(); ev.stopPropagation();
    confirmarClique(apagarNotaBt,"CONFIRMAR",function(){ apagarNota(apagarNotaBt.getAttribute("data-nota-id")); });
    return;
  }
  var notaBt=ev.target.closest("[data-nota]");
  if(notaBt){ abrirNota(notaBt.getAttribute("data-nota")); return; }
  var renameObra=ev.target.closest('[data-acao="rename-obra"]');
  if(renameObra){
    ev.preventDefault();
    ev.stopPropagation();
    renomearObra(renameObra.getAttribute("data-obra-id"));
    return;
  }
  var delObra=ev.target.closest('[data-acao="del-obra"]');
  if(delObra){
    ev.preventDefault();
    ev.stopPropagation();
    confirmarClique(delObra,"CONFIRMAR",function(){ apagarObra(delObra.getAttribute("data-obra-id")); });
    return;
  }
  var delP=ev.target.closest('[data-acao="del-personagem"]');
  if(delP){
    confirmarClique(delP,"remover?",function(){ removerPersonagem(delP.getAttribute("data-nome")); });
    return;
  }
  var b=ev.target.closest("[data-obra],[data-cap]");
  if(!b) return;
  if(b.hasAttribute("data-obra")){
    abrirObra(b.getAttribute("data-obra"));
  }else{
    abrirCapitulo(b.getAttribute("data-cap"));
  }
});

function aoClicarTela(ev){
  var b=ev.target.closest("[data-acao]"); if(!b||!doc) return;
  var acao=b.getAttribute("data-acao");


  if(acao==="fechar-leitura"){ fecharLeituraCapitulo(); return; }
  if(acao==="leitura-menos"){atualizarZoomLeitura(LEITURA.zoom-10);return;}
  if(acao==="leitura-mais"){atualizarZoomLeitura(LEITURA.zoom+10);return;}
  if(acao==="leitura-ajustar"){atualizarZoomLeitura(100,true);return;}
  if(acao==="abrir-leitura"){ abrirLeituraCapitulo(); return; }
  if(acao==="pagina-anterior"){ moverPaginaPronta(-1); return; }
  if(acao==="pagina-proxima"){ moverPaginaPronta(1); return; }
  if(acao==="abrir-editor-capitulo"){
    abrirEditorCapitulo(pgAtual); return;
  }
  if(acao==="add-pagina"){
    abrirEscolhaQtd(b,function(n){
      doc.paginas.push(novaPagina(n));
      marcarSujo(); desenhar();
    });
    return;
  }
  if(acao==="add-painel"){
    var pgId=b.getAttribute("data-pg");
    abrirEscolhaQtd(b,function(n,dupId){
      var k=acharPagina(pgId), i;
      if(k<0) return;
      if(dupId){
        executarEstruturaCapitulo("painel",{paginaId:pgId,duplicarId:dupId});return;
      }else{
        for(i=0;i<n;i++) doc.paginas[k].paineis.push(novoPainel());
      }
      marcarSujo(); desenhar();
    },{duplicaveis:listaDuplicaveis(20)});
    return;
  }
  if(acao==="duplicar-pagina"){
    var jd=acharPagina(b.getAttribute("data-pg"));
    if(jd>-1)executarEstruturaCapitulo("duplicar",{paginaId:doc.paginas[jd].id});
    return;
  }
  if(acao==="desenhar-painel"){
    var artD=b.closest(".painel");
    if(artD){ selPainel=artD.getAttribute("data-pn"); mostrarInfo(); abrirEditorDesenho(selPainel); }
    return;
  }
  if(acao==="add-um"){
    var kp=acharPagina(b.getAttribute("data-pg"));
    if(kp>-1){ var novo1=novoPainel(); doc.paginas[kp].paineis.push(novo1); selPainel=novo1.id; marcarSujo(); desenhar(); }
    return;
  }
  if(acao==="sel-painel"){
    var artS=b.closest(".painel");
    if(artS){ selPainel=artS.getAttribute("data-pn"); mostrarInfo(true); }
    return;
  }
  if(acao==="alt-info"){
    var locI=acharPainel(b);
    if(locI){
      var rec=!locI.painel.recolhido;
      if(rec) locI.painel.recolhido=true; else delete locI.painel.recolhido;
      var artI=b.closest(".painel");
      artI.classList.toggle("recolhido",rec);
      b.setAttribute("aria-expanded",rec?"false":"true");
      b.textContent=rec?"Mostrar informações":"Ocultar informações";
      marcarSujo();
    }
    return;
  }
  if(acao==="del-pagina"){
    var j=acharPagina(b.getAttribute("data-pg"));
    if(j>-1) confirmarClique(b,"Clique p/ confirmar",function(){
      executarEstruturaCapitulo("apagar",{paginaId:b.getAttribute("data-pg")});
    });
    return;
  }

  var loc=acharPainel(b); if(!loc) return;
  var lst=loc.pagina.paineis;
  if(acao==="toggle-sobreposto"){
    if(loc.painel.sobreposto) delete loc.painel.sobreposto;
    else{ loc.painel.sobreposto=true; loc.painel.borda=0; }
    var pilha=garantirComposicaoLivre(loc.pagina), pos=pilha[loc.painel.id], maior=0;
    Object.keys(pilha).forEach(function(chave){ maior=Math.max(maior,+pilha[chave].z||0); });
    pos.z=maior+1;
    marcarSujo(); desenhar(); return;
  }
  if(acao==="toggle-borda"){
    if(typeof loc.painel.borda==="number"&&loc.painel.borda<=0) delete loc.painel.borda;
    else loc.painel.borda=0;
    marcarSujo(); desenhar(); return;
  }else if(acao==="forma-painel"){
    aplicarFormaRapida(loc.painel,b.getAttribute("data-forma"));
    marcarSujo(); desenhar(); return;
  }
  if(acao==="subir" && loc.ipn>0){
    lst.splice(loc.ipn-1,0,lst.splice(loc.ipn,1)[0]); marcarSujo(); desenhar();
  }else if(acao==="descer" && loc.ipn<lst.length-1){
    lst.splice(loc.ipn+1,0,lst.splice(loc.ipn,1)[0]); marcarSujo(); desenhar();
  }else if(acao==="duplicar-painel"){
    executarEstruturaCapitulo("painel-duplicar",{paginaId:loc.pagina.id,painelId:loc.painel.id});
  }else if(acao==="del-painel"){
    confirmarClique(b,"✕ confirmar",function(){
      executarEstruturaCapitulo("painel-apagar",{paginaId:loc.pagina.id,painelId:loc.painel.id});
    });
  }else if(acao==="toggle-personagem"){
    var nome=b.getAttribute("data-nome");
    loc.painel.personagens=loc.painel.personagens||[];
    var idxp=loc.painel.personagens.indexOf(nome);
    if(idxp>-1) loc.painel.personagens.splice(idxp,1); else loc.painel.personagens.push(nome);
    b.classList.toggle("ativo");
    marcarSujo();
    atualizarFraseResumo(loc);
  }else if(acao==="add-fala"){
    loc.painel.falas=loc.painel.falas||[];
    loc.painel.falas.push({quem:"",tipo:"fala",texto:""});
    marcarSujo(); desenhar();
    var art=painelNoDOM(el("infoPainel"),loc.painel.id);
    var ta=art&&art.querySelectorAll('.fala textarea');
    if(ta&&ta.length) ta[ta.length-1].focus();
  }else if(acao==="del-fala"){
    var lf=ev.target.closest(".fala");
    var indiceFala=parseInt(lf.getAttribute("data-fala"),10);
    if(loc.painel.falas.length===1) loc.painel.falas[0]={quem:"",tipo:"fala",texto:""};
    else loc.painel.falas.splice(indiceFala,1);
    marcarSujo(); desenhar();
  }
}
tela.addEventListener("click",aoClicarTela);

/* arrastar pelo botão “mover” reposiciona só o quadro escolhido, sem deslocar a folha */
function iniciarMoverPainel(ev){
  var alca=ev.target.closest("[data-mover-painel]");
  if(!alca||!doc||(typeof ev.button==="number"&&ev.button!==0)) return;
  var loc=acharPainel(alca), papel=el("papel");
  if(!loc||!papel) return;
  ev.preventDefault(); ev.stopPropagation();
  var mapa=garantirComposicaoLivre(loc.pagina), pos=mapa[loc.painel.id], r=papel.getBoundingClientRect();
  var inicioX=ev.clientX, inicioY=ev.clientY, origemX=pos.x, origemY=pos.y, maior=0;
  Object.keys(mapa).forEach(function(chave){ maior=Math.max(maior,+mapa[chave].z||0); });
  pos.z=maior+1;
  var cel=alca.closest(".cel");
  if(cel) cel.style.zIndex=pos.z;
  if(alca.setPointerCapture) alca.setPointerCapture(ev.pointerId);
  function mover(e){
    pos.x=limitarNumero(origemX+(e.clientX-inicioX)/r.width*100,1,99-pos.w);
    pos.y=limitarNumero(origemY+(e.clientY-inicioY)/r.height*100,1,99-pos.h);
    if(cel){ cel.style.left=pos.x+"%"; cel.style.top=pos.y+"%"; }
  }
  function fim(){
    alca.removeEventListener("pointermove",mover);
    alca.removeEventListener("pointerup",fim);
    alca.removeEventListener("pointercancel",fim);
    if(alca.hasPointerCapture&&alca.hasPointerCapture(ev.pointerId)) alca.releasePointerCapture(ev.pointerId);
    marcarSujo();
  }
  alca.addEventListener("pointermove",mover);
  alca.addEventListener("pointerup",fim);
  alca.addEventListener("pointercancel",fim);
}
tela.addEventListener("pointerdown",iniciarMoverPainel);

function abrirImagemNotaTela(src,alt){
  var box=el("notaImagemLightbox"), im=el("notaImagemLightboxImg");
  if(!box||!im||!src) return;
  im.src=src; im.alt=alt||"Imagem da nota"; box.classList.remove("oculto"); document.body.classList.add("nota-lightbox-aberta");
  requestAnimationFrame(function(){ var fechar=el("fecharNotaImagemLightbox"); if(fechar) fechar.focus(); });
}
function fecharImagemNotaTela(){
  var box=el("notaImagemLightbox"), im=el("notaImagemLightboxImg");
  if(!box) return;
  box.classList.add("oculto"); document.body.classList.remove("nota-lightbox-aberta");
  if(im) im.removeAttribute("src");
}
if(el("fecharNotaImagemLightbox")) el("fecharNotaImagemLightbox").addEventListener("click",fecharImagemNotaTela);
if(el("notaImagemLightbox")) el("notaImagemLightbox").addEventListener("click",function(ev){ if(ev.target===this) fecharImagemNotaTela(); });
document.addEventListener("keydown",function(ev){ if(ev.key==="Escape") fecharImagemNotaTela(); });

function aoClicarNotas(ev){
  var imagem=ev.target.closest(".nota-imagem-item img");
  if(imagem){ abrirImagemNotaTela(imagem.src,imagem.alt); return; }
  var interna=ev.target.closest("[data-nota-interna]");
  if(interna){ abrirNota(interna.getAttribute("data-nota-interna")); return; }
  var b=ev.target.closest("[data-nota-acao]"); if(!b) return;
  var acao=b.getAttribute("data-nota-acao");
  if(acao==="entrada"){ voltarEntrada(); return; }
  if(acao==="nova"){ criarNota(); return; }
  if(acao==="nova-imagens"){ criarNota({titulo:"Imagens",tipo:"imagens"}); return; }
  if(acao==="buscar-etiqueta"){confirmarEtiquetaNota();return;}
  if(acao==="limpar-grifos"){limparMarcaNota(false);return;}
  if(acao==="editar-texto"){limparMarcaNota(true);return;}
  if(acao==="marca-anterior"){navegarMarcaNota(-1);return;}
  if(acao==="marca-proxima"){navegarMarcaNota(1);return;}
  if(acao==="anexar-imagens"){ var inp=el("notaImagens"); if(inp) inp.click(); return; }
  if(acao==="remover-imagem"){ removerImagemNota(b.getAttribute("data-nota-img-id")); return; }
  if(acao==="apagar"){
    confirmarClique(b,"CONFIRMAR",function(){ apagarNota(b.getAttribute("data-nota-id")); });
  }
}
function aoEditarNotas(ev){
  if(!modoNotas) return;
  var campo=ev.target.getAttribute("data-nota-campo"); if(!campo) return;
  var n=notaObj(notaAtual); if(!n) return;
  n[campo]=campo==="tags"?tagsNota(ev.target.value):ev.target.value;
  marcarNotaSuja();
  if(campo==="tags"){if(MARCA_NOTA.notaId===n.id&&!n.tags.some(function(tag){return normalizarBuscaNota(tag)===normalizarBuscaNota(MARCA_NOTA.termo);}))limparMarcaNota(false);desenharNotasLateral();atualizarNavegadorNotas();atualizarChipsEtiquetaNota(n);}
}
tela.addEventListener("click",aoClicarNotas);
tela.addEventListener("input",aoEditarNotas);
tela.addEventListener("change",function(ev){
  if(ev.target&&ev.target.matches("[data-nota-anexos]")){
    /* Faça a cópia antes de resetar o campo: em alguns navegadores móveis,
       ev.target.value="" também esvazia o FileList recebido pela função. */
    var arquivos=Array.prototype.slice.call(ev.target.files||[]);
    ev.target.value="";
    if(arquivos.length) anexarImagensNota(arquivos);
  }
});
function imagensDaTransferencia(dt){
  var lista=[];
  try{ if(dt&&dt.files) lista=Array.prototype.slice.call(dt.files); }catch(e){ lista=[]; }
  if(!lista.length&&dt&&dt.items){
    Array.prototype.forEach.call(dt.items,function(item){ if(item&&item.kind==="file"){ var f=item.getAsFile&&item.getAsFile(); if(f) lista.push(f); } });
  }
  return lista.filter(function(f){ return f&&/^image\//i.test(f.type||""); });
}
tela.addEventListener("dragover",function(ev){
  var zona=ev.target&&ev.target.closest?ev.target.closest("[data-nota-soltar-imagens]"):null;
  if(!zona) return;
  var n=notaObj(notaAtual); if(!modoNotas||!notaSomenteImagens(n)) return;
  ev.preventDefault(); zona.classList.add("arrastando");
});
tela.addEventListener("dragleave",function(ev){
  var zona=ev.target&&ev.target.closest?ev.target.closest("[data-nota-soltar-imagens]"):null;
  if(zona&&!zona.contains(ev.relatedTarget)) zona.classList.remove("arrastando");
});
tela.addEventListener("drop",function(ev){
  var zona=ev.target&&ev.target.closest?ev.target.closest("[data-nota-soltar-imagens]"):null;
  if(!zona) return;
  var n=notaObj(notaAtual); if(!modoNotas||!notaSomenteImagens(n)) return;
  ev.preventDefault(); zona.classList.remove("arrastando");
  var arquivos=imagensDaTransferencia(ev.dataTransfer); if(arquivos.length) anexarImagensNota(arquivos);
});
document.addEventListener("paste",function(ev){
  if(!modoNotas) return;
  var n=notaObj(notaAtual); if(!notaSomenteImagens(n)) return;
  var arquivos=imagensDaTransferencia(ev.clipboardData); if(!arquivos.length) return;
  ev.preventDefault(); anexarImagensNota(arquivos);
});


function aoEditar(ev){
  var t=ev.target; if(!doc) return;
  var loc=acharPainel(t); if(!loc) return;

  var campo=t.getAttribute("data-campo");
  if(campo){
    loc.painel[campo]=t.value;
    if(campo==="tamanho") atualizarTamanhoPainel(loc.painel);
    marcarSujo();
    atualizarFraseResumo(loc);
    return;
  }

  var fc=t.getAttribute("data-fala-campo");
  if(fc){
    var lf=t.closest(".fala"), j=parseInt(lf.getAttribute("data-fala"),10);
    var f=loc.painel.falas[j]; if(!f) return;
    f[fc]=t.value;
    if(fc==="tipo") lf.className="fala balao-"+t.value;
    marcarSujo();
    atualizarPersonagens();
    atualizarFraseResumo(loc);
  }
}
tela.addEventListener("input",aoEditar);
tela.addEventListener("change",aoEditar);
function atualizarAndamentoCapitulo(){
  if(!doc) return;
  var progresso=progressoCapitulo(doc.progresso), saida=tela.querySelector("[data-cap-progresso]"), barra=tela.querySelector(".barra-progresso i");
  if(saida) saida.textContent=progresso+"%";
  if(barra) barra.style.width=progresso+"%";
}
function editarAndamentoCapitulo(ev,atualizarLista){
  var alvo=ev.target.closest("[data-cap-campo]"); if(!alvo||!doc) return false;
  var campo=alvo.getAttribute("data-cap-campo");
  if(campo==="status") doc.status=statusCapitulo(alvo.value);
  else if(campo==="progresso") doc.progresso=progressoCapitulo(alvo.value);
  else return false;
  atualizarAndamentoCapitulo();
  var resumo=caps.filter(function(c){ return c.id===doc.id; })[0];
  if(resumo){ resumo.status=statusCapitulo(doc.status); resumo.progresso=progressoCapitulo(doc.progresso); }
  marcarSujo();
  if(atualizarLista) desenharLateral();
  return true;
}
tela.addEventListener("input",function(ev){ editarAndamentoCapitulo(ev,false); });
tela.addEventListener("change",function(ev){
  if(editarAndamentoCapitulo(ev,true)) return;
  var ir=ev.target.closest("[data-ir-pagina]");
  if(ir&&doc){ irParaPaginaPronta(parseInt(ir.value,10)||0); return; }
});
tela.addEventListener("change",function(ev){
  var sel=ev.target.closest("[data-layout-pag]"); if(!sel||!doc) return;
  var k=acharPagina(sel.getAttribute("data-layout-pag")); if(k<0) return;
  doc.paginas[k].layoutPag=sel.value; marcarSujo(); desenhar();
});

/* ===== lateral: páginas e informações do painel selecionado ===== */
function desenharPaginasLat(){
  var bl=el("blocoPaginas"), lista=el("listaPaginas");
  if(!doc){ bl.classList.add("oculto"); lista.innerHTML=""; return; }
  bl.classList.remove("oculto");
  lista.innerHTML='<p class="lateral-contexto">Do capítulo <b>'+esc(doc.titulo||("#"+(doc.numero||1)))+'</b></p>'+doc.paginas.map(function(pg,k){
    return '<button type="button" class="item" data-irpg="'+k+'"'+(k===pgAtual?' aria-current="true"':'')+'>'+
      '<span class="rotulo">Página '+(k+1)+'</span><span class="contagem">'+(pg.paineis||[]).length+'</span></button>';
  }).join("");
}
function mostrarInfo(abrirDetalhes){
  var bloco=el("blocoInfo"), host=el("infoPainel");
  if(!doc){ bloco.classList.add("oculto"); host.innerHTML=""; return; }
  var pg=doc.paginas[pgAtual], lst=(pg&&pg.paineis)||[];
  var pn=selPainel?acharPainelPorId(selPainel):null, i=lst.indexOf(pn);
  if(i<0){ pn=lst[0]||null; i=pn?0:-1; selPainel=pn?pn.id:null; }
  bloco.classList.remove("oculto");
  var aberto=!!abrirDetalhes||!!host.querySelector('.pagina-painel-detalhes[open]'),layout=pg&&LAYOUTS_PAG[pg.layoutPag];
  el("tituloInfo").textContent="Página "+(pgAtual+1)+" · Informações";
  host.innerHTML='<div class="pagina-info-resumo"><strong>Página '+(pgAtual+1)+' de '+doc.paginas.length+'</strong>'+lst.length+(lst.length===1?' painel':' painéis')+' · '+esc(layout?layout.nome:'Diagramação automática')+'</div>'+(pn?
    '<label class="pagina-painel-escolha">Painel selecionado<select data-pagina-info-painel aria-label="Escolher painel nas informações da página">'+lst.map(function(p,k){return '<option value="'+esc(p.id)+'"'+(p.id===pn.id?' selected':'')+'>Painel '+(k+1)+'</option>';}).join('')+'</select></label><details class="pagina-painel-detalhes"'+(aberto?' open':'')+'><summary>Painel '+(i+1)+' · detalhes e roteiro</summary>'+htmlInfo(pn,i,pgAtual)+'</details>'
    :'<p class="vazio-lateral">Esta página está vazia. Adicione um painel para preencher o roteiro.</p>');
  Array.prototype.forEach.call(tela.querySelectorAll(".quadro"),function(a){
    a.classList.toggle("sel",a.getAttribute("data-pn")===selPainel);
  });
}
/* os quadros se alinham para os lados, da esquerda para a direita; o tamanho se ajusta para tudo caber na tela sem rolar */
function ajustarQuadros(){
  var q=document.getElementById("quadros"), p=document.getElementById("papel"); if(!q||!p||!doc) return;
  var top=q.getBoundingClientRect().top-tela.getBoundingClientRect().top+tela.scrollTop;
  var H=Math.max(260,tela.clientHeight-top-56-(parseFloat(getComputedStyle(tela).paddingBottom)||0));
  var h=Math.min(H,(q.clientWidth-8)*7/5);
  q.style.height=H+"px";
  p.style.height=h+"px"; p.style.width=(h*5/7)+"px";
}
window.addEventListener("resize",ajustarQuadros);
function irParaPaginaPronta(indice){
  if(!doc||!(indice>=0&&indice<doc.paginas.length)||indice===pgAtual) return false;
  pgAtual=indice; selPainel=null;
  desenhar(); tela.scrollTop=0; alternarLateral(false);
  return true;
}
function moverPaginaPronta(passo){
  if(!doc||!doc.paginas.length) return false;
  return irParaPaginaPronta(Math.max(0,Math.min(doc.paginas.length-1,pgAtual+passo)));
}
el("listaPaginas").addEventListener("click",function(ev){
  var b=ev.target.closest("[data-irpg]"); if(!b||!doc) return;
  irParaPaginaPronta(parseInt(b.getAttribute("data-irpg"),10)||0);
});
document.addEventListener("keydown",function(ev){
  if(document.body.classList.contains("ed-aberto")||!doc||!ev.altKey||ev.ctrlKey||ev.metaKey) return;
  var tag=ev.target&&ev.target.tagName;
  if(tag==="TEXTAREA"||tag==="SELECT"||(tag==="INPUT"&&(ev.target.type==="text"||ev.target.type==="number"))) return;
  if(ev.key==="PageUp"||ev.key==="PageDown"){
    ev.preventDefault(); moverPaginaPronta(ev.key==="PageUp"?-1:1);
  }
});
el("novaPag").addEventListener("click",function(ev){
  if(!doc) return;
  abrirEscolhaQtd(ev.currentTarget,function(n){
    doc.paginas.push(novaPagina(n)); pgAtual=doc.paginas.length-1; selPainel=null; marcarSujo(); desenhar();
  });
});
el("infoPainel").addEventListener("click",aoClicarTela);
el("infoPainel").addEventListener("input",aoEditar);
el("infoPainel").addEventListener("change",aoEditar);
el("infoPainel").addEventListener("change",function(ev){
  if(ev.target.matches("[data-pagina-info-painel]")&&doc){selPainel=ev.target.value;mostrarInfo(true);}
});

/* datalist de personagens (junta o elenco cadastrado na obra + nomes já usados nas falas) */
var dl=document.createElement("datalist"); dl.id="personagens"; document.body.appendChild(dl);
function atualizarPersonagens(){
  if(!doc) return;
  var set={};
  var o=obraObjAtual();
  ((o&&o.personagens)||[]).forEach(function(n){ set[n]=1; });
  doc.paginas.forEach(function(pg){(pg.paineis||[]).forEach(function(pn){
    (pn.falas||[]).forEach(function(f){ if(f.quem&&f.quem.trim()) set[f.quem.trim()]=1; });
  });});
  dl.innerHTML=Object.keys(set).map(function(n){return '<option value="'+esc(n)+'">';}).join("");
}

/* ========== exportação ========== */
function nomeObra(){
  var o=obras.filter(function(x){return x.id===(doc&&doc.obraId);})[0];
  return o?(o.titulo||"Sem título"):"Sem título";
}
function fichaPainel(pn){
  var itens=[];
  if(pn.enquadramento) itens.push("Enquadramento: "+pn.enquadramento);
  else if(pn.tipoPainel) itens.push("Enquadramento: "+pn.tipoPainel);
  if(pn.distancia) itens.push("Distância: "+pn.distancia);
  if(pn.plano) itens.push("Plano: "+pn.plano);
  if(pn.angulo) itens.push("Ângulo: "+pn.angulo);
  if(pn.tamanho&&TAMANHOS[pn.tamanho]) itens.push("Tamanho: "+nomeTamanho(pn.tamanho));
  if(!itens.length && pn.enq) itens.push(pn.enq);
  return itens.join(" · ");
}
function paraTexto(){
  if(!doc) return "";
  var L=[];
  L.push(nomeObra().toUpperCase());
  L.push("Capítulo "+(doc.numero||1)+(doc.titulo?" — "+doc.titulo:""));
  L.push("");
  doc.paginas.forEach(function(pg,ip){
    var np=(pg.paineis||[]).length;
    L.push("=== PÁGINA "+(ip+1)+" ("+np+(np===1?" painel":" painéis")+") ===");
    if(pg.visual&&LAYOUTS_VISUAIS[pg.visual.ativo]) L.push("Layout visual: "+LAYOUTS_VISUAIS[pg.visual.ativo].nome);
    L.push("");
    (pg.paineis||[]).forEach(function(pn,i){
      var ficha=fichaPainel(pn);
      L.push("PAINEL "+(i+1)+(ficha?"  ["+ficha+"]":""));
      L.push("   → "+fraseResumoPainel(pn));
      if(pn.acao) L.push(pn.acao.trim());
      if(pn.personagens && pn.personagens.length) L.push("   Em cena: "+pn.personagens.join(", "));
      (pn.falas||[]).forEach(function(f){
        var texto=(f.texto||"").trim();
        if(!texto) return;
        var tipo=f.tipo||"fala";
        var quem=(f.quem||"").trim();
        if(tipo==="narracao") L.push("   NARRAÇÃO: "+texto);
        else{
          var suf=ROTULO_BALAO[tipo]?(" "+ROTULO_BALAO[tipo]):"";
          L.push("   "+(quem||"—")+suf+": "+texto);
        }
      });
      if(pn.sfx) L.push("   SFX: "+pn.sfx.trim());
      if(pn.nota) L.push("   Nota: "+pn.nota.trim());
      L.push("");
    });
  });
  return L.join("\n");
}

var conviteInstalacao=null;
window.addEventListener("beforeinstallprompt",function(ev){ ev.preventDefault(); conviteInstalacao=ev; var bt=el("btInstalar"); if(bt) bt.classList.add("visivel"); });
el("btInstalar").onclick=async function(){
  if(!conviteInstalacao){ aviso("Use o menu do navegador e escolha 'Instalar app' ou 'Adicionar à tela inicial'."); return; }
  conviteInstalacao.prompt(); try{ await conviteInstalacao.userChoice; }catch(e){} conviteInstalacao=null; el("btInstalar").classList.remove("visivel");
};
window.addEventListener("online",async function(){ atualizarConexao(); agendarBackupNuvem(); /* Reconectar não deve substituir notas editadas na memória. */ });
window.addEventListener("offline",atualizarConexao);
atualizarConexao();

el("btBackup").onclick=function(){ atualizarEstadoBackup(); atualizarPastaBackup(); el("dlgBackup").showModal(); };
el("fecharBackup").onclick=function(){ el("dlgBackup").close(); };
el("btContaNuvem").onclick=function(){ usarContaNuvem(); };
el("fecharNuvem").onclick=function(){ el("dlgNuvem").close(); };
el("dlgNuvem").addEventListener("close",function(){el("senhaNuvem").value="";});
el("btAutorizarBibliotecaNuvem").onclick=autorizarBibliotecaNuvem;
el("btSairNuvem").onclick=sairContaNuvem;
window.addEventListener("storage",function(ev){if(ev.key==="mesa:nuvem-vinculo-v1"){invalidarContaNuvem(CONTA_NUVEM.uid);setTimeout(function(){atualizarContaNuvem().catch(function(){});},0);}});
el("btEntrarNuvem").onclick=function(){ enviarContaNuvem(false); };
el("btCriarContaNuvem").onclick=function(){ enviarContaNuvem(true); };
el("btBaixarBackup").onclick=function(){ baixarBackup(); };
el("btEscolherPasta").onclick=async function(){
  try{ await window.__mesaArmazenamento.escolherPastaBackup(); atualizarPastaBackup(); el("integridadeBackup").textContent="Pasta escolhida. O site pedirá autorização antes de gravar cada nova versão."; aviso("Pasta de backup escolhida. Nenhum backup foi criado ainda."); }
  catch(e){ if(e&&e.name==="AbortError") return; el("integridadeBackup").textContent="Não foi possível escolher a pasta. Use “Baixar backup” como alternativa."; aviso("A pasta não foi autorizada; seus dados atuais permanecem intactos."); }
};
el("btSalvarNaPasta").onclick=function(){ salvarBackupNaPasta(); };
el("btRelerDadosLocais").onclick=tentarRelerDadosLocais;
el("btRetomarRecuperacao").onclick=function(){window.location.reload();};
el("btExportarDesenhoPendente").onclick=function(){try{if(window.EditorDesenho&&window.EditorDesenho.estaAberto()&&window.EditorDesenho.exportarPNG)window.EditorDesenho.exportarPNG();}catch(e){aviso("Não foi possível exportar o desenho. Preserve esta aba e não reabra a página ainda.");}};
window.addEventListener("storage",function(ev){if(ev.key==="mesa:importacao-pendente-v1"){var r=window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao;if(r)r.estado.bloqueada=true;el("textoRecuperacao").textContent="Outra aba iniciou ou concluiu uma operação de armazenamento. Esta aba foi protegida contra novas gravações. Preserve qualquer rascunho e reabra a página depois que a outra aba terminar.";mostrarBloqueioImportacao();}});
el("btConsultarCacheLocal").onclick=el("btConsultarCacheBackup").onclick=consultarCacheTextos;
el("btFecharConsultaCache").onclick=function(){el("dlgConsultaCache").close();};
el("btBaixarConsultaCache").onclick=baixarCacheConsulta;
el("btRestaurarNuvem").onclick=function(){return restaurarBackupDaNuvem();};
el("btMaisCopiasNuvem").onclick=function(){return listarCopiasNuvem(true);};
el("btEnviarCopiaNuvem").onclick=function(){return enviarBackupNuvemAutomatico(true);};
el("btTentarSalvarTexto").onclick=function(){return executarAcaoTexto(function(){return true;});};
el("btImportarBackup").onclick=function(){ el("arquivoBackup").click(); };
el("arquivoBackup").onchange=async function(){
  var arquivo=this.files&&this.files[0]; this.value="";
  if(arquivo) await importarBackupArquivo(arquivo);
};

el("btExportar").onclick=function(){
  el("saidaTexto").value=paraTexto();
  el("dlgExport").showModal();
};
el("fecharDlg").onclick=function(){ el("dlgExport").close(); };
el("btPdf").onclick=function(){ exportarCapituloPDF(el("btPdf")); };
el("btCopiar").onclick=async function(){
  var t=el("saidaTexto");
  try{ await navigator.clipboard.writeText(t.value); aviso("Texto copiado."); }
  catch(e){ t.focus(); t.select(); aviso("Use Ctrl+C para copiar o texto selecionado."); }
};
el("btBaixar").onclick=async function(){
  if(!baixador){ aviso("Download indisponível aqui — copie o texto."); return; }
  var nome=(nomeObra()+" cap "+(doc.numero||1)).replace(/[^\wÀ-ÿ \-]/g,"").trim()+".txt";
  try{ await baixador.save({filename:nome,data:paraTexto()}); }
  catch(e){ aviso("Download não concluído."); }
};

window.addEventListener("beforeunload",function(e){
  var rec=window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao;if(rec&&(rec.estado.ativa||rec.estado.bloqueada)){e.preventDefault();e.returnValue="";}
  if(sujo||notaSuja||salvando||salvandoNota||acaoTextoAtiva||textosVolateis||FICHAS.pendente||(window.__mesaArmazenamento&&window.__mesaArmazenamento.temLocalStorage===false&&(obras.length||caps.length||notas.length))||(window.EditorDesenho&&window.EditorDesenho.temAlteracoes&&window.EditorDesenho.temAlteracoes())){ e.preventDefault(); e.returnValue=""; }
});

/* ========== arranque ========== */
function mostrarEntradaInicial(){
  obraAtual=null;capAtual=null;doc=null;notaAtual=null;modoNotas=false;modoLeitura=false;pgAtual=0;selPainel=null;
  reiniciarMarcaNota();
  document.body.classList.remove("em-leitura");estado.textContent="";
  desenharLateral();desenhar();atualizarPersonagens();alternarLateral(false);tela.scrollTop=0;
  if(!BIBLIOTECA_TEXTOS_OK)tela.innerHTML='<div class="centro"><h2>Biblioteca não carregada</h2><p>Não foi possível confirmar a leitura dos textos. Seus registros não foram apagados. Use Tentar ler novamente ou consulte a cópia de textos no aviso acima.</p></div>';
}
tela.innerHTML='<div class="centro"><h2>Abrindo a mesa…</h2><p>Buscando suas obras.</p></div>';
(async function(){
  var etapaRecuperacao="consulta";
  try{
    var rec=window.__mesaArmazenamento.recuperacao;
    if(!rec||typeof rec.temPendente!=="function")throw new Error("A verificação local não está disponível.");
    /* A abertura comum não precisa da trava de uma operação de recuperação.
       Com marcador presente, preserva a trava e toda a recuperação anterior. */
    if(rec.temPendente()){
      etapaRecuperacao="trava";
      await comTravaImportacao(function(){etapaRecuperacao="recuperacao";return rec.recuperar();});
    }
  }catch(e){mostrarFalhaRecuperacaoInicial(e,etapaRecuperacao);return;}finally{RECUPERACAO_INICIAL=false;}
  await iniciarArmazenamento();
  try{carregarDesenhosLivres();}catch(e){}
  if(!db){
    tela.innerHTML='<div class="centro"><h2>Sem armazenamento nesta visualização</h2>'+
      '<p>Não foi possível iniciar o armazenamento deste navegador. Tente abrir o arquivo em outra janela ou navegador.</p></div>';
    estado.textContent="";
    return;
  }
  try{ await carregarListas(); await sincronizarImagensNuvem(); }catch(e){}
  mostrarEntradaInicial();
})();
})();
