
/* ========== Editor de desenho em tela cheia (um por painel) ==========
   Raster, com camadas. Cada painel guarda seu desenho no IndexedDB do navegador
   (uma imagem PNG por camada); o roteiro guarda só a miniatura, o tamanho e a borda.
   Expõe window.EditorDesenho = { abrir, apagar, copiar, TAMANHOS, ORDEM }. */
(function(){
"use strict";

var TAU=Math.PI*2;
var TAMANHOS={
  quadrado:{nome:"Quadrado",razao:"1:1",w:1,h:1},
  horizontal:{nome:"Horizontal",razao:"4:3",w:4,h:3},
  vertical:{nome:"Vertical",razao:"3:4",w:3,h:4},
  faixa:{nome:"Faixa larga",razao:"3:1",w:3,h:1},
  faixaAlta:{nome:"Faixa alta",razao:"1:2",w:1,h:2},
  pagina:{nome:"Página inteira",razao:"5:7",w:5,h:7}
};
var ORDEM=["quadrado","horizontal","vertical","faixa","faixaAlta","pagina"];
var PADRAO_TAM="horizontal", BORDA_PADRAO=6, LADO=1600;
var QUALIDADES={
  leve:{nome:"Leve",lado:1200,descricao:"Mais rápida e econômica"},
  final:{nome:"Final",lado:1600,descricao:"Equilíbrio para desenho e exportação"},
  alta:{nome:"Alta",lado:2400,descricao:"Mais definição; ocupa mais espaço local"}
};
function qualidadeValida(q){ return !!QUALIDADES[q]; }
function ladoQualidade(q){ return (QUALIDADES[qualidadeValida(q)?q:"final"]||QUALIDADES.final).lado; }

function dimensoes(ch,qualidade){
  var t=TAMANHOS[ch]||TAMANHOS[PADRAO_TAM], lado=ladoQualidade(qualidade), k=lado/Math.max(t.w,t.h);
  return {w:Math.max(1,Math.round(t.w*k)),h:Math.max(1,Math.round(t.h*k))};
}

/* ---------- utilidades ---------- */
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function nid(){ return "l"+Date.now().toString(36)+Math.random().toString(36).slice(2,6); }
function clamp(v,a,b){ return Math.min(b,Math.max(a,v)); }
function novoCanvas(w,h){ var c=document.createElement("canvas"); c.width=w; c.height=h; return c; }
function recortar(src,x,y,w,h){
  var c=novoCanvas(w,h); c.getContext("2d").drawImage(src,x,y,w,h,0,0,w,h); return c;
}
function hexRgb(h){
  h=String(h||"#000000").replace("#","");
  if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  var n=parseInt(h,16)||0; return [(n>>16)&255,(n>>8)&255,n&255];
}
function rgbHex(r,g,b){ return "#"+[r,g,b].map(function(v){ return ("0"+v.toString(16)).slice(-2); }).join(""); }

/* ---------- forma do painel (corte) ----------
   painel.forma = [x0,y0,x1,y1,...]: polígono em frações (0–1) do quadro. Sem forma = retângulo. */
var FORMAS_PAINEL=[
  ["ret","Retângulo / quadrado",null],
  ["trap","Trapézio",[0.2,0,0.8,0,1,1,0,1]],
  ["trapInv","Trapézio invertido",[0,0,1,0,0.8,1,0.2,1]],
  ["trapLado","Trapézio inclinado",[0,0.18,1,0,1,1,0,0.82]],
  ["para","Paralelogramo",[0.22,0,1,0,0.78,1,0,1]],
  ["paraV","Paralelogramo inclinado",[0,0.2,1,0,1,0.8,0,1]],
  ["tri","Triângulo",[0.5,0,1,1,0,1]],
  ["triInv","Triângulo invertido",[0,0,1,0,0.5,1]],
  ["triRet","Triângulo retângulo",[0,0,1,1,0,1]],
  ["losango","Losango",[0.5,0,1,0.5,0.5,1,0,0.5]],
  ["hex","Hexágono",[0.25,0,0.75,0,1,0.5,0.75,1,0.25,1,0,0.5]],
  ["canto","Canto cortado",[0,0,0.78,0,1,0.22,1,1,0,1]]
];
var RET_FORMA=[0,0,1,0,1,1,0,1];
function formaValida(f){
  if(!Array.isArray(f)||f.length<6||f.length%2) return false;
  for(var i=0;i<f.length;i++) if(typeof f[i]!=="number"||!isFinite(f[i])) return false;
  return true;
}
function formaDe(p){ return p&&formaValida(p.forma)?p.forma:null; }
function mesmaForma(a,b){
  if(!a||!b) return !a&&!b;
  if(a.length!==b.length) return false;
  for(var i=0;i<a.length;i++) if(Math.abs(a[i]-b[i])>0.0015) return false;
  return true;
}
function normalizarForma(f){
  if(!formaValida(f)) return null;
  f=f.map(function(v){ return clamp(v,0,1); });
  return mesmaForma(f,RET_FORMA)?null:f;
}
function formaId(f){
  if(!f) return "ret";
  for(var i=1;i<FORMAS_PAINEL.length;i++) if(mesmaForma(f,FORMAS_PAINEL[i][2])) return FORMAS_PAINEL[i][0];
  return "custom";
}
function trilhaForma(c,f,W,H){
  for(var i=0;i<f.length;i+=2){
    if(i) c.lineTo(f[i]*W,f[i+1]*H); else c.moveTo(f[i]*W,f[i+1]*H);
  }
  c.closePath();
}

/* ---------- armazenamento: uma falha de leitura não confirma ausência ---------- */
var BD={db:null,p:null,mem:{}},COPIAS_DESENHO=[];
function erroLeituraImagem(mensagem,codigo){var e=new Error(mensagem||"Não foi possível ler o armazenamento de imagens. Tente novamente sem apagar os dados do navegador.");e.code=codigo||"leitura_imagem";return e;}
function bdAbrir(){
  if(BD.db)return Promise.resolve(BD.db);
  if(BD.p) return BD.p;
  var abertura=new Promise(function(res){
    var concluida=false;
    function terminar(db){
      if(concluida){if(db)try{db.close();}catch(e){}return;}
      concluida=true;
      if(db){
        BD.db=db;
        db.onversionchange=db.onclose=function(){if(BD.db===db){BD.db=null;BD.p=null;}try{db.close();}catch(e){}};
      }else window.__mesaFalhaIndexedDB=true;
      res(db);
    }
    try{
      var rq=indexedDB.open("mesa-desenhos",1);
      rq.onupgradeneeded=function(){ rq.result.createObjectStore("d"); };
      rq.onsuccess=function(){terminar(rq.result);};
      rq.onerror=rq.onblocked=function(){terminar(null);};
    }catch(e){terminar(null);}
  });
  BD.p=abertura;
  abertura.then(function(db){if(!db&&BD.p===abertura)BD.p=null;});
  return abertura;
}
function bdLer(id){
  return bdAbrir().then(function(db){
    if(!db)throw erroLeituraImagem();
    return new Promise(function(res,rejeitar){
      var terminou=false,resultado;
      function falhou(){window.__mesaFalhaIndexedDB=true;rejeitar(erroLeituraImagem());}
      try{
        var tx=db.transaction("d"),rq=tx.objectStore("d").get(id);
        rq.onsuccess=function(){terminou=true;resultado=rq.result;};
        rq.onerror=tx.onerror=tx.onabort=falhou;
        tx.oncomplete=function(){
          if(!terminou){falhou();return;}
          if(resultado===undefined){res(null);return;}
          if(!resultado||typeof resultado!=="object"||Array.isArray(resultado)){rejeitar(erroLeituraImagem("O registro da imagem não pôde ser interpretado.","registro_imagem"));return;}
          res(resultado);
        };
      }catch(e){falhou();}
    });
  });
}
function bdGravar(id,rec){
  try{if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();}catch(e){return Promise.resolve(false);}
  return bdAbrir().then(function(db){
  try{if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();}catch(e){return Promise.resolve(false);}
    if(!db){ window.__mesaFalhaIndexedDB=true; BD.mem[id]=rec; return false; }
    return new Promise(function(res){
      try{
        var tx=db.transaction("d","readwrite"); tx.objectStore("d").put(rec,id);
        tx.oncomplete=function(){ try{ if(window.agendarBackupNuvem) window.agendarBackupNuvem(); }catch(e){} res(true); };
        tx.onerror=tx.onabort=function(){ window.__mesaFalhaIndexedDB=true; res(false); };
      }catch(e){ window.__mesaFalhaIndexedDB=true; res(false); }
    });
  });
}
function bdApagar(id){
  try{if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();}catch(e){return Promise.resolve(false);}
  return bdAbrir().then(function(db){
  try{if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();}catch(e){return Promise.resolve(false);}
    if(!db){ delete BD.mem[id]; return false; }
    return new Promise(function(res){
      try{
        var tx=db.transaction("d","readwrite"); tx.objectStore("d").delete(id);
        tx.oncomplete=function(){ res(true); };
        tx.onerror=tx.onabort=function(){ res(false); };
      }catch(e){ res(false); }
    });
  });
}
function bdListar(){
  try{if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();}catch(e){return Promise.reject(e);}
  return bdAbrir().then(function(db){
  if(window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao)window.__mesaArmazenamento.recuperacao.impedirGravacao();
    if(!db)throw erroLeituraImagem();
    return new Promise(function(res,rejeitar){
      var out=[],terminou=false;
      function falhou(){window.__mesaFalhaIndexedDB=true;rejeitar(erroLeituraImagem("Não foi possível concluir a leitura das imagens. O backup foi interrompido."));}
      try{
        var tx=db.transaction("d"),rq=tx.objectStore("d").openCursor();
        rq.onsuccess=function(){try{var c=rq.result;if(c){out.push({id:c.key,rec:c.value});c.continue();}else terminou=true;}catch(e){falhou();}};
        rq.onerror=tx.onerror=tx.onabort=falhou;
        tx.oncomplete=function(){if(!terminou){falhou();return;}res(out);};
      }catch(e){falhou();}
    });
  });
}
function blobParaData(blob){
  if(blob==null)return Promise.resolve(null);
  function valido(v){return typeof v==="string"&&/^data:[^,]*,[\s\S]+$/.test(v);}
  if(typeof blob==="string")return valido(blob)?Promise.resolve(blob):Promise.reject(erroLeituraImagem("Uma imagem do backup contém dados inválidos.","registro_imagem"));
  return new Promise(function(resolve,rejeitar){
    function falhou(){rejeitar(erroLeituraImagem("Não foi possível incluir uma imagem no backup. O arquivo não foi confirmado."));}
    try{var fr=new FileReader();fr.onload=function(){if(!valido(fr.result)){falhou();return;}resolve(fr.result);};fr.onerror=fr.onabort=falhou;fr.readAsDataURL(blob);}catch(e){falhou();}
  });
}
function dataParaBlob(data){
  if(typeof data!=="string"||data.indexOf("data:")!==0) return data;
  try{ var p=data.split(","), mime=(p[0].match(/data:([^;]+)/)||[])[1]||"image/png", bin=atob(p[1]||""), a=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i); return new Blob([a],{type:mime}); }catch(e){return data;}
}
async function exportarDesenhos(){
  var todos=await bdListar(), saida=[];
  for(var i=0;i<todos.length;i++){
    if(/^(nota-imagem|ficha-imagem)\//.test(String(todos[i].id))) continue;
    var rec=todos[i].rec;
    if(!rec||!Array.isArray(rec.camadas))throw erroLeituraImagem("Um desenho armazenado contém dados inválidos. Preserve os backups anteriores.","registro_imagem");
    var copia={v:rec.v,w:rec.w,h:rec.h,ativa:rec.ativa,baloes:rec.baloes||[],camadas:[]};
    for(var j=0;j<(rec.camadas||[]).length;j++){
      var c=rec.camadas[j];if(!c||!c.blob)throw erroLeituraImagem("Uma camada do desenho está sem imagem. O backup foi interrompido.","registro_imagem");
      var nc={id:c.id,nome:c.nome,tipo:c.tipo,sobreImagemId:c.sobreImagemId,manequim3d:dadosBaseManequim(c.manequim3d),vis:c.vis,bloqueada:c.bloqueada,op:c.op,modo:c.modo,blob:await blobParaData(c.blob),originalBlob:await blobParaData(c.originalBlob)}; copia.camadas.push(nc);
    }
    saida.push({id:todos[i].id,rec:copia});
  }
  return saida;
}
async function importarDesenhos(lista){
  if(!Array.isArray(lista)) return;
  for(var i=0;i<lista.length;i++){
    var item=lista[i], rec=item&&item.rec; if(!item||!item.id||!rec) continue;
    rec.camadas=(rec.camadas||[]).map(function(c){var nc=Object.create(null); Object.keys(c).forEach(function(k){nc[k]=c[k];}); nc.blob=dataParaBlob(nc.blob); nc.originalBlob=dataParaBlob(nc.originalBlob); return nc;});
    if(await bdGravar(item.id,rec)!==true)throw new Error("Não foi possível confirmar a gravação de todos os desenhos.");
  }
}
function prepararDesenhosImportacao(lista){
  return (lista||[]).map(function(item){var rec=JSON.parse(JSON.stringify(item.rec));rec.camadas=(rec.camadas||[]).map(function(c){var nc=Object.create(null);Object.keys(c).forEach(function(k){nc[k]=c[k];});nc.blob=dataParaBlob(nc.blob);nc.originalBlob=dataParaBlob(nc.originalBlob);return nc;});return{id:item.id,rec:rec};});
}

/* ---------- ferramentas e pincéis ---------- */
var PINCEIS={
  lapis:   {nome:"Lápis HB",      tipo:"lapis", pres:"op", min:1,   esp:0.12,tam:5,  op:85, estab:1, grao:0.55},
  lapis6b: {nome:"Lápis 6B",      tipo:"lapis", pres:"op", min:1,   esp:0.1, tam:18, op:65, estab:1, grao:0.8},
  esfero:  {nome:"Esferográfica", tipo:"duro",  pres:"tam",min:0.6, esp:0.08,tam:3,  op:100,estab:2},
  caneta:  {nome:"Caneta G",      tipo:"duro",  pres:"tam",min:0.15,esp:0.1, tam:6,  op:100,estab:3},
  nanquim: {nome:"Nanquim",       tipo:"duro",  pres:null, min:1,   esp:0.08,tam:3,  op:100,estab:2},
  marcador:{nome:"Marcador",      tipo:"duro",  pres:null, min:1,   esp:0.1, tam:30, op:50, estab:2},
  aerografo:{nome:"Aerógrafo",    tipo:"macio", pres:"op", min:1,   esp:0.05,tam:70, op:100,estab:1, fluxo:0.1},
  pincel:  {nome:"Pincel macio",  tipo:"macio", pres:"op", min:1,   esp:0.12,tam:40, op:60, estab:1},
  seco:    {nome:"Pincel seco",   tipo:"lapis", pres:"op", min:1,   esp:0.1, tam:36, op:80, estab:2, grao:0.28},
  esfumar: {nome:"Esfumar",       tipo:"esfumar",pres:null,min:1,   esp:0.14,tam:34, op:55, estab:2},
  borracha:{nome:"Borracha",      tipo:"duro",  pres:"tam",min:0.3, esp:0.1, tam:30, op:100,estab:1,borracha:true}
};
/* Pontas de caneta para arte-final de mangá. Os valores representam a espessura
   relativa no documento de desenho; BR usa carimbo macio para simular brush. */
var PONTAS_CANETA=[
  ["003","003",2],["005","005",3],["007","007",4],["009","009",5],
  ["01","01",6],["02","02",8],["03","03",10],["04","04",12],
  ["05","05",14],["06","06",16],["07","07",18],["08","08",20],
  ["09","09",22],["1","1",26],["2","2",34],["3","3",44],
  ["BR","BR · Brush",30]
];
PONTAS_CANETA.forEach(function(p){
  var id="caneta"+p[0], brush=p[0]==="BR";
  PINCEIS[id]={nome:"Caneta "+p[1],tipo:brush?"macio":"duro",pres:brush?"op":"tam",
    min:brush?1:0.25,esp:brush?0.13:0.08,tam:p[2],op:100,estab:2,fluxo:brush?0.72:undefined};
});
/* Graduações de lápis: 1B–10B e os principais graus H/HB/F.
   Quanto maior o número B, mais escuro e macio; H/2H são mais claros e firmes. */
var GRAUS_LAPIS=[
  ["2h","2H",3,92,0.22],["h","H",3.5,92,0.28],["f","F",4,90,0.34],
  ["b","B",5,86,0.48],["1b","1B",6,82,0.55],["2b","2B",8,78,0.62],
  ["3b","3B",10,74,0.68],["4b","4B",12,71,0.72],["5b","5B",15,68,0.76],
  ["6b","6B",18,65,0.80],["7b","7B",21,62,0.83],["8b","8B",25,59,0.86],
  ["9b","9B",29,56,0.89],["10b","10B",34,53,0.92]
];
GRAUS_LAPIS.forEach(function(g){
  var id="lapis"+g[0];
  PINCEIS[id]={nome:"Lápis "+g[1],tipo:"lapis",pres:"op",min:1,
    esp:0.1,tam:g[2],op:g[3],estab:1,grao:g[4]};
});
/* Lapiseiras comuns: grafites finos e 2,0 mm para desenho técnico/esboço. */
var LAPISSEIRAS=[
  ["03","0,3 mm",0.3,1.4,88,0.25],
  ["05","0,5 mm",0.5,1.8,86,0.32],
  ["07","0,7 mm",0.7,2.2,84,0.38],
  ["09","0,9 mm",0.9,2.7,82,0.44],
  ["20","2,0 mm",2.0,4.2,78,0.52]
];
LAPISSEIRAS.forEach(function(g){
  var id="lapiseira"+g[0];
  PINCEIS[id]={nome:"Lapiseira "+g[1],tipo:"lapis",pres:"op",min:1,
    esp:0.08,tam:g[3],op:g[4],estab:1,grao:g[5]};
});
/* Biblioteca de pontas: materiais próprios, desenhados localmente em canvas. */
var PINCEIS_ESTUDIO={
  penMaru:{nome:"Pen Maru · detalhes",familia:"pen",tipo:"pena",tam:3,min:.12,op:100,estab:3,fluxo:100,dureza:100,textura:0,espacamento:8,dica:"Ponta fina para olhos, cabelo e hachuras. A pressão varia a espessura."},
  penKabura:{nome:"Pen Kabura · contorno",familia:"pen",tipo:"pena",tam:10,min:.38,op:100,estab:3,fluxo:100,dureza:100,textura:0,espacamento:7,dica:"Contorno firme com variação moderada de pressão; indicada para arte-final."},
  penCaligrafica:{nome:"Pen caligráfica",familia:"pen",tipo:"chato",tam:20,min:.25,op:100,estab:2,fluxo:100,dureza:100,textura:0,espacamento:6,angulo:-35,dica:"Ponta achatada em ângulo fixo. Mude o ângulo da ponta para letras e linhas expressivas."},
  penBrush:{nome:"Pen brush · tinta",familia:"pen",tipo:"tinta",tam:30,min:.06,op:100,estab:3,fluxo:100,dureza:95,textura:0,espacamento:6,dica:"Ponta flexível: a pressão cria linhas finas e massas de tinta num mesmo traço."},
  guache:{nome:"Guache opaco",familia:"pintura",tipo:"guache",tam:45,min:.5,op:100,estab:1,fluxo:65,dureza:80,textura:18,espacamento:12,dica:"Pincel redondo e denso para cobrir áreas e construir volumes por sobreposição."},
  pincelChato:{nome:"Pincel chato · cerdas",familia:"pintura",tipo:"cerdas",tam:48,min:.35,op:95,estab:1,fluxo:70,dureza:95,textura:45,espacamento:9,angulo:-25,dica:"Marca achatada com sulcos de cerdas. Ajuste a rotação da ponta para mudar a direção da marca."},
  aquarela:{nome:"Aquarela · veladura",familia:"pintura",tipo:"aquarela",tam:65,min:.4,op:65,estab:2,fluxo:9,dureza:25,textura:25,espacamento:18,dica:"Camadas transparentes e borda pigmentada; passe novamente para intensificar a cor."},
  oleo:{nome:"Óleo seco",familia:"pintura",tipo:"oleo",tam:38,min:.4,op:90,estab:1,fluxo:58,dureza:85,textura:65,espacamento:16,angulo:-20,dica:"Marca densa com falhas e cerdas; útil para textura de tecido, cabelo e pinceladas secas."},
  pastelSuave:{nome:"Pastel suave",familia:"pastel",tipo:"pastel",tam:36,min:.55,op:80,estab:1,fluxo:42,dureza:40,textura:68,espacamento:14,dica:"Grão macio para volumes e sombreamento. A textura deixa o papel aparecer entre os pigmentos."},
  pastelOleo:{nome:"Pastel oleoso",familia:"pastel",tipo:"pasteloleo",tam:26,min:.55,op:95,estab:1,fluxo:82,dureza:90,textura:38,espacamento:10,dica:"Pastel denso e encerado, com falhas largas e cor intensa."},
  giz:{nome:"Giz seco",familia:"pastel",tipo:"giz",tam:30,min:.65,op:80,estab:1,fluxo:62,dureza:90,textura:85,espacamento:13,dica:"Ponta irregular e granulada para rascunho, textura e traços quebrados."},
  carvao:{nome:"Carvão",familia:"pastel",tipo:"carvao",tam:42,min:.3,op:75,estab:1,fluxo:38,dureza:25,textura:80,espacamento:18,dica:"Grão áspero com poeira suave em volta; use a lateral da marca para grandes sombras."},
  aeroDuro:{nome:"Aerógrafo firme",familia:"aero",tipo:"aeroDuro",tam:80,min:1,op:80,estab:1,fluxo:12,dureza:75,textura:0,espacamento:9,dica:"Jato com bordas mais definidas; reduza dureza para suavizar a transição."},
  aeroParticulas:{nome:"Aerógrafo · partículas",familia:"aero",tipo:"particulas",tam:90,min:1,op:85,estab:1,fluxo:55,dureza:100,textura:70,espacamento:22,dica:"Dispersa pequenos pontos dentro do jato para poeira, respingos e texturas."},
  aeroBrilho:{nome:"Aerógrafo · luz",familia:"aero",tipo:"brilho",tam:100,min:1,op:70,estab:1,fluxo:13,dureza:10,textura:0,espacamento:12,dica:"Halo muito suave para iluminar e criar atmosfera. Escolha uma cor clara para efeito de luz."},
  decoEstrela:{nome:"Decoração · estrelas",familia:"deco",tipo:"decoracao",motivo:"estrela",tam:38,min:.55,op:100,estab:0,fluxo:100,dureza:100,textura:0,espacamento:140,dispersao:25,dica:"Carimba estrelas ao arrastar. Espaçamento e dispersão controlam a distribuição."},
  decoCoracao:{nome:"Decoração · corações",familia:"deco",tipo:"decoracao",motivo:"coracao",tam:32,min:.6,op:100,estab:0,fluxo:100,dureza:100,textura:0,espacamento:135,dispersao:25,dica:"Carimba corações na cor atual; ajuste tamanho, ângulo e distância entre motivos."},
  decoFlor:{nome:"Decoração · flores",familia:"deco",tipo:"decoracao",motivo:"flor",tam:42,min:.6,op:100,estab:0,fluxo:100,dureza:100,textura:0,espacamento:145,dispersao:35,dica:"Flores de cinco pétalas para fundos e detalhes decorativos."},
  decoFolha:{nome:"Decoração · folhagem",familia:"deco",tipo:"decoracao",motivo:"folha",tam:35,min:.55,op:95,estab:0,fluxo:90,dureza:100,textura:0,espacamento:80,dispersao:55,dica:"Folhas distribuídas ao longo do gesto, orientadas pela direção do traço."},
  decoBrilho:{nome:"Decoração · brilhos",familia:"deco",tipo:"decoracao",motivo:"brilho",tam:38,min:.4,op:100,estab:0,fluxo:100,dureza:100,textura:0,espacamento:160,dispersao:70,dica:"Brilhos de quatro pontas para cabelo, olhos e efeitos de impacto."},
  decoHachura:{nome:"Decoração · hachuras",familia:"deco",tipo:"decoracao",motivo:"hachura",tam:35,min:.65,op:95,estab:1,fluxo:90,dureza:100,textura:0,espacamento:75,angulo:-20,dica:"Grupos de linhas paralelas para sombra gráfica. Ajuste o ângulo da ponta e o espaçamento."},
  borrachaMacia:{nome:"Borracha suave",familia:"borracha",tipo:"borrachaMacia",tam:65,min:.3,op:65,estab:1,fluxo:18,dureza:15,textura:0,espacamento:10,borracha:true,dica:"Apaga gradualmente com borda suave; serve para reduzir sombras e limpar transições."}
};
Object.keys(PINCEIS_ESTUDIO).forEach(function(id){
  var B=PINCEIS_ESTUDIO[id]; B.estudio=true;B.pres=B.familia==="aero"?"op":"tam"; B.esp=(B.espacamento||10)/100;
  B.dispersao=B.dispersao||0; B.angulo=B.angulo||0; PINCEIS[id]=B;
});
Object.keys(PINCEIS).forEach(function(id){
  var B=PINCEIS[id];
  if(!B.familia) B.familia=id==="aerografo"?"aero":B.borracha?"borracha":(/^(caneta|nanquim|marcador|esfero)/.test(id)?"pen":"pintura");
  if(B.fluxo==null) B.fluxo=B.tipo==="lapis"?50:B.tipo==="macio"?22:100;
  else if(B.fluxo<=1) B.fluxo*=100;
  if(B.dureza==null) B.dureza=B.tipo==="macio"?20:100;
  if(B.textura==null) B.textura=B.tipo==="lapis"?Math.round((B.grao||.55)*100):0;
  if(B.dispersao==null) B.dispersao=0;
  if(B.espacamento==null) B.espacamento=Math.round((B.esp||.1)*100);
  if(B.angulo==null) B.angulo=0;
});
var FORMAS={
  linha:"Linha",retangulo:"Retângulo",elipse:"Elipse",
  triangulo:"Triângulo",hexagono:"Hexágono",
  cubo:"Cubo de construção",cilindro:"Cilindro",cone:"Cone",piramide:"Pirâmide",prisma:"Prisma triangular",esfera:"Esfera"
};
var FERRS=[
  ["lapis","Lápis HB","P"],["lapis6b","Lápis 6B","Q"],["esfero","Esferográfica","K"],
  ["caneta","Caneta G","B"],
  ["aerografo","Aerógrafo","R"],["pincel","Pincel macio","A"],["seco","Pincel seco","D"],
  ["esfumar","Esfumar","S"],["borracha","Borracha","E"],null,
  ["linha","Linha","L"],["retangulo","Retângulo","U"],["elipse","Elipse","O"],
  ["triangulo","Triângulo",""],["hexagono","Hexágono",""],["cubo","Cubo",""],["cilindro","Cilindro",""],["cone","Cone",""],["piramide","Pirâmide",""],["prisma","Prisma",""],["esfera","Esfera",""],null,
  ["balde","Balde","G"],["gota","Conta-gotas","I"],null,
  ["selecionar","Selecionar","V"],["balao","Balão de fala","T"],["mao","Mão","H"]
];
PONTAS_CANETA.forEach(function(p){ FERRS.push(["caneta"+p[0],"Caneta "+p[1],""]); });
GRAUS_LAPIS.forEach(function(g){
  var id="lapis"+g[0];
  if(!FERRS.some(function(f){return f&&f[0]===id;})) FERRS.push([id,"Lápis "+g[1],""]);
});
LAPISSEIRAS.forEach(function(g){ FERRS.push(["lapiseira"+g[0],"Lapiseira "+g[1],""]); });
Object.keys(PINCEIS).forEach(function(id){ if(!FERRS.some(function(f){return f&&f[0]===id;})) FERRS.push([id,PINCEIS[id].nome,""]); });
/* Atalhos individuais para todas as pontas de caneta, graduações de lápis e lapiseiras. */
var TECLAS_ATALHOS_DETALHADOS="1234567890qwertyuiopasdfghjklzxcvbnm".split("");
var IDS_ATALHOS_DETALHADOS=[];
PONTAS_CANETA.forEach(function(p){ IDS_ATALHOS_DETALHADOS.push("caneta"+p[0]); });
GRAUS_LAPIS.forEach(function(g){ var id="lapis"+g[0]; if(IDS_ATALHOS_DETALHADOS.indexOf(id)<0) IDS_ATALHOS_DETALHADOS.push(id); });
LAPISSEIRAS.forEach(function(g){ IDS_ATALHOS_DETALHADOS.push("lapiseira"+g[0]); });
var MAPA_ATALHOS_DETALHADOS={};
IDS_ATALHOS_DETALHADOS.forEach(function(id,i){ if(TECLAS_ATALHOS_DETALHADOS[i]) MAPA_ATALHOS_DETALHADOS[TECLAS_ATALHOS_DETALHADOS[i]]=id; });
var HTML_ATALHOS_DETALHADOS=IDS_ATALHOS_DETALHADOS.map(function(id,i){
  if(!TECLAS_ATALHOS_DETALHADOS[i]) return "";
  var nome=PINCEIS[id]?PINCEIS[id].nome:id;
  return "<dt><kbd>Alt + "+TECLAS_ATALHOS_DETALHADOS[i].toUpperCase()+"</kbd></dt><dd>"+esc(nome)+"</dd>";
}).join("");

var AMOSTRAS=["#000000","#ffffff","#555555","#aaaaaa","#d63a3a","#e8892b","#f2d13b","#3fa34d","#2a6fdb","#7a45c9","#e46ab0","#7a4a2b"];
var CFG={ferr:"caneta",cor:"#000000",tomDesenho:"#1d1d1d",imgFerr:"lapis",pressao:true,respostaRapida:true,tol:24,ref:true,preencher:false,formaTraco:"solido",formaRot:0,linhaAngulo:15,sim:"",simN:6,balTipo:"fala",ajust:{},perfilTraco:"livre",curvaPressao:"normal",favoritos:[],guia:{grade:false,persp:false,tipo:"1",op:35,h:.42,v1:.18,v2:.82,v3:.5,v3y:.08,passo:96,div:12,edit:false},manequim:{pose:"neutro",angulo:0,escala:1,opacidade:.55}};
try{
  CFG.respostaRapida=localStorage.getItem("mesa.ed.respostaRapida")!=="false";
  var tomDesenhoGuardado=localStorage.getItem("mesa.ed.tomDesenho");
  if(/^#[0-9a-f]{6}$/i.test(tomDesenhoGuardado||"")) CFG.tomDesenho=tomDesenhoGuardado.toLowerCase();
}catch(e){}
try{
  var ferrImagemGuardada=localStorage.getItem("mesa.ed.imgFerr");
  if(PINCEIS[ferrImagemGuardada]) CFG.imgFerr=ferrImagemGuardada;
}catch(e){}
Object.keys(PINCEIS).forEach(function(k){
  CFG.ajust[k]=padraoPincel(k);
});
Object.keys(FORMAS).forEach(function(k){ CFG.ajust[k]={tam:4,op:100,estab:0}; });
function padraoPincel(id){
  var b=PINCEIS[id];
  return {tam:b.tam,op:b.op,estab:b.estab,fluxo:b.fluxo==null?100:(b.fluxo<=1?b.fluxo*100:b.fluxo),dureza:b.dureza==null?80:b.dureza,textura:b.textura==null?Math.round((b.grao||0)*100):b.textura,dispersao:b.dispersao||0,espacamento:b.espacamento==null?Math.round(b.esp*100):b.espacamento,angulo:b.angulo||0};
}
var LIMITES_PINCEL={tam:[1,200],op:[5,100],estab:[0,10],fluxo:[1,100],dureza:[0,100],textura:[0,100],dispersao:[0,100],espacamento:[2,180],angulo:[-180,180]};
try{
  var ajustesGuardados=JSON.parse(localStorage.getItem("mesa.ed.pinceis.v2")||"null");
  if(ajustesGuardados&&typeof ajustesGuardados==="object") Object.keys(PINCEIS).forEach(function(id){
    var a=ajustesGuardados[id]; if(!a||typeof a!=="object") return;
    Object.keys(LIMITES_PINCEL).forEach(function(k){ var lim=LIMITES_PINCEL[k]; if(typeof a[k]==="number"&&isFinite(a[k])) CFG.ajust[id][k]=clamp(a[k],lim[0],lim[1]); });
  });
}catch(e){}
function guardarAjustesPinceis(){ try{ localStorage.setItem("mesa.ed.pinceis.v2",JSON.stringify(CFG.ajust)); }catch(e){} }
try{
  var perfilGuardado=localStorage.getItem("mesa.ed.perfilTraco"), curvaGuardada=localStorage.getItem("mesa.ed.curvaPressao"),
      favoritosGuardados=JSON.parse(localStorage.getItem("mesa.ed.favoritos")||"[]");
  if(["livre","rapido","suave","muito-suave"].indexOf(perfilGuardado)>-1) CFG.perfilTraco=perfilGuardado;
  if(["normal","suave","firme"].indexOf(curvaGuardada)>-1) CFG.curvaPressao=curvaGuardada;
  if(Array.isArray(favoritosGuardados)) CFG.favoritos=favoritosGuardados.filter(function(f){ return !!PINCEIS[f]||!!FORMAS[f]; }).slice(0,6);
}catch(e){}
if(!CFG.favoritos.length) CFG.favoritos=["lapis","lapiseira05","caneta","caneta03","marcador","borracha"];
function salvarPreferenciasEstudio(){
  try{
    localStorage.setItem("mesa.ed.perfilTraco",CFG.perfilTraco);
    localStorage.setItem("mesa.ed.curvaPressao",CFG.curvaPressao);
    localStorage.setItem("mesa.ed.favoritos",JSON.stringify(CFG.favoritos));
    salvarEstudo();
  }catch(e){}
}
function renderFavoritos(){
  if(!E.favBar)return;
  E.favBar.innerHTML=(CFG.favoritos||[]).map(function(f){return '<button type="button" class="bt mini" data-fav="'+esc(f)+'" title="Usar '+esc(nomeFerr(f))+'">'+esc(nomeFerr(f))+'</button>';}).join("")||'<span class="ed-vazio">Adicione ferramentas favoritas.</span>';
}
function addFavorito(f){if(!f)return;CFG.favoritos=[f].concat((CFG.favoritos||[]).filter(function(x){return x!==f;})).slice(0,6);salvarPreferenciasEstudio();renderFavoritos();}
var CLIP=null;   /* área copiada: vale entre painéis */
var TIPOS_BAL=[["fala","Fala"],["pensamento","Pensamento"],["grito","Grito"],
  ["sussurro","Sussurro"],["off","Fora de quadro"],["narracao","Narração"]];
var MODOS_CAMADA=[["normal","Normal","source-over"],["multiplicar","Multiplicar","multiply"],
  ["tela","Tela","screen"],["sobrepor","Sobrepor","overlay"],["escurecer","Escurecer","darken"],["clarear","Clarear","lighten"]];
function opComp(m){
  for(var i=0;i<MODOS_CAMADA.length;i++) if(MODOS_CAMADA[i][0]===m) return MODOS_CAMADA[i][2];
  return "source-over";
}

/* ---------- balões de fala (objetos por cima do desenho) ---------- */
var FONTE_BAL='"Comic Neue","Comic Sans MS","Segoe UI",Arial,sans-serif';
var FONTES_SFX={impact:'Impact,"Arial Black",sans-serif',quadrada:'"Arial Black",Arial,sans-serif',comic:'"Comic Sans MS","Comic Neue",cursive',serif:'Georgia,"Times New Roman",serif'};
function corSfx(v,padrao){return /^#[0-9a-f]{6}$/i.test(v||"")?v:padrao;}
function cloneBal(b){
  var copia={id:b.id||nid(),txt:b.txt||"",tipo:b.tipo||"fala",
    x:+b.x||0,y:+b.y||0,w:Math.max(60,+b.w||300),h:Math.max(40,+b.h||160),
    px:+b.px||0,py:+b.py||0,fs:+b.fs||0};
  if(copia.tipo==="sfx"){
    copia.w=clamp(isFinite(copia.w)?copia.w:300,60,6000);copia.h=clamp(isFinite(copia.h)?copia.h:160,40,4000);
    copia.x=isFinite(copia.x)?copia.x:0;copia.y=isFinite(copia.y)?copia.y:0;
    copia.txt=String(copia.txt).slice(0,2000);copia.rot=isFinite(+b.rot)?((+b.rot%360)+540)%360-180:0;
    copia.fonte=Object.prototype.hasOwnProperty.call(FONTES_SFX,b.fonte)?b.fonte:"impact";
    copia.cor=corSfx(b.cor,"#111111");copia.contorno=corSfx(b.contorno,"#ffffff");copia.esp=clamp(+b.esp||0,0,32);copia.italico=!!b.italico;
  }
  return copia;
}
function pontoSfx(b,x,y,inverso){var a=(b.rot||0)*Math.PI/180*(inverso?-1:1),dx=x-b.x-b.w/2,dy=y-b.y-b.h/2;return{x:b.x+b.w/2+dx*Math.cos(a)-dy*Math.sin(a),y:b.y+b.h/2+dx*Math.sin(a)+dy*Math.cos(a)};}
function contemSfx(b,x,y){var p=pontoSfx(b,x,y,true);return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;}
function desenharSfx(c,b){
  var linhas=String(b.txt||"").split("\n").slice(0,24);if(!linhas.some(function(t){return t.trim();}))return;
  c.save();c.translate(b.x+b.w/2,b.y+b.h/2);c.rotate((b.rot||0)*Math.PI/180);
  c.font=(b.italico?"italic ":"")+"900 100px "+(FONTES_SFX[b.fonte]||FONTES_SFX.impact);
  var maior=1;linhas.forEach(function(t){maior=Math.max(maior,c.measureText(t).width);});
  var esp=clamp(+b.esp||0,0,32),sx=Math.max(1,b.w-esp*2)/maior,sy=Math.max(1,b.h-esp*2)/(linhas.length*120);
  c.scale(sx,sy);c.textAlign="center";c.textBaseline="middle";c.lineJoin="round";c.miterLimit=2;
  c.lineWidth=esp*2/Math.sqrt(sx*sy);c.strokeStyle=corSfx(b.contorno,"#ffffff");c.fillStyle=corSfx(b.cor,"#111111");
  linhas.forEach(function(t,i){var y=(i-(linhas.length-1)/2)*120;if(esp)c.strokeText(t,0,y);c.fillText(t,0,y);});c.restore();
}
function ehRetBal(t){ return t==="off"||t==="narracao"; }
function quebrarTexto(c,txt,maxW){
  var out=[];
  String(txt).split("\n").forEach(function(par){
    var pal=par.split(/\s+/).filter(Boolean), lin="";
    if(!pal.length){ out.push(""); return; }
    pal.forEach(function(p){
      var t=lin?lin+" "+p:p;
      if(lin&&c.measureText(t).width>maxW){ out.push(lin); lin=p; } else lin=t;
    });
    out.push(lin);
  });
  return out;
}
function estiloFonte(tipo,fs){
  return (tipo==="grito"?"bold ":(tipo==="sussurro"||tipo==="off"?"italic ":""))+fs+"px "+FONTE_BAL;
}
function areaTexto(b,lw){
  var t=b.tipo;
  if(t==="narracao"||t==="off"){ var pad=14+lw; return {w:b.w-pad*2,h:b.h-pad*2}; }
  if(t==="grito") return {w:b.w*0.58,h:b.h*0.52};
  if(t==="pensamento") return {w:b.w*0.66,h:b.h*0.58};
  return {w:b.w*0.72,h:b.h*0.62};
}
/* calcula (e guarda) o tamanho da letra e as linhas que cabem no balão */
function ajustarTexto(c,b,lw){
  var key=[b.txt,b.tipo,b.w,b.h,b.fs,lw].join("|");
  if(b._c&&b._c.key===key) return b._c;
  var a=areaTexto(b,lw), fs, lin=[], ok;
  function tenta(f){
    c.font=estiloFonte(b.tipo,f);
    var l=quebrarTexto(c,b.txt,a.w), larg=0;
    l.forEach(function(s){ larg=Math.max(larg,c.measureText(s).width); });
    return {l:l,ok:larg<=a.w*1.001&&l.length*f*1.2<=a.h};
  }
  if(b.fs>0){ fs=b.fs; lin=tenta(fs).l; }
  else{
    for(fs=Math.min(110,Math.floor(a.h));fs>=10;fs-=2){ var r=tenta(fs); if(r.ok){ lin=r.l; break; } }
    if(fs<10){ fs=10; lin=tenta(fs).l; }
  }
  b._c={key:key,fs:fs,lin:lin};
  return b._c;
}
function cauda(c,b,cx,cy,rx,ry,lw,fator){
  var nx=(b.px-cx)/rx, ny=(b.py-cy)/ry;
  if(Math.hypot(nx,ny)<1.12) return;
  var t=Math.atan2(ny,nx), dt=0.24, f=fator||1;
  var ax=cx+rx*f*Math.cos(t-dt), ay=cy+ry*f*Math.sin(t-dt);
  var bx=cx+rx*f*Math.cos(t+dt), by=cy+ry*f*Math.sin(t+dt);
  var a2x=ax+(cx-ax)*0.14, a2y=ay+(cy-ay)*0.14, b2x=bx+(cx-bx)*0.14, b2y=by+(cy-by)*0.14;
  c.beginPath(); c.moveTo(a2x,a2y); c.lineTo(ax,ay); c.lineTo(b.px,b.py); c.lineTo(bx,by); c.lineTo(b2x,b2y); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(ax,ay); c.lineTo(b.px,b.py); c.lineTo(bx,by); c.stroke();
}
function caudaRet(c,b,lw){
  var cx=b.x+b.w/2, cy=b.y+b.h/2, rx=b.w/2, ry=b.h/2, dx=b.px-cx, dy=b.py-cy;
  if(Math.abs(dx)<rx*1.02&&Math.abs(dy)<ry*1.02) return;
  var vert=Math.abs(dx)/rx>Math.abs(dy)/ry, hw=Math.min(rx,ry)*0.28, s=vert?rx/Math.abs(dx):ry/Math.abs(dy);
  var qx=cx+dx*s, qy=cy+dy*s, ax, ay, bx, by, ix=0, iy=0, mv=lw*3;
  if(vert){ ax=qx; ay=qy-hw; bx=qx; by=qy+hw; ix=dx>0?-mv:mv; }
  else{ ax=qx-hw; ay=qy; bx=qx+hw; by=qy; iy=dy>0?-mv:mv; }
  c.beginPath(); c.moveTo(ax+ix,ay+iy); c.lineTo(ax,ay); c.lineTo(b.px,b.py); c.lineTo(bx,by); c.lineTo(bx+ix,by+iy); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(ax,ay); c.lineTo(b.px,b.py); c.lineTo(bx,by); c.stroke();
}
function desenharBalao(c,b,lw){
  if(b.tipo==="sfx"){desenharSfx(c,b);return;}
  var cx=b.x+b.w/2, cy=b.y+b.h/2, rx=b.w/2, ry=b.h/2, t=b.tipo, i;
  c.save(); c.lineJoin="round"; c.lineCap="round"; c.lineWidth=lw; c.strokeStyle="#111"; c.fillStyle="#fff";
  if(t==="narracao"){
    c.fillStyle="#fffbe8"; c.fillRect(b.x,b.y,b.w,b.h); c.strokeRect(b.x,b.y,b.w,b.h);
  }else if(t==="off"){
    c.beginPath();
    if(c.roundRect) c.roundRect(b.x,b.y,b.w,b.h,Math.min(rx,ry)*0.35); else c.rect(b.x,b.y,b.w,b.h);
    c.fill(); c.stroke(); caudaRet(c,b,lw);
  }else if(t==="grito"){
    c.beginPath();
    var n=22;
    for(i=0;i<n*2;i++){
      var ang=Math.PI*i/n, k=(i%2?0.74:1.06)*(1+0.07*Math.sin(i*12.9898));
      var px=cx+rx*k*Math.cos(ang), py=cy+ry*k*Math.sin(ang);
      if(i) c.lineTo(px,py); else c.moveTo(px,py);
    }
    c.closePath(); c.fill(); c.stroke(); cauda(c,b,cx,cy,rx,ry,lw,0.78);
  }else if(t==="pensamento"){
    var m=16;
    c.beginPath();
    for(i=0;i<m;i++){
      var a0=TAU*i/m, a1=TAU*(i+1)/m, am=(a0+a1)/2;
      if(!i) c.moveTo(cx+rx*0.94*Math.cos(a0),cy+ry*0.94*Math.sin(a0));
      c.quadraticCurveTo(cx+rx*1.14*Math.cos(am),cy+ry*1.14*Math.sin(am),cx+rx*0.94*Math.cos(a1),cy+ry*0.94*Math.sin(a1));
    }
    c.closePath(); c.fill(); c.stroke();
    var nx=(b.px-cx)/rx, ny=(b.py-cy)/ry;
    if(Math.hypot(nx,ny)>1.2){
      var tt=Math.atan2(ny,nx), qx=cx+rx*1.05*Math.cos(tt), qy=cy+ry*1.05*Math.sin(tt), rm=Math.min(rx,ry);
      [[0.22,0.15],[0.55,0.10],[0.92,0.065]].forEach(function(p){
        c.beginPath(); c.arc(qx+(b.px-qx)*p[0],qy+(b.py-qy)*p[0],rm*p[1],0,TAU); c.fill(); c.stroke();
      });
    }
  }else{
    if(t==="sussurro") c.setLineDash([lw*2.2,lw*1.8]);
    c.beginPath(); c.ellipse(cx,cy,rx,ry,0,0,TAU); c.fill(); c.stroke();
    cauda(c,b,cx,cy,rx,ry,lw,1);
  }
  c.restore();
  if(b.txt){
    var aj=ajustarTexto(c,b,lw), alt=aj.lin.length*aj.fs*1.2;
    c.save(); c.font=estiloFonte(t,aj.fs); c.fillStyle="#111"; c.textAlign="center"; c.textBaseline="middle";
    aj.lin.forEach(function(s,j){ c.fillText(s,cx,cy-alt/2+aj.fs*1.2*(j+0.5)); });
    c.restore();
  }
}
function desenharBaloes(c,lista,lado){
  var lw=Math.max(2,Math.round(lado/400));
  lista.forEach(function(b){ desenharBalao(c,b,lw); });
}

/* sprites para pincéis macio e lápis */
var SPR={n:0,m:{}};
function criarSprite(tipo,r,cor,grao){
  var d=r*2+2, c=novoCanvas(d,d), x=c.getContext("2d"), rgb=hexRgb(cor);
  if(tipo==="macio"){
    var g=x.createRadialGradient(r+1,r+1,0,r+1,r+1,r);
    g.addColorStop(0,"rgba("+rgb.join(",")+",1)");
    g.addColorStop(0.35,"rgba("+rgb.join(",")+",0.7)");
    g.addColorStop(1,"rgba("+rgb.join(",")+",0)");
    x.fillStyle=g; x.fillRect(0,0,d,d);
  }else{
    var id=x.createImageData(d,d), dt=id.data, i, j;
    for(j=0;j<d;j++) for(i=0;i<d;i++){
      var dx=i-r-0.5, dy=j-r-0.5, dist=Math.sqrt(dx*dx+dy*dy)/r;
      if(dist>1) continue;
      var borda=dist<0.7?1:(1-dist)/0.3;
      var g=Math.random()<(grao||0.55)?(0.45+Math.random()*0.55):0.08;
      var k=(j*d+i)*4;
      dt[k]=rgb[0]; dt[k+1]=rgb[1]; dt[k+2]=rgb[2]; dt[k+3]=Math.round(borda*g*255);
    }
    x.putImageData(id,0,0);
  }
  return c;
}
function sprite(tipo,r,cor,grao){
  var ri=Math.max(1,Math.round(r)), key=tipo+"|"+ri+"|"+cor+"|"+(grao||0), v=SPR.m[key];
  if(!v){
    if(SPR.n>120){ SPR.m={}; SPR.n=0; }
    v=[]; var nv=tipo==="lapis"?3:1, i;
    for(i=0;i<nv;i++) v.push(criarSprite(tipo,ri,cor,grao));
    SPR.m[key]=v; SPR.n++;
  }
  return v[(Math.random()*v.length)|0];
}

/* Pontas de textura em cache: raster pequeno e limitado, ampliado no carimbo. */
var SPR_ESTUDIO={n:0,pixels:0,m:{}};
function valorPonta(vv,nome,padrao){
  var v=vv.aj&&vv.aj[nome]; if(v==null) v=vv.B[nome];
  return typeof v==="number"&&isFinite(v)?v:padrao;
}
function spriteEstudio(B,r,cor,aj){
  var rr=Math.max(2,Math.min(128,Math.round(r/2)*2)), duro=Math.round(clamp(aj.dureza==null?B.dureza:aj.dureza,0,100)/5)*5,
      tex=Math.round(clamp(aj.textura==null?B.textura:aj.textura,0,100)/5)*5;
  var key=B.tipo+"|"+rr+"|"+cor+"|"+duro+"|"+tex, found=SPR_ESTUDIO.m[key]; if(found) return found;
  if(SPR_ESTUDIO.n>=80||SPR_ESTUDIO.pixels>3500000) SPR_ESTUDIO={n:0,pixels:0,m:{}};
  var d=rr*2+2, cv=novoCanvas(d,d), cx=cv.getContext("2d"), im=cx.createImageData(d,d), data=im.data, rgb=hexRgb(cor), tipo=B.tipo, textura=tex/100;
  for(var y=0;y<d;y++) for(var x=0;x<d;x++){
    var nx=(x-rr-1)/rr, ny=(y-rr-1)/rr, dist=Math.hypot(nx,ny), a=0, shape=dist,
        seed=Math.sin(x*127.1+y*311.7+rr*19.3)*43758.5453, noise=seed-Math.floor(seed);
    if(tipo==="cerdas"||tipo==="oleo"||tipo==="chato") shape=Math.max(Math.abs(nx),Math.abs(ny)/.3);
    if(tipo==="tinta") shape=Math.hypot(nx,ny/.68);
    if(shape>1) continue;
    var borda=duro/100; a=shape<=borda?1:Math.max(0,(1-shape)/Math.max(.01,1-borda));
    if(tipo==="aquarela") a=(.2+(.2+.6*borda)*Math.pow(dist,2+6*borda))*Math.min(1,(1-dist)*(6+borda*20));
    if(tipo==="brilho"||tipo==="borrachaMacia") a=Math.pow(Math.max(0,1-dist),1.1+(1-borda)*1.5);
    if(tipo==="carvao") a*=Math.pow(Math.max(0,1-dist),.35);
    if(tipo==="pastel"||tipo==="carvao"||tipo==="giz"){
      var papel=(Math.sin(x*2.6)+Math.cos(y*3.1))*.13;
      a*=noise+papel<textura*.62?.02:(.35+.65*noise);
    }else if(tipo==="pasteloleo") a*=noise<textura*.38?.06:.75+.25*noise;
    else if(tipo==="cerdas"||tipo==="oleo"){
      var cerda=(Math.sin(y*2.1)+1)/2; a*=cerda<textura*.8?.04:(.5+.5*noise);
      if(tipo==="oleo"&&noise<textura*.28) a*=.08;
    }else if(textura) a*=Math.max(.02,1-textura+textura*noise);
    var i=(y*d+x)*4; data[i]=rgb[0]; data[i+1]=rgb[1]; data[i+2]=rgb[2]; data[i+3]=Math.round(clamp(a,0,1)*255);
  }
  cx.putImageData(im,0,0); SPR_ESTUDIO.m[key]=cv; SPR_ESTUDIO.n++; SPR_ESTUDIO.pixels+=d*d; return cv;
}
function motivoDecoracao(c,m,r){
  var i,a,x,y;
  c.beginPath();
  if(m==="estrela"){
    for(i=0;i<10;i++){a=-Math.PI/2+i*Math.PI/5;x=Math.cos(a)*r*(i%2?.43:1);y=Math.sin(a)*r*(i%2?.43:1);if(i)c.lineTo(x,y);else c.moveTo(x,y);} c.closePath(); c.fill();
  }else if(m==="coracao"){
    c.moveTo(0,r*.85); c.bezierCurveTo(-r*1.4,-r*.05,-r*.75,-r*1.25,0,-r*.45); c.bezierCurveTo(r*.75,-r*1.25,r*1.4,-r*.05,0,r*.85); c.fill();
  }else if(m==="flor"){
    for(i=0;i<5;i++){a=i*TAU/5;c.moveTo(Math.cos(a)*r*.5,Math.sin(a)*r*.5);c.ellipse(Math.cos(a)*r*.5,Math.sin(a)*r*.5,r*.5,r*.27,a,0,TAU);} c.fill();
    c.globalCompositeOperation="destination-out";c.beginPath();c.arc(0,0,r*.15,0,TAU);c.fill();c.globalCompositeOperation="source-over";
  }else if(m==="folha"){
    c.moveTo(-r,0);c.quadraticCurveTo(0,-r*.95,r,0);c.quadraticCurveTo(0,r*.95,-r,0);c.fill();
    c.globalCompositeOperation="destination-out";c.lineWidth=Math.max(.7,r*.06);c.beginPath();c.moveTo(-r*.75,0);c.lineTo(r*.75,0);c.stroke();c.globalCompositeOperation="source-over";
  }else if(m==="hachura"){
    c.lineWidth=Math.max(.7,r*.07);c.lineCap="round";
    for(i=-2;i<=2;i++){x=i*r*.33;c.moveTo(x,-r*.65);c.lineTo(x+r*.2,r*.65);}c.stroke();
  }else{
    for(i=0;i<8;i++){a=-Math.PI/2+i*Math.PI/4;x=Math.cos(a)*r*(i%2?.2:1);y=Math.sin(a)*r*(i%2?.2:1);if(i)c.lineTo(x,y);else c.moveTo(x,y);}c.closePath();c.fill();
  }
}
function spriteMotivo(m,r,cor){
  var rr=Math.max(2,Math.min(128,Math.round(r))), key="motivo|"+m+"|"+rr+"|"+cor, cv=SPR_ESTUDIO.m[key]; if(cv) return cv;
  if(SPR_ESTUDIO.n>=80||SPR_ESTUDIO.pixels>3500000) SPR_ESTUDIO={n:0,pixels:0,m:{}};
  cv=novoCanvas(rr*2+4,rr*2+4);var c=cv.getContext("2d");c.translate(rr+2,rr+2);c.fillStyle=cor;c.strokeStyle=cor;motivoDecoracao(c,m,rr);
  SPR_ESTUDIO.m[key]=cv;SPR_ESTUDIO.n++;SPR_ESTUDIO.pixels+=cv.width*cv.height;return cv;
}

/* ---------- grupos de ferramentas (caixa de ferramentas à esquerda) ---------- */
var GRUPOS=[
  {id:"sel",nome:"Selecionar",ferrs:["selecionar"]},
  {id:"mao",nome:"Mão",ferrs:["mao"]},
  {id:"gota",nome:"Conta-gotas",ferrs:["gota"]},
  {id:"lapis",nome:"Lápis",ferrs:["lapis"].concat(GRAUS_LAPIS.map(function(g){return "lapis"+g[0];}),["esfero"]),sep:true},
  {id:"lapiseira",nome:"Lapiseira",ferrs:LAPISSEIRAS.map(function(g){return "lapiseira"+g[0];})},
  {id:"caneta",nome:"Canetas / Pen",ferrs:["caneta","penMaru","penKabura","penBrush","penCaligrafica"].concat(PONTAS_CANETA.map(function(p){return "caneta"+p[0];}),["nanquim","marcador"])},
  {id:"pincel",nome:"Pincéis de pintura",ferrs:["guache","pincelChato","aquarela","oleo","pincel","seco"]},
  {id:"pastel",nome:"Pastel e carvão",ferrs:["pastelSuave","pastelOleo","giz","carvao"]},
  {id:"aero",nome:"Aerógrafos",ferrs:["aerografo","aeroDuro","aeroParticulas","aeroBrilho"]},
  {id:"deco",nome:"Decorações",ferrs:["decoEstrela","decoCoracao","decoFlor","decoFolha","decoBrilho","decoHachura"]},
  {id:"mistura",nome:"Misturar",ferrs:["esfumar"]},
  {id:"borr",nome:"Borrachas",ferrs:["borracha","borrachaMacia"]},
  {id:"forma",nome:"Figura e guia",ferrs:["linha","retangulo","elipse","triangulo","hexagono","cubo","cilindro","cone","piramide","prisma","esfera"],sep:true},
  {id:"balde",nome:"Balde",ferrs:["balde"]},
  {id:"balao",nome:"Balão",ferrs:["balao"]}
];
var ICO={
  sel:'<rect x="4" y="4" width="16" height="16" stroke-dasharray="3 2.4"/><path d="M10 10l7 3-3 1-1 3z" fill="currentColor"/>',
  mao:'<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  gota:'<path d="M15 4l5 5-2.2 2.2-5-5zM13.2 7.6L5 15.8V19h3.2l8.2-8.2"/>',
  lapis:'<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>',
  lapiseira:'<path d="M5 19l2-5L17 4l3 3L10 17zM7 14l3 3M14 7l3 3M4 20l3-1"/>',
  caneta:'<path d="M12 3l5 8-5 10-5-10z"/><circle cx="12" cy="11" r="1.6"/><path d="M12 12.6V21"/>',
  pincel:'<path d="M19 4L11 12"/><path d="M11 12c-3 0-4.5 2-4.5 4 0 1.4-1 2.6-2.5 3.6 3.6.6 8-.4 8-4.6 0-1.2-.4-2.2-1-3z"/>',
  pastel:'<path d="M4 16L15 4l5 5L9 21zM11 9l5 5M4 16l5 5M3 22h18"/>',
  aero:'<path d="M4 7h10v7H4zM9 14v7M14 10h3M18 5h1m1 4h1m-3 4h1m1 4h1M7 7V3h5v4"/>',
  deco:'<path d="M12 2l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
  mistura:'<path d="M4 7c5-7 11 7 16 0M4 12c5-7 11 7 16 0M4 17c5-7 11 7 16 0"/>',
  borr:'<path d="M3.5 15.5l9-10 8 8-6 7H8.5zM8.5 10.5l8 8"/>',
  forma:'<rect x="3" y="11" width="10" height="10"/><circle cx="16" cy="8" r="5"/>',
  balde:'<path d="M5 11l7-7 7 7-7 7z"/><path d="M20 15c1.2 1.8 1.2 3.6 0 3.6s-1.2-1.8 0-3.6z" fill="currentColor"/>',
  balao:'<path d="M4 5h16v11h-9l-4 4v-4H4z"/>'
};
var PREV={lapis:[1.3,.85,0],lapis6b:[3.4,.6,0],esfero:[1.5,1,0],caneta:[2.6,1,0],nanquim:[1.8,1,0],marcador:[7,.45,0],
  aerografo:[9,.28,1],pincel:[6,.55,0],seco:[6,.5,2],esfumar:[7,.25,1],borracha:[6,.35,0]};
/* Cada ponta de caneta também recebe uma amostra de traço na lista de subferramentas. */
PONTAS_CANETA.forEach(function(p){
  var id="caneta"+p[0], brush=p[0]==="BR";
  PREV[id]=[Math.max(1.1,Math.min(7,p[2]*0.16)),brush?0.82:1,brush?1:0];
});
/* Cada graduação recebe uma amostra própria, como a amostra original do 6B. */
GRAUS_LAPIS.forEach(function(g){
  PREV["lapis"+g[0]]=[Math.max(1.1,Math.min(5,g[2]*0.2)),g[3]/100,0];
});
LAPISSEIRAS.forEach(function(g){
  PREV["lapiseira"+g[0]]=[Math.max(1.1,Math.min(3.2,g[3]*0.65)),g[4]/100,0];
});
function prevSVG(f){
  var p=PREV[f], d="M4 12C14 2 22 17 34 9S52 3 62 10 72 12 76 7";
  if(p) return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="'+d+'" fill="none" stroke="currentColor" stroke-width="'+p[0]+'" stroke-linecap="round" opacity="'+p[1]+'"'+
    (p[2]===1?' style="filter:blur(2px)"':'')+(p[2]===2?' stroke-dasharray="1.5 2.5"':'')+'/></svg>';
  var o='fill="none" stroke="currentColor" stroke-width="1.6"';
  if(f==="linha") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M6 15L74 3" '+o+' stroke-linecap="round"/></svg>';
  if(f==="retangulo") return '<svg viewBox="0 0 80 18" aria-hidden="true"><rect x="8" y="2" width="64" height="14" '+o+'/></svg>';
  if(f==="elipse"||f==="esfera") return '<svg viewBox="0 0 80 18" aria-hidden="true"><ellipse cx="40" cy="9" rx="32" ry="7" '+o+'/></svg>';
  if(f==="triangulo") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M40 2L72 16H8z" '+o+'/></svg>';
  if(f==="hexagono") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M20 2H60L75 9 60 16H20L5 9z" '+o+'/></svg>';
  if(f==="cubo") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M14 6L42 2 67 7V14L39 17 14 13zM42 2v8m25-3L42 10 14 6" '+o+'/></svg>';
  if(f==="cilindro") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M18 5c0-4 44-4 44 0v8c0 4-44 4-44 0zM18 5c0 4 44 4 44 0" '+o+'/></svg>';
  if(f==="cone") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M40 2L16 14c0 3 48 3 48 0zM16 14c0-3 48-3 48 0" '+o+'/></svg>';
  if(f==="piramide") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M40 2L12 15h56zM40 2l-7 13m7-13 10 13M12 15l28-4 28 4" '+o+'/></svg>';
  if(f==="prisma") return '<svg viewBox="0 0 80 18" aria-hidden="true"><path d="M18 5l20-3 24 5v8l-20 3-24-5zM18 5l24 5 20-3M42 10v8" '+o+'/></svg>';
  return "";
}
/* Manequim articulado: malhas 3D, hierarquia de articulações e câmera em
   perspectiva. Funciona localmente, sem modelos ou bibliotecas externas. */
/* ---------- retículas procedurais, transparentes e ancoradas na folha ---------- */
var RETICULA=(function(){
  function numero(n,a,b,p){n=+n;return isFinite(n)?Math.max(a,Math.min(b,n)):p;}
  function normalizar(raw){raw=raw||{};return {tipo:["pontos","linhas","hachura","degrade"].indexOf(raw.tipo)>-1?raw.tipo:"pontos",tamanho:numero(raw.tamanho,1,24,4),espaco:numero(raw.espaco,4,64,12),angulo:numero(raw.angulo,-90,90,45),intensidade:numero(raw.intensidade,10,100,100)};}
  function pintar(cv,raw,area){
    var cfg=normalizar(raw),c=cv.getContext("2d"),w=cv.width,h=cv.height;
    c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation="source-over";c.clearRect(0,0,w,h);if(w<1||h<1)return;
    var tile=document.createElement("canvas"),passo=Math.round(cfg.espaco);tile.width=tile.height=passo;
    var t=tile.getContext("2d"),tam=Math.min(cfg.tamanho,passo*.94);t.fillStyle="#000";t.strokeStyle="#000";
    if(cfg.tipo==="pontos"||cfg.tipo==="degrade"){t.beginPath();t.arc(passo/2,passo/2,tam/2,0,Math.PI*2);t.fill();}
    else{t.fillRect(0,(passo-tam)/2,passo,tam);if(cfg.tipo==="hachura")t.fillRect((passo-tam)/2,0,tam,passo);}
    c.save();if(area)caminhoSelecao(c,area);
    c.globalAlpha=cfg.intensidade/100;c.rotate(cfg.angulo*Math.PI/180);c.fillStyle=c.createPattern(tile,"repeat");
    var alcance=Math.ceil(Math.hypot(w,h));c.fillRect(-alcance,-alcance,alcance*2,alcance*2);c.restore();
    if(cfg.tipo==="degrade"){
      var y=area?area.y:0,ah=Math.max(1,area?area.h:h),grad=c.createLinearGradient(0,y,0,y+ah);grad.addColorStop(0,"rgba(0,0,0,1)");grad.addColorStop(1,"rgba(0,0,0,0)");
      c.save();c.globalCompositeOperation="destination-in";c.fillStyle=grad;c.fillRect(0,0,w,h);c.restore();
    }
  }
  return {normalizar:normalizar,pintar:pintar};
})();
var RETICULA_CFG=RETICULA.normalizar(null);
try{RETICULA_CFG=RETICULA.normalizar(JSON.parse(localStorage.getItem("mesa.ed.reticula.v1")||"null"));}catch(e){}
var M3D=(function(){
  var rad=Math.PI/180, TAU3=Math.PI*2;
  var partes=[["quadril","Quadril"],["tronco","Tronco"],["cabeca","Cabeça"],["bracoE","Braço esquerdo"],["antebracoE","Antebraço esquerdo"],["maoE","Mão esquerda"],["bracoD","Braço direito"],["antebracoD","Antebraço direito"],["maoD","Mão direita"],["coxaE","Coxa esquerda"],["pernaE","Perna esquerda"],["peE","Pé esquerdo"],["coxaD","Coxa direita"],["pernaD","Perna direita"],["peD","Pé direito"]];
  var poses=[["neutro","Em pé"],["t","Braços abertos"],["corrida","Corrida"],["acao","Ação"],["sentado","Sentado"]];
  var limites={quadril:[[-45,45],[-90,90],[-35,35]],tronco:[[-65,65],[-70,70],[-45,45]],cabeca:[[-55,55],[-80,80],[-40,40]],braco:[[-170,100],[-90,90],[-170,170]],antebraco:[[-155,20],[-80,80],[-20,20]],mao:[[-70,70],[-80,80],[-45,45]],coxa:[[-130,50],[-55,55],[-60,60]],perna:[[0,155],[-20,20],[-12,12]],pe:[[-45,55],[-35,35],[-25,25]]};
  function lim(n,a,b,f){return typeof n==="number"&&isFinite(n)?Math.max(a,Math.min(b,n)):f;}
  function add(a,b){return[a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
  function sub(a,b){return[a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function muls(a,s){return[a[0]*s,a[1]*s,a[2]*s];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function cross(a,b){return[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function unit(a){var l=Math.hypot(a[0],a[1],a[2]);return l>1e-9?muls(a,1/l):[0,1,0];}
  function mat(a){
    var x=(a[0]||0)*rad,y=(a[1]||0)*rad,z=(a[2]||0)*rad,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
    return[cz*cy,cz*sy*sx-sz*cx,cz*sy*cx+sz*sx,sz*cy,sz*sy*sx+cz*cx,sz*sy*cx-cz*sx,-sy,cy*sx,cy*cx];
  }
  function mm(a,b){var out=[];for(var r=0;r<3;r++)for(var c=0;c<3;c++)out[r*3+c]=a[r*3]*b[c]+a[r*3+1]*b[3+c]+a[r*3+2]*b[6+c];return out;}
  function mv(m,p){return[m[0]*p[0]+m[1]*p[1]+m[2]*p[2],m[3]*p[0]+m[4]*p[1]+m[5]*p[2],m[6]*p[0]+m[7]*p[1]+m[8]*p[2]];}
  function ponto(f,p){return add(f.o,mv(f.m,p));}
  function frame(f,p,a){return{o:ponto(f,p),m:mm(f.m,mat(a||[0,0,0]))};}
  function limitesParte(id){return limites[id]||limites[id.replace(/[ED]$/,"")]||[[-180,180],[-180,180],[-180,180]];}
  function posicionamento(raw){raw=raw||{};return{escala:lim(raw.escala,.15,1.5,.82),x:lim(raw.x,0,1,.5),y:lim(raw.y,0,1,.5),rot:lim(raw.rot,-180,180,0),op:lim(raw.op,5,100,40)};}
  function padrao(){
    var joints={};partes.forEach(function(p){joints[p[0]]=[0,0,0];});joints.bracoE[2]=10;joints.bracoD[2]=-10;
    return{pose:"neutro",joints:joints,camera:{yaw:25,pitch:10,zoom:1,perspective:1},proporcoes:{altura:1,ombros:1,quadril:1,cabeca:1},estilo:"volume"};
  }
  function normalizar(raw){
    var s=padrao();raw=raw&&typeof raw==="object"?raw:{};
    if(raw.pose==="personalizada"||poses.some(function(p){return p[0]===raw.pose;}))s.pose=raw.pose;
    partes.forEach(function(p){var a=raw.joints&&raw.joints[p[0]],l=limitesParte(p[0]);if(Array.isArray(a))s.joints[p[0]]=a.slice(0,3).map(function(n,i){return lim(n,l[i][0],l[i][1],s.joints[p[0]][i]);});while(s.joints[p[0]].length<3)s.joints[p[0]].push(0);});
    var c=raw.camera||{},pr=raw.proporcoes||{};
    var yaw=typeof c.yaw==="number"&&isFinite(c.yaw)?((c.yaw+180)%360+360)%360-180:25;
    s.camera={yaw:yaw,pitch:lim(c.pitch,-70,70,10),zoom:lim(c.zoom,.6,1.8,1),perspective:lim(c.perspective,0,1,1)};
    s.proporcoes={altura:lim(pr.altura,.7,1.3,1),ombros:lim(pr.ombros,.65,1.45,1),quadril:lim(pr.quadril,.65,1.4,1),cabeca:lim(pr.cabeca,.7,1.65,1)};
    if(["volume","contorno","esqueleto"].indexOf(raw.estilo)>-1)s.estilo=raw.estilo;
    return s;
  }
  function aplicarPose(state,id){
    var z=padrao().joints;state.joints=z;state.pose=poses.some(function(p){return p[0]===id;})?id:"neutro";
    if(id==="t"){z.bracoE=[0,0,90];z.bracoD=[0,0,-90];}
    else if(id==="corrida"){
      z.tronco=[-15,8,-6];z.cabeca=[10,-8,0];z.bracoE=[-72,0,18];z.antebracoE=[-95,0,0];z.bracoD=[62,0,-18];z.antebracoD=[-96,0,0];z.coxaE=[-64,0,5];z.pernaE=[76,0,0];z.coxaD=[36,0,-7];z.pernaD=[115,0,0];z.peD=[-20,0,0];
    }else if(id==="acao"){
      z.quadril=[0,15,-8];z.tronco=[-10,-25,12];z.cabeca=[0,18,-5];z.bracoE=[-100,0,48];z.antebracoE=[-62,0,0];z.bracoD=[-65,12,-30];z.antebracoD=[-110,0,0];z.coxaE=[-35,5,28];z.pernaE=[50,0,0];z.coxaD=[-10,-10,-30];z.pernaD=[16,0,0];
    }else if(id==="sentado"){
      z.coxaE=[-90,0,5];z.coxaD=[-90,0,-5];z.pernaE=[90,0,0];z.pernaD=[90,0,0];z.bracoE=[-20,0,4];z.bracoD=[-20,0,-4];z.antebracoE=[-70,0,0];z.antebracoD=[-70,0,0];
    }
    return state;
  }
  function geometria(raw){
    var s=normalizar(raw),faces=[],bones=[],joints={},pontos=[],pr=s.proporcoes,h=pr.altura;
    function face(id,ps){faces.push({id:id,pts:ps});ps.forEach(function(p){pontos.push(p);});}
    function ell(id,f,ra){
      var rings=12,n=20,verts=[],i,j;
      for(i=0;i<=rings;i++){var ph=-Math.PI/2+Math.PI*i/rings,row=[];for(j=0;j<n;j++){var th=TAU3*j/n;row.push(ponto(f,[ra[0]*Math.cos(ph)*Math.cos(th),ra[1]*Math.sin(ph),ra[2]*Math.cos(ph)*Math.sin(th)]));}verts.push(row);}
      for(i=0;i<rings;i++)for(j=0;j<n;j++)face(id,[verts[i][j],verts[i+1][j],verts[i+1][(j+1)%n],verts[i][(j+1)%n]]);
    }
    function tube(id,a,b,r0,r1){
      var axis=unit(sub(b,a)),u=unit(cross(axis,Math.abs(axis[2])>.9?[1,0,0]:[0,0,1])),v=cross(axis,u),n=14,va=[],vb=[];
      for(var j=0;j<n;j++){var t=TAU3*j/n,d=add(muls(u,Math.cos(t)),muls(v,Math.sin(t)));va.push(add(a,muls(d,r0)));vb.push(add(b,muls(d,r1)));}
      for(j=0;j<n;j++)face(id,[va[j],va[(j+1)%n],vb[(j+1)%n],vb[j]]);
      face(id,va.slice().reverse());face(id,vb);
    }
    function perfil(id,f,aneis){
      var n=22,vs=aneis.map(function(a){var row=[];for(var j=0;j<n;j++){var t=TAU3*j/n;row.push(ponto(f,[Math.cos(t)*a[1],a[0],Math.sin(t)*a[2]+(a[3]||0)]));}return row;});
      for(var i=0;i<vs.length-1;i++)for(var j=0;j<n;j++)face(id,[vs[i][j],vs[i+1][j],vs[i+1][(j+1)%n],vs[i][(j+1)%n]]);
      face(id,vs[0].slice().reverse());face(id,vs[vs.length-1]);
    }
    function membro(id,f,len,raios){
      perfil(id,f,raios.map(function(r,i){return[-len+len*i/(raios.length-1),r[0],r[1]];}));
    }
    function joint(id,f){joints[id]=f.o.slice();}
    function bone(id,a,b){bones.push({id:id,a:a,b:b});}
    var root={o:[0,1.95*h,0],m:mat(s.joints.quadril)};
    joint("quadril",root);ell("quadril",root,[.32*pr.quadril,.245*h,.215]);
    var trunk=frame(root,[0,.12*h,0],s.joints.tronco);joint("tronco",frame(trunk,[0,.46*h,0]));
    perfil("tronco",trunk,[[.02*h,.255,.17],[.17*h,.235,.165],[.30*h,.26,.18],[.45*h,.335*pr.ombros,.215],[.64*h,.405*pr.ombros,.235],[.80*h,.405*pr.ombros,.21],[.91*h,.29*pr.ombros,.155],[.98*h,.105,.10]]);
    var neck=frame(trunk,[0,.96*h,0]);tube("cabeca",neck.o,ponto(neck,[0,.19*h,0]),.105,.087);
    var head=frame(trunk,[0,1.13*h,0],s.joints.cabeca);joint("cabeca",head);
    var hc=pr.cabeca;perfil("cabeca",head,[[-.035,.065,.095,.04],[.025,.12,.15,.045],[.10,.18,.185,.025],[.20,.218,.215,0],[.32,.22,.22,-.014],[.43,.175,.185,-.018],[.49,.075,.09,-.018],[.51,.006,.006,-.018]].map(function(a){return a.map(function(v){return v*hc;});}));
    ell("cabeca",frame(head,[0,.18*hc,.205*hc]),[.035*hc,.044*hc,.06*hc]);
    ell("cabeca",frame(head,[.215*hc,.22*hc,-.005*hc]),[.035*hc,.068*hc,.04*hc]);ell("cabeca",frame(head,[-.215*hc,.22*hc,-.005*hc]),[.035*hc,.068*hc,.04*hc]);
    bone("tronco",root.o,neck.o);bone("cabeca",neck.o,ponto(head,[0,.30*pr.cabeca,0]));
    ["E","D"].forEach(function(side){
      var sign=side==="E"?1:-1,arm=frame(trunk,[sign*.45*pr.ombros,.81*h,0],s.joints["braco"+side]);joint("braco"+side,arm);
      ell("braco"+side,arm,[.145,.15,.145]);var elbow=ponto(arm,[0,-.58*h,0]);membro("braco"+side,arm,.58*h,[[.088,.085],[.105,.105],[.132,.125],[.14,.13]]);bone("braco"+side,arm.o,elbow);
      var fore=frame(arm,[0,-.58*h,0],s.joints["antebraco"+side]);joint("antebraco"+side,fore);ell("antebraco"+side,fore,[.108,.108,.108]);
      var wrist=ponto(fore,[0,-.54*h,0]);membro("antebraco"+side,fore,.54*h,[[.062,.06],[.078,.075],[.112,.10],[.10,.095]]);bone("antebraco"+side,fore.o,wrist);
      var hand=frame(fore,[0,-.54*h,0],s.joints["mao"+side]);joint("mao"+side,hand);ell("mao"+side,frame(hand,[0,-.12*h,0]),[.087,.155*h,.048]);ell("mao"+side,frame(hand,[-sign*.065,-.07*h,.025]),[.043,.075*h,.04]);bone("mao"+side,hand.o,ponto(hand,[0,-.26*h,0]));
      var thigh=frame(root,[sign*.22*pr.quadril,-.14*h,0],s.joints["coxa"+side]);joint("coxa"+side,thigh);ell("coxa"+side,thigh,[.155,.155,.155]);
      var knee=ponto(thigh,[0,-.84*h,0]);membro("coxa"+side,thigh,.84*h,[[.105,.108],[.15,.155],[.18,.175],[.16,.16]]);bone("coxa"+side,thigh.o,knee);
      var shin=frame(thigh,[0,-.84*h,0],s.joints["perna"+side]);joint("perna"+side,shin);ell("perna"+side,shin,[.125,.125,.125]);
      var ankle=ponto(shin,[0,-.79*h,0]);membro("perna"+side,shin,.79*h,[[.066,.07],[.083,.09],[.13,.13],[.112,.115]]);bone("perna"+side,shin.o,ankle);
      var foot=frame(shin,[0,-.79*h,0],s.joints["pe"+side]);joint("pe"+side,foot);ell("pe"+side,frame(foot,[0,-.065*h,.12]),[.115,.105*h,.245]);bone("pe"+side,foot.o,ponto(foot,[0,-.065*h,.28]));
    });
    var minY=Infinity;pontos.forEach(function(p){minY=Math.min(minY,p[1]);});
    var off=isFinite(minY)?minY:0;
    // Shared mesh vertices are translated only once.
    var moved=new Set();pontos.forEach(function(p){if(!moved.has(p)){p[1]-=off;moved.add(p);}});
    Object.keys(joints).forEach(function(id){joints[id][1]-=off;});
    bones.forEach(function(b){b.a=[b.a[0],b.a[1]-off,b.a[2]];b.b=[b.b[0],b.b[1]-off,b.b[2]];});
    return{faces:faces,bones:bones,joints:joints,pontos:pontos};
  }
  function desenhar(canvas,raw,opts){
    opts=opts||{};var s=normalizar(raw),g=geometria(s),c=canvas.getContext("2d"),W=canvas.width,H=canvas.height;
    c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);if(W<2||H<2)return[];
    var min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    g.pontos.forEach(function(p){for(var i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}});
    var center=[(min[0]+max[0])/2,(min[1]+max[1])/2,(min[2]+max[2])/2],cam=mat([s.camera.pitch,-s.camera.yaw,0]),distance=7.5/Math.max(.05,s.camera.perspective);
    function view(p){return mv(cam,sub(p,center));}
    function flat(v){var k=s.camera.perspective?distance/Math.max(distance*.22,distance-v[2]):1;return[v[0]*k,-v[1]*k];}
    var fmin=[Infinity,Infinity],fmax=[-Infinity,-Infinity];g.pontos.forEach(function(p){var q=flat(view(p));for(var i=0;i<2;i++){fmin[i]=Math.min(fmin[i],q[i]);fmax[i]=Math.max(fmax[i],q[i]);}});
    var margin=Math.max(16,Math.min(W,H)*.08),scale=Math.min((W-2*margin)/Math.max(.1,fmax[0]-fmin[0]),(H-2*margin)/Math.max(.1,fmax[1]-fmin[1]))*(opts.exportar?1:s.camera.zoom);
    var cx=(fmin[0]+fmax[0])/2,cy=(fmin[1]+fmax[1])/2;
    function screen(v){var q=flat(v);return[W/2+(q[0]-cx)*scale,H/2+(q[1]-cy)*scale];}
    function line3(a,b,color,width){var p=screen(view(a)),q=screen(view(b));c.beginPath();c.moveTo(p[0],p[1]);c.lineTo(q[0],q[1]);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
    if(!opts.exportar){
      c.fillStyle="#f8fafc";c.fillRect(0,0,W,H);c.save();c.beginPath();c.rect(0,0,W,H);c.clip();
      for(var k=-6;k<=6;k++){line3([k*.4,0,-2.4],[k*.4,0,2.4],"#e1e6ed",1);line3([-2.4,0,k*.4],[2.4,0,k*.4],"#e1e6ed",1);}c.restore();
    }
    if(s.estilo!=="esqueleto"){
      var prepared=[],edges={},light=unit([-.45,.8,.7]);
      function key(id,a,b){var aa=a.map(function(v){return v.toFixed(5);}).join(","),bb=b.map(function(v){return v.toFixed(5);}).join(",");return id+"|"+(aa<bb?aa+"|"+bb:bb+"|"+aa);}
      g.faces.forEach(function(f){
        var vs=f.pts.map(view),n=unit(cross(sub(vs[1],vs[0]),sub(vs[2],vs[0]))),front=n[2]>0,face={id:f.id,vs:vs,depth:vs.reduce(function(a,p){return a+p[2];},0)/vs.length,n:n,front:front,edges:[]};
        for(var j=0;j<vs.length;j++){var ek=key(f.id,f.pts[j],f.pts[(j+1)%vs.length]);(edges[ek]||(edges[ek]=[])).push(front);face.edges.push(ek);}prepared.push(face);
      });
      prepared.filter(function(f){return f.front;}).sort(function(a,b){return a.depth-b.depth;}).forEach(function(f){
        var ps=f.vs.map(screen),shade=.58+.42*Math.max(0,dot(f.n,light)),sel=!opts.exportar&&f.id===opts.selecionado,base=sel?[124,169,213]:[222,213,198];
        c.beginPath();ps.forEach(function(p,i){if(i)c.lineTo(p[0],p[1]);else c.moveTo(p[0],p[1]);});c.closePath();
        c.fillStyle=s.estilo==="contorno"?"#fffdf9":"rgb("+base.map(function(v){return Math.round(v*shade);}).join(",")+")";c.fill();
        c.strokeStyle=c.fillStyle;c.lineWidth=.65;c.stroke();
        for(var j=0;j<ps.length;j++){var e=edges[f.edges[j]],outline=e.length===1||e.some(function(v){return!v;});if(outline){var a=ps[j],b=ps[(j+1)%ps.length];c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.strokeStyle=sel?"#2d72b8":"#655e54";c.lineWidth=Math.max(.7,W/750);c.stroke();}}
      });
    }else{
      g.bones.slice().sort(function(a,b){return(view(a.a)[2]+view(a.b)[2])-(view(b.a)[2]+view(b.b)[2]);}).forEach(function(b){line3(b.a,b.b,!opts.exportar&&b.id===opts.selecionado?"#2878be":"#4a6075",Math.max(2,W/170));});
      var hp=screen(view(g.joints.cabeca));c.beginPath();c.ellipse(hp[0],hp[1]-scale*.12,scale*.21*s.proporcoes.cabeca,scale*.30*s.proporcoes.cabeca,0,0,TAU3);c.strokeStyle="#4a6075";c.lineWidth=2;c.stroke();
    }
    var hits=partes.map(function(p){var v=view(g.joints[p[0]]),q=screen(v);return{id:p[0],x:q[0],y:q[1],depth:v[2]};}).sort(function(a,b){return b.depth-a.depth;});
    if(!opts.exportar){hits.forEach(function(p){var sel=p.id===opts.selecionado;c.beginPath();c.arc(p.x,p.y,sel?7:3,0,TAU3);c.fillStyle=sel?"#1673b9":"rgba(38,104,164,.65)";c.fill();if(sel){c.lineWidth=2;c.strokeStyle="#fff";c.stroke();}});}
    return hits;
  }
  function colocar(canvas,raw,local,opts){
    opts=opts||{};var p=posicionamento(local),c=canvas.getContext("2d"),W=canvas.width,H=canvas.height,modelo=opts.modelo;
    if(!modelo){modelo=document.createElement("canvas");modelo.width=800;modelo.height=1100;desenhar(modelo,raw,{exportar:true});}
    var k=Math.min(W/modelo.width,H/modelo.height)*p.escala,w=modelo.width*k,h=modelo.height*k;
    c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation="source-over";c.clearRect(0,0,W,H);
    c.save();c.translate(W*p.x,H*p.y);c.rotate(p.rot*rad);if(opts.opacidade)c.globalAlpha=p.op/100;c.drawImage(modelo,-w/2,-h/2,w,h);c.restore();
    return{x:W*p.x-w/2,y:H*p.y-h/2,w:w,h:h,rot:p.rot};
  }
  return{padrao:padrao,normalizar:normalizar,posicionamento:posicionamento,colocar:colocar,aplicarPose:aplicarPose,desenhar:desenhar,geometria:geometria,partes:partes,poses:poses,limitesParte:limitesParte};
})();
var POSES_MANEQUIM={neutro:{nome:"Neutro",bracos:0,pernas:0,tronco:0},acao:{nome:"Ação",bracos:-.55,pernas:.35,tronco:-.12},corrida:{nome:"Corrida",bracos:.7,pernas:-.65,tronco:.18},perfil:{nome:"Perfil",bracos:.18,pernas:.1,tronco:.25}};
function salvarEstudo(){ try{ localStorage.setItem("mesa.ed.guia",JSON.stringify(CFG.guia)); localStorage.setItem("mesa.ed.manequim",JSON.stringify(CFG.manequim)); }catch(e){} }
try{ var guiaGuardada=JSON.parse(localStorage.getItem("mesa.ed.guia")||"null"), manequimGuardado=JSON.parse(localStorage.getItem("mesa.ed.manequim")||"null"); if(guiaGuardada) Object.assign(CFG.guia,guiaGuardada); if(manequimGuardado) Object.assign(CFG.manequim,manequimGuardado); }catch(e){}
function atalhoDe(f){ for(var i=0;i<FERRS.length;i++) if(FERRS[i]&&FERRS[i][0]===f) return FERRS[i][2]; return ""; }
function grupoDe(f){ for(var i=0;i<GRUPOS.length;i++) if(GRUPOS[i].ferrs.indexOf(f)>-1) return GRUPOS[i]; return GRUPOS[0]; }
function filtrarFerramentas(){
  if(!S) return;
  var busca=String(E.buscaFerr&&E.buscaFerr.value||"").toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g,""), grupo=grupoDe(S.ferr), total=0;
  qa("[data-sg]").forEach(function(el){
    var noGrupo=el.getAttribute("data-sg")===grupo.id, visiveis=0;
    Array.prototype.forEach.call(el.querySelectorAll("[data-ferr]"),function(bt){
      var id=bt.getAttribute("data-ferr"), nome=(nomeFerr(id)+" "+(PINCEIS[id]&&PINCEIS[id].dica||"")).toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g,""), vis=busca?nome.indexOf(busca)>-1:noGrupo;
      bt.classList.toggle("oculto",!vis); if(vis) visiveis++;
    });
    el.classList.toggle("oculto",!visiveis); total+=visiveis;
  });
  if(E.ferrContagem) E.ferrContagem.textContent=total?total+" ferramenta(s) · "+(busca?"busca em todas as categorias":grupo.nome):"Nenhuma ferramenta encontrada.";
}
function amostraPincel(cv,id,ajuste){
  var b=PINCEIS[id]; if(!cv||!b) return;
  var c=cv.getContext("2d"), largura=cv.width, altura=cv.height, aj=Object.assign({},CFG.ajust[id]||padraoPincel(id),ajuste||{});
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,largura,altura);
  var am=novoCanvas(largura,altura), ac=am.getContext("2d");
  if(b.borracha){ ac.fillStyle="#55627b"; ac.fillRect(0,0,largura,altura); }
  if(b.borracha) ac.globalCompositeOperation="destination-out";
  var v={B:b,L:{cv:am,cx:ac},cv:am,cx:ac,aj:aj,previa:true,tam:Math.min(aj.tam,altura*.43),cor:ajuste?CFG.cor:"#26354a",op:aj.op/100,bb:{x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity},falta:0};
  var x0=altura*.42, x1=largura-altura*.42, y0=altura/2, pts=80, ux=x0,uy=y0;
  if(b.tipo==="esfumar") {ac.fillStyle="#e0a258"; ac.fillRect(0,altura*.28,largura*.6,altura*.45);ac.fillStyle="#5b83b9";ac.fillRect(largura*.45,altura*.28,largura*.55,altura*.45);}
  for(var i=0;i<=pts;i++){
    var t=i/pts, x=x0+(x1-x0)*t,y=y0+Math.sin(t*TAU)*altura*.16,p=pressao({pointerType:"pen",pressure:.25+.75*Math.sin(Math.PI*t)});
    if(i) segmento(v,ux,uy,1,x,y,p); else carimboUm(v,x,y,p);
    ux=x; uy=y;
  }
  c.globalAlpha=aj.op/100; c.drawImage(am,0,0); c.globalAlpha=1;
}
var previaPendente=0;
function atualizarPreviaPincel(){
  if(previaPendente) cancelAnimationFrame(previaPendente);
  previaPendente=requestAnimationFrame(function(){
    previaPendente=0; if(!S||!E.previaTraco) return;
    E.previaTraco.classList.toggle("oculto",!PINCEIS[S.ferr]);
    if(PINCEIS[S.ferr]) amostraPincel(E.previaTraco,S.ferr,CFG.ajust[S.ferr]);
  });
}
function renderMiniaturasPinceis(){
  qa("[data-prev-pincel]").forEach(function(cv){ amostraPincel(cv,cv.getAttribute("data-prev-pincel")); });
}
CFG.ultimo={};
var TAMS_PRE=[1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,60,80,100,150,200];

/* paletas: id, título, lado (L/R) */
var PAINEIS=[["ferr","Sub ferramenta"],["prop","Propriedade da ferramenta"],["tam","Tamanho do pincel"],["cor","Roda de cor"],["sim","Simetria"],
  ["estudio","Estúdio de desenho"],["guias","Guias de construção"],["mat","Material [Balão]"],["nav","Navegador"],["cprop","Propriedade da camada"],["cam","Camadas"]];
var ESTADO_PN={sim:{f:1}};
var INTERFACE_EDITOR={esq:true,dir:true,estudio:false,entorno:"#a4a4a4"};
try{var uiSalva=JSON.parse(localStorage.getItem("mesa.ed.interface.v1")||"null");if(uiSalva){INTERFACE_EDITOR.esq=uiSalva.esq!==false;INTERFACE_EDITOR.dir=uiSalva.dir!==false;if(/^#[0-9a-f]{6}$/i.test(uiSalva.entorno||""))INTERFACE_EDITOR.entorno=uiSalva.entorno;}}catch(e){}
function guardarInterfaceEditor(){try{localStorage.setItem("mesa.ed.interface.v1",JSON.stringify(INTERFACE_EDITOR));}catch(e){}}
function aplicarInterfaceEditor(){
  if(!$ed)return;
  $ed.classList.toggle("esq-recolhida",!INTERFACE_EDITOR.esq);$ed.classList.toggle("dir-recolhida",!INTERFACE_EDITOR.dir);$ed.classList.toggle("usa-estudio",INTERFACE_EDITOR.estudio);
  $ed.style.setProperty("--e-entorno",INTERFACE_EDITOR.entorno);if(E.entornoCor)E.entornoCor.value=INTERFACE_EDITOR.entorno;
  qa('[data-ed="estudio"]').forEach(function(b){b.classList.toggle("ativo",INTERFACE_EDITOR.estudio);b.setAttribute("aria-pressed",String(INTERFACE_EDITOR.estudio));});
  qa('[data-ed="laterais"]').forEach(function(b){b.textContent=INTERFACE_EDITOR.esq||INTERFACE_EDITOR.dir?"Recolher laterais":"Mostrar laterais";b.setAttribute("aria-expanded",String(INTERFACE_EDITOR.esq||INTERFACE_EDITOR.dir));});
  if(S){var sessao=S,cx=(S.pw/2-S.tx)/S.z,cy=(S.ph/2-S.ty)/S.z;S.ajustado=false;requestAnimationFrame(function(){if(S!==sessao)return;ajustarCanvasPalco();S.tx=S.pw/2-cx*S.z;S.ty=S.ph/2-cy*S.z;limitarNavegacao();pedir(true);});}
}
function alternarLateralEditor(lado){if(ED_MOVEL.ativo){abrirPainelMovel(lado==='esq'?'ferr':'camadas');return;}INTERFACE_EDITOR[lado]=!INTERFACE_EDITOR[lado];guardarInterfaceEditor();aplicarInterfaceEditor();}
function alternarLateraisEditor(){
  if(ED_MOVEL.ativo){if(ED_MOVEL.painel)fecharPainelMovel(true);else abrirPainelMovel('mais');return;}
  if(window.matchMedia("(max-width:820px)").matches){E.lat.classList.toggle("aberta");return;}
  var abrir=!(INTERFACE_EDITOR.esq||INTERFACE_EDITOR.dir);INTERFACE_EDITOR.esq=abrir;INTERFACE_EDITOR.dir=abrir;guardarInterfaceEditor();aplicarInterfaceEditor();
}
function abrirEstudioEditor(abrir){
  if(ED_MOVEL.ativo){if(abrir===false)fecharPainelMovel(true);else abrirPainelMovel('estudio');return;}
  INTERFACE_EDITOR.estudio=abrir==null?!INTERFACE_EDITOR.estudio:!!abrir;
  if(INTERFACE_EDITOR.estudio){INTERFACE_EDITOR.esq=true;ESTADO_PN.estudio={o:0,f:0};salvarPn();if(window.matchMedia("(max-width:820px)").matches)E.lat.classList.add("aberta");}
  aplicarPaineis();aplicarInterfaceEditor();if(S)atualizarFerr();
}
function campoInterfaceEditor(r,t){if(r!=="entornoCor")return false;if(/^#[0-9a-f]{6}$/i.test(t.value)){INTERFACE_EDITOR.entorno=t.value;guardarInterfaceEditor();$ed.style.setProperty("--e-entorno",t.value);pedir(true);}return true;}
/* Os painéis móveis reutilizam os próprios controles do editor. Os marcadores
   mantêm a posição original de cada nó ao voltar para a tela do computador. */
var ED_MOVEL={ativo:false,painel:null,origens:[],ferrAnterior:"caneta",canhoto:false,rotulos:true,enquadramentoTeclado:null,tTeclado:0};
try{var prefMovel=JSON.parse(localStorage.getItem("mesa.ed.mobile.v1")||"null");if(prefMovel){ED_MOVEL.canhoto=prefMovel.canhoto===true;ED_MOVEL.rotulos=prefMovel.rotulos!==false;}}catch(e){}
function iconeEditorMovel(nome){
  var icones={caneta:'<path d="m4 20 4-1L20 7l-3-3L5 16zM14 7l3 3"/>',borracha:'<path d="m4 13 9-9 7 7-9 9H8zM8 9l7 7M11 20h10"/>',cor:'<path d="M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12z"/>',camadas:'<path d="m3 8 9-5 9 5-9 5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',mais:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',voltar:'<path d="m14 5-7 7 7 7M7 12h13"/>',fechar:'<path d="m6 6 12 12M6 18 18 6"/>',foco:'<path d="M9 3H3v6M15 3h6v6M3 15v6h6M15 21h6v-6"/>',desfazer:'<path d="M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5"/>',refazer:'<path d="M20 10H10a6 6 0 0 0 0 12M20 10l-5-5M20 10l-5 5"/>',guia:'<path d="M3 20 12 4l9 16zM7 15h10M9 11h6"/>',formas:'<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 5 9-5M12 12v9"/>',balao:'<path d="M4 4h16v12H10l-6 5z"/>',reticula:'<path d="M4 4h16v16H4zM8 4v16M12 4v16M16 4v16M4 8h16M4 12h16M4 16h16"/>',texto:'<path d="M4 5h16M12 5v15M8 20h8"/>',imagem:'<path d="M3 4h18v16H3zM3 16l6-6 5 5 3-3 4 4"/><circle cx="16" cy="8" r="1"/>',pessoa:'<circle cx="12" cy="5" r="3"/><path d="M12 8v7M5 10l7 2 7-2M7 22l5-7 5 7"/>',pagina:'<path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8"/>',ajustes:'<path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 10h6"/>',salvar:'<path d="M4 3h14l3 3v15H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',girar:'<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',zoom:'<path d="M4 4h6M4 4v6M20 4h-6M20 4v6M4 20h6M4 20v-6M20 20h-6M20 20v-6"/>'};
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(icones[nome]||icones.mais)+'</svg>';
}
function htmlEscolhaMovel(painel,icone,texto){return '<button type="button" class="ed-mobile-choice" data-mobile-panel="'+painel+'">'+iconeEditorMovel(icone)+'<span>'+texto+'</span></button>';}
function montarEditorMovel(){
  if(E.mobileBar)return;
  var topo=document.createElement('div');topo.className='ed-mobile-top';
  topo.innerHTML='<button type="button" class="ed-mobile-back" data-mobile-action="voltar" aria-label="Fechar editor">'+iconeEditorMovel('voltar')+'</button><div class="ed-mobile-heading"><strong data-mobile-title>Desenho</strong><small>Um dedo desenha · dois movem e ampliam</small></div><button type="button" class="ed-mobile-focus" data-mobile-action="foco" aria-label="Entrar no modo foco">'+iconeEditorMovel('foco')+'</button><button type="button" class="ed-mobile-openmenu" data-mobile-panel="mais" aria-label="Mais opções do desenho">'+iconeEditorMovel('mais')+'</button>';
  var contexto=document.createElement('div');contexto.className='ed-mobile-context';
  contexto.innerHTML='<button type="button" data-ed="desfazer" aria-label="Desfazer traço">'+iconeEditorMovel('desfazer')+'</button><button type="button" data-ed="refazer" aria-label="Refazer traço">'+iconeEditorMovel('refazer')+'</button><label class="ed-mobile-size"><button type="button" class="ed-mobile-tool-name" data-mobile-panel="prop" aria-label="Ajustar ferramenta atual">Caneta G</button><output data-mobile-size-value>6 px</output><input type="range" min="1" max="200" step="1" data-mobile-size aria-label="Tamanho do traço"></label>';
  $ed.insertBefore(contexto,$ed.firstChild);$ed.insertBefore(topo,contexto);
  var barra=document.createElement('div');barra.className='ed-mobile-bar';barra.setAttribute('role','toolbar');barra.setAttribute('aria-label','Ferramentas de desenho para celular');
  barra.innerHTML='<button type="button" data-mobile-panel="ferr" aria-label="Escolher ferramenta" aria-pressed="false">'+iconeEditorMovel('caneta')+'<span>Ferramenta</span></button><button type="button" data-mobile-action="borracha" aria-label="Alternar borracha e ferramenta de desenho" aria-pressed="false">'+iconeEditorMovel('borracha')+'<span>Borracha</span></button><button type="button" data-mobile-panel="cor" aria-label="Escolher cor" aria-pressed="false"><i class="ed-mobile-swatch" aria-hidden="true"></i><span>Cor</span></button><button type="button" data-mobile-panel="camadas" aria-label="Abrir camadas" aria-pressed="false">'+iconeEditorMovel('camadas')+'<span>Camadas</span></button><button type="button" data-mobile-panel="mais" aria-label="Abrir mais ferramentas" aria-pressed="false">'+iconeEditorMovel('mais')+'<span>Mais</span></button>';
  var sombra=document.createElement('div');sombra.className='ed-mobile-shade';sombra.hidden=true;sombra.setAttribute('data-mobile-action','fechar');sombra.setAttribute('aria-hidden','true');
  var painel=document.createElement('section');painel.className='ed-mobile-sheet';painel.id='edMobileSheet';painel.hidden=true;painel.setAttribute('role','dialog');painel.setAttribute('aria-labelledby','edMobileSheetTitle');
  painel.innerHTML='<header class="ed-mobile-sheet-head"><button type="button" data-mobile-action="voltar-painel" aria-label="Voltar às opções">'+iconeEditorMovel('voltar')+'</button><strong id="edMobileSheetTitle">Ferramentas</strong><button type="button" data-mobile-action="fechar" aria-label="Fechar painel de ferramentas">'+iconeEditorMovel('fechar')+'</button></header><div class="ed-mobile-body"></div>';
  $ed.appendChild(sombra);$ed.appendChild(painel);$ed.appendChild(barra);
  var focoRapido=document.createElement('div');focoRapido.className='ed-foco-rapido';focoRapido.setAttribute('role','toolbar');focoRapido.setAttribute('aria-label','Ações no modo foco');
  focoRapido.innerHTML='<button type="button" class="bt mini" data-ed="desfazer" aria-label="Desfazer no modo foco">↶</button><button type="button" class="bt mini" data-ed="refazer" aria-label="Refazer no modo foco">↷</button><button type="button" class="bt mini" data-ed="foco">Voltar ao editor</button>';$ed.appendChild(focoRapido);
  E.mobileTop=topo;E.mobileContext=contexto;E.mobileBar=barra;E.mobileSheet=painel;E.mobileBody=painel.querySelector('.ed-mobile-body');E.mobileShade=sombra;
  Array.prototype.forEach.call($ed.querySelectorAll('.pn,.ed-menus,.ed-cmd'),function(no){var marcador=document.createComment('posição original do editor');no.parentNode.insertBefore(marcador,no);ED_MOVEL.origens.push({no:no,marcador:marcador});});
  $ed.addEventListener('click',cliqueEditorMovel);
  $ed.addEventListener('input',function(ev){
    if(!S||S.carregando)return;var t=ev.target;
    if(t.hasAttribute('data-mobile-size')){var a=CFG.ajust[S.ferr];if(a){a.tam=clamp(+t.value,1,200);guardarAjustesPinceis();atualizarFerr();pedir(false);}return;}
    if(t.hasAttribute('data-mobile-pref')){var pref=t.getAttribute('data-mobile-pref');if(pref==='canhoto')ED_MOVEL.canhoto=t.checked;if(pref==='rotulos')ED_MOVEL.rotulos=t.checked;try{localStorage.setItem('mesa.ed.mobile.v1',JSON.stringify({canhoto:ED_MOVEL.canhoto,rotulos:ED_MOVEL.rotulos}));}catch(e){}atualizarEditorMovel();}
  });
  $ed.addEventListener('focusin',function(ev){
    if(!ED_MOVEL.ativo||!S||!campoTecladoMovel(ev.target))return;
    clearTimeout(ED_MOVEL.tTeclado);if(!ED_MOVEL.enquadramentoTeclado||ED_MOVEL.enquadramentoTeclado.sessao!==S)ED_MOVEL.enquadramentoTeclado={sessao:S,z:S.z,tx:S.tx,ty:S.ty,ajustado:S.ajustado};
  });
  $ed.addEventListener('focusout',function(){clearTimeout(ED_MOVEL.tTeclado);ED_MOVEL.tTeclado=setTimeout(function(){if(!campoTecladoMovel(document.activeElement))ED_MOVEL.enquadramentoTeclado=null;},700);});
  var consulta=window.matchMedia('(max-width:900px)');if(consulta.addEventListener)consulta.addEventListener('change',sincronizarEditorMovel);else if(consulta.addListener)consulta.addListener(sincronizarEditorMovel);
  sincronizarEditorMovel();
}
function campoTecladoMovel(no){return !!(no&&$ed&&$ed.contains(no)&&(no.tagName==='TEXTAREA'||(no.tagName==='INPUT'&&/^(text|search|number|email|url|password)$/.test(no.type))));}
function restaurarPaineisMoveis(){ED_MOVEL.origens.forEach(function(o){if(o.marcador.parentNode)o.marcador.parentNode.insertBefore(o.no,o.marcador.nextSibling);});}
function fecharPainelMovel(focar){
  if(!E.mobileSheet)return;var foco=document.activeElement;if(E.mobileSheet.contains(foco)&&foco.blur)foco.blur();
  fecharMenus();restaurarPaineisMoveis();E.mobileBody.textContent='';E.mobileSheet.hidden=true;E.mobileShade.hidden=true;ED_MOVEL.painel=null;$ed.classList.remove('mobile-painel-aberto');atualizarEditorMovel();
  if(focar&&ED_MOVEL.ativo){var b=E.mobileBar.querySelector('[data-mobile-panel="ferr"]');if(b)b.focus({preventScroll:true});}
}
function sincronizarEditorMovel(){
  if(!$ed||!E.mobileBar)return;var ativo=window.matchMedia('(max-width:900px)').matches,mudou=ED_MOVEL.ativo!==ativo;
  if(mudou)fecharPainelMovel(false);ED_MOVEL.ativo=ativo;$ed.classList.toggle('ed-mobile-ui',ativo);if(!ativo){clearTimeout(ED_MOVEL.tTeclado);ED_MOVEL.enquadramentoTeclado=null;}
  atualizarEditorMovel();
  if(mudou&&S)requestAnimationFrame(function(){if(S){ajustarCanvasPalco();if(S.ajustado)ajustar();else{limitarNavegacao();pedir(true);}}});
}
function atualizarEditorMovel(){
  if(!E.mobileBar)return;
  $ed.setAttribute('data-mobile-hand',ED_MOVEL.canhoto?'left':'right');$ed.setAttribute('data-mobile-labels',String(ED_MOVEL.rotulos));
  if(!S)return;
  var n=S.ferr,a=CFG.ajust[n],b=PINCEIS[n],borracha=!!(b&&b.borracha),semCor=n==='selecionar'||n==='balao'||borracha;
  if(b&&!borracha)ED_MOVEL.ferrAnterior=n;
  var titulo=E.mobileTop.querySelector('[data-mobile-title]');titulo.textContent=S.opts.titulo||(S.opts.modoLivre?'Desenho livre':'Página');
  var nome=E.mobileContext.querySelector('.ed-mobile-tool-name');nome.textContent=nomeFerr(n);
  var tamanho=E.mobileContext.querySelector('[data-mobile-size]'),valor=E.mobileContext.querySelector('[data-mobile-size-value]');tamanho.disabled=!a;tamanho.value=a?a.tam:1;valor.textContent=a?a.tam+' px':'Ajustes';
  var cor=E.mobileBar.querySelector('[data-mobile-panel="cor"]');cor.disabled=semCor;cor.title=semCor?'A cor fica disponível nas ferramentas de pintura':'Escolher cor';
  E.mobileBar.querySelector('.ed-mobile-swatch').style.background=CFG.cor;
  E.mobileBar.querySelector('[data-mobile-action="borracha"]').setAttribute('aria-pressed',String(borracha));
  Array.prototype.forEach.call(E.mobileBar.querySelectorAll('[data-mobile-panel]'),function(el){var p=el.getAttribute('data-mobile-panel');el.setAttribute('aria-pressed',String(ED_MOVEL.painel===p));el.setAttribute('aria-expanded',String(ED_MOVEL.painel===p));el.setAttribute('aria-controls','edMobileSheet');});
}
function moverPainelOriginalMovel(id){var no=$ed.querySelector('[data-pn="'+id+'"]');if(no)E.mobileBody.appendChild(no);}
function abrirPainelMovel(id){
  if(!ED_MOVEL.ativo||!S||S.carregando)return;
  if(id==='cor'&&(S.ferr==='selecionar'||S.ferr==='balao'||(PINCEIS[S.ferr]&&PINCEIS[S.ferr].borracha)))return;
  fecharPainelMovel(false);
  var titulos={ferr:'Ferramentas',prop:'Ajustar ferramenta',cor:'Cor do traço',camadas:'Camadas',mais:'Mais ferramentas',guias:'Guias e perspectiva',selecionar:'Seleção e laço',formas:'Figuras e formas 3D',baloes:'Balões',reticulas:'Retículas',estudio:'Estúdio de desenho',navegador:'Navegar na folha',paginas:'Folha e páginas',comandos:'Comandos completos',ajustes:'Preferências de toque'};
  var paineis={ferr:['ferr'],prop:['prop','tam'],cor:['cor'],camadas:['cam','cprop'],guias:['guias','sim'],selecionar:['prop'],formas:['ferr','prop'],baloes:['mat'],reticulas:['reticulas'],estudio:['estudio'],navegador:['nav']};
  if(!titulos[id])return;
  if(id==='selecionar')trocarFerr('selecionar');
  if(id==='formas'){if(E.buscaFerr)E.buscaFerr.value='';trocarFerr(CFG.ultimo.forma||'cubo');}
  if(id==='baloes')trocarFerr('balao');
  ED_MOVEL.painel=id;E.mobileSheet.querySelector('#edMobileSheetTitle').textContent=titulos[id];
  E.mobileBody.className='ed-mobile-body'+(id==='paginas'?' ed-mobile-page-body':'');
  (paineis[id]||[]).forEach(moverPainelOriginalMovel);
  if(id==='mais')E.mobileBody.innerHTML='<div class="ed-mobile-more">'+htmlEscolhaMovel('selecionar','foco','Seleção e laço')+htmlEscolhaMovel('formas','formas','Figuras e 3D')+htmlEscolhaMovel('guias','guia','Guias')+htmlEscolhaMovel('baloes','balao','Balões')+htmlEscolhaMovel('reticulas','reticula','Retículas')+'<button type="button" class="ed-mobile-choice" data-mobile-native="sfx-abrir">'+iconeEditorMovel('texto')+'<span>Onomatopeia</span></button><button type="button" class="ed-mobile-choice" data-mobile-native="referencias">'+iconeEditorMovel('imagem')+'<span>Referências</span></button><button type="button" class="ed-mobile-choice" data-mobile-native="manequim">'+iconeEditorMovel('pessoa')+'<span>Manequim 3D</span></button><button type="button" class="ed-mobile-choice" data-mobile-action="personagens">'+iconeEditorMovel('pessoa')+'<span>Personagens</span></button>'+htmlEscolhaMovel('navegador','zoom','Zoom e posição')+htmlEscolhaMovel('paginas','pagina','Folha e páginas')+htmlEscolhaMovel('estudio','ajustes','Estúdio')+htmlEscolhaMovel('comandos','mais','Comandos')+htmlEscolhaMovel('ajustes','ajustes','Preferências')+'<button type="button" class="ed-mobile-choice" data-mobile-native="salvar">'+iconeEditorMovel('salvar')+'<span>Salvar agora</span></button><button type="button" class="ed-mobile-choice" data-mobile-native="png">'+iconeEditorMovel('pagina')+'<span>Baixar PNG</span></button></div>';
  if(id==='ajustes')E.mobileBody.innerHTML='<div class="ed-mobile-settings"><label><input type="checkbox" data-mobile-pref="canhoto"'+(ED_MOVEL.canhoto?' checked':'')+'> Controles para canhotos</label><label><input type="checkbox" data-mobile-pref="rotulos"'+(ED_MOVEL.rotulos?' checked':'')+'> Mostrar nomes nos atalhos</label><p>Um dedo desenha. Dois dedos movem e ampliam a folha.</p><button type="button" class="bt" data-mobile-action="foco">Modo foco</button><button type="button" class="bt" data-mobile-native="rotar-folha">Girar a folha</button></div>';
  if(id==='comandos'){var menus=$ed.querySelector('.ed-menus'),comandos=$ed.querySelector('.ed-cmd');if(menus)E.mobileBody.appendChild(menus);if(comandos)E.mobileBody.appendChild(comandos);}
  if(id==='paginas'){
    E.mobileBody.innerHTML='<p class="ed-dica">'+(S.opts.modoLivre?'Folha independente do Desenho Livre.':'Organize as páginas desta obra.')+' · '+S.dim.w+' × '+S.dim.h+' px</p><div class="ed-mobile-more"><button type="button" class="ed-mobile-choice" data-mobile-native="ajustar">'+iconeEditorMovel('zoom')+'<span>Ajustar à tela</span></button><button type="button" class="ed-mobile-choice" data-mobile-native="rotar-folha">'+iconeEditorMovel('girar')+'<span>Girar folha</span></button><button type="button" class="ed-mobile-choice" data-mobile-native="png">'+iconeEditorMovel('pagina')+'<span>Baixar PNG</span></button></div>';
    if(S.modoPagina)E.mobileBody.insertAdjacentHTML('beforeend','<div class="ed-mobile-more"><button type="button" class="ed-mobile-choice" data-mobile-native="pagina-ant">Página anterior</button><button type="button" class="ed-mobile-choice" data-mobile-native="pagina-prox">Próxima página</button><button type="button" class="ed-mobile-choice" data-mobile-native="pagina-gerenciar">Conjunto de páginas</button><button type="button" class="ed-mobile-choice" data-mobile-native="pagina-opcoes">Editar página</button></div>');
  }
  E.mobileSheet.hidden=false;E.mobileShade.hidden=false;$ed.classList.add('mobile-painel-aberto');E.mobileBody.scrollTop=0;atualizarEditorMovel();
  var voltar=E.mobileSheet.querySelector('[data-mobile-action="voltar-painel"]');voltar.hidden=id==='mais';
  if(id==='cor')desenharRoda();if(id==='navegador')pedirNav();if(id==='estudio')renderFavoritos();
  E.mobileSheet.querySelector('[data-mobile-action="fechar"]').focus({preventScroll:true});
}
function cliqueEditorMovel(ev){
  if(!ED_MOVEL.ativo||!S||S.carregando)return;var t=ev.target.closest('[data-mobile-panel],[data-mobile-action],[data-mobile-native]');
  if(t){
    if(t.disabled)return;var painel=t.getAttribute('data-mobile-panel'),a=t.getAttribute('data-mobile-action'),n=t.getAttribute('data-mobile-native');
    if(painel){if(ED_MOVEL.painel===painel&&t.closest('.ed-mobile-bar'))fecharPainelMovel(false);else abrirPainelMovel(painel);return;}
    if(n){fecharPainelMovel(false);acao(n,t);atualizarEditorMovel();return;}
    if(a==='fechar'){fecharPainelMovel(true);return;}
    if(a==='voltar-painel'){abrirPainelMovel('mais');return;}
    if(a==='voltar'){fecharPainelMovel(false);acao('voltar',t);return;}
    if(a==='foco'){fecharPainelMovel(false);alternarModoFoco(true,false);return;}
    if(a==='borracha'){var atual=PINCEIS[S.ferr],era=!!(atual&&atual.borracha);fecharPainelMovel(false);trocarFerr(era?(ED_MOVEL.ferrAnterior||'caneta'):'borracha');atualizarEditorMovel();return;}
    if(a==='personagens'){fecharPainelMovel(false);var original=$ed.querySelector('.ed-acesso-tableta [data-ficha-personagem]');if(original)original.click();return;}
  }
  if(ev.target.closest('[data-ferr],[data-fav]')&&ED_MOVEL.painel==='ferr'){fecharPainelMovel(false);}
  atualizarEditorMovel();
}
PAINEIS.push(["reticulas","Retículas de mangá"]);
try{ var _pn=JSON.parse(localStorage.getItem("mesa.ed.paineis")||"null"); if(_pn&&typeof _pn==="object") ESTADO_PN=_pn; }catch(e){}
if(!ESTADO_PN.reticulas)ESTADO_PN.reticulas={f:1};
function salvarPn(){ try{ localStorage.setItem("mesa.ed.paineis",JSON.stringify(ESTADO_PN)); }catch(e){} }
function aplicarPaineis(){
  PAINEIS.forEach(function(p){
    var el=$ed.querySelector('[data-pn="'+p[0]+'"]'), st=ESTADO_PN[p[0]]||{};
    if(!el) return;
    el.classList.toggle("fechado",!!st.f); el.classList.toggle("oculto",!!st.o);
  });
}
function fecharPn(id){
  var st=ESTADO_PN[id]||(ESTADO_PN[id]={}); st.f=st.f?0:1; salvarPn(); aplicarPaineis();
  if(id==="nav") pedirNav();
}
function alternarPainel(id){
  if(ED_MOVEL.ativo){var destino={ferr:'ferr',prop:'prop',tam:'prop',cor:'cor',sim:'guias',guias:'guias',mat:'baloes',nav:'navegador',cprop:'camadas',cam:'camadas',estudio:'estudio',reticulas:'reticulas'}[id];if(destino)abrirPainelMovel(destino);return;}
  if(id==="estudio"){abrirEstudioEditor();return;}
  var st=ESTADO_PN[id]||(ESTADO_PN[id]={}); st.o=st.o?0:1; if(!st.o){st.f=0;var pnAlvo=$ed.querySelector('[data-pn="'+id+'"]');if(pnAlvo){if(pnAlvo.closest('.ed-dockL'))INTERFACE_EDITOR.esq=true;else INTERFACE_EDITOR.dir=true;}guardarInterfaceEditor();aplicarInterfaceEditor();} salvarPn(); aplicarPaineis();
  if(id==="nav") pedirNav();
}
function atualizarMenus(){
  PAINEIS.forEach(function(p){
    var b=$ed.querySelector('[data-pn-tog="'+p[0]+'"] .ck'); if(b) b.textContent=p[0]==="estudio"?(INTERFACE_EDITOR.estudio?"✓":""):((ESTADO_PN[p[0]]&&ESTADO_PN[p[0]].o)?"":"✓");
  });
}
function fecharMenus(){
  if(!$ed) return;
  qa(".ed-ml").forEach(function(m){ m.classList.add("oculto"); });
  qa(".ed-mb").forEach(function(b){ b.classList.remove("aberto"); });
}
function menuAberto(){ return !!$ed&&!!$ed.querySelector(".ed-mb.aberto"); }
function abrirMenu(b){
  fecharMenus(); b.classList.add("aberto");
  var l=b.nextElementSibling; if(l) l.classList.remove("oculto");
  atualizarMenus();
}

/* cor: roda de matiz + quadrado de saturação/valor */
var HSV={h:0,s:0,v:0}, RODA={W:148,ro:70,ri:52};
function hsv2hex(h,s,v){
  var f=function(n){ var k=(n+h/60)%6; return v-v*s*Math.max(0,Math.min(k,4-k,1)); };
  return "#"+[f(5),f(3),f(1)].map(function(x){ var t=Math.round(x*255).toString(16); return t.length<2?"0"+t:t; }).join("");
}
function hex2hsv(hex){
  var r=parseInt(hex.slice(1,3),16)/255, g=parseInt(hex.slice(3,5),16)/255, b=parseInt(hex.slice(5,7),16)/255;
  var mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn, h=0;
  if(d){
    if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
    h*=60; if(h<0) h+=360;
  }
  return {h:h,s:mx?d/mx:0,v:mx};
}
function desenharRoda(){
  var cv=E.roda; if(!cv) return;
  var d=window.devicePixelRatio||1, W=RODA.W, ro=RODA.ro, ri=RODA.ri, cx=W/2, a;
  if(cv.width!==Math.round(W*d)){ cv.width=cv.height=Math.round(W*d); cv.style.width=cv.style.height=W+"px"; }
  var c=cv.getContext("2d"); c.setTransform(d,0,0,d,0,0); c.clearRect(0,0,W,W);
  c.lineWidth=ro-ri; c.lineCap="butt";
  for(a=0;a<360;a+=2){
    c.beginPath(); c.arc(cx,cx,(ro+ri)/2,(a-0.6)*Math.PI/180,(a+2.6)*Math.PI/180);
    c.strokeStyle="hsl("+a+",100%,50%)"; c.stroke();
  }
  var sd=ri*0.7, x0=cx-sd, side=sd*2, g;
  c.fillStyle=hsv2hex(HSV.h,1,1); c.fillRect(x0,x0,side,side);
  g=c.createLinearGradient(x0,0,x0+side,0); g.addColorStop(0,"#fff"); g.addColorStop(1,"rgba(255,255,255,0)");
  c.fillStyle=g; c.fillRect(x0,x0,side,side);
  g=c.createLinearGradient(0,x0,0,x0+side); g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(1,"#000");
  c.fillStyle=g; c.fillRect(x0,x0,side,side);
  var ang=HSV.h*Math.PI/180, rm=(ro+ri)/2;
  [[cx+Math.cos(ang)*rm,cx+Math.sin(ang)*rm],[x0+HSV.s*side,x0+(1-HSV.v)*side]].forEach(function(p){
    c.beginPath(); c.arc(p[0],p[1],5,0,Math.PI*2); c.lineWidth=2; c.strokeStyle="#fff"; c.stroke();
    c.beginPath(); c.arc(p[0],p[1],6.2,0,Math.PI*2); c.lineWidth=1; c.strokeStyle="#000"; c.stroke();
  });
}
function rodaPonteiro(e,modo){
  var r=E.roda.getBoundingClientRect(), k=RODA.W/r.width, x=(e.clientX-r.left)*k, y=(e.clientY-r.top)*k;
  var cx=RODA.W/2, dx=x-cx, dy=y-cx, dist=Math.hypot(dx,dy), sd=RODA.ri*0.7;
  if(!modo){
    if(dist>=RODA.ri-2&&dist<=RODA.ro+4) modo="h";
    else if(Math.abs(dx)<=sd+4&&Math.abs(dy)<=sd+4) modo="sv";
    else return null;
  }
  if(modo==="h") HSV.h=(Math.atan2(dy,dx)*180/Math.PI+360)%360;
  else{ HSV.s=clamp((dx+sd)/(sd*2),0,1); HSV.v=1-clamp((dy+sd)/(sd*2),0,1); }
  definirCor(hsv2hex(HSV.h,HSV.s,HSV.v),true);
  return modo;
}

/* navegador: miniatura com o retângulo da área visível */
var navT=0;
function pedirNav(){ if(!S||S.vivo||navT) return; navT=setTimeout(function(){ navT=0; desenharNav(); },120); }
function desenharNav(){
  if(!S||S.vivo||!E.nav||S.carregando) return;
  var cv=E.nav, W=cv.clientWidth, H=cv.clientHeight; if(!W||!H) return;
  var d=window.devicePixelRatio||1;
  if(cv.width!==Math.round(W*d)||cv.height!==Math.round(H*d)){ cv.width=Math.round(W*d); cv.height=Math.round(H*d); }
  var c=cv.getContext("2d"), k=Math.min((W-10)/S.dim.w,(H-10)/S.dim.h), ox=(W-S.dim.w*k)/2, oy=(H-S.dim.h*k)/2;
  c.setTransform(d,0,0,d,0,0); c.fillStyle="#8c8c8c"; c.fillRect(0,0,W,H);
  c.save(); c.translate(ox,oy); c.scale(k,k); c.imageSmoothingQuality="medium";
  c.fillStyle="#fff"; c.fillRect(0,0,S.dim.w,S.dim.h);
  fundoEm(c); camadasEm(c,true); desenharBorda(c); desenharBaloes(c,S.baloes,Math.max(S.dim.w,S.dim.h));
  c.restore();
  /* O retângulo do navegador representa apenas a parte da folha que cabe no
     palco. Assim ele não extrapola a miniatura quando a folha já está inteira
     visível ou quando o deslocamento chega a uma borda. */
  var vwDoc=Math.min(S.dim.w,S.pw/S.z), vhDoc=Math.min(S.dim.h,S.ph/S.z);
  var dx=clamp(-S.tx/S.z,0,Math.max(0,S.dim.w-vwDoc));
  var dy=clamp(-S.ty/S.z,0,Math.max(0,S.dim.h-vhDoc));
  var vx=ox+dx*k, vy=oy+dy*k, vw=vwDoc*k, vh=vhDoc*k;
  c.lineWidth=1.5; c.strokeStyle="#e0262b"; c.strokeRect(vx,vy,vw,vh);
  S.navGeo={ox:ox,oy:oy,k:k};
}
function navPonteiro(e){
  if(!S||!S.navGeo) return;
  var r=E.nav.getBoundingClientRect(), g=S.navGeo;
  var dx=((e.clientX-r.left)-g.ox)/g.k, dy=((e.clientY-r.top)-g.oy)/g.k;
  S.tx=S.pw/2-dx*S.z; S.ty=S.ph/2-dy*S.z;
  limitarNavegacao(); S.ajustado=false; pedir(true);
}

/* ---------- estado e DOM ---------- */
var $ed=null, E={}, S=null;

function montarDOM(){
  if($ed) return;
  $ed=document.createElement("div");
  $ed.className="ed oculto"; $ed.tabIndex=-1;
  $ed.setAttribute("role","dialog"); $ed.setAttribute("aria-label","Editor de desenho");
  var optsTam=ORDEM.map(function(k){
    return '<option value="'+k+'">'+esc(TAMANHOS[k].nome+" ("+TAMANHOS[k].razao+")")+'</option>';
  }).join("");
  var optsForma=FORMAS_PAINEL.map(function(f){
    return '<option value="'+f[0]+'">'+esc(f[1])+'</option>';
  }).join("")+'<option value="custom">Personalizada</option>';
  var amostras=AMOSTRAS.map(function(c){
    return '<button type="button" class="ed-amostra" data-cor="'+c+'" style="background:'+c+'" aria-label="Cor '+c+'"></button>';
  }).join("");
  var tools=GRUPOS.map(function(g){
    return (g.sep?'<div class="ed-sep"></div>':'')+
      '<button type="button" class="ed-tb'+(g.ferrs.length>1?' multi':'')+'" data-grp="'+g.id+'" title="'+esc(g.nome)+'" aria-label="'+esc(g.nome)+'">'+
      '<svg viewBox="0 0 24 24" aria-hidden="true">'+ICO[g.id]+'</svg></button>';
  }).join("");
  var subs=GRUPOS.map(function(g){
    return '<div class="oculto" data-sg="'+g.id+'">'+g.ferrs.map(function(f){
      var B=PINCEIS[f];
      return '<button type="button" class="ed-sub" data-ferr="'+f+'" title="'+esc(B&&B.dica?B.dica:"Selecionar "+nomeFerr(f))+'">'+(B?'<canvas width="132" height="48" data-prev-pincel="'+f+'" aria-hidden="true"></canvas>':prevSVG(f))+'<span class="ed-sub-texto">'+esc(nomeFerr(f))+(B&&B.familia?'<small>'+esc(B.borracha?'Limpeza':B.familia==="deco"?'Carimbos e padrões':B.familia==="pastel"?'Textura no papel':B.familia==="pintura"?'Pintura e acabamento':B.familia==="aero"?'Luz e volume':'Arte-final')+'</small>':'')+'</span><kbd>'+atalhoDe(f)+'</kbd></button>';
    }).join("")+'</div>';
  }).join("");
  var tams=TAMS_PRE.map(function(v){
    var px=Math.max(2,Math.min(v,26));
    return '<button type="button" class="ed-tm" data-tam="'+v+'" title="'+v+' px"><small>'+v+'</small><i style="width:'+px+'px;height:'+px+'px"></i></button>';
  }).join("");
  function pn(id,titulo,corpo){
    return '<section class="pn" data-pn="'+id+'"><header class="pn-t" data-pn-t="'+id+'"><span class="pn-caret">▾</span>'+titulo+'</header><div class="pn-c">'+corpo+'</div></section>';
  }
  function mi(acao,txt,atalho){ return '<button type="button" class="ed-mi" data-ed="'+acao+'"><span class="ck"></span>'+txt+(atalho?'<kbd>'+atalho+'</kbd>':'')+'</button>'; }
  function menu(nome,itens){
    return '<div class="ed-menu"><button type="button" class="ed-mb" aria-haspopup="true">'+nome+'</button><div class="ed-ml oculto" role="menu">'+itens+'</div></div>';
  }
  var janela=PAINEIS.map(function(p){
    return '<button type="button" class="ed-mi" data-pn-tog="'+p[0]+'"><span class="ck">✓</span>'+p[1]+'</button>';
  }).join("")+'<hr><button type="button" class="ed-mi" data-ed="paineis-reset"><span class="ck"></span>Restaurar paletas</button>';
  function grupoFerrConversao(titulo,ids){
    return '<optgroup label="'+titulo+'">'+ids.map(function(id){ return '<option value="'+id+'">'+esc(PINCEIS[id].nome)+'</option>'; }).join('')+'</optgroup>';
  }
  var opcoesFerrConversao=
    grupoFerrConversao("Lápis",["lapis","lapis6b"].concat(GRAUS_LAPIS.map(function(x){ return "lapis"+x[0]; })))+
    grupoFerrConversao("Lapiseiras",LAPISSEIRAS.map(function(x){ return "lapiseira"+x[0]; }))+
    grupoFerrConversao("Canetas",["esfero","caneta"].concat(PONTAS_CANETA.map(function(x){ return "caneta"+x[0]; }),["nanquim","marcador"]))+
    grupoFerrConversao("Pincéis",["aerografo","pincel","seco"]);
  var seletorFerrConversao='<label class="ed-mi ed-mi-select"><span>Ferramenta da conversão</span><select data-r="imgFerr" aria-label="Ferramenta para converter a imagem">'+opcoesFerrConversao+'</select></label>';
  var menus=
    menu("Arquivo",mi("voltar","Voltar ao roteiro")+mi("ant","Painel anterior")+mi("prox","Próximo painel")+'<hr>'+mi("png","Baixar PNG do painel"))+
    menu("Editar",mi("desfazer","Desfazer","Ctrl+Z")+mi("refazer","Refazer","Ctrl+Y")+'<hr>'+mi("m-cortar","Cortar","Ctrl+X")+mi("m-copiar","Copiar","Ctrl+C")+mi("m-colar","Colar","Ctrl+V")+mi("m-apagar","Apagar seleção","Del"))+
    menu("Camada",mi("c-nova","Nova camada")+mi("c-dup","Duplicar camada")+mi("c-mescla","Mesclar com a de baixo")+mi("c-apaga","Apagar camada")+'<hr>'+mi("c-sobe","Subir camada")+mi("c-desce","Descer camada"))+
    menu("Seleção",mi("sel-retangulo","Área retangular")+mi("sel-elipse","Área elíptica")+mi("sel-laco","Laço livre")+'<hr>'+mi("m-sel-tudo","Selecionar tudo","Ctrl+A")+mi("m-sel-nada","Desfazer seleção","Esc")+mi("sel-copiar","Copiar área")+mi("sel-cortar","Recortar área")+mi("sel-duplicar","Duplicar área")+mi("sel-nova-camada","Duplicar em nova camada")+'<hr>'+mi("s-fh","Espelhar horizontalmente")+mi("s-fv","Espelhar verticalmente")+mi("s-gira","Girar 90°"))+
    menu("Imagem",seletorFerrConversao+mi("img-converter-ferr","Converter com a ferramenta escolhida")+mi("img-tom-desenho","Escolher tom de lápis/caneta…")+'<hr>'+mi("img-ajustar-folha","Ajustar imagem à folha")+mi("img-preencher-folha","Preencher folha (cortar bordas)")+mi("img-desenho-lapis","Transformar em desenho: Lápis")+mi("img-desenho-caneta","Transformar em desenho: Caneta / mangá")+mi("img-desenho-nanquim","Transformar em desenho: Nanquim")+mi("img-desenho-colorido","Transformar em desenho: Lápis de cor")+mi("img-desenho-aquarela","Transformar em desenho: Aquarela")+mi("img-remover","Retirar imagem da camada ativa")+mi("img-original","Restaurar imagem original")+mi("img-saturacao","Ajustar saturação…")+mi("img-filtro-sepia","Filtro: Sépia")+mi("img-filtro-quente","Filtro: Quente")+mi("img-filtro-frio","Filtro: Frio")+mi("img-filtro-contraste","Filtro: Alto contraste")+mi("img-filtro-vintage","Filtro: Vintage")+mi("img-filtro-negativo","Filtro: Negativo")+mi("img-cinza","Converter camada ativa para tons de cinza")+mi("img-recortar","Recortar camada à seleção"))+ 
    menu("Balão",mi("b-novo","Novo balão no centro")+mi("b-dup","Duplicar balão")+mi("b-frente","Trazer para a frente")+mi("b-apaga","Apagar balão"))+
    menu("Visualizar",mi("zoom+","Aumentar zoom","+")+mi("zoom-","Diminuir zoom","−")+mi("ajustar","Ajustar à tela","0")+mi("preencher","Preencher toda a área")+mi("zoom100","Tamanho real (100%)"))+
    menu("Janela",janela)+
    menu("Ajuda",mi("ajuda","Atalhos e dicas"));
  var ajuda='<div class="ed-ajuda oculto" data-r="ajuda" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Atalhos e dicas" tabindex="-1"><div class="ed-ajuda-c"><div style="display:flex;align-items:center;gap:10px;justify-content:space-between"><h3>Atalhos e dicas — guia completo</h3><button type="button" class="bt mini" data-ed="ajuda-fechar" aria-label="Fechar ajuda">✕ Fechar</button></div>'+
    '<h4>Atalhos de teclado</h4><dl><dt>P · Q · K</dt><dd>Lápis HB, Lápis 6B, Esferográfica</dd><dt>B · N · M</dt><dd>Caneta G, Nanquim, Marcador</dd>'+
    '<dt>R · A · D · S</dt><dd>Aerógrafo, Pincel macio, Pincel seco, Esfumar</dd><dt>E</dt><dd>Borracha</dd><dt>Shift+B · Shift+A · Shift+P</dt><dd>Alternar Canetas/Pen, Pintura e Pastel</dd><dt>Shift+R · Shift+D · Shift+E</dt><dd>Alternar Aerógrafos, Decorações e Borrachas</dd>'+
    '<dt>L · U · O</dt><dd>Linha, Retângulo, Elipse. Na Linha, escolha o encaixe e segure Shift; Ctrl+Shift usa precisão de 5°.</dd><dt>1 · 2 · 3 · 4</dt><dd>Com a Linha ativa: encaixe de 5°, 15°, 30° e 45°</dd><dt>G · I</dt><dd>Balde de tinta, Conta-gotas</dd>'+
    '<dt>V · T · H</dt><dd>Seleção, Balão de fala, Mão</dd><dt>Tab</dt><dd>Girar a folha em 90°</dd><dt>Space</dt><dd>Ativar as formas tridimensionais</dd><dt>[ · ]</dt><dd>Mover a folha para a esquerda / direita</dd><dt>Ctrl</dt><dd>Ativar lápis</dd><dt>Alt</dt><dd>Ativar lapiseira</dd>'+ 
    '<dt>Ctrl+ + · Ctrl+ −</dt><dd>Aumentar / diminuir o zoom da folha dentro do editor</dd><dt>+ · −</dt><dd>Refazer / desfazer; os botões + e − da mesa podem usar esses atalhos</dd><dt>, · .</dt><dd>Diminuir / aumentar tamanho da ponta; Shift+, · Shift+. ajustam estabilização</dd><dt>Ctrl+, · Ctrl+.</dt><dd>Diminuir / aumentar opacidade</dd><dt>0</dt><dd>Ajustar a folha à tela</dd><dt>Ctrl+Z · Ctrl+Y</dt><dd>Desfazer / refazer (Ctrl+Shift+Z também refaz)</dd>'+ 
    '<dt>Ctrl+A · C · X · V</dt><dd>Selecionar tudo, copiar, cortar, colar</dd><dt>Enter · Esc · Delete</dt><dd>Confirmar transformação, cancelar seleção, apagar seleção ou balão</dd></dl>'+
    '<h4>Atalhos individuais para cada ponta e graduação</h4><p>Use as teclas destacadas abaixo para selecionar diretamente cada ponta de caneta, graduação de lápis e lapiseira, sem precisar abrir a lista de subferramentas.</p><dl class="ed-atalhos-detalhados">'+HTML_ATALHOS_DETALHADOS+'</dl>'+
    '<h4>Lápis e lapiseiras</h4><p><b>2H, H e F:</b> traço fino e claro, bons para construção e esboço leve. <b>HB/B/1B–3B:</b> esboço geral e linhas mais visíveis. <b>4B–6B:</b> traço escuro para sombras e desenho expressivo. <b>7B–10B:</b> muito macios e escuros; use opacidade/tamanho menores para detalhes. <b>Lapiseiras 0,3/0,5 mm:</b> detalhes finos; <b>0,7/0,9 mm:</b> esboço e contorno; <b>2,0 mm:</b> traço mais grosso.</p>'+
    '<h4>Canetas e arte-final</h4><p><b>Caneta G:</b> varie a pressão para linhas expressivas e contornos de mangá. <b>003–009 e 01–02:</b> detalhes, cílios e hachuras finas. <b>03–05:</b> contornos comuns. <b>06–09 e 1–3:</b> linhas grossas, silhuetas e impacto. <b>BR · Brush:</b> linhas com aparência de pincel. <b>Nanquim:</b> linha uniforme e limpa. <b>Esferográfica:</b> rascunho com linha firme.</p>'+
    '<h4>Biblioteca de pincéis</h4><p>Use a categoria ou a busca para escolher uma ferramenta. A prévia mostra o traço e muda com os ajustes. <b>Canetas / Pen:</b> Maru para detalhes, Kabura para contorno, Brush para linhas expressivas e Caligráfica para ponta achatada. <b>Pintura:</b> guache, pincel chato, aquarela em camadas e óleo seco. <b>Pastel:</b> suave, oleoso, giz e carvão para texturas de papel. <b>Aerógrafos:</b> suave, duro, partículas e luz. <b>Decorações:</b> arraste para distribuir estrelas, corações, flores, folhas, brilhos e hachuras. <b>Esfumar:</b> misture cores existentes na camada. <b>Borracha macia:</b> suavize bordas.</p>'+
    '<h4>Ajustes por ferramenta</h4><p><b>Fluxo:</b> quantidade de cor por carimbo. <b>Dureza:</b> nitidez das bordas. <b>Textura:</b> intensidade do grão. <b>Dispersão:</b> afastamento das marcas do trajeto. <b>Espaçamento:</b> distância entre as marcas; aumente para decorações individuais. <b>Ângulo da ponta:</b> orientação de pontas chatas e motivos. Os ajustes ficam guardados neste navegador; “Restaurar esta ferramenta” volta ao padrão. Aquarela e óleo são simulações de textura e transparência para estudo e pintura.</p>'+
    '<h4>Imagens e fotografias</h4><p><b>Referências:</b> abra o botão 🖼 Referências para escolher imagens guardadas nas notas de imagens. Cada referência entra em uma camada própria, com uma camada de desenho separada por cima. Selecione a camada da imagem para aplicar ajustes, filtros, conversão para lápis/caneta ou restauração; desenhe na camada “Desenho sobre…” para que retirar a imagem não apague o traço. Use <b>Selecionar (V)</b> para mover ou redimensionar e o menu Seleção para espelhar ou girar.</p>'+ 
    '<h4>Formas, balões e edição</h4><p><b>Linha/Retângulo/Elipse e formas 3D:</b> arraste para criar. Nas propriedades da forma, escolha traço contínuo, tracejado ou pontilhado e ajuste a rotação antes ou durante o desenho. Shift restringe ângulo/proporção quando aplicável. <b>Balde:</b> clique na área fechada e ajuste Tolerância se sobrar espaço ou vazar cor; “Usar todas as camadas” considera o desenho combinado. <b>Conta-gotas:</b> clique para copiar uma cor do desenho. <b>Seleção:</b> escolha Retângulo, Elipse ou Laço livre; mova, redimensione, gire, espelhe, copie, recorte ou duplique em nova camada. <b>Balão:</b> escolha o tipo na paleta Material [Balão] e clique na página; selecione o balão para editar. <b>Mão:</b> arraste para navegar sem desenhar.</p>'+ 
    '<p class="ed-dica">Dica: selecione qualquer ferramenta para ver uma dica específica logo abaixo das propriedades. Clique no grupo da esquerda e escolha uma opção na lista “Sub ferramenta” para acessar todas as pontas e graduações. Os valores de tamanho e opacidade são ajustáveis por ferramenta.</p>'+
    '<h4>Manequim 3D — Shift+J</h4><p>Escolha uma pose, arraste a cena para girar a câmera e use Articular corpo para ajustar os pontos azuis. Os três controles dobram, torcem e inclinam a parte selecionada dentro de limites. Em Proporções e visualização, altere altura, ombros, quadril e cabeça. Em Posicionar na folha, arraste a miniatura ou ajuste tamanho, posição, rotação e opacidade. <b>Inserir nova base</b> cria a imagem e uma camada separada para seu traço. Para mudar uma base criada com estes controles, selecione sua camada de desenho ou imagem, use <b>Carregar base da folha</b>, ajuste a pose e clique <b>Atualizar esta base</b>: somente a imagem muda; o desenho permanece intacto. Ctrl+Z desfaz a atualização. A pose fica guardada com a base e acompanha o backup. Bases antigas continuam preservadas como imagens, pois não guardavam articulações; insira uma nova para usar a edição de pose. Mãos e pés são volumes de construção, sem dedos articulados.</p>'+
    '<h4>Personagens, retículas e onomatopeias</h4><p><b>Personagens — Shift+F:</b> abra as fichas para guardar vistas de frente, perfil e costas, expressões, roupas e detalhes. A ficha fica ao lado da folha como referência. <b>Retículas — Shift+K:</b> selecione uma região com retângulo, elipse ou laço; abra Retículas, escolha o padrão e ajuste tamanho, espaçamento, ângulo e intensidade. A aplicação cria uma camada separada, que pode ser apagada ou ter sua opacidade alterada. Para cobrir a folha inteira, escolha essa opção em Aplicar em. <b>Onomatopeia — Shift+O:</b> crie um texto, escolha a fonte, as cores e o contorno. Use o painel para editar o conteúdo e os ajustes, mesmo depois de mover, redimensionar ou girar o texto. Esses objetos aparecem nas prévias e nas exportações. As fichas e suas imagens também acompanham o backup completo.</p>'+
    '<h4>Estúdio e espaço de trabalho</h4><p><b>Estúdio de desenho — Shift+S:</b> use o primeiro botão da barra lateral para abrir os perfis, favoritos e a preparação de camadas. “Voltar às ferramentas” recupera a biblioteca de pincéis. A cor do entorno fica no Estúdio e muda somente o espaço fora da folha, sem entrar nas exportações. <b>Recolher laterais:</b> esconde as informações mantendo o zoom e a rotação. As setas nas bordas reabrem cada lado; “Mostrar laterais” recupera os dois. A roda de cores fica escondida em Selecionar, Balões e Borrachas e volta ao escolher uma ferramenta de pintura.</p>'+
    '<div class="ed-acoes-cam"><button type="button" class="bt" data-ed="ajuda">Fechar</button></div></div></div>';

  var favOpcoes=Object.keys(PINCEIS).concat(Object.keys(FORMAS)).map(function(k){ return '<option value="'+k+'">'+esc(nomeFerr(k))+'</option>'; }).join("");
  var paletasEsq=
    pn("ferr",'Biblioteca de ferramentas',
      '<div class="ed-biblioteca-cab"><select data-r="grupoFerr" aria-label="Categoria de ferramenta">'+GRUPOS.map(function(g){return '<option value="'+g.id+'">'+esc(g.nome)+'</option>';}).join("")+'</select><input type="search" data-r="buscaFerr" placeholder="Buscar ferramenta…" aria-label="Buscar ferramenta em todas as categorias"></div><p class="ed-biblioteca-info" data-r="ferrContagem"></p><div class="ed-sub-lista">'+subs+'</div>')+
    pn("prop",'Propriedade da ferramenta <span class="pn-sub">[<span data-r="ferrNome"></span>]</span>',
      '<canvas class="ed-traco-previa oculto" data-r="previaTraco" width="440" height="140" aria-label="Prévia do traço da ferramenta"></canvas>'+
      '<label class="ed-lin" data-g="tam">Tamanho <input type="range" data-r="pTam" min="1" max="200"><output data-r="pTamV"></output></label>'+
      '<label class="ed-lin" data-g="op">Opacidade <input type="range" data-r="pOp" min="5" max="100"><output data-r="pOpV"></output></label>'+
      '<label class="ed-lin" data-g="estab">Estabilização <input type="range" data-r="pEstab" min="0" max="10"><output data-r="pEstabV"></output></label>'+
      '<label class="ed-lin ed-chk" data-g="estab" title="Reduz a distância entre a ponta e o traço. Desmarque para usar a estabilização tradicional."><input type="checkbox" data-r="pRapida"> Resposta rápida da caneta</label>'+
      '<label class="ed-lin ed-chk" data-g="pres"><input type="checkbox" data-r="pPres"> Sensível à pressão</label>'+
      '<div class="ed-ajustes-extra" data-g="pincelExtra">'+
        '<label class="ed-lin" data-g="fluxo">Fluxo <input type="range" data-r="pFluxo" min="1" max="100"><output data-r="pFluxoV"></output></label>'+
        '<label class="ed-lin" data-g="dureza">Dureza <input type="range" data-r="pDureza" min="0" max="100"><output data-r="pDurezaV"></output></label>'+
        '<label class="ed-lin" data-g="textura">Textura <input type="range" data-r="pTextura" min="0" max="100"><output data-r="pTexturaV"></output></label>'+
        '<label class="ed-lin" data-g="dispersao">Dispersão <input type="range" data-r="pDispersao" min="0" max="100"><output data-r="pDispersaoV"></output></label>'+
        '<label class="ed-lin" data-g="espacamento">Espaçamento <input type="range" data-r="pEspacamento" min="2" max="180"><output data-r="pEspacamentoV"></output></label>'+
        '<label class="ed-lin" data-g="anguloPonta">Ângulo da ponta <input type="range" data-r="pAngulo" min="-180" max="180"><output data-r="pAnguloV"></output></label>'+
        '<button type="button" class="bt mini" data-ed="pincel-reset">Restaurar esta ferramenta</button>'+
      '</div>'+
      '<label class="ed-lin" data-g="tol">Tolerância <input type="range" data-r="pTol" min="0" max="100"><output data-r="pTolV"></output></label>'+
      '<label class="ed-lin ed-chk" data-g="ref"><input type="checkbox" data-r="pRef"> Usar todas as camadas</label>'+
      '<label class="ed-lin ed-chk" data-g="fill"><input type="checkbox" data-r="pFill"> Preencher forma</label>'+
      '<div class="ed-forma-opcoes" data-g="forma">'+
        '<label>Traço <select data-r="pFormaTraco" aria-label="Tipo de traço da forma"><option value="solido">Contínuo</option><option value="tracejado">Tracejado</option><option value="pontilhado">Pontilhado</option></select></label>'+ 
        '<label>Rotação <input type="range" data-r="pFormaRot" min="-180" max="180" step="1"><output data-r="pFormaRotV">0°</output></label>'+ 
      '</div>'+ 
      '<label class="ed-lin" data-g="linha">Encaixe da linha <select data-r="linhaAngulo" aria-label="Ângulo de encaixe da linha"><option value="5">5°</option><option value="15">15°</option><option value="30">30°</option><option value="45">45°</option><option value="90">90°</option></select></label>'+ 
      '<div class="ed-acoes-cam" data-r="selAcoes">'+
        '<label class="ed-lin" style="display:flex;align-items:center;gap:4px">Área <select data-r="selForma" aria-label="Formato da seleção"><option value="retangulo">Retângulo</option><option value="elipse">Elipse</option><option value="laco">Laço livre</option></select></label>'+ 
        '<button type="button" class="bt mini" data-ed="s-fh">Espelhar ↔</button>'+
        '<button type="button" class="bt mini" data-ed="s-fv">Espelhar ↕</button>'+
        '<button type="button" class="bt mini" data-ed="s-gira-esq">↺ 15°</button>'+ 
        '<button type="button" class="bt mini" data-ed="s-gira-dir">↻ 15°</button>'+ 
        '<button type="button" class="bt mini" data-ed="s-gira">Girar 90°</button>'+ 
        '<button type="button" class="bt mini" data-ed="sel-copiar">Copiar</button>'+ 
        '<button type="button" class="bt mini" data-ed="sel-cortar">Recortar</button>'+ 
        '<button type="button" class="bt mini" data-ed="sel-duplicar">Duplicar</button>'+ 
        '<button type="button" class="bt mini" data-ed="sel-nova-camada">Duplicar em camada</button>'+ 
      '</div>'+
      '<p class="ed-dica" data-r="dica"></p>')+
    pn("tam",'Tamanho do pincel','<div class="ed-tams" data-r="tams">'+tams+'</div>')+
    pn("cor",'Roda de cor',
      '<canvas class="ed-roda" data-r="roda" aria-label="Roda de cor"></canvas>'+
      '<div class="ed-cores"><input type="color" data-r="cor" value="#000000" aria-label="Cor"><input type="text" class="ed-hex" data-r="corHex" maxlength="7" spellcheck="false" aria-label="Cor em hexadecimal">'+amostras+'</div>')+
    pn("estudio",'Estúdio de desenho',
      '<button type="button" class="bt mini" data-ed="estudio-fechar">← Voltar às ferramentas</button>'+
      '<p class="ed-estudio-nota">Atalhos rápidos e perfis para manter o traço consistente.</p>'+
      '<label class="ed-lin">Perfil de traço <select data-r="perfilTraco"><option value="livre">Livre</option><option value="rapido">Rápido</option><option value="suave">Suave</option><option value="muito-suave">Muito liso</option></select></label>'+
      '<label class="ed-lin">Pressão <select data-r="curvaPressao"><option value="normal">Normal</option><option value="suave">Suave</option><option value="firme">Firme</option></select></label>'+
      '<div class="ed-estudio-sub">Favoritos</div><div class="ed-favbar" data-r="favBar"></div>'+
      '<div class="ed-guia-dupla"><select data-r="favAdd" aria-label="Escolher ferramenta favorita">'+favOpcoes+'</select><button type="button" class="bt mini" data-ed="fav-add">Adicionar</button></div>'+
      '<button type="button" class="bt mini" data-ed="camadas-preparar">Preparar camadas de mangá</button>'+
      '<div class="ed-estudio-sub">Ambiente de trabalho</div><label class="ed-estudio-entorno">Cor do entorno <input type="color" data-r="entornoCor" value="#a4a4a4" aria-label="Cor do entorno da folha"></label><button type="button" class="bt mini" data-ed="entorno-reset">Restaurar cor do entorno</button><p class="ed-dica">Muda somente a área ao redor da folha; o desenho e as exportações mantêm suas cores.</p>')+
    pn("sim",'Simetria',
      '<label class="ed-lin">Modo <select data-r="sim"><option value="">Desligada</option><option value="v">Vertical</option><option value="h">Horizontal</option><option value="q">Quatro lados</option><option value="r">Radial</option></select></label>'+
      '<label class="ed-lin" data-r="simNBox">Eixos <input type="range" data-r="simN" min="2" max="12"><output data-r="simNV"></output></label>');
  var paletasDir=
    pn("reticulas",'Retículas de mangá',
      '<div class="ed-reticula-campos"><canvas class="ed-reticula-previa" data-r="reticulaPrevia" width="320" height="130" aria-label="Prévia da retícula sobre papel branco"></canvas>'+
      '<label class="ed-lin">Padrão <select data-r="reticulaTipo" aria-label="Padrão da retícula"><option value="pontos">Pontos</option><option value="linhas">Linhas</option><option value="hachura">Hachura cruzada</option><option value="degrade">Degradê de pontos</option></select></label>'+
      '<label class="ed-lin">Tamanho <input type="range" data-r="reticulaTamanho" aria-label="Tamanho da marca da retícula" min="1" max="24" step="1"><output data-r="reticulaTamanhoV"></output></label>'+
      '<label class="ed-lin">Distância <input type="range" data-r="reticulaEspaco" aria-label="Distância entre marcas da retícula" min="4" max="64" step="1"><output data-r="reticulaEspacoV"></output></label>'+
      '<label class="ed-lin">Ângulo <input type="range" data-r="reticulaAngulo" aria-label="Ângulo da retícula" min="-90" max="90" step="1"><output data-r="reticulaAnguloV"></output></label>'+
      '<label class="ed-lin">Intensidade <input type="range" data-r="reticulaIntensidade" aria-label="Intensidade da retícula" min="10" max="100" step="1"><output data-r="reticulaIntensidadeV"></output></label>'+
      '<label class="ed-lin">Aplicar em <select data-r="reticulaArea" aria-label="Área de aplicação da retícula"><option value="selecao">Seleção atual</option><option value="folha">Folha inteira</option></select></label>'+
      '<p class="ed-reticula-status" data-r="reticulaStatus" role="status">Selecione uma área com retângulo, elipse ou laço e aplique a retícula.</p>'+
      '<button class="bt mini forte" type="button" data-ed="reticula-aplicar">Aplicar em nova camada</button>'+
      '<p class="ed-dica">O desenho fica preservado. A retícula entra em uma camada própria; use a borracha para corrigir e Ctrl+Z para desfazer. Os valores são em pixels da folha.</p></div>')+
    pn("guias",'Guias de construção',
      '<label class="ed-lin ed-chk"><input type="checkbox" data-r="guiaGrade"> Grade</label>'+
      '<label class="ed-lin ed-chk"><input type="checkbox" data-r="guiaPersp"> Perspectiva com pontos de fuga</label>'+
      '<label class="ed-lin">Pontos <select data-r="guiaTipo"><option value="1">1 ponto</option><option value="2">2 pontos</option><option value="3">3 pontos</select></label>'+
      '<label class="ed-lin">Opacidade <input type="range" data-r="guiaOp" min="10" max="80"><output data-r="guiaOpV"></output></label>'+ 
      '<label class="ed-lin">Espaçamento da grade <input type="range" data-r="guiaPasso" min="24" max="240" step="4"><output data-r="guiaPassoV"></output></label>'+ 
      '<label class="ed-lin">Divisões da perspectiva <input type="range" data-r="guiaDiv" min="4" max="24" step="1"><output data-r="guiaDivV"></output></label>'+ 
      '<div class="ed-acoes-cam"><button type="button" class="bt mini" data-ed="guias-editar">Mover pontos</button><button type="button" class="bt mini" data-ed="guias-reset">Resetar</button></div>'+
      '<p class="ed-dica">Ative “Mover pontos” e arraste os pontos azuis diretamente sobre a folha. O terceiro ponto da perspectiva de 3 pontos também pode ser reposicionado.</p>')+
    pn("mat",'Material <span class="pn-sub">[Balão]</span>',
      '<div class="ed-cat">Balão ▸ <b>Tipos</b></div>'+
      '<p class="ed-dica" data-r="balDica" style="margin:0 0 6px"></p>'+
      '<div class="ed-bal-tipos" data-r="balTipos">'+
        TIPOS_BAL.map(function(t){
          return '<button type="button" class="ed-bal-t" data-baltipo="'+t[0]+'" aria-label="Balão de '+t[1]+'"><canvas width="132" height="84"></canvas><span>'+t[1]+'</span></button>';
        }).join("")+
      '</div>'+
      '<div class="ed-acoes-cam" style="margin:0 0 6px"><button type="button" class="bt mini" data-ed="b-novo">+ Inserir no centro</button></div>'+
      '<div data-r="balFalasBox" class="oculto"><div class="ed-sub-t">Falas deste painel</div><div class="ed-falas" data-r="balFalas"></div></div>'+
      '<div data-r="balCampos" class="oculto"><div class="ed-sub-t">Balão selecionado</div>'+
        '<textarea data-r="balTxt" rows="4" placeholder="Escreva a fala aqui" aria-label="Texto do balão"></textarea>'+
        '<label class="ed-lin">Texto <input type="range" data-r="balFs" min="0" max="120"><output data-r="balFsV"></output></label>'+
        '<div class="ed-acoes-cam">'+
          '<button type="button" class="bt mini" data-ed="b-dup">Duplicar</button>'+
          '<button type="button" class="bt mini" data-ed="b-frente">Trazer p/ frente</button>'+
          '<button type="button" class="bt mini risco" data-ed="b-apaga">Apagar</button>'+
        '</div>'+
        '<p class="ed-dica">Arraste o balão para mover. Alças brancas mudam o tamanho; o ponto azul move a ponta.</p>'+
      '</div>')+
    pn("nav",'Navegador',
      '<canvas class="ed-nav" data-r="nav" aria-label="Navegador"></canvas>'+
      '<div class="ed-nav-z"><button type="button" class="bt mini" data-ed="zoom-" aria-label="Diminuir zoom">−</button>'+
        '<input type="range" data-r="navZoom" min="0" max="100" step="0.5" aria-label="Zoom">'+
        '<button type="button" class="bt mini" data-ed="zoom+" aria-label="Aumentar zoom">+</button>'+
        '<button type="button" class="bt mini" data-ed="ajustar">Ajustar</button></div>')+
    pn("cprop",'Propriedade da camada',
      '<label class="ed-lin">Opacidade <input type="range" data-r="cOp" min="0" max="100"><output data-r="cOpV"></output></label>'+
      '<label class="ed-lin">Modo <select data-r="cModo">'+MODOS_CAMADA.map(function(m){ return '<option value="'+m[0]+'">'+m[1]+'</option>'; }).join("")+'</select></label>'+ 
      '<button type="button" class="bt mini" data-ed="img-remover" title="Retirar somente a imagem e conservar o desenho sobre ela">Retirar imagem · manter desenho</button>')+
    pn("cam",'Camadas',
      '<div class="ed-camadas" data-r="camadas"></div>'+
      '<div class="ed-acoes-cam">'+
        '<button type="button" class="bt mini" data-ed="c-nova">+ Nova</button>'+
        '<button type="button" class="bt mini" data-ed="c-dup">Duplicar</button>'+
        '<button type="button" class="bt mini" data-ed="c-sobe" aria-label="Subir camada">↑</button>'+
        '<button type="button" class="bt mini" data-ed="c-desce" aria-label="Descer camada">↓</button>'+
        '<button type="button" class="bt mini" data-ed="c-mescla">Mesclar</button>'+
        '<button type="button" class="bt mini risco" data-ed="c-apaga">Apagar</button>'+
      '</div>');

  $ed.innerHTML=
  '<div class="ed-menus" role="menubar">'+menus+'</div>'+
  '<div class="ed-cmd">'+
    '<button type="button" class="bt" data-ed="voltar">← Roteiro</button>'+
    '<span class="ed-paginas-ed" data-r="paginasEd" aria-label="Páginas do capítulo"></span>'+
    '<span class="ed-pagina-acoes" data-r="paginaAcoes" aria-label="Controles de página">'+
      '<button type="button" class="ed-pagina-acao" data-ed="pagina-ant" title="Página anterior (Alt + Page Up)" aria-label="Página anterior">◀ Página</button>'+
      '<button type="button" class="ed-pagina-acao" data-ed="pagina-gerenciar" title="Ver os conjuntos de páginas">▦ Páginas</button>'+
      '<button type="button" class="ed-pagina-acao" data-ed="pagina-opcoes" title="Editar esta página">Editar página</button>'+
      '<button type="button" class="ed-add-painel-ed" data-ed="pagina-nova" title="Criar uma página como no roteiro">＋ Página</button>'+
      '<button type="button" class="ed-pagina-acao" data-ed="pagina-prox" title="Próxima página (Alt + Page Down)" aria-label="Próxima página">Página ▶</button>'+
    '</span>'+    '<span class="ed-sobre-aviso" data-r="sobreAviso">Sobreposição ativa</span>'+
    '<span class="ed-vsep"></span>'+
    '<span class="ed-grupo"><button type="button" class="bt mini" data-ed="ant" aria-label="Painel anterior" title="Painel anterior">‹</button>'+
      '<button type="button" class="bt mini" data-ed="prox" aria-label="Próximo painel" title="Próximo painel">›</button></span>'+
    '<span class="ed-vsep"></span>'+
    '<span class="ed-grupo"><button type="button" class="bt mini" data-ed="desfazer" title="Desfazer (Ctrl+Z)">↶ Desfazer</button>'+
      '<button type="button" class="bt mini" data-ed="refazer" title="Refazer (Ctrl+Y)">↷ Refazer</button></span>'+
    '<span class="ed-vsep"></span>'+
    '<label class="ed-rot">Tamanho <select data-r="tam">'+optsTam+'</select></label>'+
    '<label class="ed-rot">Forma <select data-r="forma" aria-label="Forma do painel">'+optsForma+'</select></label>'+
    '<button type="button" class="bt mini" data-ed="cortar" title="Cortar painel: arraste os pontos; toque na linha para criar um ponto; toque duplo (ou Delete) remove o ponto selecionado">Cortar painel</button>'+
    '<label class="ed-rot">Borda <input type="range" data-r="borda" min="0" max="40" step="1"><output data-r="bordaV"></output></label>'+
    '<span class="ed-esp"></span>'+
    '<button type="button" class="bt mini" data-ed="laterais" aria-expanded="true" title="Recolher ou mostrar os painéis laterais, mantendo o zoom">Recolher laterais</button>'+
    '<button type="button" class="bt mini" data-ed="rotar-folha" title="Girar a folha de desenho em 90 graus (Tab)">⟳ Girar folha</button>'+ 
    '<button type="button" class="bt mini" data-ed="foco" title="Ocultar toda a interface e deixar apenas a folha (Tab ou Esc para voltar)">Tela cheia</button>'+
    '<button type="button" class="bt mini ed-ref-bt" data-ed="referencias" title="Abrir notas de imagens e inserir uma referência no desenho">🖼 Referências</button>'+ 
    '<button type="button" class="bt mini" data-ed="manequim" title="Abrir o manequim 3D articulado (Shift+J)">Manequim 3D</button>'+
    '<button type="button" class="bt mini" data-ed="png">Baixar PNG</button>'+
    '<button type="button" class="bt mini ed-bt-lat" data-ed="lat">Paletas</button>'+
  '</div>'+
  '<div class="ed-pg-janela oculto" data-r="paginaJanela" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Gerenciador de páginas">'+
    '<section class="ed-pg-dialog" data-r="paginaConteudo"></section>'+
  '</div>'+
  '<div class="ed-ref-janela oculto" data-r="referenciasJanela" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Notas de imagens e referências">'+
    '<section class="ed-ref-dialog" data-r="referenciasConteudo"></section>'+ 
  '</div>'+ 
  '<aside class="ed-ref-estudo oculto" data-r="referenciasEstudo" aria-label="Estudo de referência"><section data-r="referenciasEstudoConteudo"></section></aside>'+ 
  '<aside class="ed-sfx oculto" data-r="sfxJanela" aria-label="Onomatopeias editáveis">'+
    '<header><strong>Onomatopeias</strong><button class="bt mini" type="button" data-ed="sfx-fechar" aria-label="Fechar onomatopeias">×</button></header>'+
    '<div class="ed-sfx-corpo"><button class="bt mini forte" type="button" data-ed="sfx-novo">+ Nova onomatopeia</button>'+
      '<label class="ed-lin">Na folha <select data-r="sfxLista" aria-label="Escolher onomatopeia"><option value="">Escolher…</option></select></label>'+
      '<div data-r="sfxCampos" class="oculto"><label>Texto<textarea rows="3" maxlength="2000" data-r="sfxTexto" aria-label="Texto da onomatopeia" placeholder="BOOM!"></textarea></label>'+
        '<label class="ed-lin">Fonte <select data-r="sfxFonte"><option value="impact">Impacto</option><option value="quadrada">Quadrada</option><option value="comic">Quadrinhos</option><option value="serif">Serifada</option></select></label>'+
        '<label class="ed-lin">Altura <input type="number" min="40" max="4000" step="5" data-r="sfxAltura" aria-label="Altura da onomatopeia em pixels"> px</label>'+
        '<label class="ed-lin">Largura <input type="number" min="60" max="6000" step="5" data-r="sfxLargura" aria-label="Largura da onomatopeia em pixels"> px</label>'+
        '<label class="ed-lin">Girar <input type="range" min="-180" max="180" step="1" data-r="sfxRot"><output data-r="sfxRotV"></output></label>'+
        '<label class="ed-lin">Cor das letras <input type="color" data-r="sfxCor" value="#111111"></label>'+
        '<label class="ed-lin">Cor do contorno <input type="color" data-r="sfxContorno" value="#ffffff"></label>'+
        '<label class="ed-lin">Contorno <input type="range" min="0" max="32" step="1" data-r="sfxEsp"><output data-r="sfxEspV"></output></label>'+
        '<label class="ed-lin"><input type="checkbox" data-r="sfxItalico"> Letras inclinadas</label>'+
        '<div class="ed-acoes-cam"><button class="bt mini" type="button" data-ed="sfx-editar">Mover na folha</button><button class="bt mini" type="button" data-ed="b-dup">Duplicar</button><button class="bt mini" type="button" data-ed="b-frente">Trazer p/ frente</button><button class="bt mini risco" type="button" data-ed="b-apaga">Apagar</button></div>'+
      '</div><p class="ed-dica">Use “Mover na folha”, arraste o texto, puxe os cantos para redimensionar ou a alça azul para girar. O texto continua editável. Shift+O abre esta janela.</p>'+
    '</div></aside>'+
  '<aside class="ed-m3d oculto" data-r="m3dJanela" aria-label="Manequim 3D articulado">'+
    '<header class="ed-m3d-cab" data-r="m3dArrastar"><strong>Manequim 3D</strong><button type="button" class="bt mini" data-ed="m3d-fechar" aria-label="Fechar manequim 3D">×</button></header>'+
    '<div class="ed-m3d-corpo"><canvas class="ed-m3d-cena" data-r="m3dCanvas" width="660" height="600" aria-label="Cena do manequim 3D: arraste para girar a câmera ou ajustar articulações"></canvas>'+
      '<p class="ed-dica">Use como referência ao lado da folha. Arraste a cena para girar; em Articular, arraste um ponto azul para mudar a pose.</p>'+
      '<div class="ed-guia-dupla"><label>Interação<select data-r="m3dModo"><option value="camera">Girar câmera</option><option value="pose">Articular corpo</option></select></label><label>Pose<select data-r="m3dPose">'+M3D.poses.map(function(p){return '<option value="'+p[0]+'">'+esc(p[1])+'</option>';}).join("")+'<option value="personalizada">Personalizada</option></select></label></div>'+
      '<div class="ed-acoes-cam"><button class="bt mini" type="button" data-ed="m3d-frente">Frente</button><button class="bt mini" type="button" data-ed="m3d-perfil">Perfil</button><button class="bt mini" type="button" data-ed="m3d-costas">Costas</button><button class="bt mini" type="button" data-ed="m3d-34">¾</button><button class="bt mini" type="button" data-ed="m3d-enquadrar">Enquadrar</button><button class="bt mini" type="button" data-ed="m3d-espelhar">Espelhar pose</button></div>'+
      '<label class="ed-lin">Parte do corpo <select data-r="m3dParte">'+M3D.partes.map(function(p){return '<option value="'+p[0]+'">'+esc(p[1])+'</option>';}).join("")+'</select></label>'+
      ['X','Y','Z'].map(function(e,i){return '<label class="ed-lin">'+['Dobrar','Torcer','Inclinar'][i]+' <input type="range" data-r="m3dJ'+e+'" min="-150" max="150" step="1" aria-label="Articulação eixo '+e+'"><output data-r="m3dJ'+e+'V"></output></label>';}).join("")+
      '<details><summary>Proporções e visualização</summary>'+
        '<label class="ed-lin">Altura <input type="range" data-r="m3dAltura" min="70" max="130" value="100"><output data-r="m3dAlturaV"></output></label>'+
        '<label class="ed-lin">Ombros <input type="range" data-r="m3dOmbros" min="65" max="145" value="100"><output data-r="m3dOmbrosV"></output></label>'+
        '<label class="ed-lin">Quadril <input type="range" data-r="m3dQuadril" min="65" max="145" value="100"><output data-r="m3dQuadrilV"></output></label>'+
        '<label class="ed-lin">Cabeça <input type="range" data-r="m3dCabeca" min="70" max="165" value="100"><output data-r="m3dCabecaV"></output></label>'+
        '<label class="ed-lin">Zoom da referência <input type="range" data-r="m3dZoom" min="60" max="180" value="100"><output data-r="m3dZoomV"></output></label>'+
        '<label class="ed-lin">Perspectiva <input type="range" data-r="m3dPersp" min="0" max="100" value="60"><output data-r="m3dPerspV"></output></label>'+
        '<label class="ed-lin">Estilo <select data-r="m3dEstilo"><option value="volume">Volume sombreado</option><option value="contorno">Contorno</option><option value="esqueleto">Esqueleto de construção</option></select></label>'+
      '</details>'+
      '<div class="ed-guia-dupla"><input type="text" data-r="m3dNomePose" placeholder="Nome da sua pose" maxlength="40" aria-label="Nome para salvar pose"><button type="button" class="bt mini" data-ed="m3d-salvar">Salvar pose</button></div>'+
      '<label class="ed-lin">Minhas poses <select data-r="m3dSalvas" aria-label="Carregar pose salva"><option value="">Escolher…</option></select></label>'+
      '<details open><summary>Posicionar na folha</summary><canvas data-r="m3dFolhaCanvas" width="320" height="230" style="display:block;width:100%;height:auto;margin:6px 0;touch-action:none;cursor:move;background:#e5e7eb;border:1px solid var(--e-bd)" aria-label="Prévia da posição na folha: arraste para mover a base"></canvas>'+
        '<p class="ed-dica">Arraste esta miniatura para posicionar a base. Os ajustes abaixo não alteram o zoom da folha.</p>'+
        '<label class="ed-lin">Tamanho na folha <input type="range" min="15" max="150" data-r="m3dEscala" aria-label="Tamanho do manequim na folha"><output data-r="m3dEscalaV"></output></label>'+
        '<label class="ed-lin">Horizontal <input type="range" min="0" max="100" data-r="m3dPosX" aria-label="Posição horizontal do manequim"><output data-r="m3dPosXV"></output></label>'+
        '<label class="ed-lin">Vertical <input type="range" min="0" max="100" data-r="m3dPosY" aria-label="Posição vertical do manequim"><output data-r="m3dPosYV"></output></label>'+
        '<label class="ed-lin">Girar base <input type="range" min="-180" max="180" data-r="m3dGiro" aria-label="Rotação da base na folha"><output data-r="m3dGiroV"></output></label>'+
        '<label class="ed-lin">Opacidade da base <input type="range" min="5" max="100" data-r="m3dOpacidade" aria-label="Opacidade da base do manequim"><output data-r="m3dOpacidadeV"></output></label>'+
        '<div class="ed-acoes-cam"><button type="button" class="bt mini" data-ed="m3d-centralizar">Centralizar base</button><button type="button" class="bt mini" data-ed="m3d-carregar-base">Carregar base da folha</button></div>'+
      '</details>'+
      '<p class="ed-dica" data-r="m3dStatus" role="status"></p>'+
      '<div class="ed-acoes-cam"><button type="button" class="bt mini forte" data-ed="m3d-inserir">Inserir nova base</button><button type="button" class="bt mini" data-ed="m3d-atualizar-base">Atualizar esta base</button><button type="button" class="bt mini" data-ed="m3d-reset">Restaurar manequim</button></div>'+
      '<p class="ed-dica">Carregue uma base criada com estes controles para ajustar a pose e atualizar somente a imagem. Seu traço permanece na camada separada. Mãos e pés são volumes de construção, sem dedos articulados.</p>'+
    '</div></aside>'+
  '<input type="file" data-r="imagemArquivo" accept="image/*" style="display:none" aria-label="Escolher imagem para importar">'+
  '<input type="color" data-r="tomDesenho" value="#1d1d1d" class="ed-tom-in" tabindex="-1" aria-label="Tom para converter imagem em lápis ou caneta">'+
  '<div class="ed-acesso-tableta" role="toolbar" aria-label="Acesso rápido para mesa digitalizadora">'+
    '<button type="button" class="bt mini" data-ferr="selecionar" title="Selecionar e transformar (V)">V <span>Selecionar</span></button>'+ 
    '<button type="button" class="bt mini" data-ed="sel-laco" title="Seleção por laço livre">Laço</button>'+ 
    '<button type="button" class="bt mini" data-ferr="caneta" title="Caneta G (B)">B <span>Caneta</span></button>'+ 
    '<button type="button" class="bt mini" data-ferr="cubo" title="Formas tridimensionais (Espaço)">3D</button>'+ 
    '<button type="button" class="bt mini" data-ferr="borracha" title="Borracha (E)">E <span>Borracha</span></button>'+ 
    '<button type="button" class="bt mini" data-ferr="mao" title="Mover a folha (H / Espaço)">H <span>Mover</span></button>'+ 
    '<button type="button" class="bt mini" data-ed="referencias" title="Abrir referências">🖼</button>'+ 
    '<button type="button" class="bt mini" data-ed="guias-editar" title="Mover pontos de fuga e guias">Guias</button>'+ 
    '<button type="button" class="bt mini" data-ficha-personagem="" title="Abrir fichas visuais de personagens (Shift+F)">Personagens</button>'+
    '<button type="button" class="bt mini" data-ed="reticulas" title="Aplicar retículas na seleção ou na folha (Shift+K)">Retículas</button>'+
    '<button type="button" class="bt mini" data-ed="sfx-abrir" title="Criar e editar onomatopeias (Shift+O)">Onomatopeia</button>'+
    '<button type="button" class="bt mini" data-ed="desfazer" title="Desfazer (Ctrl+Z)">↶</button>'+ 
    '<button type="button" class="bt mini" data-ed="refazer" title="Refazer (Ctrl+Y)">↷</button>'+ 
    '<button type="button" class="bt mini" data-ed="preencher" title="Cobrir a área cinza do editor com a folha">⛶ <span>Folha</span></button>'+ 
  '</div>'+ 
  '<div class="ed-corpo">'+
    '<div class="ed-tools" role="toolbar" aria-label="Ferramentas"><button type="button" class="ed-tb estudio-atalho" data-ed="estudio" aria-label="Estúdio de desenho" aria-pressed="false" title="Estúdio de desenho (Shift+S)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 10h6"/></svg><small>Estúdio</small></button><div class="ed-sep"></div>'+tools+'</div>'+
    '<button type="button" class="bt mini ed-reabrir ed-reabrir-e" data-ed="lateral-e" aria-label="Mostrar ferramentas laterais" title="Mostrar ferramentas">›</button><button type="button" class="bt mini ed-reabrir ed-reabrir-d" data-ed="lateral-d" aria-label="Mostrar informações laterais" title="Mostrar informações">‹</button>'+
    '<div class="ed-centro">'+
      '<div class="ed-abas"><div class="ed-aba"><span class="ed-titulo" data-r="titulo"></span>'+
        '<button type="button" class="ed-aba-x" data-ed="voltar" aria-label="Fechar e voltar ao roteiro" title="Fechar e voltar ao roteiro">×</button></div></div>'+
      '<div class="ed-palco" data-r="palco"><canvas data-r="view"></canvas><canvas data-r="over"></canvas>'+
        '<div class="ed-carregando" data-r="carregando">Abrindo o desenho…</div></div>'+
      '<div class="ed-status"><span class="ed-zoom" data-r="zoom">100%</span><span class="ed-dim" data-r="dimTxt"></span>'+
        '<span id="coord" data-r="coord"></span><span class="ed-esp"></span><span class="estado" data-r="estado" role="status"></span><button type="button" class="bt mini oculto" data-ed="salvar" data-r="tentarSalvar">Tentar salvar</button></div>'+
    '</div>'+
    '<div class="ed-lat" data-r="lat">'+
      '<div class="ed-dock ed-dockL"><div class="ed-dock-cab"><strong>Ferramentas</strong><button type="button" class="bt mini" data-ed="lateral-e" aria-label="Recolher ferramentas laterais">‹ Recolher</button></div>'+paletasEsq+'</div>'+
      '<div class="ed-dock ed-dockR"><div class="ed-dock-cab"><strong>Informações</strong><button type="button" class="bt mini" data-ed="lateral-d" aria-label="Recolher informações laterais">Recolher ›</button></div>'+paletasDir+'</div>'+
    '</div>'+
    ajuda+
  '</div>';
  document.body.appendChild($ed);
  Array.prototype.forEach.call($ed.querySelectorAll("[data-r]"),function(n){ E[n.getAttribute("data-r")]=n; });
  aplicarPaineis(); atualizarMenus();
  miniaturasBaloes();
  renderMiniaturasPinceis();
  atualizarReticula();
  ligarEventos();
  ["click","input","change","pointerdown","paste","drop"].forEach(function(tipo){$ed.addEventListener(tipo,bloquearDuranteLeituraDesenho,true);});
  montarEditorMovel();
  aplicarInterfaceEditor();
}

/* ---------- abrir / fechar ---------- */
function bloquearDuranteLeituraDesenho(e){if(S&&S.carregando){e.preventDefault();e.stopImmediatePropagation();}}
function falhaAbrirDesenho(s){
  if(S!==s)return;
  fecharPainelMovel(false);
  clearTimeout(s.tSalvar);cancelAnimationFrame(s.raf);
  document.removeEventListener("keydown",onKey,true);document.removeEventListener("keyup",onKeyUp,true);
  $ed.classList.add("oculto");$ed.removeAttribute("aria-busy");document.body.classList.remove("ed-aberto");
  S=null;
  var estadoPrincipal=document.getElementById("estado");if(estadoPrincipal)estadoPrincipal.textContent="falha ao ler o desenho · tente abri-lo novamente";
  try{if(s.opts.aviso)s.opts.aviso("Não foi possível abrir o desenho com segurança. Tente abri-lo novamente sem apagar os dados do navegador.");}catch(e){}
}
function abrir(opts){
  montarDOM();
  if(S) return;
  fecharPainelMovel(false);sincronizarEditorMovel();
  var painel=opts.painel;
  var chave=TAMANHOS[painel.tamanho]?painel.tamanho:PADRAO_TAM;
  var dim=dimensoes(chave);
  var s=S={
    opts:opts,painel:painel,chave:chave,dim:dim,camadas:[],ativa:null,fundo:opts.fundoPagina||null,modoPagina:!!opts.modoPagina,
    hist:[],refaz:[],bytes:0,
    z:1,tx:0,ty:0,rot:0,pw:0,ph:0,dpr:window.devicePixelRatio||1,ajustado:true,
    ptrs:{},nptr:0,vivo:null,flut:null,sel:null,selOp:null,selForma:"retangulo",selPath:null,baloes:[],balSel:null,balOp:null,balIni:null,balSnap:null,balValId:null,
    tmp:novoCanvas(dim.w,dim.h),live:novoCanvas(dim.w,dim.h),
    sujoView:true,sujoOver:true,carregando:true,tocou:false,sujo:false,revisao:0,
    espaco:false,tSalvar:null,cursor:null,pan:null,gesto:null,raf:0,
    ferr:CFG.ferr,ferrAnt:"caneta",propIni:null,
    cortando:false,vSel:null,vDrag:null,vUlt:null
  };
  $ed.classList.remove("oculto");
  $ed.setAttribute("aria-busy","true");
  $ed.classList.toggle("modo-livre",!!opts.modoLivre);
  $ed.classList.toggle("modo-pagina",!!opts.modoPagina);
  document.body.classList.add("ed-aberto");
  var textoVoltar=opts.rotuloVoltar||(opts.modoLivre?"← Voltar":"← Roteiro");
  var ariaVoltar=opts.ariaVoltar||(opts.modoLivre?"Fechar desenho livre":"Fechar e voltar ao roteiro");
  qa("[data-ed=voltar]").forEach(function(b,i){
    if(i===0) b.textContent=textoVoltar;
    b.setAttribute("aria-label",ariaVoltar);
    b.setAttribute("title",ariaVoltar);
  });
  E.carregando.classList.remove("oculto");
  E.titulo.textContent=opts.titulo||"Painel";
  E.tam.value=chave;
  if(E.tomDesenho) E.tomDesenho.value=CFG.tomDesenho;
  if(E.imgFerr) E.imgFerr.value=CFG.imgFerr;
  E.borda.value=bordaAtual(); E.bordaV.textContent=bordaAtual();
  atualizarForma(); if(E.guiaGrade)E.guiaGrade.checked=!!CFG.guia.grade;if(E.guiaPersp)E.guiaPersp.checked=!!CFG.guia.persp;if(E.guiaTipo)E.guiaTipo.value=CFG.guia.tipo;if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} if(E.guiaGrade) E.guiaGrade.checked=!!CFG.guia.grade; if(E.guiaPersp) E.guiaPersp.checked=!!CFG.guia.persp; if(E.guiaTipo) E.guiaTipo.value=CFG.guia.tipo; if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";}
  qa("[data-ed=ant]").forEach(function(b){ b.disabled=!opts.ant; }); qa("[data-ed=prox]").forEach(function(b){ b.disabled=!opts.prox; });
  fecharMenus(); E.ajuda.classList.add("oculto"); E.ajuda.setAttribute("aria-hidden","true");
  atualizarEstadoSalvarDesenho(s,"");
  E.lat.classList.remove("aberta");
  ajustarCanvasPalco();
  atualizarFerr(); atualizarBotoesHist();
  document.addEventListener("keydown",onKey,true);
  document.addEventListener("keyup",onKeyUp,true);
  $ed.focus();

  bdLer(painel.id).then(function(rec){
    if(S!==s) return;
    if(rec===null||(rec&&Array.isArray(rec.camadas)&&!rec.camadas.length&&!painel.temDesenho)){
      if(painel.temDesenho)throw erroLeituraImagem("O desenho referenciado não foi encontrado. Nenhuma tela em branco será salva por cima dele.","desenho_ausente");
      var L=criarCamada("Camada 1"); s.camadas=[L]; s.ativa=L.id; return pronto();
    }
    if(!rec||!Array.isArray(rec.camadas)||!rec.camadas.length)throw erroLeituraImagem("O desenho armazenado está incompleto.","registro_imagem");
    var ox=Math.round((dim.w-(rec.w||dim.w))/2), oy=Math.round((dim.h-(rec.h||dim.h))/2);
    var baloes=(rec.baloes||[]).map(function(b){
      var c=cloneBal(b); c.x+=ox; c.y+=oy; c.px+=ox; c.py+=oy; return c;
    });
    var camadas=[],pend=rec.camadas.map(function(c,indice){return Promise.resolve().then(function(){
      if(S!==s)return;
      if(!c||!c.blob)throw erroLeituraImagem("Uma camada do desenho não está disponível.","registro_imagem");
      var L=criarCamada(c.nome||"Camada",c.id);
      L.vis=c.vis!==false; L.bloqueada=!!c.bloqueada; L.op=c.op==null?100:c.op; L.modo=c.modo||"normal"; L.tipo=c.tipo||(/^Imagem:/i.test(L.nome)?"imagem":null); L.sobreImagemId=c.sobreImagemId||null; L.manequim3d=dadosBaseManequim(c.manequim3d); L.blob=c.blob||null; L.originalBlob=c.originalBlob||null; L.sujo=false;
      camadas[indice]=L;
      return decodificar(c.blob).then(function(img){
        if(!img)throw erroLeituraImagem("Uma imagem do desenho não pôde ser aberta.","registro_imagem");
        if(img){ L.cx.drawImage(img,ox,oy); if(ox||oy) L.sujo=true; }
      });
    });});
    return Promise.all(pend).then(function(){
      if(S!==s)return;
      s.camadas=camadas;s.baloes=baloes;s.tocou=true;
      var ok=s.camadas.some(function(L){ return L.id===rec.ativa; });
      s.ativa=ok?rec.ativa:s.camadas[s.camadas.length-1].id;
      pronto();
    });
  }).catch(function(){falhaAbrirDesenho(s);});
  function pronto(){
    if(S!==s) return;
    s.carregando=false;$ed.removeAttribute("aria-busy"); E.carregando.classList.add("oculto");
    ajustar(); listaPaginasEditor(); listaCamadas(); pedir(true); atualizarBal();
  }
}

function decodificar(blob){
  if(blob==null)return Promise.resolve(null);
  if(typeof blob==="string"){blob=dataParaBlob(blob);if(typeof blob==="string")return Promise.reject(erroLeituraImagem("A imagem armazenada não pôde ser decodificada.","registro_imagem"));}
  if(!blob||blob.size===0)return Promise.reject(erroLeituraImagem("A imagem armazenada está vazia.","registro_imagem"));
  function peloElemento(){return new Promise(function(res,rejeitar){
    var u=null;
    function limpar(){if(u){try{URL.revokeObjectURL(u);}catch(e){}u=null;}}
    function falhou(){limpar();rejeitar(erroLeituraImagem("Não foi possível decodificar a imagem armazenada.","registro_imagem"));}
    try{u=URL.createObjectURL(blob);var im=new Image();im.onload=function(){if(!im.width||!im.height){falhou();return;}limpar();res(im);};im.onerror=falhou;im.src=u;}catch(e){falhou();}
  });}
  if(window.createImageBitmap)return Promise.resolve().then(function(){return createImageBitmap(blob);}).then(function(img){if(!img||!img.width||!img.height)throw erroLeituraImagem();return img;}).catch(peloElemento);
  return peloElemento();
}

function criarCamada(nome,id){
  var c=novoCanvas(S.dim.w,S.dim.h);
  return {id:id||nid(),nome:nome,vis:true,bloqueada:false,op:100,modo:"normal",cv:c,cx:c.getContext("2d"),sujo:true,blob:null};
}
function porId(id){ for(var i=0;i<S.camadas.length;i++) if(S.camadas[i].id===id) return S.camadas[i]; return null; }
function camadaAtiva(){ return porId(S.ativa); }
function ehCamadaImagem(L){ return !!L&&(L.tipo==="imagem"||/^Imagem:/i.test(L.nome||"")); }
function camadaImagemAlvo(){
  var A=camadaAtiva();
  if(ehCamadaImagem(A)) return A;
  if(A&&A.sobreImagemId){ var associada=porId(A.sobreImagemId); if(ehCamadaImagem(associada)) return associada; }
  /* O botão de retirar imagem não deve obrigar o usuário a trocar de camada.
     Se a camada ativa não tiver vínculo, usa a imagem mais recente do painel. */
  for(var i=S.camadas.length-1;i>=0;i--) if(ehCamadaImagem(S.camadas[i])) return S.camadas[i];
  return null;
}
function criarCamadaDesenhoSobreImagem(L){
  if(!S||!ehCamadaImagem(L)) return L;
  for(var i=0;i<S.camadas.length;i++) if(S.camadas[i].sobreImagemId===L.id) { S.ativa=S.camadas[i].id; listaCamadas(); return S.camadas[i]; }
  var desenho=criarCamada("Desenho sobre: "+String(L.nome||"Imagem").replace(/^Imagem:\s*/i,"").slice(0,28));
  desenho.tipo="desenho"; desenho.sobreImagemId=L.id;
  var idx=S.camadas.indexOf(L); S.camadas.splice(idx+1,0,desenho); S.ativa=desenho.id;
  listaCamadas(); agendarSalvar(); aviso("Camada de desenho criada. A imagem e o desenho agora ficam independentes.");
  return desenho;
}
function separarDesenhoMisturado(L){
  if(!S||!L||!L.originalBlob||S.camadas.some(function(C){return C.sobreImagemId===L.id;})) return Promise.resolve();
  var s=S;
  return decodificar(L.originalBlob).then(function(img){
    if(!img||S!==s||porId(L.id)!==L)throw erroLeituraImagem();
    var base=novoCanvas(S.dim.w,S.dim.h), bx=base.getContext("2d");
    bx.drawImage(img,0,0,S.dim.w,S.dim.h);
    var atual=L.cx.getImageData(0,0,S.dim.w,S.dim.h), original=bx.getImageData(0,0,S.dim.w,S.dim.h), saida=bx.createImageData(S.dim.w,S.dim.h), tem=false;
    for(var i=0;i<atual.data.length;i+=4){
      var a=atual.data[i+3], ba=original.data[i+3], dif=Math.abs(atual.data[i]-original.data[i])+Math.abs(atual.data[i+1]-original.data[i+1])+Math.abs(atual.data[i+2]-original.data[i+2])+Math.abs(a-ba);
      if(a>4&&(ba<4||dif>28)){saida.data[i]=atual.data[i];saida.data[i+1]=atual.data[i+1];saida.data[i+2]=atual.data[i+2];saida.data[i+3]=a;tem=true;}
    }
    var desenho=criarCamada("Desenho separado: "+String(L.nome||"Imagem").replace(/^Imagem:\s*/i,"").slice(0,24)); desenho.tipo="desenho"; desenho.sobreImagemId=L.id; if(tem) desenho.cx.putImageData(saida,0,0);
    var idx=S.camadas.indexOf(L); S.camadas.splice(idx+1,0,desenho); S.ativa=desenho.id; desenho.sujo=true; listaCamadas(); agendarSalvar();
  });
}
function qa(sel){ return Array.prototype.slice.call($ed.querySelectorAll(sel)); }
function aviso(t){ if(S&&S.opts.aviso) S.opts.aviso(t); }
function bordaAtual(){
  var b=S&&S.painel.borda;
  return typeof b==="number"?b:BORDA_PADRAO;
}

function sair(depois,daEdicaoPagina){
  if(!S) return Promise.resolve(true);
  var s=S;if(s.fechando)return s.fechando;
  if(s.editandoPagina&&!daEdicaoPagina){aviso("Aguarde a operação da página terminar.");return Promise.resolve(false);}
  s.fechando=Promise.resolve().then(function(){
    if(S!==s)return false;
    fecharSfx();fecharEdicaoBal();commitFlut();return salvarAgora();
  }).then(function(ok){
    if(!ok||S!==s||s.sujo||interacaoDesenho(s))return false;
    fecharPainelMovel(false);fecharManequim3D();alternarModoFoco(false);
    document.removeEventListener("keydown",onKey,true);
    document.removeEventListener("keyup",onKeyUp,true);
    cancelAnimationFrame(s.raf);
    $ed.classList.add("oculto"); document.body.classList.remove("ed-aberto");
    S=null;
    try{if(s.opts.aoFechar)s.opts.aoFechar(s.painel);if(depois)depois();}
    catch(e){try{if(s.opts.aviso)s.opts.aviso("O desenho foi salvo, mas a tela seguinte não pôde ser atualizada. Tente abri-la novamente.");}catch(ignorar){}}
    return true;
  }).catch(function(){falhaSalvarDesenho(s);return false;}).finally(function(){
    s.fechando=null;if(S===s){s.trocandoPagina=false;atualizarEstadoSalvarDesenho(s);}
  });
  return s.fechando;
}

/* ---------- salvar ---------- */
function interacaoDesenho(s){return !!(s&&(s.vivo||s.pan||s.gesto||s.flut||s.selOp||s.balOp||s.vDrag||s.propIni));}
function temAlteracoesDesenho(){return !!(S&&(S.sujo||S.salvando||S.editandoPagina||interacaoDesenho(S)));}
function atualizarEstadoSalvarDesenho(s,texto){
  if(S!==s)return;if(typeof texto==="string")E.estado.textContent=texto;
  if(E.tentarSalvar){E.tentarSalvar.classList.toggle("oculto",!s.erroSalvar);E.tentarSalvar.disabled=!!s.salvando;}
}
function falhaSalvarDesenho(s){
  s.sujo=true;s.erroSalvar=true;atualizarEstadoSalvarDesenho(s,"não salvo · falha ao salvar");
  try{if(S===s&&s.opts.aviso)s.opts.aviso("Não foi possível confirmar o salvamento. O desenho continua aberto; use Tentar salvar ou exporte um PNG antes de fechar.");}catch(ignorar){}
}
function agendarSalvar(){
  if(!S) return;
  S.sujo=true;S.revisao=(S.revisao||0)+1;atualizarEstadoSalvarDesenho(S,S.erroSalvar?"não salvo · falha anterior":"não salvo");
  var s=S;clearTimeout(s.tSalvar);s.tSalvar=setTimeout(function(){salvarQuandoParar(s);},800);
}
function salvarQuandoParar(s){
  if(S!==s||!s.sujo)return;
  if(s.flut)return;
  if(interacaoDesenho(s)||s.carregando){s.tSalvar=setTimeout(function(){salvarQuandoParar(s);},250);return;}
  salvarAgora();
}
function salvarAgora(){
  var s=S;if(!s)return Promise.resolve(true);
  if(s.salvando)return s.salvando.then(function(ok){return ok&&S===s?salvarAgora():false;});
  clearTimeout(s.tSalvar);
  if(interacaoDesenho(s)||s.carregando){atualizarEstadoSalvarDesenho(s,"conclua a operação para salvar");return Promise.resolve(false);}
  if(!s.sujo)return Promise.resolve(true);
  var revisao,camadas,rec;
  atualizarEstadoSalvarDesenho(s,"salvando…");
  var gravacao=Promise.resolve().then(function(){
    revisao=s.revisao||0;camadas=s.camadas.slice();
    rec={v:1,w:s.dim.w,h:s.dim.h,ativa:s.ativa,baloes:s.baloes.map(cloneBal),camadas:[]};
    return Promise.all(camadas.map(function(L){
      var c={id:L.id,nome:L.nome,tipo:L.tipo||null,sobreImagemId:L.sobreImagemId||null,manequim3d:dadosBaseManequim(L.manequim3d),vis:L.vis,bloqueada:!!L.bloqueada,op:L.op,modo:L.modo,blob:L.blob,originalBlob:L.originalBlob||null};
      if(L.blob&&!L.sujo)return Promise.resolve(c);
      return new Promise(function(res,rejeitar){
        try{L.cv.toBlob(function(b){if(!b||!b.size){rejeitar(new Error("Falha ao preparar a imagem da camada."));return;}c.blob=b;res(c);},"image/png");}catch(e){rejeitar(e);}
      });
    }));
  }).then(function(registros){
    if(S!==s)return false;rec.camadas=registros;return bdGravar(s.painel.id,rec);
  }).then(function(ok){
    if(ok!==true)throw new Error("Gravação do desenho não confirmada.");
    if(S!==s)return false;
    if((s.revisao||0)!==revisao||interacaoDesenho(s)){s.sujo=true;atualizarEstadoSalvarDesenho(s,"não salvo");return true;}
    var previa=s.tocou?miniatura(s):null;
    camadas.forEach(function(L,i){L.blob=rec.camadas[i].blob;L.sujo=false;});
    if(s.tocou){s.painel.miniatura=previa;s.painel.temDesenho=true;}
    if(s.opts.aoMudar)s.opts.aoMudar();
    // O callback pode iniciar outra edição: só a revisão confirmada fica limpa.
    s.sujo=(s.revisao||0)!==revisao;if(!s.sujo)s.erroSalvar=false;
    atualizarEstadoSalvarDesenho(s,s.sujo?"não salvo":"salvo");return true;
  }).catch(function(){falhaSalvarDesenho(s);return false;}).finally(function(){
    if(s.salvando===gravacao)s.salvando=null;atualizarEstadoSalvarDesenho(s);
  });
  s.salvando=gravacao;atualizarEstadoSalvarDesenho(s);
  return gravacao.then(function(ok){if(!ok||S!==s)return false;return s.sujo?salvarAgora():true;});
}
function tentarSalvarDesenho(){
  var s=S;return Promise.resolve().then(function(){
    if(!s)return true;if(S!==s)return false;
    fecharEdicaoBal();commitFlut();return salvarAgora();
  }).catch(function(){if(s)falhaSalvarDesenho(s);return false;});
}
function aoSairDaPagina(e){
  if(!temAlteracoesDesenho())return;
  if(S&&!S.salvando&&!interacaoDesenho(S))salvarAgora();
  e.preventDefault();e.returnValue="";
}
function aoMudarVisibilidadeDesenho(){
  if(S&&S.sujo&&!S.salvando&&!interacaoDesenho(S))salvarAgora();
}
function exportarDadosEditor(){
  return Promise.all(COPIAS_DESENHO.slice()).then(function(){return tentarSalvarDesenho();}).then(function(ok){
    if(!ok||temAlteracoesDesenho())throw new Error("O desenho aberto ainda não foi salvo. Mantenha o editor aberto e tente salvar novamente antes de criar o backup.");
    return exportarDesenhos();
  });
}
function miniatura(s){
  var k=320/Math.max(s.dim.w,s.dim.h);
  var c=novoCanvas(Math.max(1,Math.round(s.dim.w*k)),Math.max(1,Math.round(s.dim.h*k))), x=c.getContext("2d");
  if(!(s.painel&&s.painel.sobreposto)){ x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); }
  x.save(); x.scale(k,k); x.imageSmoothingQuality="high";
  camadasEm(x,false,s); desenharBaloes(x,s.baloes,Math.max(s.dim.w,s.dim.h)); x.restore();
  return c.toDataURL(s.painel&&s.painel.sobreposto?"image/png":"image/jpeg",0.72);
}

/* ---------- composição ---------- */
function camadaEfetiva(s,L){
  if(L.id!==s.ativa||(!s.vivo&&!s.flut)) return L.cv;
  var t=s.tmp, c=t.getContext("2d");
  c.globalAlpha=1; c.globalCompositeOperation="source-over";
  c.clearRect(0,0,s.dim.w,s.dim.h); c.drawImage(L.cv,0,0);
  var f=s.flut;
  if(f){ c.imageSmoothingQuality="high"; c.drawImage(f.cv,0,0,f.ow,f.oh,f.x,f.y,f.w,f.h); }
  var v=s.vivo;
  if(v){
    c.globalAlpha=v.op; c.globalCompositeOperation=v.borracha?"destination-out":"source-over";
    c.drawImage(v.cv,0,0);
    c.globalAlpha=1; c.globalCompositeOperation="source-over";
  }
  return t;
}
function camadasEm(c,efetivas,s){
  s=s||S;
  s.camadas.forEach(function(L){
    if(!L.vis) return;
    c.globalAlpha=L.op/100;
    c.globalCompositeOperation=opComp(L.modo);
    c.drawImage(efetivas?camadaEfetiva(s,L):L.cv,0,0);
  });
  c.globalAlpha=1; c.globalCompositeOperation="source-over";
}

function fundoEm(c,s){
  s=s||S;
  if(!s||!s.fundo) return;
  c.save(); c.globalAlpha=1; c.globalCompositeOperation="source-over";
  c.drawImage(s.fundo,0,0,s.dim.w,s.dim.h);
  c.restore();
}

function desenharBorda(c,s){
  s=s||S;
  var b=typeof s.painel.borda==="number"?s.painel.borda:BORDA_PADRAO; if(b<=0) return;
  var f=formaDe(s.painel);
  c.save(); c.strokeStyle="#111";
  if(f){                                   /* contorno do corte, por dentro da forma */
    c.beginPath(); trilhaForma(c,f,s.dim.w,s.dim.h); c.clip();
    c.beginPath(); trilhaForma(c,f,s.dim.w,s.dim.h);
    c.lineWidth=b*2; c.lineJoin="miter"; c.miterLimit=10; c.stroke();
  }else{
    c.lineWidth=b; c.strokeRect(b/2,b/2,s.dim.w-b,s.dim.h-b);
  }
  c.restore();
}

/* ---------- cortar o painel (forma) ---------- */
function atualizarForma(){
  if(!S||!E.forma) return;
  E.forma.value=formaId(formaDe(S.painel));
  qa("[data-ed=cortar]").forEach(function(b){ b.classList.toggle("forte",!!S.cortando); });
}
function empurrarForma(antes,depois){
  S.hist.push({t:"forma",antes:antes?antes.slice():null,depois:depois?depois.slice():null});
  S.refaz.length=0;
  while(S.hist.length>150) S.bytes-=bytesDe(S.hist.shift());
  atualizarBotoesHist(); agendarSalvar();
}
function aplicarForma(f){
  f=normalizarForma(f);
  if(f) S.painel.forma=f.slice(); else delete S.painel.forma;
  var n=f?f.length/2:4;
  if(S.vSel!=null&&S.vSel>=n) S.vSel=null;
  atualizarForma(); if(E.guiaGrade)E.guiaGrade.checked=!!CFG.guia.grade;if(E.guiaPersp)E.guiaPersp.checked=!!CFG.guia.persp;if(E.guiaTipo)E.guiaTipo.value=CFG.guia.tipo;if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} if(E.guiaGrade) E.guiaGrade.checked=!!CFG.guia.grade; if(E.guiaPersp) E.guiaPersp.checked=!!CFG.guia.persp; if(E.guiaTipo) E.guiaTipo.value=CFG.guia.tipo; if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} pedir(true);
}
function definirForma(nova){
  var antes=formaDe(S.painel); nova=normalizarForma(nova);
  if(mesmaForma(antes,nova)){ atualizarForma(); return; }
  aplicarForma(nova); empurrarForma(antes,nova);
}
function escolherForma(v){
  if(v==="custom"){ atualizarForma(); return; }
  var f=null; FORMAS_PAINEL.forEach(function(x){ if(x[0]===v) f=x[2]; });
  S.vSel=null; definirForma(f);
  if(f&&!S.cortando) aviso("Forma aplicada. Use “Cortar painel” para mexer nos pontos.");
}
function pontosCorte(){ var f=formaDe(S.painel); return f?f.slice():RET_FORMA.slice(); }
function paraTela(fx,fy){ return {x:S.tx+fx*S.dim.w*S.z,y:S.ty+fy*S.dim.h*S.z}; }
function distSeg(p,a,b){
  var dx=b.x-a.x, dy=b.y-a.y, l2=dx*dx+dy*dy;
  var t=l2?clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/l2,0,1):0;
  return {d:Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy)),t:t};
}
function alternarCorte(on){
  if(!S) return;
  if(on===undefined) on=!S.cortando;
  if(on===!!S.cortando) return;
  if(on){
    commitFlut(); S.sel=null; S.selOp=null; fecharEdicaoBal(); S.balSel=null; S.balOp=null;
    S.cortando=true; S.vSel=null; S.vUlt=null; E.over.style.cursor="default";
    aviso("Cortar painel: arraste os pontos; toque na linha para criar um ponto; toque duplo (ou Delete) remove o ponto.");
  }else{
    cancelarCorte(); S.cortando=false; S.vSel=null; S.vUlt=null;
    E.over.style.cursor=S.ferr==="mao"?"grab":"crosshair";
  }
  atualizarForma(); if(E.guiaGrade)E.guiaGrade.checked=!!CFG.guia.grade;if(E.guiaPersp)E.guiaPersp.checked=!!CFG.guia.persp;if(E.guiaTipo)E.guiaTipo.value=CFG.guia.tipo;if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} if(E.guiaGrade) E.guiaGrade.checked=!!CFG.guia.grade; if(E.guiaPersp) E.guiaPersp.checked=!!CFG.guia.persp; if(E.guiaTipo) E.guiaTipo.value=CFG.guia.tipo; if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} pedir(true);
}
function cancelarCorte(){
  var dr=S&&S.vDrag; if(!dr) return;
  S.vDrag=null;
  if(dr.antes) S.painel.forma=dr.antes.slice(); else delete S.painel.forma;
  pedir(true);
}
function cortarDown(p,e){
  var pts=pontosCorte(), n=pts.length/2, R=e.pointerType==="touch"?24:12, i, q, bi=-1, bd=1e9, d;
  var antesF=formaDe(S.painel); antesF=antesF?antesF.slice():null;
  for(i=0;i<n;i++){
    q=paraTela(pts[2*i],pts[2*i+1]); d=Math.hypot(q.x-p.x,q.y-p.y);
    if(d<bd){ bd=d; bi=i; }
  }
  var agora=Date.now();
  if(bi>-1&&bd<=R){                                  /* pegou um ponto */
    if(S.vUlt&&S.vUlt.i===bi&&agora-S.vUlt.t<400){   /* toque duplo: remove */
      S.vUlt=null;
      if(n<=3){ aviso("Um painel precisa de pelo menos 3 pontos."); return; }
      var nv=pts.slice(); nv.splice(2*bi,2); S.vSel=null; definirForma(nv); return;
    }
    S.vUlt={i:bi,t:agora}; S.vSel=bi;
    S.vDrag={i:bi,antes:antesF,pts:pts,moveu:false,ativo:false,p0:{x:p.x,y:p.y},id:e.pointerId};
    pedir(false); return;
  }
  var be=-1, bt=0, a, b, r, j;                       /* pegou uma linha: cria um ponto nela */
  bd=1e9;
  for(i=0;i<n;i++){
    j=(i+1)%n; a=paraTela(pts[2*i],pts[2*i+1]); b=paraTela(pts[2*j],pts[2*j+1]); r=distSeg(p,a,b);
    if(r.d<bd){ bd=r.d; be=i; bt=r.t; }
  }
  if(be>-1&&bd<=R*0.75){
    j=(be+1)%n;
    var nx=pts[2*be]+(pts[2*j]-pts[2*be])*bt, ny=pts[2*be+1]+(pts[2*j+1]-pts[2*be+1])*bt;
    pts.splice(2*(be+1),0,nx,ny);
    S.vSel=be+1; S.vUlt=null;
    S.vDrag={i:be+1,antes:antesF,pts:pts,moveu:true,ativo:true,p0:{x:p.x,y:p.y},id:e.pointerId};
    S.painel.forma=pts; pedir(true); return;
  }
  S.vSel=null; S.vUlt=null; pedir(false);
}
function cortarMove(p,e){
  var dr=S.vDrag; if(!dr) return;
  if(!dr.ativo){
    if(Math.hypot(p.x-dr.p0.x,p.y-dr.p0.y)<4) return;   /* evita mexer o ponto num simples toque */
    dr.ativo=true;
  }
  var w=paraObraSemRotacao(p.x,p.y), fx=clamp(w.x/S.dim.w,0,1), fy=clamp(w.y/S.dim.h,0,1);
  if(!e.altKey){                                          /* gruda nas bordas do quadro (Alt desliga) */
    var tx=9/(S.z*S.dim.w), ty=9/(S.z*S.dim.h);
    if(fx<tx) fx=0; else if(fx>1-tx) fx=1;
    if(fy<ty) fy=0; else if(fy>1-ty) fy=1;
  }
  dr.pts[2*dr.i]=fx; dr.pts[2*dr.i+1]=fy;
  dr.moveu=true; S.painel.forma=dr.pts; pedir(true);
}
function cortarUp(){
  var dr=S.vDrag; S.vDrag=null;
  if(!dr||!dr.moveu){ pedir(false); return; }
  var depois=normalizarForma(dr.pts);
  if(depois) S.painel.forma=depois.slice(); else delete S.painel.forma;
  if(!mesmaForma(dr.antes,depois)) empurrarForma(dr.antes,depois);
  atualizarForma(); if(E.guiaGrade)E.guiaGrade.checked=!!CFG.guia.grade;if(E.guiaPersp)E.guiaPersp.checked=!!CFG.guia.persp;if(E.guiaTipo)E.guiaTipo.value=CFG.guia.tipo;if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} if(E.guiaGrade) E.guiaGrade.checked=!!CFG.guia.grade; if(E.guiaPersp) E.guiaPersp.checked=!!CFG.guia.persp; if(E.guiaTipo) E.guiaTipo.value=CFG.guia.tipo; if(E.guiaOp){E.guiaOp.value=CFG.guia.op;E.guiaOpV.textContent=CFG.guia.op+"%";} pedir(true);
}
function removerVerticeSel(){
  if(S.vSel==null) return;
  var pts=pontosCorte();
  if(pts.length<=6){ aviso("Um painel precisa de pelo menos 3 pontos."); return; }
  pts.splice(2*S.vSel,2); S.vSel=null; definirForma(pts);
}
function guiasCorte(c){
  if(!S.cortando) return;
  var pts=pontosCorte(), n=pts.length/2, P=[], i, q, a, b;
  for(i=0;i<n;i++) P.push(paraTela(pts[2*i],pts[2*i+1]));
  c.save(); c.lineJoin="round";
  c.beginPath();
  P.forEach(function(v,k){ if(k) c.lineTo(v.x,v.y); else c.moveTo(v.x,v.y); });
  c.closePath();
  c.lineWidth=2; c.setLineDash([]); c.strokeStyle="#fff"; c.stroke();
  c.lineWidth=1; c.setLineDash([6,4]); c.strokeStyle="#1d1d1d"; c.stroke(); c.setLineDash([]);
  for(i=0;i<n;i++){                                       /* marcas no meio das linhas: toque para criar um ponto */
    a=P[i]; b=P[(i+1)%n];
    c.beginPath(); c.arc((a.x+b.x)/2,(a.y+b.y)/2,4,0,TAU);
    c.fillStyle="rgba(255,255,255,.85)"; c.fill(); c.lineWidth=1; c.strokeStyle="#000"; c.stroke();
  }
  for(i=0;i<n;i++){
    q=P[i]; c.fillStyle=i===S.vSel?"#4f8fdc":"#fff"; c.strokeStyle="#000"; c.lineWidth=1;
    c.fillRect(q.x-5,q.y-5,10,10); c.strokeRect(q.x-4.5,q.y-4.5,9,9);
  }
  c.restore();
}

/* ---------- tela: palco, zoom e quadros ---------- */
function ajustarCanvasPalco(){
  var r=E.palco.getBoundingClientRect(); if(!r.width||!r.height) return;
  var d=window.devicePixelRatio||1;
  [E.view,E.over].forEach(function(c){ c.width=Math.round(r.width*d); c.height=Math.round(r.height*d); });
  if(S){ S.dpr=d; S.pw=r.width; S.ph=r.height; }
}
/* Mantém a folha dentro de uma área navegável finita. Quando ela cabe por
   inteiro, ela fica centralizada; com zoom, ainda há uma pequena margem para
   alcançar as bordas sem permitir que a folha suma para fora do palco. */
function limitarNavegacao(){
  if(!S||!S.pw||!S.ph||!S.dim||!S.z) return;
  var margem=($ed&&($ed.classList.contains("preencher-tela")||$ed.classList.contains("modo-foco")))?0:
    clamp(Math.round(Math.min(S.pw,S.ph)*0.08),24,72);
  function limitar(pos,tamanho,janela){
    if(tamanho<=janela-margem*2) return (janela-tamanho)/2;
    return clamp(pos,janela-tamanho-margem,margem);
  }
  S.tx=limitar(S.tx,S.dim.w*S.z,S.pw);
  S.ty=limitar(S.ty,S.dim.h*S.z,S.ph);
}
function ajustar(){
  if(!S||!S.pw) return;
  /* Sempre que o editor estiver em Tela cheia, a folha cobre o palco inteiro.
     Isso também é reaplicado depois de o navegador concluir a tela cheia nativa. */
  if($ed&&$ed.classList.contains("modo-foco")){ preencherModoFoco(); return; }
  var m=ED_MOVEL.ativo?12:28, vd=dimensoesVisuaisFolha(), z=Math.min((S.pw-m*2)/vd.w,(S.ph-m*2)/vd.h);
  S.z=clamp(z,0.05,1.5); S.tx=(S.pw-S.dim.w*S.z)/2; S.ty=(S.ph-S.dim.h*S.z)/2;
  limitarNavegacao();
  S.ajustado=true; atualizarZoom(); pedir(true);
}
function dimensoesVisuaisFolha(){ var q=Math.round(((S&&S.rot)||0)/(Math.PI/2)); return (Math.abs(q)%2)?{w:S.dim.h,h:S.dim.w}:{w:S.dim.w,h:S.dim.h}; }
function preencherModoFoco(){
  if(!S||!S.pw||!S.ph||!S.dim||!S.dim.w||!S.dim.h) return;
  /* A folha usa o enquadramento de cobertura: cada ponto visível pertence à folha.
     Trechos fora da tela continuam acessíveis com a ferramenta Mover/arrastar. */
  var vd=dimensoesVisuaisFolha(), z=Math.max(S.pw/vd.w,S.ph/vd.h);
  S.z=clamp(z,0.01,16);
  S.tx=(S.pw-S.dim.w*S.z)/2;
  S.ty=(S.ph-S.dim.h*S.z)/2;
  limitarNavegacao();
  S.ajustado=true; atualizarZoom(); pedir(true);
}
function preencherArea(){
  if(!S||!E.palco||!S.dim||!S.dim.w||!S.dim.h) return;
  /* Mantém a interface do editor visível e enquadra a folha inteira no palco.
     O Escape apenas sai deste modo de enquadramento. */
  if($ed) $ed.classList.add("preencher-tela");
  S.ajustado=true;
  requestAnimationFrame(function(){
    if(!S) return;
    ajustarCanvasPalco();
    if(!S.pw||!S.ph) return;
    /* Folha cobre a área cinza do editor: a proporção é preservada e o palco fica preenchido. */
    var vd=dimensoesVisuaisFolha(), z=Math.max(S.pw/vd.w,S.ph/vd.h);
    S.z=clamp(z,0.01,16);
    S.tx=(S.pw-S.dim.w*S.z)/2;
    S.ty=(S.ph-S.dim.h*S.z)/2;
    limitarNavegacao();
    atualizarZoom(); pedir(true);
  });
}
function sairPreencherTela(){
  if(!$ed||!$ed.classList.contains("preencher-tela")) return false;
  $ed.classList.remove("preencher-tela");
  requestAnimationFrame(function(){
    if(!S) return;
    ajustarCanvasPalco();
    ajustar();
  });
  return true;
}
function reaplicarFolhaInteira(){
  if(!S||!$ed||!$ed.classList.contains("modo-foco")) return;
  ajustarCanvasPalco();
  preencherModoFoco();
}
function alternarModoFoco(entrar,usarTelaInteira){
  if(!$ed) return;
  if(typeof entrar!=="boolean") entrar=!$ed.classList.contains("modo-foco");
  if(entrar)fecharPainelMovel(false);
  var pedido=null;
  if(entrar){
    fecharJanelaPagina();
    $ed.classList.remove("preencher-tela");
    $ed.classList.add("modo-foco");
    if(usarTelaInteira!==false&&$ed.requestFullscreen&&!document.fullscreenElement){
      pedido=$ed.requestFullscreen();
      if(pedido&&pedido.catch) pedido.catch(function(){});
    }
  }else{
    $ed.classList.remove("modo-foco");
    if(usarTelaInteira!==false&&document.fullscreenElement&&document.exitFullscreen){
      document.exitFullscreen().catch(function(){});
    }
  }
  requestAnimationFrame(function(){
    if(!S) return;
    ajustarCanvasPalco();
    ajustar();
  });
  /* requestFullscreen muda as medidas depois do clique em alguns navegadores. */
  if(entrar){
    window.setTimeout(reaplicarFolhaInteira,80);
    window.setTimeout(reaplicarFolhaInteira,260);
    if(pedido&&pedido.then) pedido.then(function(){ window.setTimeout(reaplicarFolhaInteira,0); }).catch(function(){});
  }
}
function zoomEm(f,cx,cy){
  var nz=clamp(S.z*f,0.05,16); f=nz/S.z;
  S.tx=cx-(cx-S.tx)*f; S.ty=cy-(cy-S.ty)*f; S.z=nz; S.ajustado=false;
  limitarNavegacao();
  atualizarZoom(); pedir(true);
}
function zoomCentro(f){ zoomEm(f,S.pw/2,S.ph/2); }
function atualizarZoom(){
  E.zoom.textContent=Math.round(S.z*100)+"%";
  E.dimTxt.textContent=S.dim.w+" × "+S.dim.h+" px";
  E.navZoom.value=clamp(100*Math.log(S.z/0.05)/Math.log(320),0,100);
  pedirNav();
}
function pedir(view){
  if(!S) return;
  if(view) S.sujoView=true;
  S.sujoOver=true;
  if(!S.raf) S.raf=requestAnimationFrame(quadro);
}
function quadro(){
  var s=S; if(!s) return; s.raf=0;
  var seguirTraco=aproximarTracoParado(performance.now());
  if(s.coordPendente!=null){if(E.coord.textContent!==s.coordPendente)E.coord.textContent=s.coordPendente;s.coordPendente=null;}
  if(s.sujoView){ s.sujoView=false; renderView(); pedirNav(); }
  if(s.sujoOver){ s.sujoOver=false; renderOver(); }
  if(seguirTraco&&!s.raf)s.raf=requestAnimationFrame(quadro);
}
function renderView(){
  var v=E.view, c=v.getContext("2d"), d=S.dpr, z=S.z;
  c.setTransform(1,0,0,1,0,0); c.fillStyle=INTERFACE_EDITOR.entorno; c.fillRect(0,0,v.width,v.height);
  c.setTransform(d*z,0,0,d*z,d*S.tx,d*S.ty);
  if(S.rot){ c.translate(S.dim.w/2,S.dim.h/2); c.rotate(S.rot); c.translate(-S.dim.w/2,-S.dim.h/2); }
  c.imageSmoothingEnabled=z<2; c.imageSmoothingQuality="high";
  c.fillStyle="#fff"; c.fillRect(0,0,S.dim.w,S.dim.h);
  fundoEm(c);
  if(!S.carregando) camadasEm(c,true);
  var fm=formaDe(S.painel);
  if(fm){                                    /* fora do corte fica apagado (não entra na exportação) */
    if(!S.carregando) desenharBaloes(c,S.baloes,Math.max(S.dim.w,S.dim.h));
    c.save(); c.beginPath(); c.rect(-1,-1,S.dim.w+2,S.dim.h+2); trilhaForma(c,fm,S.dim.w,S.dim.h);
    c.fillStyle="rgba(150,150,150,.82)"; c.fill("evenodd"); c.restore();
    desenharBorda(c);
  }else{
    desenharBorda(c);
    if(!S.carregando) desenharBaloes(c,S.baloes,Math.max(S.dim.w,S.dim.h));
  }
}
var ALCAS=["nw","n","ne","e","se","s","sw","w"];
function posAlca(r,h){
  var x=S.tx+r.x*S.z, y=S.ty+r.y*S.z, w=r.w*S.z, hh=r.h*S.z;
  var px=h.indexOf("w")>-1?x:(h.indexOf("e")>-1?x+w:x+w/2);
  var py=h.indexOf("n")>-1?y:(h.indexOf("s")>-1?y+hh:y+hh/2);
  return {x:px,y:py};
}
function retSel(){
  if(S.flut) return {x:S.flut.x,y:S.flut.y,w:S.flut.w,h:S.flut.h,forma:S.flut.forma||"retangulo",path:S.flut.path||null};
  return S.sel;
}
/* Máscara usada pelas seleções retangulares, elípticas e de laço.  A área
   continua tendo uma caixa delimitadora para permitir mover/redimensionar,
   mas os pixels fora do contorno ficam transparentes e não são apagados. */
function caminhoSelecao(c,r,ox,oy){
  var x=r.x-(ox||0), y=r.y-(oy||0), w=r.w, h=r.h, i, p;
  c.beginPath();
  if(r.forma==="elipse") c.ellipse(x+w/2,y+h/2,Math.max(1,w/2),Math.max(1,h/2),0,0,TAU);
  else if(r.forma==="laco"&&r.path&&r.path.length>2){
    p=r.path[0]; c.moveTo(p.x-(ox||0),p.y-(oy||0));
    for(i=1;i<r.path.length;i++){ p=r.path[i]; c.lineTo(p.x-(ox||0),p.y-(oy||0)); }
    c.closePath();
  }else c.rect(x,y,w,h);
  c.clip();
}
function recorteSelecao(src,r){
  var c=novoCanvas(Math.max(1,Math.round(r.w)),Math.max(1,Math.round(r.h))), x=c.getContext("2d");
  x.save(); caminhoSelecao(x,r,r.x,r.y); x.drawImage(src,r.x,r.y,r.w,r.h,0,0,r.w,r.h); x.restore(); return c;
}
function escolherFormaSelecao(forma){
  if(!S) return;
  commitFlut(); S.sel=null; S.selPath=null; S.selForma=forma||"retangulo";
  if(E.selForma) E.selForma.value=S.selForma;
  trocarFerr("selecionar");
  aviso(S.selForma==="laco"?"Laço livre ativo: circule a área do desenho.":S.selForma==="elipse"?"Seleção elíptica ativa.":"Seleção retangular ativa.");
  pedir(true);
}
function renderOver(){
  var o=E.over, c=o.getContext("2d");
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,o.width,o.height);
  c.setTransform(S.dpr,0,0,S.dpr,0,0);
  if(S.rot){ var rcx=S.tx+S.dim.w*S.z/2, rcy=S.ty+S.dim.h*S.z/2; c.translate(rcx,rcy); c.rotate(S.rot); c.translate(-rcx,-rcy); }
  guiasSim(c);
  desenharGuiasConstrucao(c);
  guiasBal(c);
  guiasCorte(c);
  var r=retSel();
  if(r&&r.w>0&&r.h>0){
    var x=S.tx+r.x*S.z, y=S.ty+r.y*S.z, w=r.w*S.z, h=r.h*S.z;
    function contornoSelecao(){
      c.beginPath();
      if(r.forma==="elipse") c.ellipse(x+w/2,y+h/2,Math.max(1,w/2),Math.max(1,h/2),0,0,TAU);
      else if(r.forma==="laco"&&r.path&&r.path.length>2){
        var sp=r.path[0], j; c.moveTo(S.tx+sp.x*S.z,S.ty+sp.y*S.z);
        for(j=1;j<r.path.length;j++){ sp=r.path[j]; c.lineTo(S.tx+sp.x*S.z,S.ty+sp.y*S.z); }
        c.closePath();
      }else c.rect(x+0.5,y+0.5,w,h);
    }
    c.lineWidth=1; c.setLineDash([]); c.strokeStyle="#fff"; contornoSelecao(); c.stroke();
    c.setLineDash([5,4]); c.strokeStyle="#000"; contornoSelecao(); c.stroke(); c.setLineDash([]);
    if(S.flut||(!S.selOp||S.selOp.tipo!=="novo")){
      ALCAS.forEach(function(a){
        var p=posAlca(r,a); c.fillStyle="#fff"; c.strokeStyle="#000";
        c.fillRect(p.x-4,p.y-4,8,8); c.strokeRect(p.x-3.5,p.y-3.5,7,7);
      });
    }
  }
  var B=PINCEIS[S.ferr];
  if(B&&S.cursor&&!S.gesto&&!S.pan&&!S.espaco){
    var rr=Math.max(1.5,CFG.ajust[S.ferr].tam*S.z/2);
    c.beginPath(); c.arc(S.cursor.x,S.cursor.y,rr,0,TAU); c.lineWidth=1;
    c.strokeStyle="#fff"; c.stroke();
    c.beginPath(); c.arc(S.cursor.x,S.cursor.y,rr+1,0,TAU); c.strokeStyle="rgba(0,0,0,.7)"; c.stroke();
  }
}

/* ---------- histórico (desfazer / refazer) ---------- */
function bytesDe(e){
  if(e.t==="px") return e.antes.width*e.antes.height*8;
  if(e.t==="grupo") return e.itens.reduce(function(a,i){ return a+bytesDe(i); },0);
  return 0;
}
function empurrar(ent){
  S.hist.push(ent); S.refaz.length=0; S.tocou=true;
  S.bytes+=bytesDe(ent);
  while(S.hist.length>150||S.bytes>350e6){
    S.bytes-=bytesDe(S.hist.shift());
  }
  atualizarBotoesHist(); agendarSalvar();
}
function aplicar(e,lado){
  if(e.t==="px"){
    var L=porId(e.layer); if(!L) return;
    var img=e[lado];
    L.cx.clearRect(e.x,e.y,img.width,img.height); L.cx.drawImage(img,e.x,e.y); L.sujo=true;
  }else if(e.t==="prop"){
    var P=porId(e.id); if(!P) return;
    var v=e[lado]; for(var k in v) P[k]=v[k];
  }else if(e.t==="estrutura"){
    var st=e[lado]; S.camadas=st.lista.slice(); S.ativa=st.ativa;
    S.camadas.forEach(function(L){ L.sujo=true; });
  }else if(e.t==="bal"){
    S.baloes=e[lado].map(cloneBal);
    if(!S.baloes.some(function(b){ return b.id===S.balSel; })) S.balSel=null;
  }else if(e.t==="forma"){
    aplicarForma(e[lado]);
  }else if(e.t==="grupo"){
    var it=lado==="antes"?e.itens.slice().reverse():e.itens;
    it.forEach(function(i){ aplicar(i,lado); });
  }
}
function desfazer(){
  if(!S||S.carregando) return;
  if(S.flut) commitFlut();
  fecharEdicaoBal(); var e=S.hist.pop(); if(!e) return;
  aplicar(e,"antes"); S.refaz.push(e);
  depoisHist();
}
function refazer(){
  if(!S||S.carregando) return;
  fecharEdicaoBal(); var e=S.refaz.pop(); if(!e) return;
  aplicar(e,"depois"); S.hist.push(e);
  depoisHist();
}
function depoisHist(){
  S.sel=null; atualizarBotoesHist(); listaCamadas(); pedir(true); agendarSalvar(); atualizarBal();
}
function atualizarBotoesHist(){
  qa("[data-ed=desfazer]").forEach(function(b){ b.disabled=!S||!S.hist.length; });
  qa("[data-ed=refazer]").forEach(function(b){ b.disabled=!S||!S.refaz.length; });
}

/* ---------- pincéis ---------- */
function pressao(e){
  if(!CFG.pressao||e.pointerType!=="pen") return 1;
  var p=clamp(e.pressure==null?.5:e.pressure,.05,1);
  if(CFG.curvaPressao==="suave") p=Math.sqrt(p);
  else if(CFG.curvaPressao==="firme") p=p*p;
  return p;
}
function raio(vv,p){
  var r=vv.tam/2;
  if(vv.B.pres==="tam") r*=vv.B.min+(1-vv.B.min)*p;
  return Math.max(0.4,r);
}
function passo(vv,p){ return Math.max(.5,clamp(valorPonta(vv,"espacamento",(vv.B.esp||.1)*100),1,300)/100*2*raio(vv,p)); }
/* simetria: lista de matrizes [a,b,c,d,e,f] (a primeira é a identidade) */
function transfSim(){
  var m=CFG.sim, W=S.dim.w, H=S.dim.h, out=[[1,0,0,1,0,0]];
  if(m==="v"||m==="q") out.push([-1,0,0,1,W,0]);
  if(m==="h"||m==="q") out.push([1,0,0,-1,0,H]);
  if(m==="q") out.push([-1,0,0,-1,W,H]);
  if(m==="r"){
    var n=CFG.simN, cx=W/2, cy=H/2, k, a, co, si;
    for(k=1;k<n;k++){
      a=TAU*k/n; co=Math.cos(a); si=Math.sin(a);
      out.push([co,si,-si,co,cx-co*cx+si*cy,cy-si*cx-co*cy]);
    }
  }
  return out;
}
function carimbo(vv,x,y,p){
  if(vv.previa||vv.B.tipo==="esfumar"||!CFG.sim){ carimboUm(vv,x,y,p); return; }
  var dispersao=clamp(valorPonta(vv,"dispersao",0),0,150)/100*raio(vv,p),
      jx=(Math.random()*2-1)*dispersao,jy=(Math.random()*2-1)*dispersao;
  transfSim().forEach(function(m){
    vv.matrizPonta=m;
    vv.desvioSim={x:m[0]*jx+m[2]*jy,y:m[1]*jx+m[3]*jy};
    carimboUm(vv,m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5],p);
  });
  vv.matrizPonta=null;vv.desvioSim=null;
}
function carimboUm(vv,x,y,p){
  var B=vv.B, r=raio(vv,p), c=vv.cx, bb=vv.bb, dispersao=clamp(valorPonta(vv,"dispersao",0),0,150)/100*r,
      alcance=r*1.5+dispersao+4, fluxo=clamp(valorPonta(vv,"fluxo",100),1,100)/100, pp=B.pres==="op"?.3+.7*p:1;
  if(x-alcance<bb.x0) bb.x0=x-alcance; if(y-alcance<bb.y0) bb.y0=y-alcance;
  if(x+alcance>bb.x1) bb.x1=x+alcance; if(y+alcance>bb.y1) bb.y1=y+alcance;
  if(B.tipo==="esfumar"){ esfumarUm(vv,x,y,r); return; }
  if(dispersao){x+=vv.desvioSim?vv.desvioSim.x:(Math.random()*2-1)*dispersao;y+=vv.desvioSim?vv.desvioSim.y:(Math.random()*2-1)*dispersao;}
  if(B.estudio){
    c.save(); c.globalAlpha=fluxo*pp; c.translate(x,y);
    if(vv.matrizPonta){var mm=vv.matrizPonta;c.transform(mm[0],mm[1],mm[2],mm[3],0,0);}
    var ang=valorPonta(vv,"angulo",0)*Math.PI/180;
    if(B.motivo==="folha") ang+=vv.dir||0;
    c.rotate(ang);
    if(B.tipo==="particulas"){
      c.fillStyle=vv.cor;
      var qtd=Math.round(10+clamp(valorPonta(vv,"textura",70),0,100)*.3);
      for(var i=0;i<qtd;i++){var a=Math.random()*TAU,rd=Math.sqrt(Math.random())*r,pr=Math.max(.45,r*(.008+Math.random()*.026));c.beginPath();c.arc(Math.cos(a)*rd,Math.sin(a)*rd,pr,0,TAU);c.fill();}
    }else if(B.tipo==="decoracao"){
      var de=spriteMotivo(B.motivo,r,vv.cor);c.drawImage(de,-r-2,-r-2,r*2+4,r*2+4);
    }else{
      var st=spriteEstudio(B,r,vv.cor,vv.aj||B);c.drawImage(st,-r-1,-r-1,r*2+2,r*2+2);
    }
    c.restore();return;
  }
  if(B.tipo==="lapis"){
    var grao=vv.aj&&vv.aj.textura!=null?clamp(1-vv.aj.textura*.006,.12,.98):B.grao;
    var sp=sprite("lapis",r,vv.cor,grao);
    c.globalAlpha=fluxo*(B.pres==="op"?(0.35+0.65*p):1);
    c.drawImage(sp,x-sp.width/2+(Math.random()-0.5)*r*0.5,y-sp.height/2+(Math.random()-0.5)*r*0.5);
    c.globalAlpha=1;
  }else if(B.tipo==="macio"){
    var sm=spriteEstudio(B,r,vv.cor,vv.aj||B);
    c.globalAlpha=fluxo*(0.4+0.6*p);
    c.drawImage(sm,x-sm.width/2,y-sm.height/2);
    c.globalAlpha=1;
  }else{
    c.globalAlpha=fluxo; c.fillStyle=vv.cor; c.beginPath(); c.arc(x,y,r,0,TAU); c.fill();c.globalAlpha=1;
  }
}
/* esfumar: arrasta a cor que está sob o pincel, direto na camada */
function esfumarUm(vv,x,y,r){
  var L=vv.L, d=Math.round(r*2)+2, ri=Math.max(1,Math.round(r));
  var ox=Math.round(x-d/2), oy=Math.round(y-d/2);
  if(!vv.pick){
    vv.pick=novoCanvas(d,d); vv.pk=vv.pick.getContext("2d"); vv.tmpE=novoCanvas(d,d);
    vv.pk.drawImage(L.cv,ox,oy,d,d,0,0,d,d);
    return;
  }
  var t=vv.tmpE, tc=t.getContext("2d");
  tc.globalCompositeOperation="source-over"; tc.globalAlpha=1; tc.clearRect(0,0,d,d);
  tc.drawImage(vv.pick,0,0);
  tc.globalCompositeOperation="destination-in";
  tc.drawImage(sprite("macio",ri,"#000000")[0]||sprite("macio",ri,"#000000"),0,0,d,d);
  tc.globalCompositeOperation="source-over";
  L.cx.save(); L.cx.globalAlpha=Math.min(1,vv.op*0.6); L.cx.drawImage(t,ox,oy); L.cx.restore();
  vv.pk.globalAlpha=0.35; vv.pk.drawImage(L.cv,ox,oy,d,d,0,0,d,d); vv.pk.globalAlpha=1;
}
function segmento(vv,x1,y1,p1,x2,y2,p2){
  var d=Math.hypot(x2-x1,y2-y1); if(d<=0) return;
  vv.dir=Math.atan2(y2-y1,x2-x1);
  var pos=vv.falta, f, p;
  while(pos<=d){
    f=pos/d; p=p1+(p2-p1)*f;
    carimbo(vv,x1+(x2-x1)*f,y1+(y2-y1)*f,p);
    pos+=passo(vv,p);
  }
  vv.falta=pos-d;
}
function kEstab(vv,dt,velocidade){
  if(!vv.estab)return 1;
  if(!vv.rapido)return 1/(1+vv.estab*0.9);
  var ms=clamp(dt==null?1000/120:dt,1,64),tau=vv.estab*6/(1+Math.max(0,velocidade||0)*.7);
  return 1-Math.exp(-ms/Math.max(1,tau));
}
function seguir(vv,k){
  var u=vv.ult, a=vv.alvo;
  var nx=u.x+(a.x-u.x)*k, ny=u.y+(a.y-u.y)*k, np=u.p+(a.p-u.p)*k;
  segmento(vv,u.x,u.y,u.p,nx,ny,np);
  vv.ult={x:nx,y:ny,p:np};
}
function addPonto(vv,x,y,p,tempo){
  var anterior=vv.alvo,dt=typeof tempo==="number"&&isFinite(tempo)&&typeof vv.tempoEntrada==="number"?tempo-vv.tempoEntrada:1000/120;
  if(typeof tempo==="number"&&isFinite(tempo))vv.tempoEntrada=tempo;
  dt=clamp(dt>0?dt:1000/120,1,64);
  var velocidade=anterior?Math.hypot(x-anterior.x,y-anterior.y)/dt:0;
  vv.alvo={x:x,y:y,p:p};
  if(vv.rapido)vv.seguiuEm=performance.now();
  if(!vv.ult){
    carimbo(vv,x,y,p); vv.ult={x:x,y:y,p:p}; vv.falta=passo(vv,p); return;
  }
  seguir(vv,kEstab(vv,dt,velocidade));
}
function aproximarTracoParado(agora){
  var vv=S&&S.vivo;if(!vv||vv.forma||!vv.rapido||!vv.estab||!vv.ult||!vv.alvo)return false;
  var falta=Math.hypot(vv.alvo.x-vv.ult.x,vv.alvo.y-vv.ult.y),pressaoFalta=Math.abs(vv.alvo.p-vv.ult.p);
  if(falta<=.25&&pressaoFalta<=.003)return false;
  var dt=agora-vv.seguiuEm;
  if(dt>=8){seguir(vv,kEstab(vv,dt,0));vv.seguiuEm=agora;S.sujoView=true;}
  return true;
}
function iniciarTraco(e,w){
  commitFlut();
  var L=camadaAtiva(); if(!L) return;
  if(ehCamadaImagem(L)&&(L.bloqueada||!L.vis)){ aviso(L.bloqueada?"Desbloqueie a camada da imagem antes de desenhar.":"Mostre a camada da imagem antes de desenhar."); return; }
  if(ehCamadaImagem(L)) L=criarCamadaDesenhoSobreImagem(L);
  if(!L.vis){ aviso("A camada está oculta. Mostre-a para desenhar."); return; } if(L.bloqueada){ aviso("Desbloqueie a camada antes de desenhar."); return; } if(L.bloqueada){ aviso("Desbloqueie a camada antes de desenhar."); return; }
  var B=PINCEIS[S.ferr], aj=CFG.ajust[S.ferr];
  var vv={B:B,aj:Object.assign({},aj),L:L,cv:S.live,cx:S.live.getContext("2d"),borracha:!!B.borracha,op:aj.op/100,
    cor:B.borracha?"#000000":CFG.cor,tam:aj.tam,estab:aj.estab,rapido:CFG.respostaRapida!==false,ult:null,alvo:null,falta:0,
    bb:{x0:1e9,y0:1e9,x1:-1e9,y1:-1e9},id:e.pointerId};
  if(B.tipo==="esfumar"){ vv.fb=novoCanvas(S.dim.w,S.dim.h); vv.fb.getContext("2d").drawImage(L.cv,0,0); }
  vv.cx.clearRect(0,0,S.dim.w,S.dim.h);
  S.vivo=vv;
  addPonto(vv,w.x,w.y,pressao(e),e.timeStamp);
  pedir(true);
}
function cancelarTraco(){
  if(!S.vivo) return;
  var vv=S.vivo;
  if(vv.fb){ vv.L.cx.save(); vv.L.cx.globalCompositeOperation="copy"; vv.L.cx.drawImage(vv.fb,0,0); vv.L.cx.restore(); }
  var lc=S.live.getContext("2d"); lc.setTransform(1,0,0,1,0,0); lc.clearRect(0,0,S.dim.w,S.dim.h);
  S.vivo=null; pedir(true);
}
function clipBB(bb){
  var x0=Math.max(0,Math.floor(bb.x0)), y0=Math.max(0,Math.floor(bb.y0));
  var x1=Math.min(S.dim.w,Math.ceil(bb.x1)), y1=Math.min(S.dim.h,Math.ceil(bb.y1));
  if(x1<=x0||y1<=y0) return null;
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
function finalizarTraco(){
  var vv=S.vivo; if(!vv) return;
  var bb, f;
  if(vv.forma){
    f=vv.forma;
    if(Math.hypot(f.x1-f.x0,f.y1-f.y0)<2){
      vv.cx.setTransform(1,0,0,1,0,0); vv.cx.clearRect(0,0,S.dim.w,S.dim.h);
      S.vivo=null; pedir(true); return;
    }
    redesenharForma(vv); bb=clipBB(bbForma(vv));
  }else{
    var g=0, k=Math.max(kEstab(vv),0.3);
    while(g++<60&&Math.hypot(vv.alvo.x-vv.ult.x,vv.alvo.y-vv.ult.y)>0.3) seguir(vv,k);
    segmento(vv,vv.ult.x,vv.ult.y,vv.ult.p,vv.alvo.x,vv.alvo.y,vv.alvo.p);
    bb=clipBB(vv.bb);
  }
  S.vivo=null;
  var L=vv.L||camadaAtiva();
  if(vv.fb){
    if(!bb){ pedir(true); return; }
    var antesE=recortar(vv.fb,bb.x,bb.y,bb.w,bb.h), depoisE=recortar(L.cv,bb.x,bb.y,bb.w,bb.h);
    L.sujo=true;
    empurrar({t:"px",layer:L.id,x:bb.x,y:bb.y,antes:antesE,depois:depoisE});
    pedir(true); return;
  }
  if(!bb){ vv.cx.clearRect(0,0,S.dim.w,S.dim.h); pedir(true); return; }
  var antes=recortar(L.cv,bb.x,bb.y,bb.w,bb.h);
  L.cx.save();
  L.cx.globalAlpha=vv.op; L.cx.globalCompositeOperation=vv.borracha?"destination-out":"source-over";
  L.cx.drawImage(vv.cv,bb.x,bb.y,bb.w,bb.h,bb.x,bb.y,bb.w,bb.h);
  L.cx.restore();
  var depois=recortar(L.cv,bb.x,bb.y,bb.w,bb.h);
  L.sujo=true;
  empurrar({t:"px",layer:L.id,x:bb.x,y:bb.y,antes:antes,depois:depois});
  vv.cx.setTransform(1,0,0,1,0,0); vv.cx.clearRect(0,0,S.dim.w,S.dim.h);
  pedir(true);
}

/* ---------- formas: linha, retângulo, elipse ---------- */
function iniciarForma(e,w){
  commitFlut();
  var L=camadaAtiva(); if(!L) return;
  if(ehCamadaImagem(L)&&(L.bloqueada||!L.vis)){ aviso(L.bloqueada?"Desbloqueie a camada da imagem antes de desenhar.":"Mostre a camada da imagem antes de desenhar."); return; }
  if(ehCamadaImagem(L)) L=criarCamadaDesenhoSobreImagem(L);
  if(!L.vis){ aviso("A camada está oculta. Mostre-a para desenhar."); return; } if(L.bloqueada){ aviso("Desbloqueie a camada antes de desenhar."); return; } if(L.bloqueada){ aviso("Desbloqueie a camada antes de desenhar."); return; }
  var aj=CFG.ajust[S.ferr];
  var vv={forma:{tipo:S.ferr,x0:w.x,y0:w.y,x1:w.x,y1:w.y,rot:CFG.formaRot||0,traco:CFG.formaTraco||"solido"},L:L,cv:S.live,cx:S.live.getContext("2d"),
    borracha:false,op:aj.op/100,cor:CFG.cor,tam:aj.tam,fill:CFG.preencher,id:e.pointerId,bb:null};
  vv.cx.setTransform(1,0,0,1,0,0); vv.cx.clearRect(0,0,S.dim.w,S.dim.h);
  S.vivo=vv; redesenharForma(vv); pedir(true);
}
function ajustarForma(f,w,shift,preciso){
  var x=w.x, y=w.y, dx=x-f.x0, dy=y-f.y0;
  if(shift){
    if(f.tipo==="linha"){
      var ang=Math.atan2(dy,dx), len=Math.hypot(dx,dy), passo=(preciso?5:(+CFG.linhaAngulo||15))*Math.PI/180, q=Math.round(ang/passo)*passo;
      dx=Math.cos(q)*len; dy=Math.sin(q)*len;
    }else{
      var m=Math.max(Math.abs(dx),Math.abs(dy));
      dx=(dx<0?-1:1)*m; dy=(dy<0?-1:1)*m;
    }
    x=f.x0+dx; y=f.y0+dy;
  }
  f.x1=x; f.y1=y;
}
function tracarForma(c,f,cor,lw,fill,traco,rot){
  c.save(); c.strokeStyle=cor; c.fillStyle=cor; c.lineWidth=lw; c.lineCap="round"; c.lineJoin="round";
  var ang=((f&&f.rot!=null?f.rot:rot)||0)*Math.PI/180, tcx=(f.x0+f.x1)/2, tcy=(f.y0+f.y1)/2;
  if(ang){ c.translate(tcx,tcy); c.rotate(ang); c.translate(-tcx,-tcy); }
  traco=traco||(f&&f.traco)||"solido";
  c.setLineDash(traco==="tracejado"?[Math.max(3,lw*3),Math.max(2,lw*2)]:traco==="pontilhado"?[Math.max(1,lw),Math.max(3,lw*2.8)]:[]);
  if(f.tipo==="linha"){
    c.beginPath(); c.moveTo(f.x0,f.y0); c.lineTo(f.x1,f.y1); c.stroke();
  }else if(f.tipo==="retangulo"){
    var rx=Math.min(f.x0,f.x1), ry=Math.min(f.y0,f.y1), rw=Math.abs(f.x1-f.x0), rh=Math.abs(f.y1-f.y0);
    if(fill) c.fillRect(rx,ry,rw,rh);
    c.strokeRect(rx,ry,rw,rh);
  }else{
    var rx=Math.min(f.x0,f.x1), ry=Math.min(f.y0,f.y1), rw=Math.abs(f.x1-f.x0), rh=Math.abs(f.y1-f.y0);
    var cx=(f.x0+f.x1)/2, cy=(f.y0+f.y1)/2, a=Math.max(0.5,rw/2), b=Math.max(0.5,rh/2), pts=[], i, q;
    if(f.tipo==="elipse"){ c.beginPath(); c.ellipse(cx,cy,a,b,0,0,TAU); if(fill)c.fill(); c.stroke(); }
    else if(f.tipo==="triangulo"){ pts=[[cx,ry],[rx+rw,ry+rh],[rx,ry+rh]]; c.beginPath(); pts.forEach(function(p,j){j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);}); c.closePath(); if(fill)c.fill(); c.stroke(); }
    else if(f.tipo==="hexagono"){ for(i=0;i<6;i++){q=-Math.PI/2+i*Math.PI/3;pts.push([cx+Math.cos(q)*a,cy+Math.sin(q)*b]);} c.beginPath(); pts.forEach(function(p,j){j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);}); c.closePath(); if(fill)c.fill(); c.stroke(); }
    else if(f.tipo==="cubo"){ var d=Math.min(rw,rh)*.22; if(fill)c.fillRect(rx,ry+ d,rw-d,rh-d); c.strokeRect(rx,ry+d,rw-d,rh-d); c.strokeRect(rx+d,ry,rw-d,rh-d); [[rx,ry+d,rx+d,ry],[rx+rw-d,ry+d,rx+rw,ry],[rx,ry+rh,rx+d,ry+rh-d],[rx+rw-d,ry+rh,rx+rw,ry+rh-d]].forEach(function(z){c.beginPath();c.moveTo(z[0],z[1]);c.lineTo(z[2],z[3]);c.stroke();}); }
    else if(f.tipo==="cilindro"){ var eh=Math.max(4,rh*.15); if(fill)c.fillRect(rx,ry+eh,rw,rh-2*eh); c.beginPath();c.ellipse(cx,ry+eh,a,eh,0,0,TAU);c.ellipse(cx,ry+rh-eh,a,eh,0,0,TAU);c.moveTo(rx,ry+eh);c.lineTo(rx,ry+rh-eh);c.moveTo(rx+rw,ry+eh);c.lineTo(rx+rw,ry+rh-eh);if(fill)c.fill();c.stroke(); }
    else if(f.tipo==="cone"){ pts=[[cx,ry],[rx+rw,ry+rh*.82],[rx,ry+rh*.82]];c.beginPath();pts.forEach(function(p,j){j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);});c.closePath();if(fill)c.fill();c.stroke();c.beginPath();c.ellipse(cx,ry+rh*.82,a,Math.max(3,rh*.12),0,0,TAU);if(fill)c.fill();c.stroke(); }
    else if(f.tipo==="piramide"){ pts=[[cx,ry],[rx+rw,ry+rh],[cx,ry+rh*.82],[rx,ry+rh]];c.beginPath();pts.forEach(function(p,j){j?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]);});c.closePath();if(fill)c.fill();c.stroke();c.beginPath();c.moveTo(cx,ry);c.lineTo(cx,ry+rh*.82);c.stroke(); }
    else if(f.tipo==="prisma"){ var d=Math.min(rw,rh)*.22;c.beginPath();c.moveTo(rx+d,ry);c.lineTo(rx+rw,ry+rh*.2);c.lineTo(rx+rw-d,ry+rh);c.lineTo(rx,ry+rh*.8);c.closePath();if(fill)c.fill();c.stroke();c.beginPath();c.moveTo(rx+d,ry);c.lineTo(rx+d,ry+rh*.78);c.lineTo(rx,ry+rh*.8);c.moveTo(rx+rw,ry+rh*.2);c.lineTo(rx+rw-d,ry+rh);c.stroke(); }
    else if(f.tipo==="esfera"){ var g=c.createRadialGradient(cx-a*.35,cy-b*.4,1,cx,cy,a);g.addColorStop(0,"#fff");g.addColorStop(1,cor);c.fillStyle=fill?g:cor;c.beginPath();c.ellipse(cx,cy,a,b,0,0,TAU);if(fill)c.fill();c.stroke(); }
    else { c.beginPath(); c.ellipse(cx,cy,a,b,0,0,TAU); if(fill)c.fill(); c.stroke(); }
  }
  c.setLineDash([]); c.restore();
}
function redesenharForma(vv){
  var c=vv.cx;
  c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,S.dim.w,S.dim.h);
  transfSim().forEach(function(m){
    c.save(); c.setTransform(m[0],m[1],m[2],m[3],m[4],m[5]);
    tracarForma(c,vv.forma,vv.cor,vv.tam,vv.fill,vv.forma.traco,vv.forma.rot);
    c.restore();
  });
}
function bbForma(vv){
  var f=vv.forma, pad=vv.tam+3;
  if(CFG.sim) return {x0:0,y0:0,x1:S.dim.w,y1:S.dim.h};
  return {x0:Math.min(f.x0,f.x1)-pad,y0:Math.min(f.y0,f.y1)-pad,x1:Math.max(f.x0,f.x1)+pad,y1:Math.max(f.y0,f.y1)+pad};
}

/* guias desenhadas por cima do palco */
function guiaPontos(){var g=CFG.guia||{},tipo=String(g.tipo||"1"),h=clamp(+g.h||.42,.05,.95),a=[];if(tipo==="1")a.push({id:"v1",x:clamp(+g.v1||.5,.02,.98),y:h});else{a.push({id:"v1",x:clamp(+g.v1||.18,.02,.98),y:h},{id:"v2",x:clamp(+g.v2||.82,.02,.98),y:h});if(tipo==="3")a.push({id:"v3",x:clamp(+g.v3||.5,.02,.98),y:clamp(+g.v3y||.08,.02,.98)});}return a;}
function desenharGuiasConstrucao(c){
  var g=CFG.guia||{};if(!g.grade&&!g.persp)return;
  var x0=S.tx,y0=S.ty,W=S.dim.w*S.z,H=S.dim.h*S.z,h=clamp(+g.h||.42,.05,.92),hy=y0+H*h,tipo=String(g.tipo||"1");
  c.save();c.beginPath();c.rect(x0,y0,W,H);c.clip();c.globalAlpha=clamp((+g.op||35)/100,.08,.8);c.lineWidth=Math.max(.7,1/S.z);c.strokeStyle="#2a6fdb";c.setLineDash([5,5]);
  if(g.grade&&!g.persp){
    var passo=Math.max(18,Math.round((+g.passo||96)*S.z));
    for(var gx=x0-(x0%passo);gx<x0+W;gx+=passo){c.beginPath();c.moveTo(gx,y0);c.lineTo(gx,y0+H);c.stroke();}
    for(var gy=y0-(y0%passo);gy<y0+H;gy+=passo){c.beginPath();c.moveTo(x0,gy);c.lineTo(x0+W,gy);c.stroke();}
  }
  if(g.persp){
    var ps=guiaPontos(),vps=ps.map(function(p){return{x:x0+p.x*W,y:hy};}),i,j,t,px,py;
    c.setLineDash([7,5]);c.beginPath();c.moveTo(x0,hy);c.lineTo(x0+W,hy);c.stroke();
    var div=clamp(+g.div||12,4,24);
    if(tipo==="1"){
      var vp=vps[0];
      for(i=0;i<=div;i++){px=x0+W*i/div;c.beginPath();c.moveTo(vp.x,hy);c.lineTo(px,y0+H);c.stroke();}
      for(j=1;j<div;j++){t=Math.pow(j/div,1.65);py=hy+(y0+H-hy)*t;c.beginPath();c.moveTo(x0+(vp.x-x0)*t,py);c.lineTo(vp.x+(x0+W-vp.x)*t,py);c.stroke();}
    }else{
      var vl=vps[0],vr=vps[1];
      for(i=0;i<=div;i++){px=x0+W*i/div;c.beginPath();c.moveTo(vl.x,hy);c.lineTo(px,y0+H);c.stroke();c.beginPath();c.moveTo(vr.x,hy);c.lineTo(px,y0+H);c.stroke();}
      for(j=1;j<div;j++){t=Math.pow(j/div,1.65);py=hy+(y0+H-hy)*t;c.beginPath();c.moveTo(vl.x+(x0-vl.x)*t,py);c.lineTo(vr.x+(x0+W-vr.x)*t,py);c.stroke();}
      if(tipo==="3"){var vm=vps[2]||{x:x0+W*.5,y:y0+H*.08};for(i=0;i<=div;i++){px=x0+W*i/div;c.beginPath();c.moveTo(vm.x,vm.y);c.lineTo(px,y0+H);c.stroke();}}
    }
    vps.forEach(function(v){c.setLineDash([]);c.beginPath();c.arc(v.x,v.y,Math.max(5,7/S.z),0,TAU);c.fillStyle=g.edit?"#1c73d1":"rgba(42,111,219,.55)";c.fill();c.strokeStyle="#fff";c.stroke();c.setLineDash([7,5]);});
  }
  c.restore();
}function guiaHit(sx,sy){var g=CFG.guia||{};if(!g.edit||!g.persp)return null;var W=S.dim.w*S.z,H=S.dim.h*S.z,x0=S.tx,y0=S.ty;for(var p of guiaPontos()){var px=x0+p.x*W,py=y0+p.y*H;if(Math.hypot(sx-px,sy-py)<14)return p.id;}return null;}
function guiasSim(c){
  if(!CFG.sim) return;
  var W=S.dim.w*S.z, H=S.dim.h*S.z, x0=S.tx, y0=S.ty, cx=x0+W/2, cy=y0+H/2;
  c.save();
  c.beginPath(); c.rect(x0,y0,W,H); c.clip();
  c.lineWidth=1; c.setLineDash([6,5]); c.strokeStyle="rgba(42,111,219,.85)";
  c.beginPath();
  if(CFG.sim==="v"||CFG.sim==="q"){ c.moveTo(cx,y0); c.lineTo(cx,y0+H); }
  if(CFG.sim==="h"||CFG.sim==="q"){ c.moveTo(x0,cy); c.lineTo(x0+W,cy); }
  if(CFG.sim==="r"){
    var k, a, rr=Math.hypot(W,H)/2;
    for(k=0;k<CFG.simN;k++){ a=TAU*k/CFG.simN; c.moveTo(cx,cy); c.lineTo(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr); }
  }
  c.stroke(); c.restore();
}
function guiasBal(c){
  if(S.ferr!=="balao") return;
  var b=balAtual(); if(!b) return;
  var x=S.tx+b.x*S.z, y=S.ty+b.y*S.z, w=b.w*S.z, h=b.h*S.z;
  if(b.tipo==="sfx"){
    c.save();c.translate(x+w/2,y+h/2);c.rotate((b.rot||0)*Math.PI/180);c.lineWidth=1;c.setLineDash([5,4]);c.strokeStyle="#1673b9";c.strokeRect(-w/2,-h/2,w,h);c.setLineDash([]);
    [[-w/2,-h/2],[w/2,-h/2],[w/2,h/2],[-w/2,h/2]].forEach(function(p){c.fillStyle="#fff";c.strokeStyle="#1673b9";c.fillRect(p[0]-4,p[1]-4,8,8);c.strokeRect(p[0]-4,p[1]-4,8,8);});
    c.beginPath();c.moveTo(0,-h/2);c.lineTo(0,-h/2-28);c.stroke();c.beginPath();c.arc(0,-h/2-28,6,0,TAU);c.fillStyle="#1673b9";c.fill();c.strokeStyle="#fff";c.stroke();c.restore();return;
  }
  c.save(); c.lineWidth=1; c.setLineDash([]); c.strokeStyle="#fff"; c.strokeRect(x+0.5,y+0.5,w,h);
  c.setLineDash([5,4]); c.strokeStyle="#000"; c.strokeRect(x+0.5,y+0.5,w,h); c.setLineDash([]);
  var r={x:b.x,y:b.y,w:b.w,h:b.h};
  ALCAS.forEach(function(a){
    var p=posAlca(r,a); c.fillStyle="#fff"; c.strokeStyle="#000";
    c.fillRect(p.x-4,p.y-4,8,8); c.strokeRect(p.x-3.5,p.y-3.5,7,7);
  });
  if(b.tipo!=="narracao"){
    var tx=S.tx+b.px*S.z, ty=S.ty+b.py*S.z;
    c.beginPath(); c.arc(tx,ty,7,0,TAU); c.fillStyle="#2a6fdb"; c.fill(); c.lineWidth=2; c.strokeStyle="#fff"; c.stroke();
  }
  c.restore();
}

/* ---------- balões: criar, escolher o tipo, mover, redimensionar, editar ---------- */
function abrirSfx(){
  if(!S)return;E.sfxJanela.classList.remove("oculto");trocarFerr("balao");S.sfxModo=true;atualizarSfx();
}
function fecharSfx(){if(E.sfxJanela)E.sfxJanela.classList.add("oculto");if(S){fecharEdicaoBal();S.sfxModo=false;}}
function novoSfx(){
  if(!S)return;commitFlut();fecharEdicaoBal();trocarFerr("balao");S.sfxModo=true;
  var m=Math.min(S.dim.w,S.dim.h),w=m*.45,h=m*.16,p=paraObra(S.pw/2,S.ph/2),antes=snapBal();
  var b=cloneBal({id:nid(),tipo:"sfx",txt:"BOOM!",x:clamp(p.x-w/2,0,S.dim.w-w),y:clamp(p.y-h/2,0,S.dim.h-h),w:w,h:h,rot:-10,fonte:"impact",cor:"#111111",contorno:"#ffffff",esp:5});
  S.baloes.push(b);S.balSel=b.id;empurrar({t:"bal",antes:antes,depois:snapBal()});abrirSfx();atualizarBal();pedir(true);E.sfxTexto.focus();E.sfxTexto.select();
}
function atualizarSfx(){
  if(!S||!E.sfxLista)return;var b=balAtual(),sfx=b&&b.tipo==="sfx"?b:null,foco=document.activeElement;
  E.sfxLista.innerHTML='<option value="">Escolher…</option>'+S.baloes.filter(function(o){return o.tipo==="sfx";}).map(function(o){return '<option value="'+esc(o.id)+'">'+esc((o.txt||"Sem texto").replace(/\n/g," ").slice(0,50))+'</option>';}).join("");
  E.sfxLista.value=sfx?sfx.id:"";E.sfxCampos.classList.toggle("oculto",!sfx);if(!sfx)return;
  [["sfxTexto",sfx.txt],["sfxFonte",sfx.fonte],["sfxAltura",Math.round(sfx.h)],["sfxLargura",Math.round(sfx.w)],["sfxRot",Math.round(sfx.rot||0)],["sfxCor",sfx.cor],["sfxContorno",sfx.contorno],["sfxEsp",sfx.esp||0]].forEach(function(p){if(foco!==E[p[0]])E[p[0]].value=p[1];});
  E.sfxItalico.checked=!!sfx.italico;E.sfxRotV.textContent=Math.round(sfx.rot||0)+"°";E.sfxEspV.textContent=(sfx.esp||0)+" px";
}
function campoSfx(r,t,confirmar){
  if(!/^sfx/.test(r||""))return false;
  if(r==="sfxLista"){if(confirmar){var escolhido=t.value||null;fecharEdicaoBal();trocarFerr("balao");S.sfxModo=true;S.balSel=escolhido;atualizarBal();pedir(true);}return true;}
  var b=balAtual();if(!b||b.tipo!=="sfx")return true;
  balEdit(function(o){
    if(r==="sfxTexto")o.txt=t.value.slice(0,2000);
    else if(r==="sfxFonte")o.fonte=Object.prototype.hasOwnProperty.call(FONTES_SFX,t.value)?t.value:"impact";
    else if(r==="sfxAltura"&&t.value!=="")o.h=clamp(+t.value||40,40,4000);
    else if(r==="sfxLargura"&&t.value!=="")o.w=clamp(+t.value||60,60,6000);
    else if(r==="sfxRot")o.rot=clamp(+t.value||0,-180,180);
    else if(r==="sfxCor")o.cor=corSfx(t.value,"#111111");
    else if(r==="sfxContorno")o.contorno=corSfx(t.value,"#ffffff");
    else if(r==="sfxEsp")o.esp=clamp(+t.value||0,0,32);
    else if(r==="sfxItalico")o.italico=t.checked;
  });if(confirmar)fecharEdicaoBal();atualizarSfx();return true;
}
function snapBal(){ return S.baloes.map(cloneBal); }
function balAtual(){
  for(var i=0;i<S.baloes.length;i++) if(S.baloes[i].id===S.balSel) return S.baloes[i];
  return null;
}
function balEdit(fn){
  var b=balAtual(); if(!b) return;
  if(!S.balSnap) S.balSnap=snapBal();
  fn(b); b._c=null;
  pedir(true); agendarSalvar();
}
function fecharEdicaoBal(){
  if(!S||!S.balSnap) return;
  var antes=S.balSnap; S.balSnap=null;
  empurrar({t:"bal",antes:antes,depois:snapBal()});
}
function novoBalao(x,y,tipo,txt){
  var m=Math.min(S.dim.w,S.dim.h), t=tipo||CFG.balTipo, rect=ehRetBal(t);
  var w=Math.round(m*(rect?0.42:0.36)), h=Math.round(m*(rect?0.17:0.22));
  var bx=clamp(Math.round(x-w/2),0,Math.max(0,S.dim.w-w)), by=clamp(Math.round(y-h/2),0,Math.max(0,S.dim.h-h));
  var py=by+h+h*0.55; if(py>S.dim.h-4) py=by-h*0.55;
  var b=cloneBal({id:nid(),txt:txt||"",tipo:t,x:bx,y:by,w:w,h:h,px:bx+w*0.3,py:py,fs:0});
  var antes=snapBal();
  S.baloes.push(b); S.balSel=b.id;
  empurrar({t:"bal",antes:antes,depois:snapBal()});
  atualizarBal(); pedir(true);
  return b;
}
function novoBalaoCentro(){
  fecharEdicaoBal();
  novoBalao((S.pw/2-S.tx)/S.z,(S.ph/2-S.ty)/S.z,CFG.balTipo,"");
}
function balEm(x,y){
  for(var i=S.baloes.length-1;i>=0;i--){
    var b=S.baloes[i];
    if(b.tipo==="sfx"){if(contemSfx(b,x,y))return b;continue;}
    if(x<b.x||x>b.x+b.w||y<b.y||y>b.y+b.h) continue;
    if(ehRetBal(b.tipo)) return b;
    var nx=(x-(b.x+b.w/2))/(b.w/2), ny=(y-(b.y+b.h/2))/(b.h/2);
    if(nx*nx+ny*ny<=1.15) return b;
  }
  return null;
}
function balAlca(b,sx,sy){
  var i, p;
  if(b.tipo==="sfx"){
    var w=paraObraSemRotacao(sx,sy),q=pontoSfx(b,w.x,w.y,true),tol=12/S.z,rt=28/S.z;
    if(Math.hypot(q.x-b.x-b.w/2,q.y-b.y+rt)<=tol)return "girar";
    var cantos=[["nw",b.x,b.y],["ne",b.x+b.w,b.y],["se",b.x+b.w,b.y+b.h],["sw",b.x,b.y+b.h]];
    for(i=0;i<cantos.length;i++)if(Math.abs(q.x-cantos[i][1])<=tol&&Math.abs(q.y-cantos[i][2])<=tol)return cantos[i][0];
    return contemSfx(b,w.x,w.y)?"mover":null;
  }
  if(b.tipo!=="narracao"){
    p={x:S.tx+b.px*S.z,y:S.ty+b.py*S.z};
    if(Math.hypot(sx-p.x,sy-p.y)<=14) return "cauda";
  }
  var r={x:b.x,y:b.y,w:b.w,h:b.h};
  for(i=0;i<ALCAS.length;i++){
    p=posAlca(r,ALCAS[i]);
    if(Math.abs(sx-p.x)<=10&&Math.abs(sy-p.y)<=10) return ALCAS[i];
  }
  var x=S.tx+b.x*S.z, y=S.ty+b.y*S.z, w=b.w*S.z, h=b.h*S.z;
  if(sx>=x&&sx<=x+w&&sy>=y&&sy<=y+h) return "mover";
  return null;
}
function balDown(w,sx,sy){
  var b=balAtual(), h=b?balAlca(b,sx,sy):null;
  if(!(h&&h!=="mover")){
    var hit=balEm(w.x,w.y);
    if(hit){
      b=hit; h="mover";
      if(S.balSel!==b.id){ fecharEdicaoBal(); S.balSel=b.id; atualizarBal(); }
      if(b.tipo==="sfx"){S.sfxModo=true;E.sfxJanela.classList.remove("oculto");atualizarSfx();}
    }else{
      fecharEdicaoBal();
      if(S.sfxModo){S.balSel=null;atualizarBal();pedir(false);return;}
      novoBalao(w.x,w.y,CFG.balTipo,"");
      return;
    }
  }
  fecharEdicaoBal();
  S.balOp={h:h,x0:w.x,y0:w.y,ini:cloneBal(b),snap:snapBal(),moveu:false};
  pedir(false);
}
function balMove(w){
  var op=S.balOp, b=balAtual(); if(!op||!b) return;
  var dx=w.x-op.x0, dy=w.y-op.y0, i=op.ini, h=op.h;
  if(Math.abs(dx)+Math.abs(dy)>2) op.moveu=true;
  if(b.tipo==="sfx"&&h==="girar"){
    var cx=i.x+i.w/2,cy=i.y+i.h/2,a0=Math.atan2(op.y0-cy,op.x0-cx),a1=Math.atan2(w.y-cy,w.x-cx);b.rot=((i.rot||0)+(a1-a0)*180/Math.PI+540)%360-180;
  }else if(b.tipo==="sfx"&&h!=="mover"){
    var a=(i.rot||0)*Math.PI/180,ldx=dx*Math.cos(a)+dy*Math.sin(a),ldy=-dx*Math.sin(a)+dy*Math.cos(a),sw=h.indexOf("w")>-1?-1:1,sh=h.indexOf("n")>-1?-1:1;
    var nw=clamp(i.w+sw*ldx,60,6000),nh=clamp(i.h+sh*ldy,40,4000),shiftX=sw*(nw-i.w)/2,shiftY=sh*(nh-i.h)/2;
    var ncx=i.x+i.w/2+shiftX*Math.cos(a)-shiftY*Math.sin(a),ncy=i.y+i.h/2+shiftX*Math.sin(a)+shiftY*Math.cos(a);b.x=ncx-nw/2;b.y=ncy-nh/2;b.w=nw;b.h=nh;
  }
  else if(h==="mover"){ b.x=i.x+dx; b.y=i.y+dy; b.px=i.px+dx; b.py=i.py+dy; }
  else if(h==="cauda"){ b.px=i.px+dx; b.py=i.py+dy; }
  else{
    var nx=i.x, ny=i.y, nw=i.w, nh=i.h;
    if(h.indexOf("e")>-1) nw=i.w+dx;
    if(h.indexOf("w")>-1){ nw=i.w-dx; nx=i.x+dx; }
    if(h.indexOf("s")>-1) nh=i.h+dy;
    if(h.indexOf("n")>-1){ nh=i.h-dy; ny=i.y+dy; }
    if(nw<60){ if(h.indexOf("w")>-1) nx=i.x+i.w-60; nw=60; }
    if(nh<40){ if(h.indexOf("n")>-1) ny=i.y+i.h-40; nh=40; }
    b.x=nx; b.y=ny; b.w=nw; b.h=nh;
  }
  b._c=null;if(b.tipo==="sfx")atualizarSfx(); pedir(true);
}
function balUp(){
  var op=S.balOp; S.balOp=null; if(!op) return;
  if(op.moveu) empurrar({t:"bal",antes:op.snap,depois:snapBal()});
  pedir(true);
}
function escolherTipoBal(t){
  S.sfxModo=false;
  CFG.balTipo=t;
  if(S.ferr!=="balao") trocarFerr("balao");
  if(balAtual()){ balEdit(function(x){ x.tipo=t; }); fecharEdicaoBal(); }
  atualizarBal(); pedir(true);
}
function apagarBal(){
  var b=balAtual(); if(!b) return;
  fecharEdicaoBal();
  var antes=snapBal();
  S.baloes=S.baloes.filter(function(x){ return x.id!==b.id; }); S.balSel=null;
  empurrar({t:"bal",antes:antes,depois:snapBal()});
  atualizarBal(); pedir(true);
}
function duplicarBal(){
  var b=balAtual(); if(!b) return;
  fecharEdicaoBal();
  var antes=snapBal(), c=cloneBal(b);
  c.id=nid(); c.x+=40; c.y+=40; c.px+=40; c.py+=40;
  S.baloes.push(c); S.balSel=c.id;
  empurrar({t:"bal",antes:antes,depois:snapBal()});
  atualizarBal(); pedir(true);
}
function balFrente(){
  var b=balAtual(); if(!b) return;
  fecharEdicaoBal();
  var antes=snapBal();
  S.baloes=S.baloes.filter(function(x){ return x.id!==b.id; }); S.baloes.push(b);
  empurrar({t:"bal",antes:antes,depois:snapBal()});
  pedir(true);
}
function listarFalas(){
  var lista=(S.opts.falas?S.opts.falas():[])||[], h="", n=0;
  lista.forEach(function(f,i){
    var t=(f.texto||"").trim(); if(!t) return;
    n++;
    var q=(f.quem||"").trim();
    h+='<button type="button" class="bt mini" data-bfala="'+i+'" title="'+esc(t)+'">'+esc((q?q+": ":"")+t)+'</button>';
  });
  E.balFalas.innerHTML=h; E.balFalasBox.classList.toggle("oculto",!n);
}
function balDeFala(i){
  var lista=(S.opts.falas?S.opts.falas():[])||[], f=lista[i]; if(!f) return;
  var tipo=f.tipo||"fala";
  if(!TIPOS_BAL.some(function(t){ return t[0]===tipo; })) tipo="fala";
  var b=balAtual();
  if(b&&!(b.txt||"").trim()){
    balEdit(function(x){ x.txt=f.texto||""; x.tipo=tipo; }); fecharEdicaoBal(); atualizarBal(); return;
  }
  var n=S.baloes.length%4;
  fecharEdicaoBal();
  novoBalao((S.pw/2-S.tx)/S.z+n*40,(S.ph/2-S.ty)/S.z+n*40,tipo,f.texto||"");
}
function atualizarBal(){
  if(!S||!E.balCampos) return;
  var on=S.ferr==="balao", b=on?balAtual():null, tipoAtivo=b?b.tipo:CFG.balTipo;
  atualizarSfx();if(b&&b.tipo==="sfx"){E.balCampos.classList.add("oculto");E.balDica.textContent="Onomatopeia selecionada: use a janela Onomatopeias para editar texto e aparência.";return;}
  qa("[data-baltipo]").forEach(function(x){ x.classList.toggle("ativo",x.getAttribute("data-baltipo")===tipoAtivo); });
  E.balCampos.classList.toggle("oculto",!b);
  E.balDica.textContent=b?"Balão selecionado: troque o tipo abaixo, edite o texto ou arraste no desenho."
    :(on?"Escolha o tipo e clique no desenho para criar. Clique num balão para editá-lo."
        :"Escolha um tipo: a ferramenta Balão é ativada e o próximo clique no desenho cria o balão.");
  if(b){
    var foco=document.activeElement===E.balTxt&&S.balValId===b.id;
    if(!foco) E.balTxt.value=b.txt;
    S.balValId=b.id;
    E.balFs.value=b.fs||0; E.balFsV.textContent=b.fs?b.fs:"auto";
  }
  listarFalas();
}
function miniaturasBaloes(){
  qa("[data-baltipo]").forEach(function(btn){
    var cv=btn.querySelector("canvas"), x=cv.getContext("2d"), t=btn.getAttribute("data-baltipo");
    x.fillStyle="#fff"; x.fillRect(0,0,cv.width,cv.height);
    desenharBalao(x,{id:"x",txt:"Aa",tipo:t,x:16,y:8,w:100,h:50,px:36,py:cv.height-6,fs:0},3);
  });
}

/* ---------- seleção: espelhar e girar ---------- */
function girarSelecaoGraus(graus){
  if(!S.flut){
    if(!S.sel||!levantar()){ aviso("Faça uma seleção primeiro (ferramenta Selecionar)."); return; }
  }
  var f=S.flut, rad=(+graus||0)*Math.PI/180, co=Math.abs(Math.cos(rad)), si=Math.abs(Math.sin(rad));
  var nw=Math.max(1,Math.ceil(f.ow*co+f.oh*si)), nh=Math.max(1,Math.ceil(f.ow*si+f.oh*co));
  var c=novoCanvas(nw,nh), x=c.getContext("2d");
  x.translate(nw/2,nh/2); x.rotate(rad); x.drawImage(f.cv,-f.ow/2,-f.oh/2);
  var cx=f.x+f.w/2, cy=f.y+f.h/2; f.cv=c; f.ow=nw; f.oh=nh; f.w=nw; f.h=nh; f.x=cx-nw/2; f.y=cy-nh/2;
  pedir(true);
}
function transformarSel(op){
  if(!S.flut){
    if(!S.sel||!levantar()){ aviso("Faça uma seleção primeiro (ferramenta Selecionar)."); return; }
  }
  var f=S.flut, c, x;
  if(op==="gira"){
    c=novoCanvas(f.oh,f.ow); x=c.getContext("2d");
    x.translate(c.width/2,c.height/2); x.rotate(Math.PI/2); x.drawImage(f.cv,-f.ow/2,-f.oh/2);
    var cx=f.x+f.w/2, cy=f.y+f.h/2, nw=f.h, nh=f.w, ow=f.ow;
    f.ow=f.oh; f.oh=ow; f.cv=c; f.w=nw; f.h=nh; f.x=cx-nw/2; f.y=cy-nh/2;
  }else{
    var fh=op==="fh";
    c=novoCanvas(f.ow,f.oh); x=c.getContext("2d");
    x.translate(fh?f.ow:0,fh?0:f.oh); x.scale(fh?-1:1,fh?1:-1); x.drawImage(f.cv,0,0);
    f.cv=c;
  }
  f.mod=true;
  pedir(true);
}

/* ---------- balde e conta-gotas ---------- */
function balde(w){
  commitFlut();
  var L=camadaAtiva(); if(!L) return;
  if(!L.vis){ aviso("A camada está oculta. Mostre-a para pintar."); return; } if(L.bloqueada){ aviso("Desbloqueie a camada antes de pintar."); return; }
  var W=S.dim.w, H=S.dim.h, sx=Math.floor(w.x), sy=Math.floor(w.y);
  if(sx<0||sy<0||sx>=W||sy>=H) return;
  var ref;
  if(CFG.ref){
    ref=novoCanvas(W,H); var rc=ref.getContext("2d");
    rc.fillStyle="#fff"; rc.fillRect(0,0,W,H); camadasEm(rc,false);
  }else ref=L.cv;
  var dt=ref.getContext("2d").getImageData(0,0,W,H).data;
  var i0=(sy*W+sx)*4, r0=dt[i0], g0=dt[i0+1], b0=dt[i0+2], a0=dt[i0+3];
  var tol=CFG.tol*2.55;
  function casa(i){
    var j=i*4;
    return (Math.abs(dt[j]-r0)+Math.abs(dt[j+1]-g0)+Math.abs(dt[j+2]-b0)+Math.abs(dt[j+3]-a0))/4<=tol;
  }
  var mask=new Uint8Array(W*H), pilha=[sx,sy], minx=sx, maxx=sx, miny=sy, maxy=sy;
  while(pilha.length){
    var y=pilha.pop(), x=pilha.pop(), i=y*W+x;
    if(mask[i]||!casa(i)) continue;
    var xl=x, xr=x;
    while(xl>0&&!mask[y*W+xl-1]&&casa(y*W+xl-1)) xl--;
    while(xr<W-1&&!mask[y*W+xr+1]&&casa(y*W+xr+1)) xr++;
    var k;
    for(k=xl;k<=xr;k++) mask[y*W+k]=1;
    if(xl<minx) minx=xl; if(xr>maxx) maxx=xr; if(y<miny) miny=y; if(y>maxy) maxy=y;
    for(var dy=-1;dy<=1;dy+=2){
      var ny=y+dy; if(ny<0||ny>=H) continue;
      var preso=false;
      for(k=xl;k<=xr;k++){
        var ok=!mask[ny*W+k]&&casa(ny*W+k);
        if(ok&&!preso){ pilha.push(k,ny); preso=true; } else if(!ok) preso=false;
      }
    }
  }
  /* cresce 1 px para cobrir o serrilhado das linhas */
  var bx0=Math.max(0,minx-1), by0=Math.max(0,miny-1), bx1=Math.min(W-1,maxx+1), by1=Math.min(H-1,maxy+1);
  var bw=bx1-bx0+1, bh=by1-by0+1;
  var tc=novoCanvas(bw,bh), tcx=tc.getContext("2d"), id=tcx.createImageData(bw,bh), od=id.data, rgb=hexRgb(CFG.cor);
  var yy, xx;
  for(yy=by0;yy<=by1;yy++) for(xx=bx0;xx<=bx1;xx++){
    var q=yy*W+xx, m=mask[q];
    if(!m){
      if(xx>0&&mask[q-1]) m=1; else if(xx<W-1&&mask[q+1]) m=1;
      else if(yy>0&&mask[q-W]) m=1; else if(yy<H-1&&mask[q+W]) m=1;
    }
    if(m){ var o=((yy-by0)*bw+(xx-bx0))*4; od[o]=rgb[0]; od[o+1]=rgb[1]; od[o+2]=rgb[2]; od[o+3]=255; }
  }
  tcx.putImageData(id,0,0);
  var antes=recortar(L.cv,bx0,by0,bw,bh);
  L.cx.save(); L.cx.globalCompositeOperation="destination-over"; L.cx.drawImage(tc,bx0,by0); L.cx.restore();
  var depois=recortar(L.cv,bx0,by0,bw,bh);
  L.sujo=true;
  empurrar({t:"px",layer:L.id,x:bx0,y:by0,antes:antes,depois:depois});
  pedir(true);
}
function gota(w){
  var x=Math.floor(w.x), y=Math.floor(w.y);
  if(x<0||y<0||x>=S.dim.w||y>=S.dim.h) return;
  commitFlut();
  var c=novoCanvas(1,1), cx=c.getContext("2d");
  cx.fillStyle="#fff"; cx.fillRect(0,0,1,1); cx.translate(-x,-y); camadasEm(cx,false);
  var d=cx.getImageData(0,0,1,1).data;
  definirCor(rgbHex(d[0],d[1],d[2]));
  if(S.ferrAnt&&S.ferrAnt!=="gota") trocarFerr(S.ferrAnt);
}

/* ---------- seleção, mover e redimensionar ---------- */
function levantar(){
  var L=camadaAtiva(), r=S.sel; if(!L||!r||r.w<1||r.h<1) return false;
  if(!L.vis){ aviso("A camada está oculta."); return false; }
  var fb=novoCanvas(S.dim.w,S.dim.h); fb.getContext("2d").drawImage(L.cv,0,0);
  var fc=recorteSelecao(L.cv,r);
  L.cx.save(); caminhoSelecao(L.cx,r,0,0); L.cx.clearRect(r.x,r.y,r.w,r.h); L.cx.restore();
  S.flut={cv:fc,ox:r.x,oy:r.y,ow:r.w,oh:r.h,x:r.x,y:r.y,w:r.w,h:r.h,fb:fb,layer:L.id,nova:false,forma:r.forma||"retangulo",path:r.path||null};
  S.sel=null; pedir(true); return true;
}
function uniao(a,b){
  var x0=b.x, y0=b.y, x1=b.x+b.w, y1=b.y+b.h;
  if(a){ x0=Math.min(x0,a.x); y0=Math.min(y0,a.y); x1=Math.max(x1,a.x+a.w); y1=Math.max(y1,a.y+a.h); }
  x0=Math.max(0,Math.floor(x0)); y0=Math.max(0,Math.floor(y0));
  x1=Math.min(S.dim.w,Math.ceil(x1)); y1=Math.min(S.dim.h,Math.ceil(y1));
  if(x1<=x0||y1<=y0) return null;
  return {x:x0,y:y0,w:x1-x0,h:y1-y0};
}
function commitFlut(){
  var f=S&&S.flut; if(!f) return;
  S.flut=null;
  var L=porId(f.layer); if(!L){ pedir(true); return; }
  var nx=Math.round(f.x), ny=Math.round(f.y), nw=Math.max(1,Math.round(f.w)), nh=Math.max(1,Math.round(f.h));
  var igual=!f.nova&&!f.mod&&nx===f.ox&&ny===f.oy&&nw===f.ow&&nh===f.oh;
  var bb=uniao(f.nova?null:{x:f.ox,y:f.oy,w:f.ow,h:f.oh},{x:nx,y:ny,w:nw,h:nh});
  L.cx.save(); L.cx.imageSmoothingQuality="high";
  L.cx.drawImage(f.cv,0,0,f.ow,f.oh,nx,ny,nw,nh); L.cx.restore();
  if(!bb||igual){ S.sel=igual?{x:f.ox,y:f.oy,w:f.ow,h:f.oh,forma:f.forma||"retangulo",path:f.path||null}:null; pedir(true); return; }
  var antes=recortar(f.fb,bb.x,bb.y,bb.w,bb.h), depois=recortar(L.cv,bb.x,bb.y,bb.w,bb.h);
  L.sujo=true;
  empurrar({t:"px",layer:L.id,x:bb.x,y:bb.y,antes:antes,depois:depois});
  S.sel={x:nx,y:ny,w:nw,h:nh,forma:f.forma||"retangulo",path:f.path||null}; pedir(true);
}
function cancelarSel(){
  if(S.flut){
    var f=S.flut, L=porId(f.layer); S.flut=null;
    if(L&&!f.nova){ if(f.mod){ L.cx.clearRect(0,0,S.dim.w,S.dim.h); L.cx.drawImage(f.fb,0,0); } else L.cx.drawImage(f.cv,f.ox,f.oy); }
    S.sel=f.nova?null:{x:f.ox,y:f.oy,w:f.ow,h:f.oh};
  }else S.sel=null;
  S.selPath=null;
  pedir(true);
}
function apagarSel(){
  var L=camadaAtiva(); if(!L) return;
  if(S.flut){
    var f=S.flut; S.flut=null;
    if(!f.nova){
      var bb=uniao(null,{x:f.ox,y:f.oy,w:f.ow,h:f.oh});
      if(bb){
        var antes=recortar(f.fb,bb.x,bb.y,bb.w,bb.h), depois=recortar(L.cv,bb.x,bb.y,bb.w,bb.h);
        L.sujo=true; empurrar({t:"px",layer:L.id,x:bb.x,y:bb.y,antes:antes,depois:depois});
      }
    }
    S.sel=null; pedir(true);
  }else if(S.sel&&L.vis){
    var r=S.sel, b2=uniao(null,r); if(!b2) return;
    var a2=recortar(L.cv,b2.x,b2.y,b2.w,b2.h);
    L.cx.save(); caminhoSelecao(L.cx,r,0,0); L.cx.clearRect(b2.x,b2.y,b2.w,b2.h); L.cx.restore();
    var d2=recortar(L.cv,b2.x,b2.y,b2.w,b2.h);
    L.sujo=true; empurrar({t:"px",layer:L.id,x:b2.x,y:b2.y,antes:a2,depois:d2});
    pedir(true);
  }
}
function selecionarTudo(){
  commitFlut(); S.sel={x:0,y:0,w:S.dim.w,h:S.dim.h,forma:"retangulo"}; S.selPath=null; trocarFerr("selecionar"); pedir(false);
}
function copiarSel(){
  var r=retSel(); if(!r) return;
  var c;
  if(S.flut){
    var f=S.flut; c=novoCanvas(Math.max(1,Math.round(f.w)),Math.max(1,Math.round(f.h)));
    c.getContext("2d").drawImage(f.cv,0,0,f.ow,f.oh,0,0,c.width,c.height);
  }else{
    var L=camadaAtiva(); if(!L) return;
    c=recorteSelecao(L.cv,r);
  }
  CLIP=c; aviso("Área copiada.");
}
function duplicarSelecaoNovaCamada(){
  var r=retSel(); if(!r){ aviso("Faça uma seleção primeiro."); return; }
  copiarSel(); if(!CLIP) return;
  commitFlut(); r=retSel(); if(!r) return;
  var c=novoCanvas(S.dim.w,S.dim.h), x=c.getContext("2d"); x.drawImage(CLIP,Math.round(r.x),Math.round(r.y));
  novaCamada("Seleção duplicada",c);
  S.sel={x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.w),h:Math.round(r.h),forma:r.forma||"retangulo",path:r.path||null};
  aviso("Seleção duplicada em uma nova camada."); pedir(true);
}
function colarSel(){
  if(!CLIP) return;
  commitFlut();
  var L=camadaAtiva(); if(!L||!L.vis) return;
  var fb=novoCanvas(S.dim.w,S.dim.h); fb.getContext("2d").drawImage(L.cv,0,0);
  var cx=(S.pw/2-S.tx)/S.z, cy=(S.ph/2-S.ty)/S.z;
  var w=CLIP.width, h=CLIP.height;
  var x=clamp(Math.round(cx-w/2),0,Math.max(0,S.dim.w-w)), y=clamp(Math.round(cy-h/2),0,Math.max(0,S.dim.h-h));
  S.flut={cv:CLIP,ox:0,oy:0,ow:w,oh:h,x:x,y:y,w:w,h:h,fb:fb,layer:L.id,nova:true};
  S.sel=null; trocarFerr("selecionar"); pedir(true);
}
function alcaEm(r,sx,sy){
  var i, p;
  for(i=0;i<ALCAS.length;i++){
    p=posAlca(r,ALCAS[i]);
    if(Math.abs(sx-p.x)<=9&&Math.abs(sy-p.y)<=9) return ALCAS[i];
  }
  var x=S.tx+r.x*S.z, y=S.ty+r.y*S.z, w=r.w*S.z, h=r.h*S.z;
  if(sx>=x&&sx<=x+w&&sy>=y&&sy<=y+h) return "mover";
  return null;
}
function selDown(w,sx,sy,e){
  var LA=camadaAtiva(); if(LA&&LA.bloqueada){ aviso("Desbloqueie a camada antes de selecionar ou mover."); return; }
  var r=retSel();
  if(r&&r.w>0&&r.h>0){
    var h=alcaEm(r,sx,sy);
    if(h){
      if(!S.flut&&!levantar()) return;
      var f=S.flut;
      S.selOp={tipo:h==="mover"?"mover":"escala",h:h,x0:w.x,y0:w.y,r0:{x:f.x,y:f.y,w:f.w,h:f.h},path0:f.path?f.path.map(function(p){return {x:p.x,y:p.y};}):null,shift:e.shiftKey};
      return;
    }
    commitFlut(); S.sel=null; S.selPath=null;
  }
  S.selOp={tipo:"novo",x0:w.x,y0:w.y,forma:S.selForma||"retangulo"};
  S.selPath=(S.selForma==="laco")?[{x:w.x,y:w.y}]:null;
  S.sel={x:Math.round(w.x),y:Math.round(w.y),w:0,h:0,forma:S.selForma||"retangulo",path:S.selPath};
}
function selMove(w){
  var op=S.selOp; if(!op) return;
  if(op.tipo==="novo"){
    if(op.forma==="laco"){
      w={x:clamp(w.x,0,S.dim.w),y:clamp(w.y,0,S.dim.h)};
      var ultimo=S.selPath&&S.selPath[S.selPath.length-1];
      if(!ultimo||Math.hypot(w.x-ultimo.x,w.y-ultimo.y)>=2) S.selPath.push({x:w.x,y:w.y});
      var lx=Infinity,ly=Infinity,lx1=-Infinity,ly1=-Infinity,i;
      for(i=0;i<S.selPath.length;i++){ lx=Math.min(lx,S.selPath[i].x); ly=Math.min(ly,S.selPath[i].y); lx1=Math.max(lx1,S.selPath[i].x); ly1=Math.max(ly1,S.selPath[i].y); }
      S.sel={x:Math.round(lx),y:Math.round(ly),w:Math.round(lx1-lx),h:Math.round(ly1-ly),forma:"laco",path:S.selPath.slice()};
      pedir(false); return;
    }
    var x0=clamp(Math.min(op.x0,w.x),0,S.dim.w), y0=clamp(Math.min(op.y0,w.y),0,S.dim.h);
    var x1=clamp(Math.max(op.x0,w.x),0,S.dim.w), y1=clamp(Math.max(op.y0,w.y),0,S.dim.h);
    S.sel={x:Math.round(x0),y:Math.round(y0),w:Math.round(x1-x0),h:Math.round(y1-y0),forma:op.forma||"retangulo"};
  }else if(op.tipo==="mover"){
    var mdx=w.x-op.x0, mdy=w.y-op.y0;
    S.flut.x=op.r0.x+mdx; S.flut.y=op.r0.y+mdy;
    if(op.path0) S.flut.path=op.path0.map(function(p){ return {x:p.x+mdx,y:p.y+mdy}; });
    pedir(true); return;
  }else{
    var r=op.r0, dx=w.x-op.x0, dy=w.y-op.y0, h=op.h;
    var nx=r.x, ny=r.y, nw=r.w, nh=r.h;
    if(h.indexOf("e")>-1) nw=r.w+dx;
    if(h.indexOf("w")>-1){ nw=r.w-dx; nx=r.x+dx; }
    if(h.indexOf("s")>-1) nh=r.h+dy;
    if(h.indexOf("n")>-1){ nh=r.h-dy; ny=r.y+dy; }
    if(h.length===2&&!op.shift){
      var sc=Math.max(Math.abs(nw/r.w),Math.abs(nh/r.h));
      nw=r.w*sc; nh=r.h*sc;
      nx=h.indexOf("w")>-1?r.x+r.w-nw:r.x; ny=h.indexOf("n")>-1?r.y+r.h-nh:r.y;
    }
    if(nw<4){ if(h.indexOf("w")>-1) nx=r.x+r.w-4; nw=4; }
    if(nh<4){ if(h.indexOf("n")>-1) ny=r.y+r.h-4; nh=4; }
    S.flut.x=nx; S.flut.y=ny; S.flut.w=nw; S.flut.h=nh;
    if(op.path0) S.flut.path=op.path0.map(function(p){ return {x:nx+(p.x-r.x)*(nw/Math.max(1,r.w)),y:ny+(p.y-r.y)*(nh/Math.max(1,r.h))}; });
    pedir(true); return;
  }
  pedir(false);
}
function selUp(){
  var op=S.selOp; S.selOp=null; if(!op) return;
  if(op.tipo==="novo"){
    if(!S.sel||S.sel.w<3||S.sel.h<3) S.sel=null;
    else if(op.forma==="laco"){
      if(!S.selPath||S.selPath.length<3) S.sel=null;
      else { S.sel.path=S.selPath.slice(); S.sel.forma="laco"; }
    }
  }
  pedir(true);
}

/* ---------- ponteiro: desenhar, mover a tela, zoom ---------- */
function ptoPalco(e,rc){
  rc=rc||E.palco.getBoundingClientRect();
  return {x:e.clientX-rc.left,y:e.clientY-rc.top};
}
function rotacionarPonto(x,y,ang,cx,cy){ var dx=x-cx,dy=y-cy,co=Math.cos(ang),si=Math.sin(ang); return {x:cx+dx*co-dy*si,y:cy+dx*si+dy*co}; }
function telaSemRotacao(sx,sy){ if(!S||!S.rot) return {x:sx,y:sy}; var cx=S.tx+S.dim.w*S.z/2,cy=S.ty+S.dim.h*S.z/2; return rotacionarPonto(sx,sy,-S.rot,cx,cy); }
function paraObraSemRotacao(sx,sy){ return {x:(sx-S.tx)/S.z,y:(sy-S.ty)/S.z}; }
function paraObra(sx,sy){ var q=telaSemRotacao(sx,sy); return paraObraSemRotacao(q.x,q.y); }
function deslocarFolha(dx,dy){
  if(!S) return;
  var fw=S.dim.w*S.z, fh=S.dim.h*S.z, mx=Math.max(72,Math.round(Math.min(S.pw||fw,S.ph||fh)*.35));
  var margem=($ed&&($ed.classList.contains("preencher-tela")||$ed.classList.contains("modo-foco")))?0:clamp(Math.round(Math.min(S.pw||fw,S.ph||fh)*.08),24,72);
  if(fw<=(S.pw||fw)){ var cx=((S.pw||fw)-fw)/2; S.tx=clamp(cx+(S.tx-cx)+(dx||0),cx-mx,cx+mx); }
  else S.tx=clamp(S.tx+(dx||0),(S.pw||fw)-fw-margem,margem);
  if(fh<=(S.ph||fh)){ var cy=((S.ph||fh)-fh)/2; S.ty=clamp(cy+(S.ty-cy)+(dy||0),cy-mx,cy+mx); }
  else S.ty=clamp(S.ty+(dy||0),(S.ph||fh)-fh-margem,margem);
  S.ajustado=false; pedir(true);
}
function girarFolha(graus){ if(!S) return; S.rot=(S.rot+(graus||90)*Math.PI/180)%TAU; if(S.rot<0) S.rot+=TAU; S.ajustado=false; limitarNavegacao(); pedir(true); aviso("Folha girada "+Math.round(S.rot*180/Math.PI)%360+"°. O zoom atual foi preservado."); }
function onDown(e){
  if(!S||S.carregando||S.fechando||S.editandoPagina) return;
  var p=ptoPalco(e);
  var q=telaSemRotacao(p.x,p.y), gh=guiaHit(q.x,q.y);
  if(gh){E.over.setPointerCapture(e.pointerId);S.guiaDrag={id:gh,pid:e.pointerId};return;}
  E.over.setPointerCapture(e.pointerId);
  S.ptrs[e.pointerId]={x:p.x,y:p.y}; S.nptr=Object.keys(S.ptrs).length;
  if(S.nptr===2){ iniciarGesto(); cancelarTraco(); cancelarCorte(); S.selOp=null; S.balOp=null; return; }
  if(S.nptr>2) return;
  if(e.pointerType==="mouse"&&e.button>1) return;
  if((e.pointerType==="mouse"&&e.button===1)||S.espaco||(S.ferr==="mao"&&!S.cortando)){
    S.pan={x:p.x,y:p.y,tx:S.tx,ty:S.ty}; E.over.style.cursor="grabbing"; return;
  }
  if(S.cortando){ cortarDown(q,e); return; }
  var w=paraObra(p.x,p.y);
  if(PINCEIS[S.ferr]) iniciarTraco(e,w);
  else if(FORMAS[S.ferr]) iniciarForma(e,w);
  else if(S.ferr==="balao") balDown(w,q.x,q.y);
  else if(S.ferr==="balde") balde(w);
  else if(S.ferr==="gota") gota(w);
  else if(S.ferr==="selecionar") selDown(w,q.x,q.y,e);
}
function onMove(e){
  if(!S) return;
  var rc=E.palco.getBoundingClientRect(),p=ptoPalco(e,rc);
  if(S.guiaDrag&&S.guiaDrag.pid===e.pointerId){var gw=paraObra(p.x,p.y),gg=CFG.guia;if(S.guiaDrag.id==="v3"){gg.v3=clamp(gw.x/S.dim.w,.02,.98);gg.v3y=clamp(gw.y/S.dim.h,.02,.98);}else{gg.h=clamp(gw.y/S.dim.h,.05,.95);if(S.guiaDrag.id==="v1")gg.v1=clamp(gw.x/S.dim.w,.02,.98);if(S.guiaDrag.id==="v2")gg.v2=clamp(gw.x/S.dim.w,.02,.98);}salvarEstudo();pedir(false);return;}
  var q=telaSemRotacao(p.x,p.y), ow=paraObra(p.x,p.y);
  S.cursor=q;
  S.coordPendente=Math.round(ow.x)+", "+Math.round(ow.y)+" px";
  if(S.ptrs[e.pointerId]){ S.ptrs[e.pointerId]={x:p.x,y:p.y}; }
  if(S.gesto){ atualizarGesto(); return; }
  if(S.pan){
    S.tx=S.pan.tx+(p.x-S.pan.x); S.ty=S.pan.ty+(p.y-S.pan.y);
    limitarNavegacao(); S.ajustado=false; pedir(true); return;
  }
  if(S.vDrag&&e.pointerId===S.vDrag.id){ cortarMove(q,e); return; }
  if(S.vivo&&e.pointerId===S.vivo.id){
    if(S.vivo.forma){ ajustarForma(S.vivo.forma,paraObra(p.x,p.y),e.shiftKey,e.ctrlKey); redesenharForma(S.vivo); pedir(true); return; }
    var evs=e.getCoalescedEvents?e.getCoalescedEvents():[];
    if(!evs.length) evs=[e];
    for(var i=0;i<evs.length;i++){
      var q=ptoPalco(evs[i],rc), w=paraObra(q.x,q.y);
      addPonto(S.vivo,w.x,w.y,pressao(evs[i]),evs[i].timeStamp);
    }
    pedir(true); return;
  }
  if(S.balOp){ balMove(paraObra(p.x,p.y)); return; }
  if(S.selOp){ selMove(paraObra(p.x,p.y)); return; }
  pedir(false);
}
function onUp(e){
  if(!S) return;
  if(S.guiaDrag&&S.guiaDrag.pid===e.pointerId){S.guiaDrag=null;pedir(false);return;}
  delete S.ptrs[e.pointerId]; S.nptr=Object.keys(S.ptrs).length;
  if(S.gesto){ if(S.nptr<2) S.gesto=null; return; }
  if(S.pan){ S.pan=null; E.over.style.cursor=S.espaco||S.ferr==="mao"?"grab":"crosshair"; return; }
  if(S.vDrag&&e.pointerId===S.vDrag.id){ cortarUp(); return; }
  if(S.vivo&&e.pointerId===S.vivo.id){ finalizarTraco(); return; }
  if(S.balOp){ balUp(); return; }
  if(S.selOp){ selUp(); return; }
}
function iniciarGesto(){
  var ids=Object.keys(S.ptrs), a=S.ptrs[ids[0]], b=S.ptrs[ids[1]];
  S.gesto={d0:Math.hypot(b.x-a.x,b.y-a.y)||1,cx0:(a.x+b.x)/2,cy0:(a.y+b.y)/2,z0:S.z,tx0:S.tx,ty0:S.ty};
  S.pan=null;
}
function atualizarGesto(){
  var g=S.gesto, ids=Object.keys(S.ptrs); if(ids.length<2) return;
  var a=S.ptrs[ids[0]], b=S.ptrs[ids[1]];
  var d=Math.hypot(b.x-a.x,b.y-a.y)||1, cx=(a.x+b.x)/2, cy=(a.y+b.y)/2;
  var nz=clamp(g.z0*d/g.d0,0.05,16), wx=(g.cx0-g.tx0)/g.z0, wy=(g.cy0-g.ty0)/g.z0;
  S.z=nz; S.tx=cx-wx*nz; S.ty=cy-wy*nz; S.ajustado=false;
  limitarNavegacao();
  atualizarZoom(); pedir(true);
}
function onWheel(e){
  if(!S) return;
  e.preventDefault();
  var p=ptoPalco(e);
  if(e.ctrlKey||e.metaKey) zoomEm(Math.exp(-clamp(e.deltaY,-120,120)*0.0025),p.x,p.y);
  else{
    S.tx-=e.deltaX; S.ty-=e.deltaY; S.ajustado=false;
    limitarNavegacao(); pedir(true);
  }
}

/* ---------- ferramentas e interface lateral ---------- */
function trocarFerr(n){
  if(!S) return;
  if(S.cortando) alternarCorte(false);
  if(S.ferr==="selecionar"&&n!=="selecionar"){ commitFlut(); S.sel=null; S.selPath=null; }
  if(S.ferr==="balao"&&n!=="balao"){ fecharEdicaoBal(); S.balSel=null; S.balOp=null; }
  if(n==="gota"&&S.ferr!=="gota") S.ferrAnt=S.ferr;
  S.ferr=n; CFG.ferr=n; CFG.ultimo[grupoDe(n).id]=n; atualizarFerr(); pedir(true);
}
function proximaFerramentaGrupo(id){
  var g=GRUPOS.filter(function(g){return g.id===id;})[0]; if(!g) return;
  var i=g.ferrs.indexOf(S.ferr), proxima=i<0?(CFG.ultimo[id]||g.ferrs[0]):g.ferrs[(i+1)%g.ferrs.length];
  if(E.buscaFerr) E.buscaFerr.value=""; trocarFerr(proxima); aviso(g.nome+": "+nomeFerr(proxima));
}
function nomeFerr(n){
  if(PINCEIS[n]) return PINCEIS[n].nome;
  if(FORMAS[n]) return FORMAS[n];
  return {balde:"Balde",gota:"Conta-gotas",selecionar:"Selecionar",balao:"Balão de fala",mao:"Mão"}[n]||n;
}
function atualizarFerr(){
  var n=S.ferr, B=PINCEIS[n], F=!!FORMAS[n];
  $ed.classList.toggle("sem-roda",n==="selecionar"||n==="balao"||!!(B&&B.borracha));
  $ed.classList.toggle("sem-tamanho",!B&&!F);
  qa("[data-ferr]").forEach(function(b){ b.classList.toggle("forte",b.getAttribute("data-ferr")===n); });
  E.ferrNome.textContent=nomeFerr(n);
  renderFavoritos();
  if(E.curvaPressao) E.curvaPressao.value=CFG.curvaPressao;
  if(E.perfilTraco) E.perfilTraco.value=CFG.perfilTraco;
  var gr=grupoDe(n);
  qa("[data-grp]").forEach(function(b){ b.classList.toggle("ativo",!INTERFACE_EDITOR.estudio&&b.getAttribute("data-grp")===gr.id); });
  if(E.grupoFerr) E.grupoFerr.value=gr.id;
  filtrarFerramentas();
  CFG.ultimo[gr.id]=n;
  var mostrar={tam:!!B||F,op:!!B||F,estab:!!B,pres:!!(B&&B.pres),tol:n==="balde",ref:n==="balde",fill:!!F&&n!=="linha",forma:!!F,linha:n==="linha",pincelExtra:!!B,fluxo:!!B&&B.tipo!=="esfumar",dureza:!!B&&(["macio","aeroDuro","brilho","aquarela","borrachaMacia"].indexOf(B.tipo)>-1),textura:!!B&&(["lapis","pastel","pasteloleo","giz","carvao","cerdas","oleo","aquarela"].indexOf(B.tipo)>-1),dispersao:!!B&&(B.familia==="deco"||B.tipo==="particulas"),espacamento:!!B&&B.tipo!=="esfumar",anguloPonta:!!B&&(B.familia==="deco"||["chato","cerdas","oleo","giz"].indexOf(B.tipo)>-1)};
  qa("[data-g]").forEach(function(l){ l.classList.toggle("oculto",!mostrar[l.getAttribute("data-g")]); });
  if(B||F){
    var a=CFG.ajust[n];
    E.pTam.value=a.tam; E.pTamV.textContent=a.tam;
    E.pOp.value=a.op; E.pOpV.textContent=a.op+"%";
    E.pEstab.value=a.estab; E.pEstabV.textContent=a.estab;
    if(E.pRapida)E.pRapida.checked=CFG.respostaRapida!==false;
    E.pPres.checked=CFG.pressao;
    if(B){
      [["Fluxo","fluxo","%"],["Dureza","dureza","%"],["Textura","textura","%"],["Dispersao","dispersao","%"],["Espacamento","espacamento","%"],["Angulo","angulo","°"]].forEach(function(k){ if(E["p"+k[0]]){E["p"+k[0]].value=a[k[1]];E["p"+k[0]+"V"].textContent=Math.round(a[k[1]])+k[2];} });
    }
  }
  E.pTol.value=CFG.tol; E.pTolV.textContent=CFG.tol; E.pRef.checked=CFG.ref; E.pFill.checked=CFG.preencher;
  if(E.pFormaTraco) E.pFormaTraco.value=CFG.formaTraco||"solido";
  if(E.pFormaRot){ E.pFormaRot.value=CFG.formaRot||0; E.pFormaRotV.textContent=(CFG.formaRot||0)+"°"; }
  if(E.linhaAngulo) E.linhaAngulo.value=CFG.linhaAngulo||15;
  if(E.guiaPasso){ E.guiaPasso.value=CFG.guia.passo||96; E.guiaPassoV.textContent=(CFG.guia.passo||96)+" px"; }
  if(E.guiaDiv){ E.guiaDiv.value=CFG.guia.div||12; E.guiaDivV.textContent=String(CFG.guia.div||12); }
  E.selAcoes.classList.toggle("oculto",n!=="selecionar");
  if(E.selForma) E.selForma.value=S.selForma||"retangulo";
  var dicas={
    selecionar:"Seleção: escolha Retângulo, Elipse ou Laço livre. Circule a área, arraste dentro para mover e use as alças para redimensionar. Use Copiar, Recortar ou Duplicar; Enter confirma, Esc cancela e Delete apaga.",
    gota:"Conta-gotas: clique na cor que deseja reutilizar no desenho.",
    mao:"Mão: arraste para mover a folha sem pintar. Também pode segurar Espaço e arrastar.",
    esfumar:"Esfumar: arraste sobre pixels pintados para misturar cores. Não cria cor sozinho; funciona melhor sobre pintura existente.",
    linha:"Linha: arraste de um ponto a outro. Segure Shift para restringir o ângulo.",
    retangulo:"Retângulo: arraste para desenhar a forma. Shift restringe as proporções; marque Preencher forma para preencher o interior.",
    elipse:"Elipse: arraste para desenhar. Shift cria um círculo; marque Preencher forma para pintar o interior.",
    balde:"Balde: clique numa área para preencher. Ajuste Tolerância para controlar diferenças de cor e ative Usar todas as camadas para considerar a imagem combinada.",
    balao:"Balão: escolha Fala, Pensamento, Grito, Sussurro, Fora de quadro ou Narração em Material [Balão] e clique na página; clique no balão para editá-lo."
  };
  var nomeDica=nomeFerr(n), dicaPincel="";
  if(B){
    if(n.indexOf("lapiseira")==0) dicaPincel="Lapiseira "+nomeDica.replace("Lapiseira ","")+": use para esboço controlado e detalhes técnicos; 0,3/0,5 mm são finas, 0,7/0,9 mm intermediárias e 2,0 mm mais grossa. Ajuste tamanho e opacidade ao resultado desejado.";
    else if(n.indexOf("lapis")==0) dicaPincel= /2H|H$|F$/.test(nomeDica)?nomeDica+": traço mais claro para construção e esboço leve; aumente a pressão/opacidade para escurecer.":nomeDica+": bom para esboço e textura. Graduações B maiores tendem a ficar mais escuras e macias; use tamanho/opacidade menores para detalhes e maiores para sombras.";
    else if(n.indexOf("caneta")===0) dicaPincel=(n==="canetaBR"?"Caneta Brush: varie a pressão e o tamanho para linhas expressivas e pontas afiladas.":nomeDica+": use para arte-final. Pontas pequenas servem para detalhes e hachuras; pontas médias para contorno geral; pontas grandes para silhuetas e linhas de impacto.")+" Ajuste a estabilização para suavizar tremores.";
    else if(n==="caneta") dicaPincel="Caneta G: faça o contorno do mangá variando a pressão para linhas finas e grossas. Aumente a estabilização se o traço sair tremido.";
    else if(n==="esfero") dicaPincel="Esferográfica: linha firme e uniforme, útil para rascunhos e detalhes. Use tamanho pequeno para hachuras.";
    else if(n==="nanquim") dicaPincel="Nanquim: linha uniforme e opaca para arte-final limpa. Escolha uma ponta fina para detalhes e aumente o tamanho para contornos.";
    else if(n==="marcador") dicaPincel="Marcador: bom para massas de sombra e preenchimentos gráficos. Diminua a opacidade para sobrepor tons sem escurecer demais.";
    else if(n==="aerografo") dicaPincel="Aerógrafo: use tamanho grande e opacidade baixa para luzes, brilhos e sombras suaves; aplique várias passadas leves.";
    else if(n==="pincel") dicaPincel="Pincel macio: indicado para pintar e criar transições suaves. Ajuste tamanho e opacidade e construa a cor aos poucos.";
    else if(n==="seco") dicaPincel="Pincel seco: textura áspera para cabelo, tecido, materiais e hachuras. Use passadas curtas para destacar a textura.";
    else if(n==="borracha") dicaPincel="Borracha: apague traços da camada atual. Use tamanho pequeno para limpar bordas e grande para áreas; confira a camada selecionada.";
    else dicaPincel=nomeDica+": ajuste tamanho, opacidade e estabilização nas Propriedades. Faça um traço de teste e adapte os valores antes de desenhar detalhes.";
  }
  E.dica.textContent=(B&&B.dica)||dicas[n]||dicaPincel||"Escolha a ferramenta e faça um traço de teste. Ajuste as propriedades para controlar tamanho, opacidade e suavidade.";
  E.dica.classList.toggle("oculto",!E.dica.textContent);
  var ta=CFG.ajust[n];
  qa("[data-tam]").forEach(function(b){
    b.disabled=!ta; b.classList.toggle("ativo",!!ta&&+b.getAttribute("data-tam")===ta.tam);
  });
  definirCor(CFG.cor);
  E.sim.value=CFG.sim; E.simN.value=CFG.simN; E.simNV.textContent=CFG.simN;
  E.simNBox.classList.toggle("oculto",CFG.sim!=="r");
  E.over.style.cursor=n==="mao"?"grab":"crosshair";
  atualizarBal();
  atualizarPreviaPincel();
  atualizarEditorMovel();
}
function definirCor(c,deRoda){
  CFG.cor=c; if(E.cor) E.cor.value=c; if(E.corHex) E.corHex.value=c.toUpperCase();
  if(!deRoda&&/^#[0-9a-f]{6}$/i.test(c)){
    var h=hex2hsv(c); if(h.s>0.001&&h.v>0.001) HSV.h=h.h; HSV.s=h.s; HSV.v=h.v;
  }
  desenharRoda();
  if(S) atualizarPreviaPincel();
  atualizarEditorMovel();
}
function ajustaTam(dir){
  if(!PINCEIS[S.ferr]&&!FORMAS[S.ferr]) return;
  var a=CFG.ajust[S.ferr], t=a.tam, passo=t<10?1:(t<40?2:5);
  a.tam=clamp(t+dir*passo,1,200); guardarAjustesPinceis(); atualizarFerr(); pedir(false); aviso("Tamanho: "+a.tam+" px");
}
function ajustaOp(dir){
  if(!PINCEIS[S.ferr]&&!FORMAS[S.ferr]) return;
  var a=CFG.ajust[S.ferr]; a.op=clamp(a.op+(dir*5),5,100); guardarAjustesPinceis(); atualizarFerr(); pedir(false);
  aviso("Opacidade: "+a.op+"%");
}
function ajustaEstab(dir){
  if(!PINCEIS[S.ferr]) return;
  var a=CFG.ajust[S.ferr]; a.estab=clamp(a.estab+dir,0,10); guardarAjustesPinceis(); atualizarFerr(); pedir(false);
  aviso("Estabilização: "+a.estab+"/10");
}

function paginaMiniatura(p,i){
  return '<figure class="ed-pg-mini'+(p.ativa?' ativa':'')+'" aria-label="Prévia da Página '+(i+1)+(p.ativa?', página atual':'')+'">'+
    '<span class="ed-mini-papel vazia"><img class="oculto" data-ed-mini-prev="'+i+'" alt="Prévia da Página '+(i+1)+'"></span><figcaption class="ed-mini-num">'+(i+1)+'</figcaption></figure>';
}
function carregarMiniaturasPaginas(){
  if(!S||S.paginaModalModo!=="conjuntos"||!E.paginaConteudo) return;
  var obter=S.opts&&S.opts.obterMiniaturaPagina;
  if(typeof obter!=="function") return;
  var geracao=(S.geracaoMiniaturas||0)+1;
  S.geracaoMiniaturas=geracao;
  Array.prototype.forEach.call(E.paginaConteudo.querySelectorAll("[data-ed-mini-prev]"),function(img){
    var indice=parseInt(img.getAttribute("data-ed-mini-prev"),10);
    if(isNaN(indice)) return;
    Promise.resolve(obter(indice)).then(function(preview){
      if(!preview||!S||S.geracaoMiniaturas!==geracao||!img.isConnected) return;
      var src=typeof preview==="string"?preview:(preview.toDataURL?preview.toDataURL("image/jpeg",0.82):"");
      if(!src) return;
      img.src=src; img.classList.remove("oculto");
      var papel=img.parentNode; if(papel) papel.classList.remove("vazia");
    }).catch(function(){if(img.isConnected){img.alt="Falha ao ler a prévia da página";if(img.parentNode)img.parentNode.title="Não foi possível ler a página. Tente novamente; os desenhos armazenados não foram alterados.";}});
  });
}function conjuntosPaginas(pags){
  var html="", inicio=0, conjunto=1;
  while(inicio<pags.length){
    var quantidade=inicio===0?1:2, fim=Math.min(pags.length,inicio+quantidade), itens=[], i;
    for(i=inicio;i<fim;i++) itens.push(paginaMiniatura(pags[i],i));
    html+='<section class="ed-conjunto"><p class="ed-conjunto-titulo">Conjunto '+conjunto+' · '+
      (fim-inicio===1?'Página '+(inicio+1):'Páginas '+(inicio+1)+'–'+fim)+'</p>'+
      '<div class="ed-conjunto-folhas">'+itens.join("")+'</div></section>';
    inicio=fim; conjunto++;
  }
  return html||'<p class="ed-pg-vazio">Nenhuma página neste capítulo.</p>';
}
function opcoesLayoutEditor(){
  var layouts=(S.opts&&typeof S.opts.obterLayouts==="function"?S.opts.obterLayouts():(S.opts&&S.opts.layouts)||[]),
      atual=(S.opts&&typeof S.opts.obterLayoutAtual==="function"?S.opts.obterLayoutAtual():(S.opts&&S.opts.layoutAtual)||"");
  return layouts.map(function(l){ return '<option value="'+esc(l.id)+'"'+(l.id===atual?' selected':'')+'>'+esc(l.nome)+'</option>'; }).join("");
}

function paineisDaPaginaNoEditor(){
  var itens=S&&S.opts&&typeof S.opts.obterPaineisPagina==="function"?S.opts.obterPaineisPagina():[];
  return Array.isArray(itens)?itens:[];
}
function opcoesPaineisEditor(paineis){
  return paineis.map(function(p,i){
    var nome=p.nome||("Painel "+(i+1));
    return '<option value="'+esc(p.id)+'">'+esc(nome)+'</option>';
  }).join("");
}function renderJanelaPagina(){
  if(!S||!E.paginaConteudo) return;
  var pags=(S.opts&&typeof S.opts.obterPaginas==="function"?S.opts.obterPaginas():(S.opts&&S.opts.paginas)||[]), ativa=0, i;
  for(i=0;i<pags.length;i++) if(pags[i].ativa){ ativa=i; break; }
  var modo=S.paginaModalModo||"conjuntos", paineis=paineisDaPaginaNoEditor(), h;
  if(modo==="editar"){
    h='<div class="ed-pg-cab"><div><h2>Editar página '+(ativa+1)+'</h2><p>Os painéis desta página permanecem visíveis na folha do editor.</p></div>'+
      '<button type="button" class="bt mini ed-pg-fechar" data-ed="pagina-modal-fechar">Fechar</button></div>'+
      '<div class="ed-pg-config"><label>Layout da página <select data-ed-layout aria-label="Layout da página">'+opcoesLayoutEditor()+'</select></label>'+
        '<label>Editar painel <select data-ed-painel aria-label="Painel a editar"'+(paineis.length?"":" disabled")+'>'+opcoesPaineisEditor(paineis)+'</select></label>'+
        '<div class="ed-pg-botoes">'+
          '<button type="button" class="bt" data-ed="painel-editar"'+(paineis.length?"":" disabled")+'>Editar painel</button>'+
          '<button type="button" class="bt" data-ed="pagina-adicionar">＋ Painéis</button>'+
          '<button type="button" class="bt" data-ed="pagina-nova">＋ Página</button>'+
          '<button type="button" class="bt" data-ed="pagina-duplicar">Duplicar página</button>'+
          '<button type="button" class="bt risco" data-ed="pagina-apagar">Apagar página</button>'+
        '</div></div>'+
      '<p class="ed-pg-aviso">Ao escolher um layout ou adicionar painéis, a folha é atualizada aqui no editor. O conjunto de páginas fica apenas para organizar e conferir as prévias.</p>';
  }else{
    h='<div class="ed-pg-cab"><div><h2>Conjunto de páginas</h2><p>Miniaturas das páginas que você criou, organizadas em conjuntos.</p></div>'+
      '<button type="button" class="bt mini ed-pg-fechar" data-ed="pagina-modal-fechar">Fechar</button></div>'+
      '<div class="ed-conjuntos">'+conjuntosPaginas(pags)+'</div>';
  }
  E.paginaConteudo.innerHTML=h;
  if(modo==="conjuntos") carregarMiniaturasPaginas();
}
function abrirJanelaPagina(modo){
  if(!S||!S.modoPagina||!E.paginaJanela) return;
  S.paginaModalModo=modo||"conjuntos";
  E.paginaJanela.classList.toggle("edicao",S.paginaModalModo==="editar");
  renderJanelaPagina();
  E.paginaJanela.classList.remove("oculto");
  E.paginaJanela.setAttribute("aria-hidden","false");
}
function fecharJanelaPagina(){
  if(!E.paginaJanela) return;
  E.paginaJanela.classList.remove("edicao");
  E.paginaJanela.classList.add("oculto");
  E.paginaJanela.setAttribute("aria-hidden","true");
}
function fecharJanelaReferencias(){
  if(!E.referenciasJanela) return;
  E.referenciasJanela.classList.add("oculto");
  E.referenciasJanela.setAttribute("aria-hidden","true");
}
var referenciaEstudoAtual=null;
var M3D_UI={estado:null,parte:"tronco",hits:[],raf:0,arrasto:null,tSalvar:null,local:M3D.posicionamento(null),baseId:null,modelo:null,modeloChave:"",folhaRect:null};
try{M3D_UI.local=M3D.posicionamento(JSON.parse(localStorage.getItem("mesa.ed.manequim3d.local.v1")||"null"));}catch(e){}
function dadosBaseManequim(raw){return raw&&raw.estado?{estado:M3D.normalizar(raw.estado),local:M3D.posicionamento(raw.local)}:null;}
function modeloManequim3D(){
  var st=estadoManequim3D(),chave=JSON.stringify(st);if(!M3D_UI.modelo||M3D_UI.modeloChave!==chave){M3D_UI.modelo=novoCanvas(800,1100);M3D.desenhar(M3D_UI.modelo,st,{exportar:true});M3D_UI.modeloChave=chave;}return M3D_UI.modelo;
}
function previaManequimNaFolha(){
  if(!S||!E.m3dFolhaCanvas)return;var cv=E.m3dFolhaCanvas,c=cv.getContext("2d"),W=cv.width,H=cv.height,k=Math.min((W-20)/S.dim.w,(H-20)/S.dim.h),w=S.dim.w*k,h=S.dim.h*k,x=(W-w)/2,y=(H-h)/2;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,W,H);c.fillStyle="#e5e7eb";c.fillRect(0,0,W,H);c.fillStyle="#fff";c.fillRect(x,y,w,h);
  var folha=novoCanvas(Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));M3D.colocar(folha,estadoManequim3D(),M3D_UI.local,{modelo:modeloManequim3D(),opacidade:true});c.drawImage(folha,x,y,w,h);c.strokeStyle="#9ca3af";c.lineWidth=1;c.strokeRect(x,y,w,h);M3D_UI.folhaRect={x:x,y:y,w:w,h:h};
}
function estadoManequim3D(){
  if(!M3D_UI.estado){
    var raw=null;try{raw=JSON.parse(localStorage.getItem("mesa.ed.manequim3d.v1")||"null");}catch(e){}
    M3D_UI.estado=M3D.normalizar(raw||M3D.padrao());
  }
  return M3D_UI.estado;
}
function guardarManequim3D(){
  clearTimeout(M3D_UI.tSalvar); M3D_UI.tSalvar=setTimeout(function(){try{localStorage.setItem("mesa.ed.manequim3d.v1",JSON.stringify(estadoManequim3D()));localStorage.setItem("mesa.ed.manequim3d.local.v1",JSON.stringify(M3D_UI.local));}catch(e){}},180);
}
function minhasPoses3D(){
  try{var a=JSON.parse(localStorage.getItem("mesa.ed.poses3d.v1")||"[]");return Array.isArray(a)?a.filter(function(p){return p&&typeof p.nome==="string"&&p.estado;}).slice(0,30):[];}catch(e){return [];}
}
function atualizarPoses3D(){
  if(E.m3dSalvas) E.m3dSalvas.innerHTML='<option value="">Escolher…</option>'+minhasPoses3D().map(function(p,i){return '<option value="'+i+'">'+esc(p.nome.slice(0,40))+'</option>';}).join("");
}
function atualizarManequim3D(){
  if(!S||!E.m3dJanela||E.m3dJanela.classList.contains("oculto")) return;
  var st=estadoManequim3D(), j=st.joints[M3D_UI.parte]||[0,0,0];
  E.m3dParte.value=M3D_UI.parte;E.m3dPose.value=st.pose;E.m3dEstilo.value=st.estilo;
  var limites=M3D.limitesParte(M3D_UI.parte);
  ["X","Y","Z"].forEach(function(e,i){E["m3dJ"+e].min=limites[i][0];E["m3dJ"+e].max=limites[i][1];E["m3dJ"+e].value=j[i];E["m3dJ"+e+"V"].textContent=Math.round(j[i])+"°";});
  [["Altura","altura"],["Ombros","ombros"],["Quadril","quadril"],["Cabeca","cabeca"]].forEach(function(p){E["m3d"+p[0]].value=Math.round(st.proporcoes[p[1]]*100);E["m3d"+p[0]+"V"].textContent=Math.round(st.proporcoes[p[1]]*100)+"%";});
  E.m3dZoom.value=Math.round(st.camera.zoom*100);E.m3dZoomV.textContent=Math.round(st.camera.zoom*100)+"%";
  E.m3dPersp.value=Math.round(st.camera.perspective*100);E.m3dPerspV.textContent=Math.round(st.camera.perspective*100)+"%";
  var p=M3D_UI.local;[["Escala",p.escala*100,"%"],["PosX",p.x*100,"%"],["PosY",p.y*100,"%"],["Giro",p.rot,"°"],["Opacidade",p.op,"%"]].forEach(function(a){E["m3d"+a[0]].value=Math.round(a[1]);E["m3d"+a[0]+"V"].textContent=Math.round(a[1])+a[2];});
  if(M3D_UI.raf) cancelAnimationFrame(M3D_UI.raf);
  M3D_UI.raf=requestAnimationFrame(function(){M3D_UI.raf=0;if(!S)return;M3D_UI.hits=M3D.desenhar(E.m3dCanvas,st,{selecionado:E.m3dModo.value==="pose"?M3D_UI.parte:null,articular:E.m3dModo.value==="pose"});previaManequimNaFolha();});
}
/* ---------- retículas: controles, seleção e camada independente ---------- */
function atualizarReticula(){
  if(!E.reticulaPrevia)return;
  var cfg=RETICULA_CFG;
  E.reticulaTipo.value=cfg.tipo;
  [["Tamanho","tamanho"," px"],["Espaco","espaco"," px"],["Angulo","angulo","°"],["Intensidade","intensidade","%"]].forEach(function(a){E["reticula"+a[0]].value=cfg[a[1]];E["reticula"+a[0]+"V"].textContent=cfg[a[1]]+a[2];});
  RETICULA.pintar(E.reticulaPrevia,cfg,null);
}
function abrirReticulas(){
  if(!S)return;var st=ESTADO_PN.reticulas||(ESTADO_PN.reticulas={});st.f=0;st.o=0;salvarPn();aplicarPaineis();atualizarMenus();
  INTERFACE_EDITOR.dir=true;guardarInterfaceEditor();aplicarInterfaceEditor();
  if(E.lat)E.lat.classList.add("aberta");atualizarReticula();
  E.reticulaStatus.textContent=retSel()?"Seleção pronta. Ajuste o padrão e aplique em nova camada.":"Faça uma seleção com o laço ou escolha Folha inteira em Aplicar em.";
  var paleta=$ed.querySelector('[data-pn="reticulas"]');if(paleta)paleta.scrollIntoView({block:"nearest",behavior:"smooth"});
}
function campoReticula(r,t){
  if(!/^reticula/.test(r||""))return false;
  var chave={reticulaTipo:"tipo",reticulaTamanho:"tamanho",reticulaEspaco:"espaco",reticulaAngulo:"angulo",reticulaIntensidade:"intensidade"}[r];
  if(chave){RETICULA_CFG[chave]=chave==="tipo"?t.value:+t.value;RETICULA_CFG=RETICULA.normalizar(RETICULA_CFG);try{localStorage.setItem("mesa.ed.reticula.v1",JSON.stringify(RETICULA_CFG));}catch(e){}atualizarReticula();}
  if(r==="reticulaArea")E.reticulaStatus.textContent=t.value==="folha"?"A retícula será aplicada à folha inteira, em uma nova camada.":"A retícula será recortada pela seleção atual, incluindo o laço livre.";
  return true;
}
function aplicarReticula(){
  if(!S||S.carregando||S.vivo)return;
  var reg=E.reticulaArea.value==="folha"?null:retSel();
  if(E.reticulaArea.value!=="folha"&&(!reg||reg.w<1||reg.h<1)){E.reticulaStatus.textContent="Nenhuma seleção. Circule a área com o laço ou escolha Folha inteira.";aviso("Selecione uma área ou escolha Folha inteira para aplicar a retícula.");return;}
  if(reg)reg=JSON.parse(JSON.stringify(reg));commitFlut();fecharEdicaoBal();
  var nomes={pontos:"Pontos",linhas:"Linhas",hachura:"Hachura",degrade:"Degradê"},antes=estadoEstrutura(),L=criarCamada("Retícula: "+nomes[RETICULA_CFG.tipo]);
  try{RETICULA.pintar(L.cv,RETICULA_CFG,reg);}catch(e){E.reticulaStatus.textContent="Não foi possível criar a retícula. Tente uma área menor.";return;}
  L.tipo="reticula";var indice=S.camadas.indexOf(camadaAtiva());S.camadas.splice(indice+1,0,L);S.ativa=L.id;S.sel=reg;S.tocou=true;
  empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});listaCamadas();pedir(true);
  E.reticulaStatus.textContent="Retícula aplicada "+(reg?"à seleção":"à folha inteira")+" em camada própria. O desenho foi preservado.";aviso("Retícula criada em nova camada.");
}
function abrirManequim3D(){
  if(!S)return; E.m3dJanela.classList.remove("oculto"); E.m3dJanela.setAttribute("aria-hidden","false");estadoManequim3D();atualizarPoses3D();atualizarManequim3D();
}
function fecharManequim3D(){
  if(E.m3dJanela){E.m3dJanela.classList.add("oculto");E.m3dJanela.setAttribute("aria-hidden","true");}
  M3D_UI.arrasto=null;if(M3D_UI.raf)cancelAnimationFrame(M3D_UI.raf);M3D_UI.raf=0;
}
function inserirManequim3D(){
  if(!S)return; commitFlut();fecharEdicaoBal();
  var antes=estadoEstrutura(),L=criarBaseManequim3D("Imagem: Manequim 3D");
  var topo=criarCamada("Desenho sobre: Manequim 3D");topo.tipo="desenho";topo.sobreImagemId=L.id;
  var idx=S.camadas.indexOf(camadaAtiva());S.camadas.splice(idx+1,0,L,topo);S.ativa=topo.id;S.sel=null;S.tocou=true;
  M3D_UI.baseId=L.id;guardarOriginalManequim3D(L);
  empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});listaCamadas();trocarFerr("lapis");pedir(true);
  E.m3dStatus.textContent="Base inserida. Para mudar esta pose depois, carregue a base e use Atualizar esta base. O traço fica separado.";
  aviso("Manequim inserido em camada própria; a camada de desenho está ativa.");
}
function criarBaseManequim3D(nome,id){
  var L=criarCamada(nome,id);L.tipo="imagem";L.op=M3D_UI.local.op;L.manequim3d={estado:M3D.normalizar(estadoManequim3D()),local:M3D.posicionamento(M3D_UI.local)};
  M3D.colocar(L.cv,L.manequim3d.estado,L.manequim3d.local,{modelo:modeloManequim3D()});return L;
}
function guardarOriginalManequim3D(L){var sessao=S;L.cv.toBlob(function(b){L.originalBlob=b;if(S===sessao&&porId(L.id)===L)agendarSalvar();},"image/png");}
function carregarBaseManequim3D(){
  if(!S)return;var A=camadaAtiva(),L=A&&A.manequim3d?A:A&&A.sobreImagemId?porId(A.sobreImagemId):null;
  if(!L||!L.manequim3d){L=null;for(var i=S.camadas.length-1;i>=0;i--)if(S.camadas[i].manequim3d){L=S.camadas[i];break;}}
  if(!L){E.m3dStatus.textContent="Insira uma base com estes controles primeiro. Imagens antigas continuam preservadas, mas não guardam as articulações.";return;}
  M3D_UI.baseId=L.id;M3D_UI.estado=M3D.normalizar(L.manequim3d.estado);M3D_UI.local=M3D.posicionamento(L.manequim3d.local);M3D_UI.local.op=L.op;
  E.m3dStatus.textContent="Base carregada: "+L.nome+". Ajuste pose ou posição e clique Atualizar esta base. Seu desenho não será movido.";atualizarManequim3D();
}
function atualizarBaseManequim3D(){
  if(!S)return;var A=porId(M3D_UI.baseId);if(!A||!A.manequim3d){E.m3dStatus.textContent="Use Carregar base da folha para escolher qual base ajustar.";return;}
  if(A.bloqueada){E.m3dStatus.textContent="A camada desta base está bloqueada. Desbloqueie-a em Camadas antes de atualizar.";return;}
  commitFlut();fecharEdicaoBal();var antes=estadoEstrutura(),L=criarBaseManequim3D(A.nome,A.id),i=S.camadas.indexOf(A);L.vis=A.vis;L.modo=A.modo;S.camadas[i]=L;S.sel=null;S.tocou=true;guardarOriginalManequim3D(L);
  empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});listaCamadas();pedir(true);E.m3dStatus.textContent="Somente a base foi atualizada. As camadas de desenho foram preservadas. Ctrl+Z desfaz.";
}
function acaoManequim3D(acao){
  var st=estadoManequim3D();
  if(acao==="manequim"){abrirManequim3D();return;}
  if(acao==="m3d-fechar"){fecharManequim3D();return;}
  if(acao==="m3d-inserir"){inserirManequim3D();return;}
  if(acao==="m3d-carregar-base"){carregarBaseManequim3D();return;}
  if(acao==="m3d-atualizar-base"){atualizarBaseManequim3D();return;}
  if(acao==="m3d-reset"){M3D_UI.estado=M3D.padrao();M3D_UI.parte="tronco";M3D_UI.local=M3D.posicionamento(null);}
  else if(acao==="m3d-centralizar"){M3D_UI.local.x=.5;M3D_UI.local.y=.5;M3D_UI.local.rot=0;}
  else if(acao==="m3d-enquadrar"){st.camera.zoom=1;}
  else if(acao==="m3d-frente"||acao==="m3d-perfil"||acao==="m3d-costas"||acao==="m3d-34"){st.camera.yaw={"m3d-frente":0,"m3d-perfil":90,"m3d-costas":180,"m3d-34":35}[acao];st.camera.pitch=8;}
  else if(acao==="m3d-espelhar"){
    var clone=JSON.parse(JSON.stringify(st.joints));
    Object.keys(st.joints).forEach(function(id){var par=/D$/.test(id)?id.slice(0,-1)+"E":/E$/.test(id)?id.slice(0,-1)+"D":id;var a=clone[par]||clone[id];st.joints[id]=[a[0],-a[1],-a[2]];});st.pose="personalizada";
  }else if(acao==="m3d-salvar"){
    var nome=String(E.m3dNomePose.value||"").trim().slice(0,40);if(!nome){E.m3dStatus.textContent="Dê um nome à pose antes de salvar.";E.m3dNomePose.focus();return;}
    var poses=minhasPoses3D(), i=poses.findIndex(function(p){return p.nome.toLowerCase()===nome.toLowerCase();}), item={nome:nome,estado:M3D.normalizar(st)};
    if(i>-1)poses[i]=item;else poses.unshift(item);
    try{localStorage.setItem("mesa.ed.poses3d.v1",JSON.stringify(poses.slice(0,30)));atualizarPoses3D();E.m3dStatus.textContent="Pose ‘"+nome+"’ salva neste navegador.";}catch(e){E.m3dStatus.textContent="Não foi possível salvar a pose. Verifique o espaço do navegador.";}
  }
  guardarManequim3D();atualizarManequim3D();
}
function campoManequim3D(r,t){
  if(!/^m3d/.test(r||""))return false;
  var st=estadoManequim3D();
  if(/^m3dJ[XYZ]$/.test(r)){var i={m3dJX:0,m3dJY:1,m3dJZ:2}[r],l=M3D.limitesParte(M3D_UI.parte);st.joints[M3D_UI.parte][i]=clamp(+t.value,l[i][0],l[i][1]);st.pose="personalizada";}
  else if(r==="m3dParte")M3D_UI.parte=t.value;
  else if(r==="m3dPose"&&t.value!=="personalizada")M3D.aplicarPose(st,t.value);
  else if(r==="m3dEstilo")st.estilo=t.value;
  else if(r==="m3dZoom")st.camera.zoom=clamp(+t.value/100,.6,1.8);
  else if(r==="m3dPersp")st.camera.perspective=clamp(+t.value/100,0,1);
  else if(/^m3d(Escala|PosX|PosY|Giro|Opacidade)$/.test(r)){var p=M3D_UI.local;if(r==="m3dEscala")p.escala=+t.value/100;else if(r==="m3dPosX")p.x=+t.value/100;else if(r==="m3dPosY")p.y=+t.value/100;else if(r==="m3dGiro")p.rot=+t.value;else p.op=+t.value;M3D_UI.local=M3D.posicionamento(p);}
  else if(/^m3d(Altura|Ombros|Quadril|Cabeca)$/.test(r)){var k={m3dAltura:"altura",m3dOmbros:"ombros",m3dQuadril:"quadril",m3dCabeca:"cabeca"}[r];st.proporcoes[k]=+t.value/100;}
  else if(r==="m3dSalvas"&&t.value!==""){var p=minhasPoses3D()[+t.value];if(p){M3D_UI.estado=M3D.normalizar(p.estado);E.m3dNomePose.value=p.nome;}}
  else if(r==="m3dNomePose")return true;
  M3D_UI.estado=M3D.normalizar(M3D_UI.estado);guardarManequim3D();atualizarManequim3D();return true;
}
function ligarManequim3D(){
  if(!E.m3dCanvas)return;
  var folhaDrag=null,folhaCV=E.m3dFolhaCanvas;
  folhaCV.addEventListener("pointerdown",function(e){if(e.button!==0||!S||!M3D_UI.folhaRect)return;e.preventDefault();e.stopPropagation();folhaCV.setPointerCapture(e.pointerId);var r=folhaCV.getBoundingClientRect();folhaDrag={id:e.pointerId,x:e.clientX,y:e.clientY,px:M3D_UI.local.x,py:M3D_UI.local.y,sx:folhaCV.width/r.width/M3D_UI.folhaRect.w,sy:folhaCV.height/r.height/M3D_UI.folhaRect.h};});
  folhaCV.addEventListener("pointermove",function(e){if(!folhaDrag||e.pointerId!==folhaDrag.id)return;e.preventDefault();e.stopPropagation();M3D_UI.local.x=clamp(folhaDrag.px+(e.clientX-folhaDrag.x)*folhaDrag.sx,0,1);M3D_UI.local.y=clamp(folhaDrag.py+(e.clientY-folhaDrag.y)*folhaDrag.sy,0,1);atualizarManequim3D();});
  function soltarFolha(e){if(folhaDrag&&folhaDrag.id===e.pointerId){folhaDrag=null;guardarManequim3D();}}folhaCV.addEventListener("pointerup",soltarFolha);folhaCV.addEventListener("pointercancel",soltarFolha);
  var cv=E.m3dCanvas;
  cv.addEventListener("pointerdown",function(e){
    if(e.button!==0)return;e.preventDefault();e.stopPropagation();cv.setPointerCapture(e.pointerId);
    var st=estadoManequim3D(), rc=cv.getBoundingClientRect(), x=(e.clientX-rc.left)*cv.width/rc.width,y=(e.clientY-rc.top)*cv.height/rc.height, parte=null;
    if(E.m3dModo.value==="pose"){
      var dist=70;M3D_UI.hits.forEach(function(h){var d=Math.hypot(h.x-x,h.y-y);if(d<dist){dist=d;parte=h.id;}});
      if(!parte){E.m3dStatus.textContent="Toque num ponto azul para selecionar a articulação.";return;}
      M3D_UI.parte=parte;
    }
    M3D_UI.arrasto={id:e.pointerId,x:e.clientX,y:e.clientY,parte:parte,j:parte?st.joints[parte].slice():null,yaw:st.camera.yaw,pitch:st.camera.pitch};atualizarManequim3D();
  });
  cv.addEventListener("pointermove",function(e){
    var a=M3D_UI.arrasto;if(!a||a.id!==e.pointerId)return;e.preventDefault();e.stopPropagation();
    var st=estadoManequim3D(), dx=e.clientX-a.x,dy=e.clientY-a.y;
    if(a.parte){var l=M3D.limitesParte(a.parte);st.joints[a.parte]=[clamp(a.j[0]+dy*.6,l[0][0],l[0][1]),a.j[1],clamp(a.j[2]+dx*.6,l[2][0],l[2][1])];st.pose="personalizada";}
    else{st.camera.yaw=((a.yaw+dx*.6+180)%360+360)%360-180;st.camera.pitch=clamp(a.pitch+dy*.45,-70,70);}
    atualizarManequim3D();guardarManequim3D();
  });
  function soltar(e){if(M3D_UI.arrasto&&M3D_UI.arrasto.id===e.pointerId){M3D_UI.arrasto=null;guardarManequim3D();}}
  cv.addEventListener("pointerup",soltar);cv.addEventListener("pointercancel",soltar);
  cv.addEventListener("wheel",function(e){e.preventDefault();e.stopPropagation();var st=estadoManequim3D();st.camera.zoom=clamp(st.camera.zoom*Math.exp(-e.deltaY*.001),.6,1.8);atualizarManequim3D();guardarManequim3D();},{passive:false});
  E.m3dArrastar.addEventListener("pointerdown",function(e){
    if(e.target.closest("button")||e.button!==0)return;
    e.preventDefault();var cab=E.m3dArrastar,janela=E.m3dJanela,rc=janela.getBoundingClientRect(),area=$ed.getBoundingClientRect(),x=e.clientX,y=e.clientY;
    cab.setPointerCapture(e.pointerId);
    function mover(ev){if(ev.pointerId!==e.pointerId)return;janela.style.left=clamp(rc.left-area.left+ev.clientX-x,0,Math.max(0,area.width-janela.offsetWidth))+"px";janela.style.top=clamp(rc.top-area.top+ev.clientY-y,0,Math.max(0,area.height-140))+"px";janela.style.right="auto";janela.style.bottom="auto";janela.style.height=Math.min(rc.height,area.height-16)+"px";}
    function fim(){cab.removeEventListener("pointermove",mover);cab.removeEventListener("pointerup",fim);cab.removeEventListener("pointercancel",fim);}
    cab.addEventListener("pointermove",mover);cab.addEventListener("pointerup",fim);cab.addEventListener("pointercancel",fim);
  });
}
function fecharEstudoReferencia(){
  referenciaEstudoAtual=null;
  if(E.referenciasEstudo){ E.referenciasEstudo.classList.add("oculto"); E.referenciasEstudo.innerHTML="<section data-r=\"referenciasEstudoConteudo\"></section>"; E.referenciasEstudoConteudo=E.referenciasEstudo.querySelector("[data-r=referenciasEstudoConteudo]"); }
}
function abrirEstudoReferencia(src,nome,tipo){
  if(!E.referenciasEstudo||!E.referenciasEstudoConteudo||!src) return false;
  referenciaEstudoAtual={src:src,nome:nome||"Referência",tipo:tipo||"image/png"};
  E.referenciasEstudoConteudo.innerHTML='<div class="estudo-cab"><div><strong title="'+esc(referenciaEstudoAtual.nome)+'">'+esc(referenciaEstudoAtual.nome)+'</strong><small>Estudo separado: desenhe na folha sem inserir a imagem.</small></div><button type="button" class="bt mini" data-ed="estudo-fechar" aria-label="Fechar estudo">×</button></div><img data-estudo-img src="'+esc(src)+'" alt="'+esc(referenciaEstudoAtual.nome)+'"><div class="estudo-controles"><label>Opacidade <input type="range" data-r="estudoOpacidade" min="20" max="100" value="100"><output>100%</output></label><button type="button" class="bt mini ed-ref-bt" data-ed="estudo-inserir">Inserir cópia na folha</button></div>';
  E.referenciasEstudo.classList.remove("oculto");
  return true;
}
function abrirJanelaReferencias(){
  if(!S||!E.referenciasJanela||!E.referenciasConteudo) return false;
  if(!window.MesaReferencias||typeof window.MesaReferencias.render!=="function"){
    aviso("As notas de imagens ainda estão carregando. Tente novamente em instantes.");
    return false;
  }
  fecharMenus(); fecharJanelaPagina();
  E.referenciasJanela.classList.remove("oculto");
  E.referenciasJanela.setAttribute("aria-hidden","false");
  window.MesaReferencias.render(E.referenciasConteudo,{
    inserir:function(src,nome,tipo){ return inserirImagemDados(src,nome,tipo); },
    estudar:function(src,nome,tipo){ fecharJanelaReferencias(); return abrirEstudoReferencia(src,nome,tipo); },
    fechar:fecharJanelaReferencias
  });
  return true;
}
function irPaginaEditor(indice){
  if(!S||!S.modoPagina||S.trocandoPagina||S.editandoPagina) return false;
  var pags=S.opts&&typeof S.opts.obterPaginas==="function"?S.opts.obterPaginas():(S.opts&&S.opts.paginas)||[], ir=S.opts&&S.opts.irPagina;
  if(!ir||!(indice>=0&&indice<pags.length)||pags[indice].ativa) return false;
  S.trocandoPagina=true;
  fecharJanelaPagina();
  sair(function(){ ir(indice); });
  return true;
}
function moverPaginaEditor(passo){
  if(!S||!S.modoPagina) return false;
  var pags=S.opts&&typeof S.opts.obterPaginas==="function"?S.opts.obterPaginas():(S.opts&&S.opts.paginas)||[], ativa=0, i;
  for(i=0;i<pags.length;i++) if(pags[i].ativa){ ativa=i; break; }
  return irPaginaEditor(Math.max(0,Math.min(pags.length-1,ativa+passo)));
}
function abrirPainelNoEditor(id){
  if(!S||!S.modoPagina||S.trocandoPagina||S.editandoPagina||!id) return false;
  var abrir=S.opts&&S.opts.abrirPainel;
  if(typeof abrir!=="function") return false;
  S.trocandoPagina=true;
  fecharJanelaPagina();
  sair(function(){ abrir(id); });
  return true;
}
function listaPaginasEditor(){
  if(!S||!E.paginasEd) return;
  var pags=(S.opts&&typeof S.opts.obterPaginas==="function"?S.opts.obterPaginas():(S.opts&&S.opts.paginas)||[]), ativa=0, i;
  for(i=0;i<pags.length;i++) if(pags[i].ativa){ ativa=i; break; }
  E.paginasEd.innerHTML=pags.map(function(p,i){
    var nome=p.nome||("Página "+(i+1));
    return '<button type="button" class="ed-pg-ed'+(p.ativa?' ativa':'')+'" data-ed-pagina="'+i+'"'+(p.ativa?' aria-current="page"':'')+' title="Abrir '+esc(nome)+'">'+esc(nome)+'</button>';
  }).join('');
  var ant=$ed.querySelector('[data-ed="pagina-ant"]'), prox=$ed.querySelector('[data-ed="pagina-prox"]');
  if(ant) ant.disabled=ativa<=0;
  if(prox) prox.disabled=ativa>=pags.length-1;
  if(E.paginaJanela&&!E.paginaJanela.classList.contains("oculto")) renderJanelaPagina();
}/* camadas */
function listaCamadas(){
  if(!S) return;
  var h="", i;
  for(i=S.camadas.length-1;i>=0;i--){
    var L=S.camadas[i];
    h+='<div class="ed-cam'+(L.id===S.ativa?" ativa":"")+'" data-id="'+esc(L.id)+'">'+
       '<input type="checkbox" data-cam="vis"'+(L.vis?" checked":"")+' aria-label="Mostrar camada">'+
       '<span class="ed-cam-nome">'+esc(L.nome)+'</span><button type="button" class="ed-cam-trava'+(L.bloqueada?" ativa":"")+'" data-cam="trava" title="'+(L.bloqueada?"Desbloquear camada":"Bloquear camada")+'" aria-label="'+(L.bloqueada?"Desbloquear camada":"Bloquear camada")+'">'+(L.bloqueada?"🔒":"🔓")+'</button></div>';
  }
  if(S.modoPagina) h+='<div class="ed-cam-base">🔒 Base da página e dos painéis</div>';
  E.camadas.innerHTML=h;
  var A=camadaAtiva();
  if(A){ E.cOp.value=A.op; E.cOpV.textContent=A.op+"%"; E.cModo.value=A.modo; }
}
function estadoEstrutura(){ return {lista:S.camadas.slice(),ativa:S.ativa}; }
function selecionarCamada(id){
  if(id===S.ativa) return;
  commitFlut(); S.sel=null; S.ativa=id; listaCamadas(); pedir(true); agendarSalvar();
}
function novaCamada(nome,pixels){
  commitFlut();
  var antes=estadoEstrutura(), L=criarCamada(nome||("Camada "+(S.camadas.length+1)));
  if(pixels) L.cx.drawImage(pixels,0,0);
  var i=S.camadas.indexOf(camadaAtiva());
  S.camadas.splice(i+1,0,L); S.ativa=L.id;
  empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});
  listaCamadas(); pedir(true);
}
function duplicarCamada(){
  var A=camadaAtiva(); if(!A) return;
  novaCamada(A.nome+" cópia",A.cv);
  var L=camadaAtiva(); L.op=A.op; L.modo=A.modo; L.tipo=A.tipo||null; L.sobreImagemId=A.sobreImagemId||null; L.manequim3d=dadosBaseManequim(A.manequim3d); listaCamadas();
}
function moverCamada(dir){
  commitFlut();
  var i=S.camadas.indexOf(camadaAtiva()), j=i+dir;
  if(i<0||j<0||j>=S.camadas.length) return;
  var antes=estadoEstrutura(), l=S.camadas.slice(), t=l[i]; l[i]=l[j]; l[j]=t;
  S.camadas=l;
  empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});
  listaCamadas(); pedir(true);
}
function apagarCamada(){
  commitFlut();
  if(S.camadas.length<2){ aviso("Mantenha pelo menos uma camada."); return; }
  var antes=estadoEstrutura(), i=S.camadas.indexOf(camadaAtiva());
  var l=S.camadas.slice(); l.splice(i,1); S.camadas=l;
  S.ativa=l[Math.min(i,l.length-1)].id;
  empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});
  listaCamadas(); pedir(true);
}
function mesclarCamada(){
  commitFlut();
  var i=S.camadas.indexOf(camadaAtiva());
  if(i<1){ aviso("Não há camada abaixo para mesclar."); return; }
  var cima=S.camadas[i], baixo=S.camadas[i-1], W=S.dim.w, H=S.dim.h;
  var antesPx=recortar(baixo.cv,0,0,W,H), antes=estadoEstrutura();
  baixo.cx.save();
  baixo.cx.globalAlpha=cima.vis?cima.op/100:0;
  baixo.cx.globalCompositeOperation=opComp(cima.modo);
  baixo.cx.drawImage(cima.cv,0,0); baixo.cx.restore();
  var depoisPx=recortar(baixo.cv,0,0,W,H);
  var l=S.camadas.slice(); l.splice(i,1); S.camadas=l; S.ativa=baixo.id; baixo.sujo=true;
  var px={t:"px",layer:baixo.id,x:0,y:0,antes:antesPx,depois:depoisPx};
  empurrar({t:"grupo",itens:[px,{t:"estrutura",antes:antes,depois:estadoEstrutura()}]});
  listaCamadas(); pedir(true);
}
function mudarProp(L,novo){
  var antes={}, depois={}, mudou=false;
  for(var k in novo){ antes[k]=L[k]; depois[k]=novo[k]; if(L[k]!==novo[k]) mudou=true; }
  if(!mudou) return;
  for(var k2 in novo) L[k2]=novo[k2];
  empurrar({t:"prop",id:L.id,antes:antes,depois:depois});
  listaCamadas(); pedir(true);
}
function mudarTamanho(chave){
  if(!S||chave===S.chave) return;
  commitFlut();
  var nd=dimensoes(chave), od=S.dim;
  var ox=Math.round((nd.w-od.w)/2), oy=Math.round((nd.h-od.h)/2);
  S.camadas.forEach(function(L){
    var c=novoCanvas(nd.w,nd.h); c.getContext("2d").drawImage(L.cv,ox,oy);
    L.cv=c; L.cx=c.getContext("2d"); L.sujo=true;
  });
  fecharEdicaoBal(); S.baloes.forEach(function(b){ b.x+=ox; b.y+=oy; b.px+=ox; b.py+=oy; b._c=null; });
  S.dim=nd; S.chave=chave; S.painel.tamanho=chave;
  S.tmp=novoCanvas(nd.w,nd.h); S.live=novoCanvas(nd.w,nd.h);
  S.hist=[]; S.refaz=[]; S.bytes=0; S.sel=null; S.tocou=true;
  atualizarBotoesHist(); ajustar(); agendarSalvar();
  aviso("Tamanho alterado. O desenho foi centralizado e o histórico de desfazer foi reiniciado.");
}

/* ---------- importação e ajustes de imagens ---------- */
function dadosImagemParaArquivo(src,nome,tipo){
  try{
    var texto=String(src||""), partes=texto.split(","), cab=partes[0]||"", mime=(cab.match(/data:([^;]+)/i)||[])[1]||tipo||"image/png", bin=atob(partes[1]||""), bytes=new Uint8Array(bin.length), i;
    for(i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    var blob=new Blob([bytes],{type:mime}), nomeArquivo=(nome||"referencia.png").replace(/[\\/:*?"<>|]+/g,"_")||"referencia.png";
    if(window.File){ return new File([blob],nomeArquivo,{type:mime}); }
    try{ blob.name=nomeArquivo; }catch(e){}
    return blob;
  }catch(e){ return null; }
}
function inserirImagemDados(src,nome,tipo){
  var arquivo=dadosImagemParaArquivo(src,nome,tipo);
  if(!arquivo){ aviso("Não foi possível abrir esta referência."); return false; }
  importarImagem(arquivo); return true;
}
function importarImagem(arquivo){
  if(!S||!arquivo) return;
  if(!/^image\//i.test(arquivo.type||"")){ aviso("Escolha um arquivo de imagem (JPG, PNG, WebP ou outro formato aceito pelo navegador)."); return; }
  if(arquivo.size>25*1024*1024){ aviso("Essa imagem tem mais de 25 MB. Reduza o tamanho do arquivo antes de importar."); return; }
  var sessaoImportacao=S;
  var url=URL.createObjectURL(arquivo), img=new Image();
  img.onload=function(){
    URL.revokeObjectURL(url);
    if(S!==sessaoImportacao) return;
    try{
      commitFlut(); fecharEdicaoBal();
      var maxW=Math.round(S.dim.w*0.82), maxH=Math.round(S.dim.h*0.82);
      var escala=Math.min(1,maxW/img.naturalWidth,maxH/img.naturalHeight);
      var w=Math.max(1,Math.round(img.naturalWidth*escala)), h=Math.max(1,Math.round(img.naturalHeight*escala));
      var listaAntes=S.camadas.slice(), ativaAntes=S.ativa;
      var nome=(arquivo.name||"Imagem").replace(/\.[^.]+$/,"").slice(0,26)||"Imagem";
      var L=criarCamada("Imagem: "+nome); L.tipo="imagem"; L.cx.drawImage(img,Math.round((S.dim.w-w)/2),Math.round((S.dim.h-h)/2),w,h); L.sujo=true;
      /* A base dos efeitos deve ser ImageData, não um elemento canvas. */
      L._baseEfeitos=L.cx.getImageData(0,0,S.dim.w,S.dim.h);
      /* Guarda uma cópia original para restaurar mesmo depois de filtros e ao reabrir o projeto. */
      L.cv.toBlob(function(blob){
        if(!blob||S!==sessaoImportacao||porId(L.id)!==L)return;
        L.originalBlob=blob;
        agendarSalvar();
      },"image/png");
      var desenho=criarCamada("Desenho sobre: "+nome); desenho.tipo="desenho"; desenho.sobreImagemId=L.id;
      var posInsercao=S.camadas.indexOf(camadaAtiva()); if(posInsercao<0) posInsercao=S.camadas.length-1;
      S.camadas.splice(posInsercao+1,0,L,desenho); S.ativa=desenho.id; S.sel={x:Math.round((S.dim.w-w)/2),y:Math.round((S.dim.h-h)/2),w:w,h:h};
      S.tocou=true;
      empurrar({t:"estrutura",antes:{lista:listaAntes,ativa:ativaAntes},depois:{lista:S.camadas.slice(),ativa:S.ativa}});
      trocarFerr("selecionar"); listaCamadas(); atualizarBotoesHist(); pedir(true);
      aviso("Imagem importada em uma camada própria, com uma camada de desenho separada por cima. Use Referências ou Camadas para editar cada parte.");
    }catch(e){ aviso("Não foi possível importar essa imagem. Tente uma imagem menor ou em JPG/PNG."); }
  };
  img.onerror=function(){ URL.revokeObjectURL(url); if(S===sessaoImportacao)aviso("Não foi possível abrir essa imagem. Tente JPG, PNG ou WebP."); };
  img.src=url;
}
function retirarImagemAtiva(){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo(); if(!L){ aviso("Não há imagem para retirar neste painel."); return; }
  var remover=function(){
    if(!S||!porId(L.id)) return;
    var antes=estadoEstrutura(), associados=S.camadas.filter(function(C){return C.sobreImagemId===L.id;}), eraAtiva=S.ativa;
    var idx=S.camadas.indexOf(L); S.camadas.splice(idx,1);
    associados.forEach(function(C){ C.sobreImagemId=null; C.tipo="desenho"; if(/^Desenho sobre:/i.test(C.nome||"")) C.nome="Desenho (imagem retirada): "+String(C.nome).replace(/^Desenho sobre:\s*/i,""); C.sujo=true; });
    if(eraAtiva===L.id){ var destino=associados[0]||S.camadas[Math.max(0,Math.min(idx,S.camadas.length-1))]||S.camadas[0]||null; S.ativa=destino?destino.id:null; }
    empurrar({t:"estrutura",antes:antes,depois:estadoEstrutura()});
    S.sel=null; listaCamadas(); pedir(true); aviso("Camada da imagem retirada. O desenho foi mantido separado. Use Ctrl+Z para desfazer.");
  };
  var s=S;
  separarDesenhoMisturado(L).then(function(){if(S===s&&porId(L.id)===L)remover();}).catch(function(){if(S===s)aviso("A imagem não foi retirada porque o original não pôde ser lido. Tente novamente.");});
}
function restaurarImagemOriginal(){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo(); if(!L){ aviso("Selecione uma camada de imagem para restaurar."); return; }
  if(!L.originalBlob){ aviso("Esta imagem foi importada antes da função de restauração. Importe-a novamente para poder restaurar o original."); return; }
  var s=S,antes=recortar(L.cv,0,0,S.dim.w,S.dim.h), original=L.originalBlob;
  decodificar(original).then(function(img){
    if(!img||S!==s||porId(L.id)!==L) return;
    L.cx.clearRect(0,0,S.dim.w,S.dim.h); L.cx.drawImage(img,0,0,S.dim.w,S.dim.h); L.sujo=true;
    L._baseEfeitos=L.cx.getImageData(0,0,S.dim.w,S.dim.h);
    var depois=recortar(L.cv,0,0,S.dim.w,S.dim.h);
    empurrar({t:"px",layer:L.id,x:0,y:0,antes:antes,depois:depois}); pedir(true);
    aviso("Imagem restaurada ao estado original. Use Ctrl+Z para desfazer a restauração.");
  }).catch(function(){if(S===s)aviso("Não foi possível ler a imagem original. A camada atual foi preservada.");});
}
function baseOriginalEfeitos(L){
  /* Todos os efeitos partem de ImageData da mesma base, não do resultado do
     filtro anterior. Isso evita acúmulo e mantém compatibilidade com putImageData. */
  if(!L._baseEfeitos){
    L._baseEfeitos=L.cx.getImageData(0,0,S.dim.w,S.dim.h);
  }
  return L._baseEfeitos;
}
function copiarImageData(base,ctx){
  var copia=ctx.createImageData(base.width,base.height);
  copia.data.set(base.data);
  return copia;
}
function converterCamadaCinza(){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo()||camadaAtiva(); if(!L) return;
  var antes=recortar(L.cv,0,0,S.dim.w,S.dim.h), c=L.cx, im;
  try{ im=copiarImageData(baseOriginalEfeitos(L),c); }catch(e){ aviso("Não foi possível editar os pixels dessa camada."); return; }
  var d=im.data;
  for(var i=0;i<d.length;i+=4){ var g=Math.round(d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114); d[i]=d[i+1]=d[i+2]=g; }
  c.putImageData(im,0,0); L.sujo=true;
  var depois=recortar(L.cv,0,0,S.dim.w,S.dim.h);
  empurrar({t:"px",layer:L.id,x:0,y:0,antes:antes,depois:depois}); pedir(true);
  aviso("Camada convertida para tons de cinza. Você pode desfazer com Ctrl+Z.");
}
function ajustarSaturacao(){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo()||camadaAtiva(); if(!L) return;
  var atual=prompt("Saturação da camada ativa (0 a 200):\n0 = sem cor, 100 = original, 200 = cores intensas","100");
  if(atual===null) return;
  var fator=Number(atual);
  if(!isFinite(fator)||atual.trim()===""||fator<0||fator>200){ aviso("Digite um valor de 0 a 200."); return; }
  aplicarAjusteImagem("saturacao",fator/100);
  aviso("Saturação ajustada. Use Ctrl+Z para desfazer.");
}
function aplicarFiltroImagem(tipo){
  var nomes={sepia:"Sépia",quente:"Quente",frio:"Frio",contraste:"Alto contraste",vintage:"Vintage",negativo:"Negativo"};
  aplicarAjusteImagem(tipo,null);
  if(nomes[tipo]) aviso("Filtro "+nomes[tipo]+" aplicado à camada ativa. Use Ctrl+Z para desfazer.");
}
function aplicarAjusteImagem(tipo,valor){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo()||camadaAtiva(); if(!L) return;
  var antes=recortar(L.cv,0,0,S.dim.w,S.dim.h), c=L.cx, im;
  try{ im=copiarImageData(baseOriginalEfeitos(L),c); }catch(e){ aviso("Não foi possível editar os pixels dessa camada."); return; }
  var d=im.data;
  for(var i=0;i<d.length;i+=4){
    var r=d[i],g=d[i+1],b=d[i+2],nr=r,ng=g,nb=b;
    if(tipo==="saturacao"){
      var lum=0.299*r+0.587*g+0.114*b;
      nr=lum+(r-lum)*valor; ng=lum+(g-lum)*valor; nb=lum+(b-lum)*valor;
    }else if(tipo==="sepia"){
      nr=0.393*r+0.769*g+0.189*b; ng=0.349*r+0.686*g+0.168*b; nb=0.272*r+0.534*g+0.131*b;
    }else if(tipo==="quente"){
      nr=r*1.08+10; ng=g*1.02+2; nb=b*0.88-4;
    }else if(tipo==="frio"){
      nr=r*0.88-3; ng=g*1.01+2; nb=b*1.12+10;
    }else if(tipo==="contraste"){
      nr=(r-128)*1.35+128; ng=(g-128)*1.35+128; nb=(b-128)*1.35+128;
    }else if(tipo==="vintage"){
      nr=0.393*r+0.769*g+0.189*b; ng=0.349*r+0.686*g+0.168*b; nb=0.272*r+0.534*g+0.131*b;
      nr=nr*0.88+18; ng=ng*0.88+12; nb=nb*0.82+4;
    }else if(tipo==="negativo"){
      nr=255-r; ng=255-g; nb=255-b;
    }
    d[i]=Math.max(0,Math.min(255,Math.round(nr)));
    d[i+1]=Math.max(0,Math.min(255,Math.round(ng)));
    d[i+2]=Math.max(0,Math.min(255,Math.round(nb)));
  }
  c.putImageData(im,0,0); L.sujo=true;
  var depois=recortar(L.cv,0,0,S.dim.w,S.dim.h);
  empurrar({t:"px",layer:L.id,x:0,y:0,antes:antes,depois:depois}); pedir(true);
}
function ajustarImagemFolha(modo){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo();
  if(!L){ aviso("Selecione uma camada de imagem para ajustar."); return; }
  var w=S.dim.w,h=S.dim.h, ctx=L.cx, data;
  try{ data=ctx.getImageData(0,0,w,h); }catch(e){ aviso("Não foi possível ler a imagem para ajustá-la."); return; }
  var d=data.data,minX=w,minY=h,maxX=-1,maxY=-1;
  for(var y=0;y<h;y++) for(var x=0;x<w;x++) if(d[(y*w+x)*4+3]>4){ if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y; }
  if(maxX<minX||maxY<minY){ aviso("A camada não contém uma imagem visível."); return; }
  var sw=maxX-minX+1,sh=maxY-minY+1,src=novoCanvas(sw,sh); src.getContext("2d").putImageData(ctx.getImageData(minX,minY,sw,sh),0,0);
  var escala=modo==="cover"?Math.max(w/sw,h/sh):Math.min(w/sw,h/sh),dw=Math.max(1,Math.round(sw*escala)),dh=Math.max(1,Math.round(sh*escala));
  var antes=recortar(L.cv,0,0,w,h),novo=novoCanvas(w,h),nc=novo.getContext("2d");
  nc.imageSmoothingEnabled=true; nc.imageSmoothingQuality="high"; nc.drawImage(src,Math.round((w-dw)/2),Math.round((h-dh)/2),dw,dh);
  L.cv=novo;L.cx=nc;L.sujo=true;L._baseEfeitos=null;
  var depois=recortar(L.cv,0,0,w,h); empurrar({t:"px",layer:L.id,x:0,y:0,antes:antes,depois:depois});
  S.sel={x:0,y:0,w:w,h:h}; pedir(true);
  aviso(modo==="cover"?"Imagem ampliada para preencher a folha; as bordas podem ser cortadas. Use Ctrl+Z para desfazer.":"Imagem ajustada e centralizada na folha, sem deformar. Use Ctrl+Z para desfazer.");
}
function transformarFotoDesenho(estilo,ferramenta){
  if(!S) return;
  commitFlut();
  var L=camadaImagemAlvo();
  if(!L){ aviso("Selecione uma camada de imagem para transformar."); return; }
  var ferramentaEscolhida=ferramenta&&PINCEIS[ferramenta]?ferramenta:null, B=ferramentaEscolhida?PINCEIS[ferramentaEscolhida]:null;
  var modo=estilo;
  if(B) modo=ferramentaEscolhida==="nanquim"?"nanquim":((B.tipo==="lapis"||B.tipo==="macio")?"lapis":"caneta");
  var grafite=B?clamp(B.grao==null?0.55:B.grao,0.12,1):0.55, tamanhoFerr=B?clamp(B.tam||5,1,70):5;
  var w=S.dim.w,h=S.dim.h,c=L.cx,im;
  try{ im=copiarImageData(baseOriginalEfeitos(L),c); }catch(e){ aviso("Não foi possível processar esta imagem."); return; }
  var d=im.data, n=w*h, gray=new Float32Array(n), alpha=new Uint8ClampedArray(n), tom=hexRgb(CFG.tomDesenho||"#1d1d1d");
  for(var i=0,p=0;i<d.length;i+=4,p++){gray[p]=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];alpha[p]=d[i+3];}
  var antes=recortar(L.cv,0,0,w,h);
  function pix(x,y){x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));return gray[y*w+x];}
  for(var yy=0;yy<h;yy++) for(var xx=0;xx<w;xx++){
    var q=yy*w+xx,idx=q*4;if(alpha[q]===0)continue;
    var g=gray[q],gx=-pix(xx-1,yy-1)+pix(xx+1,yy-1)-2*pix(xx-1,yy)+2*pix(xx+1,yy)-pix(xx-1,yy+1)+pix(xx+1,yy+1),gy=-pix(xx-1,yy-1)-2*pix(xx,yy-1)-pix(xx+1,yy-1)+pix(xx-1,yy+1)+2*pix(xx,yy+1)+pix(xx+1,yy+1),edge=Math.min(1,Math.sqrt(gx*gx+gy*gy)/190),r=d[idx],gg=d[idx+1],b=d[idx+2],nr=r,ng=gg,nb=b;
    if(modo==="lapis"){
      var textura=((xx*17+yy*31+(xx*yy)%23)%11)-5,forcaL=B?(0.35+grafite*0.55):0.78,bordaL=B?(70+grafite*125+Math.min(36,tamanhoFerr*0.55)):170;
      var baseL=Math.max(0,Math.min(255,Math.round(255-(255-g)*forcaL-edge*bordaL+textura))),escL=(255-baseL)/255;
      nr=255-(255-tom[0])*escL; ng=255-(255-tom[1])*escL; nb=255-(255-tom[2])*escL;
    }else if(modo==="caneta"||modo==="nanquim"){
      var lim=modo==="nanquim"?160:185,bordaC=modo==="nanquim"?0.18:0.27;
      if(B){
        lim=clamp(Math.round(175+Math.min(25,tamanhoFerr*0.45)-(B.op<70?8:0)),105,205);
        bordaC=clamp(0.33-Math.min(0.16,tamanhoFerr*0.002),0.12,0.33);
        if(ferramentaEscolhida==="nanquim"){ lim=160; bordaC=0.18; }
      }
      var base=(g<lim?20:255);if(edge>bordaC)base=0;
      var escC=(255-base)/255; nr=255-(255-tom[0])*escC; ng=255-(255-tom[1])*escC; nb=255-(255-tom[2])*escC;
    }else if(estilo==="colorido"){
      var lum=0.299*r+0.587*gg+0.114*b,fac=1.28;nr=lum+(r-lum)*fac-edge*100;ng=lum+(gg-lum)*fac-edge*100;nb=lum+(b-lum)*fac-edge*100;
    }else if(estilo==="aquarela"){
      function poster(v){return Math.round(v/42)*42;}
      nr=poster(r)*(1-edge*0.48)+Math.max(0,r-18)*edge*0.48;ng=poster(gg)*(1-edge*0.48)+Math.max(0,gg-18)*edge*0.48;nb=poster(b)*(1-edge*0.48)+Math.max(0,b-18)*edge*0.48;
    }
    d[idx]=Math.max(0,Math.min(255,Math.round(nr)));d[idx+1]=Math.max(0,Math.min(255,Math.round(ng)));d[idx+2]=Math.max(0,Math.min(255,Math.round(nb)));
  }
  c.putImageData(im,0,0);L.sujo=true;
  var depois=recortar(L.cv,0,0,w,h);empurrar({t:"px",layer:L.id,x:0,y:0,antes:antes,depois:depois});pedir(true);
  var nomes={lapis:"Lápis",caneta:"Caneta / mangá",nanquim:"Nanquim",colorido:"Lápis de cor",aquarela:"Aquarela"};
  var nomeEfeito=ferramentaEscolhida?B.nome:nomes[estilo];
  var detalheTom=(modo==="lapis"||modo==="caneta"||modo==="nanquim")?" no tom "+CFG.tomDesenho.toUpperCase():"";
  aviso("Efeito "+nomeEfeito+detalheTom+" aplicado. A imagem original continua guardada; use Restaurar imagem original ou Ctrl+Z.");
}
function recortarCamadaSelecao(){
  if(!S) return;
  commitFlut();
  var L=camadaAtiva(), r=S.sel;
  if(!L||!r||r.w<1||r.h<1){ aviso("Use a ferramenta Selecionar para marcar a área que deseja manter."); return; }
  var antes=recortar(L.cv,0,0,S.dim.w,S.dim.h);
  var x=Math.max(0,Math.floor(r.x)), y=Math.max(0,Math.floor(r.y));
  var x2=Math.min(S.dim.w,Math.ceil(r.x+r.w)), y2=Math.min(S.dim.h,Math.ceil(r.y+r.h));
  if(x2<=x||y2<=y) return;
  L.cx.clearRect(0,0,S.dim.w,y); L.cx.clearRect(0,y2,S.dim.w,S.dim.h-y2);
  L.cx.clearRect(0,y,x,S.dim.h); L.cx.clearRect(x2,y,S.dim.w-x2,S.dim.h);
  L.sujo=true; var depois=recortar(L.cv,0,0,S.dim.w,S.dim.h);
  empurrar({t:"px",layer:L.id,x:0,y:0,antes:antes,depois:depois});
  S.sel={x:x,y:y,w:x2-x,h:y2-y}; pedir(true);
  aviso("Camada recortada à seleção. As outras camadas não foram alteradas.");
}

/* exportar */
function baixar(blob,nome){
  var a=document.createElement("a"), u=URL.createObjectURL(blob);
  var rec=window.__mesaArmazenamento&&window.__mesaArmazenamento.recuperacao,pai=document.body;
  if(rec&&rec.estado.bloqueada&&document.getElementById("avisoRecuperacao"))pai=document.getElementById("avisoRecuperacao");
  a.href=u; a.download=nome; pai.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(u); },1500);
}
function exportar(){
  commitFlut();
  var c=novoCanvas(S.dim.w,S.dim.h), x=c.getContext("2d"), f=formaDe(S.painel);
  if(f){ x.save(); x.beginPath(); trilhaForma(x,f,S.dim.w,S.dim.h); x.clip(); }   /* fora do corte fica transparente */
  x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height);
  fundoEm(x); camadasEm(x,false); desenharBorda(x); desenharBaloes(x,S.baloes,Math.max(S.dim.w,S.dim.h));
  if(f) x.restore();
  var nomeArquivo=(S&&S.opts.arquivo||"painel")+".png";
  var avisoExportacao=S&&S.opts&&S.opts.aviso;
  try{
    c.toBlob(function(b){
      if(!b||!b.size){
        if(avisoExportacao)avisoExportacao("Não foi possível gerar o PNG. Tente novamente ou diminua as dimensões do desenho.");
        return;
      }
      try{baixar(b,nomeArquivo);}
      catch(e){if(avisoExportacao)avisoExportacao("Não foi possível baixar o PNG. Verifique as permissões de download do navegador.");}
    },"image/png");
  }catch(e){
    if(avisoExportacao)avisoExportacao("Não foi possível gerar o PNG. Tente novamente.");
  }
}

function atualizarPaginaNoEditor(res,b,limpar,limparPainel){
  var s=S, montar=s.opts&&s.opts.refazerFundoPagina;
  /* Atualiza a interface já; a composição visual corre depois e nunca bloqueia os botões. */
  if(res.removida&&limpar) limpar(res.removida);
  if(res.painelRemovido&&limparPainel) limparPainel(res.painelRemovido);
  listaPaginasEditor(); pedir(true);
  if(res.mensagem&&s.opts&&s.opts.aviso) s.opts.aviso(res.mensagem);
  if(!res.recarregar||typeof montar!=="function") return;
  var revisao=(s.revisaoPagina||0)+1;
  s.revisaoPagina=revisao;
  Promise.resolve(montar()).then(function(base){
    if(S!==s||s.revisaoPagina!==revisao) return;
    if(base) s.fundo=base;
    pedir(true);
  }).catch(function(err){
    console.error("atualizar página:",err);
    if(s.opts&&s.opts.aviso) s.opts.aviso("A página foi criada; a prévia será atualizada ao reabrir.");
  });
}
function executarEdicaoPagina(tipo,valor,b){
  if(!S||!S.opts||!S.opts.editarPagina||S.trocandoPagina||S.editandoPagina)return Promise.resolve(false);
  var s=S,editar=s.opts.editarPagina,ir=s.opts.irPagina,limpar=s.opts.limparPaginaRemovida,limparPainel=s.opts.limparPainelRemovido,textoBotao=b&&b.textContent,botaoDesabilitado=b&&b.disabled,estruturaConfirmada=false;
  s.editandoPagina=true;if(b){b.disabled=true;b.textContent="Salvando…";}
  return tentarSalvarDesenho().then(async function(ok){
    if(!ok||S!==s||s.sujo)return false;
    var res=await editar(tipo,valor);if(!res||typeof res.indice!=="number")return false;
    estruturaConfirmada=!!res.confirmada;
    if(res.recarregar||res.atualizarUI){atualizarPaginaNoEditor(res,b,limpar,limparPainel);return true;}
    s.trocandoPagina=true;if(b)b.textContent="Abrindo…";
    return sair(function(){
      if(res.removida&&limpar)limpar(res.removida);
      if(res.painelRemovido&&limparPainel)limparPainel(res.painelRemovido);
      if(ir)ir(res.indice);
    },true).then(function(ok){if(!ok&&estruturaConfirmada&&s.opts.aoFalharEstrutura)s.opts.aoFalharEstrutura();return ok;});
  }).catch(function(){if(estruturaConfirmada&&s.opts.aoFalharEstrutura)s.opts.aoFalharEstrutura();else if(S===s)aviso("Não foi possível concluir a operação da página. O editor continua aberto.");return false;}).finally(function(){
    s.editandoPagina=false;if(S===s)s.trocandoPagina=false;if(b){b.disabled=botaoDesabilitado;b.textContent=textoBotao;}
  });
}function confirmarAcaoPagina(b,texto,tipo,valor){
  if(!b) return;
  if(b.getAttribute("data-armado")==="1"){
    b.removeAttribute("data-armado");if(b.__mesaTextoConfirmacao!=null){b.textContent=b.__mesaTextoConfirmacao;delete b.__mesaTextoConfirmacao;}executarEdicaoPagina(tipo,valor,b);return;
  }
  var original=b.textContent;
  b.__mesaTextoConfirmacao=original;
  b.setAttribute("data-armado","1"); b.textContent=texto;
  setTimeout(function(){
    if(b&&b.isConnected&&b.getAttribute("data-armado")==="1"){
      b.removeAttribute("data-armado"); b.textContent=original;delete b.__mesaTextoConfirmacao;
    }
  },2600);
}
function escolherQuantidadeNoEditor(tipo,b,paginaDestino){
  if(!S||!S.opts||!S.opts.escolherQuantidade) return;
  S.opts.escolherQuantidade(b,tipo,function(valor){
    if(typeof paginaDestino==="number") valor.paginaDestino=paginaDestino;
    executarEdicaoPagina(tipo,valor,b);
  });
}
/* ---------- eventos da interface ---------- */
function acao(n,b){
  if(n==="reticulas"||n==="reticula-aplicar"){if(n==="reticulas")abrirReticulas();else aplicarReticula();if(b&&b.blur)b.blur();return;}
  if(n==="manequim"||/^m3d-/.test(n)){acaoManequim3D(n);if(b&&b.blur)b.blur();return;}
  if(!S) return;
  switch(n){
    case "laterais": alternarLateraisEditor(); break;
    case "lateral-e": alternarLateralEditor("esq"); break;
    case "lateral-d": alternarLateralEditor("dir"); break;
    case "estudio": abrirEstudioEditor(); break;
    case "estudio-fechar": abrirEstudioEditor(false); break;
    case "entorno-reset": INTERFACE_EDITOR.entorno="#a4a4a4";guardarInterfaceEditor();if(E.entornoCor)E.entornoCor.value=INTERFACE_EDITOR.entorno;$ed.style.setProperty("--e-entorno",INTERFACE_EDITOR.entorno);pedir(true);break;
    case "sfx-abrir": abrirSfx(); break;
    case "sfx-fechar": fecharSfx(); break;
    case "sfx-novo": novoSfx(); break;
    case "sfx-editar": abrirSfx(); $ed.focus(); aviso("Arraste o texto para mover, os cantos para redimensionar e o ponto azul para girar."); break;
    case "voltar": fecharJanelaPagina(); sair(); break;
    case "salvar": tentarSalvarDesenho(); break;
    case "pagina-gerenciar": abrirJanelaPagina("conjuntos"); break;
    case "pagina-opcoes": abrirJanelaPagina("editar"); break;
    case "pagina-modal-fechar": fecharJanelaPagina(); break;
    case "referencias": abrirJanelaReferencias(); break;
    case "referencias-fechar": fecharJanelaReferencias(); break;
    case "estudo-fechar": fecharEstudoReferencia(); break;
    case "estudo-inserir": if(referenciaEstudoAtual){ inserirImagemDados(referenciaEstudoAtual.src,referenciaEstudoAtual.nome,referenciaEstudoAtual.tipo); } break;
    case "pagina-ant": moverPaginaEditor(-1); break;
    case "pagina-prox": moverPaginaEditor(1); break;
    case "painel-editar":
      var seletorPainel=E.paginaConteudo&&E.paginaConteudo.querySelector("[data-ed-painel]");
      abrirPainelNoEditor(seletorPainel&&seletorPainel.value); break;
    case "pagina-adicionar": escolherQuantidadeNoEditor("painel",b); break;
    case "pagina-nova": escolherQuantidadeNoEditor("nova",b); break;
    case "pagina-duplicar": executarEdicaoPagina("duplicar",null,b); break;
    case "pagina-apagar": confirmarAcaoPagina(b,"Confirmar apagar","apagar",null); break;
    case "painel-duplicar":
      executarEdicaoPagina("painel-duplicar",{indice:+b.getAttribute("data-ed-painel")},b); break;
    case "painel-apagar":
      confirmarAcaoPagina(b,"Confirmar apagar","painel-apagar",{indice:+b.getAttribute("data-ed-painel")}); break;
    case "ant": if(S.opts.ant){ var a=S.opts.ant; sair(a); } break;
    case "prox": if(S.opts.prox){ var p=S.opts.prox; sair(p); } break;
    case "desfazer": desfazer(); break;
    case "refazer": refazer(); break;
    case "fav-add": if(E.favAdd){addFavorito(E.favAdd.value);aviso("Ferramenta adicionada aos favoritos.");} break;
    case "pincel-reset":
      if(PINCEIS[S.ferr]){ CFG.ajust[S.ferr]=padraoPincel(S.ferr); guardarAjustesPinceis(); atualizarFerr(); aviso("Ajustes de "+nomeFerr(S.ferr)+" restaurados."); }
      break;
    case "zoom+": zoomCentro(1.25); break;
    case "zoom-": zoomCentro(0.8); break;
    case "ajustar": ajustar(); break;
    case "preencher": preencherArea(); break;
    case "rotar-folha": girarFolha(90); break;
    case "foco": alternarModoFoco(); break;
    case "guias-editar": CFG.guia.edit=!CFG.guia.edit; salvarEstudo(); pedir(false); aviso(CFG.guia.edit?"Arraste os pontos azuis na folha.":"Movimentação das guias desativada."); break;
    case "guias-reset": CFG.guia.h=.42; CFG.guia.v1=.18; CFG.guia.v2=.82; CFG.guia.v3=.5; CFG.guia.v3y=.08; CFG.guia.passo=96; CFG.guia.div=12; salvarEstudo(); atualizarFerr(); pedir(false); break;
    case "img-importar": if(E.imagemArquivo) E.imagemArquivo.click(); break;
    case "img-converter-ferr": transformarFotoDesenho("ferramenta",CFG.imgFerr); break;
    case "img-tom-desenho":
      if(E.tomDesenho){ E.tomDesenho.value=CFG.tomDesenho; E.tomDesenho.click(); }
      break;
    case "img-ajustar-folha": ajustarImagemFolha("contain"); break;
    case "img-preencher-folha": ajustarImagemFolha("cover"); break;
    case "img-desenho-lapis": transformarFotoDesenho("lapis"); break;
    case "img-desenho-caneta": transformarFotoDesenho("caneta"); break;
    case "img-desenho-nanquim": transformarFotoDesenho("nanquim"); break;
    case "img-desenho-colorido": transformarFotoDesenho("colorido"); break;
    case "img-desenho-aquarela": transformarFotoDesenho("aquarela"); break;
    case "img-remover": retirarImagemAtiva(); break;
    case "img-original": restaurarImagemOriginal(); break;
    case "img-saturacao": ajustarSaturacao(); break;
    case "img-filtro-sepia": aplicarFiltroImagem("sepia"); break;
    case "img-filtro-quente": aplicarFiltroImagem("quente"); break;
    case "img-filtro-frio": aplicarFiltroImagem("frio"); break;
    case "img-filtro-contraste": aplicarFiltroImagem("contraste"); break;
    case "img-filtro-vintage": aplicarFiltroImagem("vintage"); break;
    case "img-filtro-negativo": aplicarFiltroImagem("negativo"); break;
    case "img-cinza": converterCamadaCinza(); break;
    case "img-recortar": recortarCamadaSelecao(); break;
    case "png": exportar(); break;
    case "cortar": alternarCorte(); break;
    case "lat": E.lat.classList.toggle("aberta"); break;
    case "c-nova": novaCamada(); break;
    case "c-dup": duplicarCamada(); break;
    case "c-sobe": moverCamada(1); break;
    case "c-desce": moverCamada(-1); break;
    case "c-mescla": mesclarCamada(); break;
    case "c-apaga": apagarCamada(); break;
    case "b-novo": novoBalaoCentro(); break;
    case "b-dup": duplicarBal(); break;
    case "b-apaga": apagarBal(); break;
    case "b-frente": balFrente(); break;
    case "s-fh": transformarSel("fh"); break;
    case "s-fv": transformarSel("fv"); break;
    case "s-gira-esq": girarSelecaoGraus(-15); break;
    case "s-gira-dir": girarSelecaoGraus(15); break;
    case "s-gira": transformarSel("gira"); break;
    case "sel-retangulo": escolherFormaSelecao("retangulo"); break;
    case "sel-elipse": escolherFormaSelecao("elipse"); break;
    case "sel-laco": escolherFormaSelecao("laco"); break;
    case "sel-copiar": copiarSel(); break;
    case "sel-cortar": copiarSel(); apagarSel(); break;
    case "sel-duplicar": copiarSel(); colarSel(); break;
    case "sel-nova-camada": duplicarSelecaoNovaCamada(); break;
    case "m-cortar": copiarSel(); apagarSel(); break;
    case "m-copiar": copiarSel(); break;
    case "m-colar": colarSel(); break;
    case "m-apagar": apagarSel(); break;
    case "m-sel-tudo": selecionarTudo(); break;
    case "m-sel-nada": cancelarSel(); break;
    case "zoom100": zoomCentro(1/S.z); break;
    case "ajuda":
      if(E.ajuda.classList.contains("oculto")){
        fecharMenus(); E.ajuda.classList.remove("oculto");
        E.ajuda.setAttribute("aria-hidden","false");
        var fecharAjuda=E.ajuda.querySelector("[data-ed=ajuda-fechar]");
        if(fecharAjuda) fecharAjuda.focus();
      }else fecharAjuda();
      break;
    case "ajuda-fechar": fecharAjuda(); break;
    case "paineis-reset": ESTADO_PN={sim:{f:1}};INTERFACE_EDITOR.esq=true;INTERFACE_EDITOR.dir=true;INTERFACE_EDITOR.estudio=false;guardarInterfaceEditor();salvarPn();aplicarPaineis();aplicarInterfaceEditor();atualizarFerr();atualizarMenus();pedirNav();break;
  }
  if(b&&b.blur) b.blur();
}
function fecharAjuda(){
  if(!E.ajuda) return;
  E.ajuda.classList.add("oculto");
  E.ajuda.setAttribute("aria-hidden","true");
  var gatilho=$ed&&$ed.querySelector('.ed-menu .ed-ml [data-ed="ajuda"]');
  if(gatilho&&S) gatilho.focus();
}
function ligarEventos(){
  ligarManequim3D();
  $ed.addEventListener("click",function(ev){
    if(ev.target===E.ajuda){ fecharAjuda(); return; }
    if(ev.target===E.paginaJanela){ fecharJanelaPagina(); return; }
    if(ev.target===E.referenciasJanela){ fecharJanelaReferencias(); return; }
    var mb=ev.target.closest(".ed-mb");
    if(mb){ if(mb.classList.contains("aberto")) fecharMenus(); else abrirMenu(mb); return; }
    var pt=ev.target.closest("[data-pn-tog]");
    if(pt){ alternarPainel(pt.getAttribute("data-pn-tog")); atualizarMenus(); return; }
    if(ev.target.closest(".ed-ml")&&!ev.target.closest("select,input,label")) fecharMenus();
    var th=ev.target.closest(".pn-t");
    if(th&&!ev.target.closest("button,select,input,label")){if(ED_MOVEL.ativo&&E.mobileBody.contains(th))return;fecharPn(th.getAttribute("data-pn-t")); return; }
    var gp=ev.target.closest("[data-grp]");
    if(gp){
      if(INTERFACE_EDITOR.estudio)abrirEstudioEditor(false);
      var g=null, i; for(i=0;i<GRUPOS.length;i++) if(GRUPOS[i].id===gp.getAttribute("data-grp")) g=GRUPOS[i];
      if(g){
        if(E.buscaFerr) E.buscaFerr.value="";
        trocarFerr(CFG.ultimo[g.id]||g.ferrs[0]);
      }
      gp.blur(); return;
    }
    var favorito=ev.target.closest("[data-fav]");
    if(favorito){ if(E.buscaFerr) E.buscaFerr.value=""; trocarFerr(favorito.getAttribute("data-fav")); favorito.blur(); return; }
    var tm=ev.target.closest("[data-tam]");
    if(tm){
      var ta=CFG.ajust[S.ferr];
      if(ta){ ta.tam=+tm.getAttribute("data-tam"); guardarAjustesPinceis(); atualizarFerr(); pedir(false); }
      tm.blur(); return;
    }
    var b=ev.target.closest("[data-ed]");
    var pgEd=ev.target.closest("[data-ed-pagina]");
    if(pgEd){
      var num=parseInt(pgEd.getAttribute("data-ed-pagina"),10);
      if(!isNaN(num)){ pgEd.blur(); irPaginaEditor(num); }
      return;
    }
    if(b){ acao(b.getAttribute("data-ed"),b); return; }
    var f=ev.target.closest("[data-ferr]");
    if(f){if(INTERFACE_EDITOR.estudio)abrirEstudioEditor(false); trocarFerr(f.getAttribute("data-ferr")); f.blur(); return; }
    var bt=ev.target.closest("[data-baltipo]");
    if(bt){ escolherTipoBal(bt.getAttribute("data-baltipo")); bt.blur(); return; }
    var bf=ev.target.closest("[data-bfala]");
    if(bf){ balDeFala(+bf.getAttribute("data-bfala")); bf.blur(); return; }
    var c=ev.target.closest("[data-cor]");
    if(c){ definirCor(c.getAttribute("data-cor")); c.blur(); return; }
    var cam=ev.target.closest(".ed-cam");
    if(cam&&ev.target.tagName!=="INPUT") selecionarCamada(cam.getAttribute("data-id"));
  });
  $ed.addEventListener("pointerover",function(ev){
    if(ev.pointerType==="touch") return;
    var mb=ev.target.closest&&ev.target.closest(".ed-mb");
    if(mb&&menuAberto()&&!mb.classList.contains("aberto")) abrirMenu(mb);
  });
  document.addEventListener("pointerdown",function(ev){
    if(S&&menuAberto()&&!ev.target.closest(".ed-menu")) fecharMenus();
  },true);
  E.roda.addEventListener("pointerdown",function(e){
    var modo=rodaPonteiro(e,null); if(!modo) return;
    e.preventDefault(); E.roda.setPointerCapture(e.pointerId);
    var mv=function(ev){ rodaPonteiro(ev,modo); };
    var up=function(){ E.roda.removeEventListener("pointermove",mv); E.roda.removeEventListener("pointerup",up); E.roda.removeEventListener("pointercancel",up); };
    E.roda.addEventListener("pointermove",mv); E.roda.addEventListener("pointerup",up); E.roda.addEventListener("pointercancel",up);
  });
  E.nav.addEventListener("pointerdown",function(e){
    e.preventDefault(); E.nav.setPointerCapture(e.pointerId); navPonteiro(e);
    var mv=function(ev){ navPonteiro(ev); };
    var up=function(){ E.nav.removeEventListener("pointermove",mv); E.nav.removeEventListener("pointerup",up); E.nav.removeEventListener("pointercancel",up); };
    E.nav.addEventListener("pointermove",mv); E.nav.addEventListener("pointerup",up); E.nav.addEventListener("pointercancel",up);
  });
  $ed.addEventListener("dblclick",function(ev){
    var cam=ev.target.closest(".ed-cam"); if(!cam||!S) return;
    var L=porId(cam.getAttribute("data-id")); if(!L) return;
    var n=window.prompt("Nome da camada:",L.nome);
    if(n&&n.trim()) mudarProp(L,{nome:n.trim().slice(0,40)});
  });
  $ed.addEventListener("input",function(ev){
    if(!S) return;
    var t=ev.target, r=t.getAttribute("data-r"), n;
    if(campoInterfaceEditor(r,t))return;
    if(campoSfx(r,t,false))return;
    if(campoManequim3D(r,t))return;
    if(campoReticula(r,t))return;
    if(r==="buscaFerr"){ filtrarFerramentas(); return; }
    if(r==="borda"){ S.painel.borda=+t.value; E.bordaV.textContent=t.value; pedir(true); agendarSalvar(); }
    else if(r==="pTam"&&CFG.ajust[S.ferr]){ n=+t.value; CFG.ajust[S.ferr].tam=n; E.pTamV.textContent=n; pedir(false); }
    else if(r==="pOp"&&CFG.ajust[S.ferr]){ n=+t.value; CFG.ajust[S.ferr].op=n; E.pOpV.textContent=n+"%"; }
    else if(r==="pEstab"&&CFG.ajust[S.ferr]){ n=+t.value; CFG.ajust[S.ferr].estab=n; E.pEstabV.textContent=n; }
    else if(r==="pRapida"){CFG.respostaRapida=!!t.checked;try{localStorage.setItem("mesa.ed.respostaRapida",String(CFG.respostaRapida));}catch(e){}}
    else if(PINCEIS[S.ferr]&&["pFluxo","pDureza","pTextura","pDispersao","pEspacamento","pAngulo"].indexOf(r)>-1){
      var campo={pFluxo:"fluxo",pDureza:"dureza",pTextura:"textura",pDispersao:"dispersao",pEspacamento:"espacamento",pAngulo:"angulo"}[r], lim=LIMITES_PINCEL[campo];
      CFG.ajust[S.ferr][campo]=clamp(+t.value,lim[0],lim[1]); E[r+"V"].textContent=Math.round(CFG.ajust[S.ferr][campo])+(campo==="angulo"?"°":"%");
    }
    else if(r==="pTol"){ CFG.tol=+t.value; E.pTolV.textContent=t.value; }
    else if(r==="cor"){ definirCor(t.value); }
    else if(r==="tomDesenho"){ CFG.tomDesenho=t.value.toLowerCase(); }
    else if(r==="estudoOpacidade"){
      var estudoImg=E.referenciasEstudoConteudo&&E.referenciasEstudoConteudo.querySelector("[data-estudo-img]");
      if(estudoImg){ estudoImg.style.opacity=(+t.value/100); var estudoOut=t.parentNode&&t.parentNode.querySelector("output"); if(estudoOut) estudoOut.textContent=t.value+"%"; }
    }
    else if(r==="pFormaRot"){
      CFG.formaRot=+t.value||0; if(E.pFormaRotV) E.pFormaRotV.textContent=CFG.formaRot+"°";
      if(S.vivo&&S.vivo.forma){ S.vivo.forma.rot=CFG.formaRot; redesenharForma(S.vivo); pedir(true); }
    }
    else if(r==="navZoom"){ var nz=0.05*Math.pow(320,(+t.value)/100); zoomEm(nz/S.z,S.pw/2,S.ph/2); }
    else if(r==="simN"){ CFG.simN=+t.value; E.simNV.textContent=t.value; pedir(false); }
    else if(r==="balTxt"){ balEdit(function(b){ b.txt=t.value; }); }
    else if(r==="balFs"){ var fv=+t.value; E.balFsV.textContent=fv?fv:"auto"; balEdit(function(b){ b.fs=fv; }); }
    else if(r==="guiaOp"){CFG.guia.op=+t.value;if(E.guiaOpV)E.guiaOpV.textContent=t.value+"%";salvarEstudo();pedir(false);}
    else if(r==="guiaPasso"){CFG.guia.passo=clamp(+t.value||96,24,240);if(E.guiaPassoV)E.guiaPassoV.textContent=CFG.guia.passo+" px";salvarEstudo();pedir(false);}
    else if(r==="guiaDiv"){CFG.guia.div=clamp(+t.value||12,4,24);if(E.guiaDivV)E.guiaDivV.textContent=String(CFG.guia.div);salvarEstudo();pedir(false);}
    else if(r==="cOp"){
      var L=camadaAtiva(); if(!L) return;
      if(!S.propIni) S.propIni={id:L.id,op:L.op};
      L.op=+t.value; E.cOpV.textContent=L.op+"%"; pedir(true);
    }
    if(PINCEIS[S.ferr]&&/^p(Tam|Op|Estab|Fluxo|Dureza|Textura|Dispersao|Espacamento|Angulo)$/.test(r||"")){ guardarAjustesPinceis(); atualizarPreviaPincel(); }
  });
  $ed.addEventListener("change",function(ev){
    if(!S) return;
    var t=ev.target, r=t.getAttribute("data-r");
    if(campoInterfaceEditor(r,t))return;
    if(campoReticula(r,t))return;
    if(campoSfx(r,t,true))return;
    if(campoManequim3D(r,t))return;
    if(t.hasAttribute("data-ed-layout")){ executarEdicaoPagina("layout",t.value,null); t.blur(); }
    else if(r==="grupoFerr"){
      var g=GRUPOS.filter(function(g){return g.id===t.value;})[0];
      if(g){ if(E.buscaFerr) E.buscaFerr.value=""; trocarFerr(CFG.ultimo[g.id]||g.ferrs[0]); } t.blur();
    }
    else if(r==="curvaPressao"){
      if(["normal","suave","firme"].indexOf(t.value)>-1){CFG.curvaPressao=t.value;salvarPreferenciasEstudio();atualizarPreviaPincel();} t.blur();
    }
    else if(r==="perfilTraco"){
      if(["livre","rapido","suave","muito-suave"].indexOf(t.value)>-1){
        CFG.perfilTraco=t.value;var perfilEstab={livre:0,rapido:1,suave:4,"muito-suave":7};
        if(PINCEIS[S.ferr]) CFG.ajust[S.ferr].estab=perfilEstab[t.value];
        salvarPreferenciasEstudio();guardarAjustesPinceis();atualizarFerr();
      } t.blur();
    }
    else if(r==="selForma"){ escolherFormaSelecao(t.value||"retangulo"); t.blur(); }
    else if(r==="tam") mudarTamanho(t.value);
    else if(r==="forma"){ escolherForma(t.value); t.blur(); }
    else if(r==="imgFerr"){
      if(PINCEIS[t.value]){
        CFG.imgFerr=t.value;
        try{ localStorage.setItem("mesa.ed.imgFerr",CFG.imgFerr); }catch(e){}
        aviso(nomeFerr(CFG.imgFerr)+" selecionada para converter imagens.");
      }
    }
    else if(r==="tomDesenho"){
      CFG.tomDesenho=t.value.toLowerCase();
      try{ localStorage.setItem("mesa.ed.tomDesenho",CFG.tomDesenho); }catch(e){}
      aviso("Tom "+CFG.tomDesenho.toUpperCase()+" escolhido para lápis, caneta e nanquim.");
    }
    else if(r==="corHex"){
      var hv=t.value.trim(); if(hv[0]!=="#") hv="#"+hv;
      if(/^#[0-9a-f]{3}$/i.test(hv)) hv="#"+hv[1]+hv[1]+hv[2]+hv[2]+hv[3]+hv[3];
      if(/^#[0-9a-f]{6}$/i.test(hv)) definirCor(hv.toLowerCase()); else t.value=CFG.cor.toUpperCase();
    }
    else if(r==="pPres"){ CFG.pressao=t.checked; atualizarPreviaPincel(); }
    else if(r==="pFill") CFG.preencher=t.checked;
    else if(r==="pFormaTraco"){
      CFG.formaTraco=t.value||"solido"; if(S.vivo&&S.vivo.forma){ S.vivo.forma.traco=CFG.formaTraco; redesenharForma(S.vivo); pedir(true); }
    }
    else if(r==="linhaAngulo"){
      CFG.linhaAngulo=clamp(+t.value||15,5,90); aviso("Encaixe da linha: "+CFG.linhaAngulo+"°. Segure Shift ao desenhar.");
    }
    else if(r==="sim"){ CFG.sim=t.value; E.simNBox.classList.toggle("oculto",t.value!=="r"); pedir(false); }
    else if(r==="balTxt"||r==="balFs") fecharEdicaoBal();
    else if(r==="pRef") CFG.ref=t.checked;
    else if(r==="guiaGrade"){CFG.guia.grade=t.checked;salvarEstudo();pedir(false);}
    else if(r==="guiaPersp"){CFG.guia.persp=t.checked;salvarEstudo();pedir(false);}
    else if(r==="guiaTipo"){CFG.guia.tipo=t.value;salvarEstudo();pedir(false);}
    else if(r==="cOp"&&S.propIni){
      var ini=S.propIni; S.propIni=null;
      var L=porId(ini.id); if(!L) return;
      var novo=L.op; L.op=ini.op; mudarProp(L,{op:novo});
    }
    else if(r==="cModo"){ var A=camadaAtiva(); if(A) mudarProp(A,{modo:t.value}); }
    else if(t.getAttribute("data-cam")==="vis"){
      var row=t.closest(".ed-cam"), C=row&&porId(row.getAttribute("data-id"));
      if(C) mudarProp(C,{vis:t.checked});
    }
  });
  if(E.imagemArquivo) E.imagemArquivo.addEventListener("change",function(ev){
    var f=ev.target.files&&ev.target.files[0];
    if(f) importarImagem(f);
    ev.target.value="";
  });
  E.over.addEventListener("pointerdown",onDown);
  E.over.addEventListener("pointermove",onMove);
  E.over.addEventListener("pointerup",onUp);
  E.over.addEventListener("pointercancel",onUp);
  E.over.addEventListener("pointerleave",function(){ if(S){ S.cursor=null; S.coordPendente=null; E.coord.textContent=""; pedir(false); } });
  E.over.addEventListener("wheel",onWheel,{passive:false});
  E.over.addEventListener("contextmenu",function(ev){ ev.preventDefault(); });
  if(window.ResizeObserver){
    new ResizeObserver(function(){
      if(!S) return;
      var enquadramento=ED_MOVEL.ativo&&ED_MOVEL.enquadramentoTeclado;
      ajustarCanvasPalco();
      if(enquadramento&&enquadramento.sessao===S){S.z=enquadramento.z;S.tx=enquadramento.tx;S.ty=enquadramento.ty;S.ajustado=enquadramento.ajustado;pedir(true);return;}
      if(S.ajustado){ if($ed&&$ed.classList.contains("modo-foco")) preencherModoFoco(); else ajustar(); }
      else{ limitarNavegacao(); pedir(true); }
    }).observe(E.palco);
  }
  window.addEventListener("beforeunload",aoSairDaPagina);
  document.addEventListener("visibilitychange",aoMudarVisibilidadeDesenho);
  document.addEventListener("fullscreenchange",function(){ if($ed&&$ed.classList.contains("modo-foco")&&!document.fullscreenElement) alternarModoFoco(false,false); });
}

/* ---------- teclado ---------- */
function onKey(e){
  if(S&&S.carregando){e.preventDefault();e.stopImmediatePropagation();return;}
  if(!S) return;
  if(e.target&&e.target.closest&&e.target.closest('.fichas-janela')) return;
  var key=e.key||"", code=e.code||"", lower=key.toLowerCase();
  if(ED_MOVEL.ativo&&ED_MOVEL.painel&&(key==='Escape'||code==='Escape')){e.preventDefault();e.stopPropagation();fecharPainelMovel(true);return;}
  if(ED_MOVEL.ativo&&(key==='Tab'||code==='Tab')&&e.target&&e.target.closest&&e.target.closest('.ed-mobile-top,.ed-mobile-context,.ed-mobile-bar,.ed-mobile-sheet,.ed-foco-rapido'))return;
  if((key==="Escape"||code==="Escape")&&E.sfxJanela&&!E.sfxJanela.classList.contains("oculto")){e.preventDefault();e.stopPropagation();fecharSfx();$ed.focus();return;}
  if(e.target&&e.target.closest&&e.target.closest('.ed-sfx')) return;
  if((key==="Escape"||code==="Escape")&&E.m3dJanela&&!E.m3dJanela.classList.contains("oculto")){e.preventDefault();e.stopPropagation();fecharManequim3D();return;}
  var alvo=e.target; if(alvo&&(alvo.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))) return;
  if(!E.ajuda.classList.contains("oculto")&&(key==="Escape"||code==="Escape")){ e.preventDefault(); e.stopPropagation(); fecharAjuda(); return; }
  if($ed&&$ed.classList.contains("modo-foco")&&(key==="Escape"||code==="Escape")){ e.preventDefault(); e.stopPropagation(); alternarModoFoco(false); return; }
  if(key==="Tab"||code==="Tab"){ e.preventDefault(); e.stopPropagation(); girarFolha(90); return; }
  if((key==="Escape"||code==="Escape")&&sairPreencherTela()){ e.preventDefault(); e.stopPropagation(); return; }
  if(menuAberto()&&(key==="Escape"||code==="Escape")){ e.preventDefault(); e.stopPropagation(); fecharMenus(); return; }
  var t=e.target, tag=t&&t.tagName;
  if(tag==="TEXTAREA"||tag==="SELECT"||(tag==="INPUT"&&(t.type==="text"||t.type==="number"))) return;
  var ctrl=e.ctrlKey||e.metaKey, k=lower;
  if(key==="Control"||code==="ControlLeft"||code==="ControlRight"){ e.preventDefault(); e.stopPropagation(); if(!S.vivo||!S.vivo.forma) trocarFerr("lapis"); return; }
  if(key==="Alt"||code==="AltLeft"||code==="AltRight"){ e.preventDefault(); e.stopPropagation(); if(!S.vivo||!S.vivo.forma) trocarFerr("lapiseira05"); return; }
  /* Alt + tecla escolhe diretamente uma ponta/graduação específica. */
  if(e.altKey && !ctrl){
    if(S.modoPagina&&(key==="PageUp"||key==="PageDown"||code==="PageUp"||code==="PageDown")){
      e.preventDefault(); e.stopPropagation(); moverPaginaEditor((key==="PageUp"||code==="PageUp")?-1:1); return;
    }
    var idAtalhoDetalhado=MAPA_ATALHOS_DETALHADOS[k];
    if(idAtalhoDetalhado){ e.preventDefault(); e.stopPropagation(); trocarFerr(idAtalhoDetalhado); return; }
  }
  if(ctrl){
    if(k==="z"){ e.preventDefault(); e.stopPropagation(); if(e.shiftKey) refazer(); else desfazer(); }
    else if(k==="y"){ e.preventDefault(); e.stopPropagation(); refazer(); }
    else if(k==="+"||k==="add"||k==="="||code==="Equal"||code==="NumpadAdd"){ e.preventDefault(); e.stopPropagation(); zoomCentro(1.25); }
    else if(k==="-"||code==="Minus"||code==="NumpadSubtract"){ e.preventDefault(); e.stopPropagation(); zoomCentro(0.8); }
    else if(code==="Comma"){ e.preventDefault(); e.stopPropagation(); ajustaOp(-1); }
    else if(code==="Period"){ e.preventDefault(); e.stopPropagation(); ajustaOp(1); }
    else if(k==="a"){ e.preventDefault(); e.stopPropagation(); selecionarTudo(); }
    else if(k==="c"){ e.preventDefault(); e.stopPropagation(); copiarSel(); }
    else if(k==="x"){ e.preventDefault(); e.stopPropagation(); copiarSel(); apagarSel(); }
    else if(k==="v"){ e.preventDefault(); e.stopPropagation(); colarSel(); }
    return;
  }
  if(e.shiftKey&&!e.altKey){
    if(k==="s"){e.preventDefault();e.stopPropagation();abrirEstudioEditor();return;}
    if(k==="k"){e.preventDefault();e.stopPropagation();abrirReticulas();return;}
    if(k==="o"){e.preventDefault();e.stopPropagation();if(E.sfxJanela.classList.contains("oculto"))abrirSfx();else fecharSfx();return;}
    if(k==="j"){e.preventDefault();e.stopPropagation();if(E.m3dJanela.classList.contains("oculto"))abrirManequim3D();else fecharManequim3D();return;}
    var atalhosGrupos={b:"caneta",a:"pincel",p:"pastel",r:"aero",d:"deco",e:"borr"};
    if(atalhosGrupos[k]){e.preventDefault();e.stopPropagation();proximaFerramentaGrupo(atalhosGrupos[k]);return;}
  }
  if(k===" "||code==="Space"){
    e.preventDefault(); e.stopPropagation();
    trocarFerr("cubo"); aviso("Formas tridimensionais ativadas. Escolha cubo, cilindro, cone, pirâmide ou prisma.");
    return;
  }
  if(S.cortando){
    if(k==="escape"||code==="Escape"){ e.stopPropagation(); alternarCorte(false); return; }
    if(k==="delete"||k==="backspace"){ e.preventDefault(); removerVerticeSel(); return; }
  }
  if(k==="escape"||code==="Escape"){ e.stopPropagation(); if(S.ferr==="balao"&&S.balSel){ fecharEdicaoBal(); S.balSel=null; atualizarBal(); pedir(false); } else cancelarSel(); return; }
  if(k==="enter"&&S.flut){ e.preventDefault(); commitFlut(); return; }
  if(k==="delete"||k==="backspace"){ e.preventDefault(); if(S.ferr==="balao") apagarBal(); else apagarSel(); return; }
  var barraEsquerda=(k==="["||k==="{"||k==="arrowleft"||code==="BracketLeft"||code==="ArrowLeft"||e.which===219||e.keyCode===219);
  var barraDireita=(k==="]"||k==="}"||k==="arrowright"||code==="BracketRight"||code==="ArrowRight"||e.which===221||e.keyCode===221);
  if(barraEsquerda){ e.preventDefault(); e.stopPropagation(); deslocarFolha(-48,0); return; }
  if(barraDireita){ e.preventDefault(); e.stopPropagation(); deslocarFolha(48,0); return; }
  if(code==="Comma"){ e.preventDefault(); e.stopPropagation(); if(e.shiftKey) ajustaEstab(-1); else ajustaTam(-1); return; }
  if(code==="Period"){ e.preventDefault(); e.stopPropagation(); if(e.shiftKey) ajustaEstab(1); else ajustaTam(1); return; }
  if(k==="+"||k==="add"||((k==="=")&&e.shiftKey)||(code==="Equal"&&e.shiftKey)||code==="NumpadAdd"){ e.preventDefault(); refazer(); return; }
  if(k==="-"||code==="Minus"||code==="NumpadSubtract"){ e.preventDefault(); desfazer(); return; }
  if(k==="0"){ ajustar(); return; }
  if(S.ferr==="linha"&&(k==="1"||k==="2"||k==="3"||k==="4")){
    var angulosLinha={"1":5,"2":15,"3":30,"4":45}; CFG.linhaAngulo=angulosLinha[k]; if(E.linhaAngulo) E.linhaAngulo.value=CFG.linhaAngulo; aviso("Encaixe da linha: "+CFG.linhaAngulo+"°. Segure Shift ao desenhar."); return;
  }
  var mapa={p:"lapis",q:"lapis6b",k:"esfero",b:"caneta",n:"nanquim",m:"marcador",r:"aerografo",a:"pincel",d:"seco",s:"esfumar",e:"borracha",l:"linha",u:"retangulo",o:"elipse",g:"balde",i:"gota",v:"selecionar",t:"balao",h:"mao"};
  if(mapa[k]) trocarFerr(mapa[k]);
}
function onKeyUp(e){
  if(!S) return;
  if((e.key||"")===" "||e.code==="Space"){
    e.preventDefault(); e.stopPropagation();
    S.espaco=false; E.over.style.cursor=S.ferr==="mao"?"grab":"crosshair"; pedir(false);
  }
}

/* painel pronto (camadas + balões) como canvas; usado nas prévias e nas exportações */
function compor(id,painel,maxLado,comBorda){
  /* A prévia da página usa as camadas ainda abertas no editor, inclusive antes de salvar. */
  if(S&&S.painel&&S.painel.id===id){
    if(S.carregando)return Promise.reject(erroLeituraImagem("O desenho ainda está sendo lido."));
    var dimAtual=dimensoes(TAMANHOS[painel&&painel.tamanho]?painel.tamanho:PADRAO_TAM);
    var fatorAtual=Math.min(1,maxLado/Math.max(dimAtual.w,dimAtual.h));
    var atual=novoCanvas(Math.max(1,Math.round(dimAtual.w*fatorAtual)),Math.max(1,Math.round(dimAtual.h*fatorAtual))), xa=atual.getContext("2d");
    if(!(painel&&painel.sobreposto)){ xa.fillStyle="#fff"; xa.fillRect(0,0,atual.width,atual.height); }
    xa.save(); xa.scale(fatorAtual,fatorAtual); xa.imageSmoothingQuality="high";
    camadasEm(xa,true,S);
    desenharBaloes(xa,S.baloes,Math.max(dimAtual.w,dimAtual.h));
    var bordaAtualComposta=painel&&typeof painel.borda==="number"?painel.borda:BORDA_PADRAO;
    if(comBorda&&bordaAtualComposta>0){ xa.strokeStyle="#111"; xa.lineWidth=bordaAtualComposta; xa.strokeRect(bordaAtualComposta/2,bordaAtualComposta/2,dimAtual.w-bordaAtualComposta,dimAtual.h-bordaAtualComposta); }
    xa.restore();
    return Promise.resolve(atual);
  }
  return bdLer(id).then(function(rec){
    if(rec===null||(rec&&Array.isArray(rec.camadas)&&!rec.camadas.length&&!(painel&&painel.temDesenho))){
      if(painel&&painel.temDesenho)throw erroLeituraImagem("O desenho referenciado não foi encontrado.","desenho_ausente");return null;
    }
    if(!rec||!Array.isArray(rec.camadas)||!rec.camadas.length)throw erroLeituraImagem("O desenho armazenado está incompleto.","registro_imagem");
    var chave=TAMANHOS[painel&&painel.tamanho]?painel.tamanho:PADRAO_TAM, dim=dimensoes(chave);
    var k=Math.min(1,maxLado/Math.max(dim.w,dim.h));
    var ox=Math.round((dim.w-(rec.w||dim.w))/2), oy=Math.round((dim.h-(rec.h||dim.h))/2);
    return Promise.all(rec.camadas.map(function(c){return Promise.resolve().then(function(){if(!c||!c.blob)throw erroLeituraImagem("Uma camada do desenho está sem imagem.","registro_imagem");return decodificar(c.blob).then(function(img){if(!img)throw erroLeituraImagem();return img;});});})).then(function(imgs){
      var cv=novoCanvas(Math.max(1,Math.round(dim.w*k)),Math.max(1,Math.round(dim.h*k))), x=cv.getContext("2d");
      if(!(painel&&painel.sobreposto)){ x.fillStyle="#fff"; x.fillRect(0,0,cv.width,cv.height); }
      x.save(); x.scale(k,k); x.imageSmoothingQuality="high";
      rec.camadas.forEach(function(c,i){
        if(c.vis===false||!imgs[i]) return;
        x.globalAlpha=(c.op==null?100:c.op)/100; x.globalCompositeOperation=opComp(c.modo);
        x.drawImage(imgs[i],ox,oy);
      });
      x.globalAlpha=1; x.globalCompositeOperation="source-over";
      var b=painel&&typeof painel.borda==="number"?painel.borda:BORDA_PADRAO;
      if(comBorda&&b>0){ x.strokeStyle="#111"; x.lineWidth=b; x.strokeRect(b/2,b/2,dim.w-b,dim.h-b); }
      desenharBaloes(x,(rec.baloes||[]).map(function(bl){
        var q=cloneBal(bl); q.x+=ox; q.y+=oy; q.px+=ox; q.py+=oy; return q;
      }),Math.max(dim.w,dim.h));
      x.restore();
      return cv;
    });
  });
}
/* prévia em boa resolução (usada na lista de painéis do roteiro) */
function previa(id,painel){
  return compor(id,painel,1100,false).then(function(cv){
    return cv?new Promise(function(res){ cv.toBlob(res,painel&&painel.sobreposto?"image/png":"image/jpeg",0.86); }):null;
  });
}
if(document.fonts&&document.fonts.load){
  document.fonts.load('700 24px "Comic Neue"').then(function(){
    if(S){ S.baloes.forEach(function(b){ b._c=null; }); pedir(true); }
    qa("[data-baltipo]").length&&miniaturasBaloes();
  }).catch(function(){});
}
function copiarDesenho(de,para){
  var copia=bdLer(de).then(function(rec){if(!rec)throw erroLeituraImagem("O desenho original da cópia não foi encontrado.","desenho_ausente");return bdGravar(para,rec);}).then(function(ok){if(ok!==true)throw erroLeituraImagem("A cópia do desenho não foi confirmada.");return true;});
  COPIAS_DESENHO.push(copia);
  function terminou(){var i=COPIAS_DESENHO.indexOf(copia);if(i>=0)COPIAS_DESENHO.splice(i,1);}
  copia.then(terminou,terminou);return copia;
}
window.EditorDesenho={
  abrir:abrir,
  fechar:function(){ fecharJanelaReferencias(); fecharEstudoReferencia(); return sair(); },
  estaAberto:function(){ return !!S; },
  salvar:tentarSalvarDesenho,
  temAlteracoes:temAlteracoesDesenho,
  abrirReferencias:abrirJanelaReferencias,
  fecharReferencias:fecharJanelaReferencias,
  inserirImagemDados:inserirImagemDados,
  apagar:function(id){ return bdApagar(id); },
  copiar:copiarDesenho,
  previa:previa,
  compor:compor,
  exportarDados:exportarDadosEditor,
  blobParaData:blobParaData,
  dataParaBlob:dataParaBlob,
  exportarPNG:exportar,
  importarDados:function(lista){if(!window.__mesaImportarPacote)throw new Error("O importador ainda não foi iniciado.");return window.__mesaImportarPacote({obras:[],capitulos:[],notas:[],desenhos:lista});},
  bdLer:bdLer,
  bdGravar:bdGravar,
  bdApagar:bdApagar,
  bdListar:bdListar,
  bdAbrir:bdAbrir,
  prepararDadosImportacao:prepararDesenhosImportacao,
  aguardarOperacoes:function(){return Promise.all(COPIAS_DESENHO.slice()).then(tentarSalvarDesenho);},
  TAMANHOS:TAMANHOS,
  ORDEM:ORDEM
};
})();
