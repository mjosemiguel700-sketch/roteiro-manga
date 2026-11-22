
/* Armazenamento local: guarda tudo no armazenamento do próprio navegador.
   Funciona publicado ou como arquivo, sem depender de conta externa. Por navegador/aparelho:
   os dados não sincronizam entre celular e computador, por exemplo. */
(function(){
"use strict";

/* Motor local de importação. O chamador prepara/valida o plano e obtém a
   confirmação do usuário antes de executar. Não acessa Supabase nem arquivos.
   O marker é compartilhado entre abas; esta versão deve verificá-lo antes de
   qualquer escrita normal. Abas antigas e modificações externas não obedecem
   a esse bloqueio e exigem fechar as outras abas antes da importação.
   Não há transação conjunta entre localStorage e IndexedDB: o journal mantém
   a operação reversível até a confirmação final. Durabilidade estrita é usada
   quando disponível; isso não equivale a backup externo contra falha do disco. */
function criarMotorImportacao(abrirBanco,obterStorage){
  "use strict";
  var CHAVE_JOURNAL=["mesa-sistema","importacao",1],CHAVE_MARKER="mesa:importacao-pendente-v1";
  var FORMATO_JOURNAL="mesa-importacao-journal",FORMATO_MARKER="mesa-importacao-pendente";
  var estado={ativa:false,bloqueada:false};
  if(typeof abrirBanco!=="function"||typeof obterStorage!=="function")throw new TypeError("O motor precisa das fontes locais de armazenamento.");

  function erro(mensagem,codigo,causa){var e=new Error(mensagem);e.code=codigo||"importacao_local";if(causa)e.cause=causa;return e;}
  function pendente(causa,mensagem){var e=erro(mensagem||"Há uma importação local ainda não recuperada. Preserve esta aba e tente recuperar antes de editar.","importacao_pendente",causa);e.pendente=true;return e;}
  function objeto(v){return !!v&&typeof v==="object"&&!Array.isArray(v);}
  function possui(v,k){return Object.prototype.hasOwnProperty.call(v,k);}
  function chavesExatas(v,campos){return objeto(v)&&Object.keys(v).length===campos.length&&campos.every(function(k){return possui(v,k);});}
  function idValido(v){return (typeof v==="string"&&v.length>0)||(typeof v==="number"&&isFinite(v));}
  function chaveTextoValida(v){
    return typeof v==="string"&&(
      /^mesa:roteiros\/local\/(obras|capitulos|notas)\/[^\/]+$/.test(v)||
      v==="mesa:desenhos-livres"||v==="mesa:fichas-personagem-v1"
    );
  }
  function lista(v,visitar){
    if(!Array.isArray(v))throw erro("O plano de importação contém uma lista inválida.","importacao_plano");
    for(var i=0;i<v.length;i++){if(!possui(v,i))throw erro("A lista de importação está incompleta.","importacao_plano");visitar(v[i],i);}
  }
  function copiar(v){
    if(typeof structuredClone!=="function")throw erro("Este navegador não oferece a preparação segura da importação.","importacao_indisponivel");
    try{return structuredClone(v);}catch(e){throw erro("Não foi possível preparar os dados da importação.","importacao_plano",e);}
  }
  function storage(){
    var s=obterStorage();
    if(!s)return null;
    if(typeof s.getItem!=="function"||typeof s.setItem!=="function"||typeof s.removeItem!=="function")throw erro("O armazenamento local não está disponível.");
    return s;
  }
  function lerTexto(s,chave){
    var v=s.getItem(chave);if(v!==null&&typeof v!=="string")throw erro("A leitura do armazenamento local não foi confirmada.");return v;
  }
  function validarMarker(bruto){
    var m;try{m=JSON.parse(bruto);}catch(e){throw pendente(e,"O aviso de importação pendente está ilegível. Nenhum dado foi substituído pela recuperação.");}
    if(!chavesExatas(m,["formato","versao","id"])||m.formato!==FORMATO_MARKER||m.versao!==1||typeof m.id!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(m.id))throw pendente(null,"O aviso de importação pendente é inválido. Preserve os dados antes de tentar novamente.");
    return m;
  }
  function novoMarker(){
    var identificador;
    if(typeof crypto!=="undefined"&&crypto&&typeof crypto.randomUUID==="function")identificador=crypto.randomUUID();
    else identificador=Date.now().toString(36)+"-"+Math.random().toString(36).slice(2)+"-"+Math.random().toString(36).slice(2);
    return{formato:FORMATO_MARKER,versao:1,id:identificador};
  }
  function preparar(textos,imagens,s){
    var saidaTextos=[],saidaImagens=[],vistosTextos=new Set(),vistosImagens=new Set();
    lista(textos,function(t){
      if(!objeto(t)||!chaveTextoValida(t.chave)||(t.valor!==null&&typeof t.valor!=="string")||vistosTextos.has(t.chave))throw erro("O plano contém um destino de texto inválido ou repetido.","importacao_plano");
      vistosTextos.add(t.chave);saidaTextos.push({chave:t.chave,anterior:lerTexto(s,t.chave),valor:t.valor});
    });
    lista(imagens,function(im){
      if(!objeto(im)||!idValido(im.id)||!objeto(im.rec)||vistosImagens.has(String(im.id)))throw erro("O plano contém um destino de imagem inválido ou repetido.","importacao_plano");
      vistosImagens.add(String(im.id));saidaImagens.push({id:im.id,rec:copiar(im.rec)});
    });
    return{textos:saidaTextos,imagens:saidaImagens};
  }
  function validarJournal(j,m){
    if(!chavesExatas(j,["formato","versao","id","textos","imagens"])||j.formato!==FORMATO_JOURNAL||j.versao!==1||j.id!==m.id)throw pendente(null,"O registro de recuperação não corresponde ao aviso local. Nenhum dado foi restaurado automaticamente.");
    var textos=new Set(),imagens=new Set();
    try{
      lista(j.textos,function(t){
        if(!chavesExatas(t,["chave","anterior","valor"])||!chaveTextoValida(t.chave)||(t.anterior!==null&&typeof t.anterior!=="string")||(t.valor!==null&&typeof t.valor!=="string")||textos.has(t.chave))throw erro("Destino de texto inválido no registro de recuperação.");
        textos.add(t.chave);
      });
      lista(j.imagens,function(im){
        if(!chavesExatas(im,["id","existia","anterior"])||!idValido(im.id)||typeof im.existia!=="boolean"||imagens.has(String(im.id))||(!im.existia&&im.anterior!==undefined))throw erro("Destino de imagem inválido no registro de recuperação.");
        imagens.add(String(im.id));
      });
    }catch(e){throw pendente(e,"O registro de recuperação contém dados inválidos. Ele foi preservado para análise.");}
    return j;
  }
  function abrirTransacao(db,modo){
    if(!db||typeof db.transaction!=="function")throw erro("Não foi possível abrir o armazenamento de recuperação.","importacao_indisponivel");
    if(modo!=="readwrite")return db.transaction("d",modo);
    try{return db.transaction("d",modo,{durability:"strict"});}
    catch(e){if(!e||e.name!=="TypeError")throw e;return db.transaction("d",modo);}
  }
  function transacao(db,modo,prepararOperacoes){
    return new Promise(function(resolve,rejeitar){
      var tx,resultado,falha=null,terminou=false;
      function rejeicao(e){if(terminou)return;terminou=true;rejeitar(e||erro("A transação de recuperação foi interrompida."));}
      function abortar(e){
        if(terminou)return;falha=e||erro("A transação de recuperação falhou.");
        if(!tx){rejeicao(falha);return;}
        try{tx.abort();}catch(ignorar){rejeicao(falha);}
      }
      function observar(req,aoSucesso){
        req.onerror=function(){abortar(req.error||erro("Uma operação do armazenamento de recuperação falhou."));};
        req.onsuccess=function(){try{aoSucesso(req.result);}catch(e){abortar(e);}};
        return req;
      }
      try{
        tx=abrirTransacao(db,modo);
        tx.oncomplete=function(){if(terminou)return;terminou=true;resolve(resultado);};
        tx.onerror=function(){falha=falha||tx.error||erro("A transação de recuperação falhou.");try{tx.abort();}catch(e){rejeicao(falha);}};
        tx.onabort=function(){rejeicao(falha||tx.error||erro("A transação de recuperação foi cancelada."));};
        prepararOperacoes(tx.objectStore("d"),observar,function(v){resultado=v;},abortar);
      }catch(e){abortar(e);}
    });
  }
  function lerJournal(db){
    return transacao(db,"readonly",function(st,observar,resultado){
      var chaveLida=false,valorLido=false,chave,valor;
      function pronto(){if(chaveLida&&valorLido)resultado({existe:chave!==undefined,valor:valor});}
      observar(st.getKey(CHAVE_JOURNAL),function(v){chave=v;chaveLida=true;pronto();});
      observar(st.get(CHAVE_JOURNAL),function(v){valor=v;valorLido=true;pronto();});
    });
  }
  function gravarPreparacao(db,m,plano){
    return transacao(db,"readwrite",function(st,observar,resultado){
      var existentes=plano.imagens.map(function(im){return{id:im.id,existia:false,anterior:undefined};});
      var faltam=2+plano.imagens.length*2,journalExistente=false;
      function recebida(){
        faltam--;if(faltam)return;
        if(journalExistente)throw pendente(null,"Já existe um registro de importação pendente. Preserve os dados e feche as outras abas.");
        var j={formato:FORMATO_JOURNAL,versao:1,id:m.id,textos:plano.textos,imagens:existentes};validarJournal(j,m);
        st.put(j,CHAVE_JOURNAL);
        plano.imagens.forEach(function(im){st.put(im.rec,im.id);});
        resultado(j);
      }
      observar(st.getKey(CHAVE_JOURNAL),function(v){journalExistente=v!==undefined;recebida();});
      observar(st.get(CHAVE_JOURNAL),function(){recebida();});
      plano.imagens.forEach(function(im,i){
        observar(st.getKey(im.id),function(v){existentes[i].existia=v!==undefined;recebida();});
        observar(st.get(im.id),function(v){existentes[i].anterior=v;recebida();});
      });
    });
  }
  function markerConfere(s,bruto){if(lerTexto(s,CHAVE_MARKER)!==bruto)throw pendente(null,"O aviso local mudou durante a operação. A recuperação foi interrompida para preservar outras alterações.");}
  function limparMarker(s,bruto){
    var atual=lerTexto(s,CHAVE_MARKER);if(atual===null)return;
    if(atual!==bruto)throw pendente(null,"O aviso local mudou; ele não foi removido automaticamente.");
    s.removeItem(CHAVE_MARKER);if(lerTexto(s,CHAVE_MARKER)!==null)throw pendente(null,"Não foi possível confirmar a limpeza do aviso local.");
  }
  function compararTextos(s,j,novos){
    j.textos.forEach(function(t){var atual=lerTexto(s,t.chave);if(novos?atual!==t.valor:(atual!==t.anterior&&atual!==t.valor))throw pendente(null,"Um texto foi alterado fora da importação. A recuperação foi interrompida sem substituir essa versão.");});
  }
  function aplicarTextos(s,j,bruto){
    markerConfere(s,bruto);compararTextos(s,j,false);
    j.textos.forEach(function(t){
      markerConfere(s,bruto);var atual=lerTexto(s,t.chave);
      if(atual!==t.anterior&&atual!==t.valor)throw pendente(null,"Um texto mudou durante a importação. A operação foi interrompida.");
      /* null é exclusão explícita do plano autorizado, nunca o texto "null". */
      if(atual!==t.valor){if(t.valor===null)s.removeItem(t.chave);else s.setItem(t.chave,t.valor);}
      if(lerTexto(s,t.chave)!==t.valor)throw erro("A releitura de um texto importado divergiu. A importação não foi confirmada.");
    });
    compararTextos(s,j,true);
  }
  function removerJournal(db,m,s,bruto){
    return transacao(db,"readwrite",function(st,observar,resultado){
      var lido=false,chaveLida=false,valor,chave;
      function pronto(){if(!lido||!chaveLida)return;if(chave===undefined)throw pendente(null,"O registro de recuperação desapareceu antes da confirmação.");validarJournal(valor,m);markerConfere(s,bruto);compararTextos(s,valor,true);st.delete(CHAVE_JOURNAL);resultado(true);}
      observar(st.getKey(CHAVE_JOURNAL),function(v){chave=v;chaveLida=true;pronto();});
      observar(st.get(CHAVE_JOURNAL),function(v){valor=v;lido=true;pronto();});
    });
  }
  async function restaurar(db,s,j,m,bruto){
    validarJournal(j,m);markerConfere(s,bruto);compararTextos(s,j,false);
    /* Libera primeiro chaves criadas pela importação, sem tocar valores terceiros. */
    var ordem=j.textos.filter(function(t){return t.anterior===null;}).concat(j.textos.filter(function(t){return t.anterior!==null;}));
    ordem.forEach(function(t){
      markerConfere(s,bruto);var atual=lerTexto(s,t.chave);
      if(atual!==t.anterior&&atual!==t.valor)throw pendente(null,"Um texto mudou durante a recuperação. A versão encontrada foi preservada.");
      if(atual!==t.anterior){if(t.anterior===null)s.removeItem(t.chave);else s.setItem(t.chave,t.anterior);}
      if(lerTexto(s,t.chave)!==t.anterior)throw pendente(null,"Não foi possível confirmar a restauração de um texto. O registro de recuperação foi mantido.");
    });
    await transacao(db,"readwrite",function(st,observar,resultado){
      var chaveLida=false,lido=false,chave,valor;
      function pronto(){
        if(!chaveLida||!lido)return;
        if(chave===undefined)throw pendente(null,"O registro de recuperação não está mais disponível.");
        validarJournal(valor,m);markerConfere(s,bruto);
        j.textos.forEach(function(t){if(lerTexto(s,t.chave)!==t.anterior)throw pendente(null,"Um texto mudou antes da confirmação da recuperação.");});
        j.imagens.forEach(function(im){if(im.existia)st.put(im.anterior,im.id);else st.delete(im.id);});
        st.delete(CHAVE_JOURNAL);resultado(true);
      }
      observar(st.getKey(CHAVE_JOURNAL),function(v){chave=v;chaveLida=true;pronto();});
      observar(st.get(CHAVE_JOURNAL),function(v){valor=v;lido=true;pronto();});
    });
    limparMarker(s,bruto);
  }
  function impedirGravacao(){
    if(estado.ativa)throw pendente(null,"Aguarde a importação ou recuperação terminar antes de salvar.");
    if(estado.bloqueada)throw pendente();
    try{var s=storage();if(s&&lerTexto(s,CHAVE_MARKER)!==null){estado.bloqueada=true;throw pendente();}}
    catch(e){estado.bloqueada=true;if(e&&e.pendente)throw e;throw pendente(e,"Não foi possível confirmar se há uma importação pendente. As escritas foram bloqueadas por segurança.");}
    return false;
  }
  async function executar(textos,imagens){
    if(estado.ativa)throw pendente(null,"Já há uma importação ou recuperação em andamento.");
    if(estado.bloqueada)throw pendente();
    estado.ativa=true;
    var s,m,bruto,db,journal,markerTentado=false,fonteConfirmada=false,confirmado=false;
    try{
      s=storage();if(!s)throw erro("A importação precisa de armazenamento local persistente.","importacao_indisponivel");
      if(lerTexto(s,CHAVE_MARKER)!==null){estado.bloqueada=true;throw pendente();}
      fonteConfirmada=true;
      var plano=preparar(textos,imagens,s);m=novoMarker();bruto=JSON.stringify(m);
      markerTentado=true;s.setItem(CHAVE_MARKER,bruto);markerConfere(s,bruto);
      db=await abrirBanco();journal=await gravarPreparacao(db,m,plano);
      aplicarTextos(s,journal,bruto);
      await removerJournal(db,m,s,bruto);confirmado=true;
      limparMarker(s,bruto);estado.bloqueada=false;
      return{importado:true};
    }catch(causa){
      if(confirmado){estado.bloqueada=true;var committed=pendente(causa,"Os dados foram importados, mas a limpeza do aviso local não foi confirmada. Recupere o aviso antes de editar.");committed.importado=true;throw committed;}
      if(journal){
        try{await restaurar(db,s,journal,m,bruto);estado.bloqueada=false;var desfeito=erro("A importação não foi concluída. Os dados anteriores foram restaurados.","importacao_recuperada",causa);desfeito.recuperado=true;throw desfeito;}
        catch(recuperacao){if(recuperacao&&recuperacao.recuperado)throw recuperacao;estado.bloqueada=true;throw pendente(recuperacao,"A importação não foi confirmada e a recuperação ainda está pendente. Preserve esta aba, feche as outras abas e tente recuperar.");}
      }
      if(causa&&causa.pendente){estado.bloqueada=true;throw causa;}
      try{if(markerTentado)limparMarker(s,bruto);else if(s&&lerTexto(s,CHAVE_MARKER)!==null)throw pendente();}
      catch(limpeza){estado.bloqueada=true;throw pendente(limpeza,"A preparação da importação falhou e o aviso local ainda não pôde ser conferido.");}
      if(!fonteConfirmada){estado.bloqueada=true;throw pendente(causa);}
      estado.bloqueada=false;var intacto=erro("A importação não foi iniciada; os dados anteriores foram preservados.","importacao_recuperada",causa);intacto.recuperado=true;throw intacto;
    }finally{estado.ativa=false;}
  }
  async function recuperar(){
    if(estado.ativa)throw pendente(null,"Aguarde a operação local em andamento antes de recuperar.");
    estado.ativa=true;
    try{
      var s=storage();if(!s){estado.bloqueada=false;return false;}
      var bruto=lerTexto(s,CHAVE_MARKER);if(bruto===null){estado.bloqueada=false;return false;}
      estado.bloqueada=true;
      var m=validarMarker(bruto),db=await abrirBanco(),lido=await lerJournal(db);
      if(!lido||typeof lido.existe!=="boolean")throw pendente(null,"A leitura do registro de recuperação não foi confirmada.");
      if(!lido.existe){limparMarker(s,bruto);estado.bloqueada=false;return true;}
      var j=validarJournal(lido.valor,m);await restaurar(db,s,j,m,bruto);estado.bloqueada=false;return true;
    }catch(e){estado.bloqueada=true;if(e&&e.pendente)throw e;throw pendente(e);}
    finally{estado.ativa=false;}
  }
  /* Consulta sem escrita ou abertura do IndexedDB. Erro de leitura nunca
     equivale a marcador ausente. A recuperação efetiva relê sob a trava. */
  function temPendente(){var s=storage();return !!s&&lerTexto(s,CHAVE_MARKER)!==null;}
  return{estado:estado,executar:executar,recuperar:recuperar,temPendente:temPendente,impedirGravacao:impedirGravacao};
}
var P="mesa:", mem=Object.create(null), ls=null, falhaAcesso=false;
/* Uma fonte legível continua válida mesmo quando não há espaço para escrever. */
try{ls=window.localStorage||null;}catch(e){falhaAcesso=true;}
function erroLeituraTexto(){var e=new Error("Não foi possível ler os dados locais com segurança. Preserve esta aba e tente novamente sem apagar os dados do navegador.");e.code="leitura_local";return e;}
function fonteLocal(){
  if(!ls&&falhaAcesso){try{ls=window.localStorage;if(!ls)throw erroLeituraTexto();falhaAcesso=false;if(window.__mesaArmazenamento)window.__mesaArmazenamento.temLocalStorage=true;}catch(e){throw erroLeituraTexto();}}
  return ls;
}

function ler(k){try{var fonte=fonteLocal();return fonte?fonte.getItem(P+k):(Object.prototype.hasOwnProperty.call(mem,k)?mem[k]:null);}catch(e){throw erroLeituraTexto();}}
function lerDocumento(path){
  var bruto=ler(path);if(bruto===null)return null;
  try{var v=JSON.parse(bruto);if(!v||typeof v!=="object"||Array.isArray(v))throw erroLeituraTexto();return v;}catch(e){throw erroLeituraTexto();}
}
function gravar(k,v,restauracaoConfirmada){
  if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
  if(/^roteiros\/local\//.test(k)){if(restauracaoConfirmada)ler(k);else lerDocumento(k);}
  var fonte=fonteLocal();
  try{ if(fonte) fonte.setItem(P+k,v); else mem[k]=v; }
  catch(e){ var er=new Error("Armazenamento cheio"); er.code="quota_exceeded"; throw er; }
  try{if(/^roteiros\/local\//.test(k)&&window.agendarBackupNuvem)window.agendarBackupNuvem();}catch(e){}
}
function apagar(k){if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();if(/^roteiros\/local\//.test(k))lerDocumento(k);var fonte=fonteLocal();if(fonte)fonte.removeItem(P+k);else delete mem[k];try{if(/^roteiros\/local\//.test(k)&&window.agendarBackupNuvem)window.agendarBackupNuvem();}catch(e){} }
function chaves(){
  var out=[],i,k;
  try{var fonte=fonteLocal();if(fonte){for(i=0;i<fonte.length;i++){k=fonte.key(i);if(typeof k!=="string")throw erroLeituraTexto();if(k.indexOf(P)===0)out.push(k.slice(P.length));}}else out=Object.keys(mem);}catch(e){throw erroLeituraTexto();}
  return out;
}
function novoId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function docRef(path){
  var id=path.split("/").pop();
  return {
    path:path, id:id,
    get:async function(){
      var v=lerDocumento(path);
      return {exists:v!==null, id:id, data:function(){return v===null?undefined:JSON.parse(JSON.stringify(v));}};
    },
    set:async function(d,opcoes){gravar(path,JSON.stringify(d),!!(opcoes&&opcoes.restauracaoConfirmada));},
    update:async function(d){
      var o=lerDocumento(path)||{},k;
      for(k in d) o[k]=d[k];
      gravar(path,JSON.stringify(o));
    },
    delete:async function(){ apagar(path); }
  };
}

function consulta(cp,campo,dir){
  return {
    orderBy:function(c,d){ return consulta(cp,c,d||"asc"); },
    get:async function(){
      var pre=cp+"/";
      var docs=chaves().filter(function(k){
        return k.indexOf(pre)===0 && k.indexOf("/",pre.length)<0;
      }).map(function(k){
        var d=lerDocumento(k);if(d===null)throw erroLeituraTexto();
        return {id:k.slice(pre.length), ref:docRef(k), data:function(){ return d; }};
      });
      if(campo) docs.sort(function(a,b){
        var x=a.data()[campo], y=b.data()[campo], r=x<y?-1:(x>y?1:0);
        return dir==="desc"?-r:r;
      });
      return {docs:docs, size:docs.length, empty:!docs.length, forEach:function(f){ docs.forEach(f); }};
    }
  };
}

var dbLocal={
  collection:function(cp){
    var q=consulta(cp);
    q.doc=function(i){ return docRef(cp+"/"+(i||novoId())); };
    q.add=async function(d){ var r=docRef(cp+"/"+novoId()); await r.set(d); return r; };
    return q;
  }
};

  var baixadorLocal={
  save:async function(o){
    var b=new Blob([o.data],{type:"text/plain;charset=utf-8"});
    var a=document.createElement("a");
    a.href=URL.createObjectURL(b); a.download=o.filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(a.href); },1000);
  }
};

  /* A pasta escolhida pelo usuário fica separada dos dados do projeto. O navegador
     pode revogar essa autorização; por isso ela nunca substitui o backup baixado. */
  var pastaDB=null, pastaDBP=null;
  function abrirPastaDB(){
    if(pastaDBP) return pastaDBP;
    pastaDBP=new Promise(function(res){
      try{
        var r=indexedDB.open("mesa-configuracao",1);
        r.onupgradeneeded=function(){ if(!r.result.objectStoreNames.contains("config")) r.result.createObjectStore("config"); };
        r.onsuccess=function(){ pastaDB=r.result; res(pastaDB); };
        r.onerror=function(){ res(null); };
      }catch(e){ res(null); }
    });
    return pastaDBP;
  }
  function configPasta(acao,valor){ return abrirPastaDB().then(function(db){ return new Promise(function(res){
    if(!db){res(null);return;} try{var tx=db.transaction("config",acao==="ler"?"readonly":"readwrite"), st=tx.objectStore("config"); var r=acao==="ler"?st.get("pasta-backups"):st.put(valor,"pasta-backups"); r.onsuccess=function(){res(acao==="ler"?r.result:true);}; r.onerror=function(){res(null);};}catch(e){res(null);}
  }); }); }
  function nomeVersao(prefixo){ var d=new Date(), z=function(n){return String(n).padStart(2,"0");}; return prefixo+"-"+d.getFullYear()+z(d.getMonth()+1)+z(d.getDate())+"-"+z(d.getHours())+z(d.getMinutes())+z(d.getSeconds())+"-"+String(d.getMilliseconds()).padStart(3,"0")+".json"; }
  async function escolherPastaBackup(){
    if(!window.showDirectoryPicker) throw new Error("pasta_indisponivel");
    var h=await window.showDirectoryPicker({mode:"readwrite"});
    if(!await configPasta("gravar",h)) throw new Error("pasta_nao_guardada");
    return h;
  }
  async function salvarEmPasta(filename,data,verificar){
    var h=await configPasta("ler"); if(!h) throw new Error("pasta_ausente");
    var p=await h.queryPermission({mode:"readwrite"}); if(p!=="granted") p=await h.requestPermission({mode:"readwrite"});
    if(p!=="granted") throw new Error("permissao_negada");
    var f=await h.getFileHandle(filename,{create:true}), w=await f.createWritable();
    await w.write(data); await w.close();
    /* Confere o arquivo que acabou de ser gravado, antes de informar sucesso. */
    var texto=await (await f.getFile()).text(); if(texto!==data || !(await verificar(texto))) throw new Error("verificacao_falhou");
    return {nome:h.name||"pasta escolhida",arquivo:filename};
  }
  async function nomePastaBackup(){ var h=await configPasta("ler"); return h?(h.name||"pasta escolhida"):null; }
  window.__mesaArmazenamento={db:dbLocal,baixador:baixadorLocal,temLocalStorage:!!ls,modoMemoria:!ls&&!falhaAcesso,lerValor:ler,gravarValor:gravar,escolherPastaBackup:escolherPastaBackup,salvarEmPasta:salvarEmPasta,nomePastaBackup:nomePastaBackup,nomeVersao:nomeVersao,suportaPasta:!!window.showDirectoryPicker};
  window.__mesaArmazenamento.recuperacao=criarMotorImportacao(function(){if(!window.EditorDesenho||!window.EditorDesenho.bdAbrir)throw new Error("O banco de desenhos não está disponível.");return window.EditorDesenho.bdAbrir();},fonteLocal);
})();
