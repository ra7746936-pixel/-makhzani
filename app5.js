/* مخزني - الجزء 5 (UTF-8، جنب index.html): الاستيراد والفواتير والعملاء ثم بداية التشغيل */
/* ---------- استيراد أصناف من Excel / CSV (المالك بس) ---------- */
var impRows = null, impBusy = false;
function impMsg(t,bad){ var m = $('#imp-msg'); m.hidden = !t; m.textContent = t||''; m.style.color = bad ? 'var(--bad-ink)' : ''; }
function impNorm(x){
  return String(x==null ? '' : x).toLowerCase().replace(/[ً-ٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[\s_\-.:()\/]+/g,'');
}
function impNum(v){
  if(v==null) return NaN;
  var t = String(v).replace(/[٠-٩]/g,function(c){ return c.charCodeAt(0)-0x0660; }).replace(/[۰-۹]/g,function(c){ return c.charCodeAt(0)-0x06F0; })
    .replace(/٫/g,'.').replace(/٬/g,'').replace(/[^\d.,\-]/g,'');
  if(!t) return NaN;
  if(t.indexOf(',')>=0 && t.indexOf('.')<0 && /,\d{1,2}$/.test(t)) t = t.replace(',','.'); else t = t.replace(/,/g,'');
  return parseFloat(t);
}
function impCsv(text){
  if(text.charCodeAt(0)===0xFEFF) text = text.slice(1);
  var first = text.split(/\r?\n/)[0]||'', d = ',';
  if((first.match(/;/g)||[]).length > (first.match(/,/g)||[]).length) d = ';';
  if((first.match(/\t/g)||[]).length > (first.match(new RegExp('['+d+']','g'))||[]).length) d = '\t';
  var rows = [], row = [], cur = '', q = false;
  for(var i = 0; i < text.length; i++){
    var c = text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){ cur += '"'; i++; } else q = false; } else cur += c; }
    else if(c==='"') q = true;
    else if(c===d){ row.push(cur); cur = ''; }
    else if(c==='\n' || c==='\r'){ if(c==='\r' && text[i+1]==='\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if(cur!=='' || row.length){ row.push(cur); rows.push(row); }
  return rows;
}
function impInflate(u8){
  if(typeof DecompressionStream==='undefined') return Promise.reject(new Error('nodecomp'));
  var ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
  w.write(u8); w.close();
  return new Response(ds.readable).arrayBuffer().then(function(b){ return new Uint8Array(b); });
}
function impUnzip(buf){
  var u = new Uint8Array(buf), dv = new DataView(buf), e = -1, i;
  for(i = u.length-22; i >= Math.max(0,u.length-70000); i--){ if(dv.getUint32(i,true)===0x06054b50){ e = i; break; } }
  if(e<0) return Promise.reject(new Error('notzip'));
  var n = dv.getUint16(e+10,true), off = dv.getUint32(e+16,true), dec = new TextDecoder(), ent = {};
  for(i = 0; i < n; i++){
    if(dv.getUint32(off,true)!==0x02014b50) break;
    var meth = dv.getUint16(off+10,true), cs = dv.getUint32(off+20,true), nl = dv.getUint16(off+28,true), xl = dv.getUint16(off+30,true), cl = dv.getUint16(off+32,true), lo = dv.getUint32(off+42,true);
    ent[dec.decode(u.subarray(off+46,off+46+nl))] = {meth:meth,cs:cs,lo:lo};
    off += 46+nl+xl+cl;
  }
  function get(name){
    var f = ent[name]; if(!f) return Promise.resolve(null);
    var ds = f.lo+30+dv.getUint16(f.lo+26,true)+dv.getUint16(f.lo+28,true), raw = u.subarray(ds,ds+f.cs);
    if(f.meth===0) return Promise.resolve(raw);
    if(f.meth===8) return impInflate(raw);
    return Promise.reject(new Error('method'));
  }
  return {names:Object.keys(ent),get:get};
}
function impColIdx(ref){ var m = /^([A-Z]+)/.exec(ref||''), n = 0; if(!m) return 0; for(var i = 0; i < m[1].length; i++) n = n*26+(m[1].charCodeAt(i)-64); return n-1; }
function impXlsx(buf){
  var z; try{ z = impUnzip(buf); }catch(e){ return Promise.reject(e); }
  if(z.then) return z;
  var dec = new TextDecoder(), parse = function(u){ return new DOMParser().parseFromString(dec.decode(u),'application/xml'); };
  var sheets = z.names.filter(function(n){ return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort(function(a,b){ return parseInt(a.replace(/\D/g,''),10)-parseInt(b.replace(/\D/g,''),10); });
  if(!sheets.length) return Promise.reject(new Error('nosheet'));
  return Promise.all([z.get('xl/sharedStrings.xml'),z.get(sheets[0])]).then(function(r){
    var ss = [];
    if(r[0]){
      var sd = parse(r[0]).getElementsByTagName('si');
      for(var i = 0; i < sd.length; i++){ var ts = sd[i].getElementsByTagName('t'), t = ''; for(var k = 0; k < ts.length; k++) t += ts[k].textContent; ss.push(t); }
    }
    var cells = parse(r[1]).getElementsByTagName('row'), rows = [];
    for(var ri = 0; ri < cells.length; ri++){
      var rn = parseInt(cells[ri].getAttribute('r'),10)-1, cs = cells[ri].getElementsByTagName('c'), row = [];
      for(var ci = 0; ci < cs.length; ci++){
        var c = cs[ci], t2 = c.getAttribute('t'), v = c.getElementsByTagName('v')[0], val = '';
        if(t2==='s') val = v ? (ss[parseInt(v.textContent,10)]||'') : '';
        else if(t2==='inlineStr'){ var it = c.getElementsByTagName('t'); for(var q = 0; q < it.length; q++) val += it[q].textContent; }
        else val = v ? v.textContent : '';
        row[impColIdx(c.getAttribute('r'))] = val;
      }
      rows[isNaN(rn) ? rows.length : rn] = row;
    }
    var out = []; for(var x = 0; x < rows.length; x++) out.push(rows[x]||[]);
    return out;
  });
}
/* ملف Word (.docx): بنقرا الجدول الأكبر في الملف، وأي جداول تانية ليها نفس صف العناوين (لو الجدول اتقسم) */
function impDocx(buf){
  var z; try{ z = impUnzip(buf); }catch(e){ return Promise.reject(e); }
  if(z.then) return z;
  return z.get('word/document.xml').then(function(u){
    if(!u) throw new Error('notable');
    var doc = new DOMParser().parseFromString(new TextDecoder().decode(u),'application/xml'), tbs = doc.getElementsByTagName('w:tbl'), all = [], i, j, k;
    var txt = function(tc){
      var ps = tc.getElementsByTagName('w:p'), out = [];
      for(var a = 0; a < ps.length; a++){ var ts = ps[a].getElementsByTagName('w:t'), t = ''; for(var b = 0; b < ts.length; b++) t += ts[b].textContent; if(t.trim()) out.push(t.trim()); }
      return out.join(' ');
    };
    for(i = 0; i < tbs.length; i++){
      var trs = tbs[i].getElementsByTagName('w:tr'), rows = [];
      for(j = 0; j < trs.length; j++){
        var row = [], kids = trs[j].childNodes;
        for(k = 0; k < kids.length; k++){ if(kids[k].nodeName==='w:tc') row.push(txt(kids[k])); }
        if(row.length) rows.push(row);
      }
      if(rows.length) all.push(rows);
    }
    if(!all.length) throw new Error('notable');
    var main = all[0]; all.forEach(function(t){ if(t.length>main.length) main = t; });
    var hs = JSON.stringify(main[0]), out = main.slice();
    all.forEach(function(t){ if(t!==main && JSON.stringify(t[0])===hs) out = out.concat(t); });
    /* صف العناوين لو اتكرر مع كل صفحة بنشيله */
    return out.filter(function(r,ix){ return ix===0 || JSON.stringify(r)!==hs; });
  });
}
var IMP_FIELDS = [
  {k:'unit',kw:['وحده','نوع','تصنيف','unit','kind']},
  {k:'pack',kw:['كرتون','علبه','عبوه','pack','carton','box']},
  {k:'cost',kw:['جمله','تكلف','شراء','cost','wholesale','purchase']},
  {k:'barcode',kw:['باركود','barcode','sku','كود']},
  {k:'qty',kw:['كميه','رصيد','مخزون','الفاضل','عدد','qty','quantity','stock','balance']},
  {k:'name',kw:['صنف','اسم','منتج','بيان','name','item','product','description']},
  {k:'price',kw:['سعربيع','سعرالبيع','بيع','سعر','price','sell','retail']}
];
function impGuess(head){
  var used = {}, g = {}, hn = head.map(impNorm), qi = -1, pi = -1, gi = -1, i0;
  for(i0 = 0; i0 < hn.length; i0++){
    if(qi<0 && (hn[i0].indexOf('قطاع')>=0 || hn[i0].indexOf('qata')>=0)) qi = i0;
    if(pi<0 && hn[i0].indexOf('pricesell')>=0) pi = i0;
    if(gi<0 && (hn[i0].indexOf('جمله')>=0 || hn[i0].indexOf('gomla')>=0)) gi = i0;
  }
  /* ملفات برامج الكاشير القديمة: سعر القطاعي = سعر البيع، و«سعر البيع» نفسه غالبا هو التكلفة (متوسط الشراء) */
  if(qi>=0 && pi>=0 && gi>=0){ g.price = qi; used[qi] = true; g.cost = pi; used[pi] = true; used[gi] = true; }
  IMP_FIELDS.forEach(function(f){
    if(g[f.k]!=null) return;
    for(var i = 0; i < head.length; i++){
      if(used[i]) continue; var h = impNorm(head[i]); if(!h) continue;
      if(f.kw.some(function(w){ return h.indexOf(w)>=0; })){ g[f.k] = i; used[i] = true; return; }
    }
  });
  return g;
}
function impFill(rows){
  var head = rows[0].map(function(h){ return String(h==null?'':h).trim(); }), g = impGuess(head), w = Math.max.apply(null,rows.slice(0,50).map(function(r){ return r.length; }).concat([head.length]));
  var opts = function(req){ var h = req ? '' : '<option value="-1">— مفيش —</option>'; for(var i = 0; i < w; i++) h += '<option value="'+i+'">'+esc(head[i] ? head[i] : 'عمود '+(i+1))+'</option>'; return h; };
  ['name','price'].forEach(function(k){ $('#imp-c-'+k).innerHTML = opts(true); $('#imp-c-'+k).value = g[k]!=null ? g[k] : (k==='name' ? 0 : Math.min(1,w-1)); });
  ['cost','qty','barcode','pack','unit'].forEach(function(k){ $('#imp-c-'+k).innerHTML = opts(false); $('#imp-c-'+k).value = g[k]!=null ? g[k] : -1; });
  $('#imp-info').textContent = 'لقيت '+fmt(rows.length-1)+' صف في الملف. راجع إن كل عمود مختار صح، وبعدين اضغط استورد.';
  impPreview();
}
function impParse(){
  var col = function(k){ return parseInt($('#imp-c-'+k).value,10); }, c = {name:col('name'),price:col('price'),cost:col('cost'),qty:col('qty'),barcode:col('barcode'),pack:col('pack'),unit:col('unit')};
  var items = [], bad = 0, seen = {};
  for(var i = 1; i < impRows.length; i++){
    var r = impRows[i], name = String(r[c.name]==null ? '' : r[c.name]).trim();
    if(!name && !r.some(function(x){ return String(x||'').trim(); })) continue;
    var price = impNum(r[c.price]);
    if(!name || !(price>=0)){ bad++; continue; }
    var qty = c.qty>=0 ? impNum(r[c.qty]) : 0, cost = c.cost>=0 ? impNum(r[c.cost]) : NaN, pk = c.pack>=0 ? Math.floor(impNum(r[c.pack])) : 0;
    var un = c.unit>=0 ? String(r[c.unit]==null ? '' : r[c.unit]).trim().slice(0,12) : '';
    if(/^(قطعه|قطعة|حبه|حبة|piece|pieces|pcs|pc|unit|units)$/i.test(un) || un==='-' || un==='0') un = '';
    if(un) pk = 0;
    var bc = c.barcode>=0 ? String(r[c.barcode]==null ? '' : r[c.barcode]).trim() : '';
    var kb = bc ? 'b'+bc : '', kn = 'n'+name.toLowerCase();
    if((kb && seen[kb]) || seen[kn]){ bad++; continue; } if(kb) seen[kb] = 1; seen[kn] = 1;
    items.push({name:name,price:round(price),qty:(qty>=0 ? round(qty) : 0),cost:(cost>=0 ? round(cost) : null),pack:(pk>1 ? pk : 0),unit:un,hasUnit:(c.unit>=0),barcode:bc,hasQty:(c.qty>=0 && qty>=0),hasCost:(c.cost>=0 && cost>=0)});
  }
  return {items:items,bad:bad};
}
function impPreview(){
  if(!impRows) return;
  var r = impParse(), f = r.items.slice(0,3).map(function(x){ return x.name+' — بيع '+fmt(x.price)+(x.cost!=null ? ' / جملة '+fmt(x.cost) : '')+(x.qty ? ' — كمية '+fmt(x.qty)+(x.unit ? ' '+x.unit : '') : ''); }).join('  |  ');
  $('#imp-prev').textContent = 'هيتستورد '+fmt(r.items.length)+' صنف'+(r.bad ? ' (و'+fmt(r.bad)+' صف هيتخطى: اسم فاضي أو سعر غلط أو مكرر)' : '')+(f ? '. مثال: '+f : '.');
  $('#imp-go').disabled = !r.items.length;
}
function impHandleFile(file){
  impMsg('بقرا الملف…'); $('#imp-map').hidden = true; impRows = null;
  var isX = /\.xlsx$/i.test(file.name), isD = /\.docx$/i.test(file.name);
  if(/\.doc$/i.test(file.name)){ impMsg('ملفات .doc القديمة مش بتتقري. افتح الملف في Word واحفظه باسم جديد بصيغة .docx (أو Excel).',true); return; }
  var fr = new FileReader();
  fr.onerror = function(){ impMsg('معرفتش أقرا الملف.',true); };
  fr.onload = function(){
    var done = function(rows){
      rows = (rows||[]).filter(function(r){ return r && r.some(function(x){ return String(x==null?'':x).trim(); }); });
      if(rows.length<2){ impMsg('الملف فاضي أو فيه صف العناوين بس.',true); return; }
      if(rows.length>5001){ impMsg('الملف كبير (أكتر من 5000 صنف). قسّمه على ملفين.',true); return; }
      impRows = rows; impMsg(''); impFill(rows); $('#imp-map').hidden = false;
    };
    if(isD) impDocx(fr.result).then(done,function(e){ impMsg(e && e.message==='notable' ? 'ملف Word ده مفيهوش جدول. البيانات لازم تكون في جدول (صف عناوين وتحته الأصناف).' : (e && e.message==='nodecomp' ? 'المتصفح ده قديم. جرّب من Chrome حديث أو احفظ الملف Excel.' : 'معرفتش أقرا ملف Word. تأكد إنه .docx.'),true); });
    else if(isX) impXlsx(fr.result).then(done,function(e){ impMsg(e && e.message==='nodecomp' ? 'المتصفح ده قديم ومش بيقرا ملفات Excel. احفظ الملف CSV واختاره.' : 'معرفتش أقرا ملف Excel. تأكد إنه .xlsx، أو احفظه CSV.',true); });
    else done(impCsv(new TextDecoder('utf-8').decode(new Uint8Array(fr.result))));
  };
  fr.readAsArrayBuffer(file);
}
$('#imp-pick').addEventListener('click',function(){ $('#imp-file').click(); });
$('#imp-file').addEventListener('change',function(e){ var f = e.target.files[0]; e.target.value = ''; if(f) impHandleFile(f); });
$('#imp-cancel').addEventListener('click',function(){ impRows = null; $('#imp-map').hidden = true; impMsg(''); });
['name','price','cost','qty','barcode','pack','unit'].forEach(function(k){ $('#imp-c-'+k).addEventListener('change',impPreview); });
$('#imp-tpl').addEventListener('click',function(){
  var rows = [['اسم الصنف','سعر البيع','سعر الجملة','الكمية','الباركود','عدد القطع في الكرتونة','الوحدة'],['مياه 600 مل',5,3.5,48,'6221234567890',12,'قطعة'],['سلك كهربا 2.5',18,14,200,'',0,'متر']];
  var blob = xlsxFromSheets([['الأصناف',rows,[28,12,12,10,18,22,10]]]), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'makhzani-items-template.xlsx'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); },1000);
});
$('#imp-go').addEventListener('click',function(){
  if(impBusy || !impRows) return;
  if(!isOwner()){ toast('الاستيراد للمالك بس',true); return; }
  if(!ready()) return;
  var r = impParse(), mode2 = $('#imp-dup').value, byB = {}, byN = {}, added = 0, upd = 0, skipped = 0, i = 0;
  products.forEach(function(p){ if(p.barcode) byB[p.barcode] = p; byN[p.name.toLowerCase()] = p; });
  impBusy = true; $('#imp-go').disabled = true; holdRender(true);
  (function step(){
    var end = Math.min(i+40,r.items.length);
    for(; i < end; i++){
      var x = r.items[i], old = (x.barcode && byB[x.barcode]) || byN[x.name.toLowerCase()];
      if(old){
        if(mode2==='skip'){ skipped++; continue; }
        putProduct(Object.assign({},old,{name:x.name,price:x.price,unit:x.hasUnit ? x.unit : (old.unit||''),pack:x.hasUnit&&x.unit ? 0 : (x.pack||old.pack||0),barcode:x.barcode||old.barcode||'',qty:x.hasQty ? x.qty : old.qty,cost:x.hasCost ? x.cost : (old.cost==null ? null : old.cost)})); upd++;
      } else {
        var np = {id:uid(),name:x.name,price:x.price,qty:x.qty,cost:x.cost,barcode:x.barcode,pack:x.pack,unit:x.unit,sold:0,revenue:0,created:Date.now()+i};
        putProduct(np); added++; if(np.barcode) byB[np.barcode] = np; byN[np.name.toLowerCase()] = np;
      }
    }
    impMsg('بستورد… '+fmt(i)+' من '+fmt(r.items.length));
    if(i<r.items.length){ setTimeout(step,30); return; }
    logA('addp','استيراد أصناف من Excel: '+fmt(added)+' جديد، '+fmt(upd)+' اتحدّث، '+fmt(skipped)+' اتخطّى');
    impBusy = false; impRows = null; $('#imp-map').hidden = true; holdRender(false);
    impMsg('تمام: اتضاف '+fmt(added)+' صنف جديد'+(upd ? '، واتحدّث '+fmt(upd) : '')+(skipped ? '، واتخطّى '+fmt(skipped)+' موجودين قبل كده' : '')+'.');
    toast('اتستورد '+fmt(added+upd)+' صنف');
  })();
});

/* نسخة كاملة + ملف Excel مقروء (لرفعهم على Drive) */
window.mkBackupBundle = function(cb){ mkBackupData(function(data){ cb(data, buildExcelBlob(data.sales||[])); }); };

/* ---------- تبويب الفواتير (النهارده / 7 أيام / الشهر / من الأول) ---------- */
var invPer = 'today', invQ = '', invLimit = 50;
function invSince(per){
  var d = new Date(); d.setHours(0,0,0,0);
  if(per==='today') return d.getTime();
  if(per==='week') return d.getTime()-6*86400000;
  if(per==='month'){ d.setDate(1); return d.getTime(); }
  return 0;
}
function invRow(s,showCust,ro){
  var tag = (s.edits && s.edits.length) ? '<span class="pill warn">اتعدّلت</span>' : '';
  var ct = (showCust!==false && s.cust) ? '<span class="cust-tag">· '+esc(s.cust.name)+'</span>' : '';
  var fee = s.fee>0 ? '<span class="pmeta"> · توصيل '+money(s.fee)+'</span>' : '';
  return '<li><span class="when"><span class="inv-num">'+esc(invCode(s))+'</span> · '+dt(s.ts)+(s.by ? ' · '+esc(s.by.name) : '')+ct+'</span>'+
    '<span class="what">'+s.lines.map(function(l){ return esc(l.name)+' ×'+esc(qtyText(l.qty,l.pack,l.u)); }).join('، ')+fee+'</span><span class="sum">'+money(s.total)+'</span>'+
    '<div class="inv-act">'+(ro ? '<span class="pill zero">قديمة (للعرض فقط)</span>' : '<button type="button" class="btn sm" data-act="editinv" data-sid="'+esc(s.id)+'">مرتجع / تعديل</button>')+'<button type="button" class="btn sm" data-act="print" data-sid="'+esc(s.id)+'">اطبع</button>'+tag+'</div></li>';
}
function renderInv(){
  var box = $('#inv-list'); if(!box || $('#v-inv').hidden) return;
  Array.prototype.forEach.call(document.querySelectorAll('[data-iper]'),function(b){ b.setAttribute('aria-pressed', b.dataset.iper===invPer ? 'true' : 'false'); });
  var t0 = invSince(invPer), q = invQ.trim().toLowerCase().replace(/^#/,'');
  var list = sales.filter(function(s){ return s.ts>=t0; });
  var oldOn = invPer==='all' && mode==='cloud' && isOwner(), oldIds = {};
  if(oldOn) list = list.concat(oldSales.filter(function(s){ return !sales.some(function(x){ return x.id===s.id; }); }));
  oldSales.forEach(function(s){ oldIds[s.id] = 1; });
  if(q){
    list = list.filter(function(s){
      if(String(s.no||'')===q) return true;
      if(s.cust && s.cust.name.toLowerCase().indexOf(q)>=0) return true;
      return s.lines.some(function(l){ return l.name.toLowerCase().indexOf(q)>=0; });
    });
  }
  list.sort(function(a,b){ return b.ts-a.ts; });
  var tot = 0, fees = 0; list.forEach(function(s){ tot += s.total; fees += (s.fee||0); });
  $('#inv-tiles').innerHTML =
    '<div class="tile"><span>عدد الفواتير</span><strong>'+fmt(list.length)+'</strong></div>'+
    '<div class="tile"><span>إجمالي الفواتير</span><strong>'+money(round(tot))+'</strong>'+(fees>0 ? '<small>منها توصيل '+money(round(fees))+'</small>' : '')+'</div>';
  var shown = list.slice(0,invLimit);
  box.innerHTML = shown.length ? shown.map(function(s){ return invRow(s,true,!!oldIds[s.id] && !sales.some(function(x){ return x.id===s.id; })); }).join('') : '<li class="note">مفيش فواتير في الفترة دي'+(q ? ' بالبحث ده' : '')+'.</li>';
  $('#inv-more').hidden = list.length<=invLimit;
  $('#inv-note').textContent = (invPer==='all' && mode==='cloud') ? (isOwner() ? 'بيعرض فواتير آخر 45 يوم. الأقدم منها محفوظة في الكلاود، وبتتحمّل بالزرار اللي تحت (للعرض والطباعة بس).' : 'بيعرض فواتير آخر 45 يوم.') : '';
  var ob = $('#inv-old'); if(ob){
    ob.hidden = !oldOn || oldDone;
    ob.disabled = oldBusy; ob.textContent = oldBusy ? 'بيحمّل…' : (oldSales.length ? 'حمّل فواتير أقدم' : 'عرض الفواتير الأقدم من 45 يوم');
  }
}
var oldSales = [], oldBusy = false, oldDone = false;
window.oldSales = oldSales;
function loadOldInv(){
  if(oldBusy || mode!=='cloud' || !isOwner() || !db) return;
  var cutoff = Date.now()-CLOUD_DAYS*86400000;
  var last = oldSales.length ? oldSales[oldSales.length-1].ts : cutoff;
  oldBusy = true; renderInv();
  db.collection('sales').where('ts','<',Math.min(last,cutoff)).orderBy('ts','desc').limit(200).getOnce().then(function(rows){
    rows.forEach(function(s){ if(s && Array.isArray(s.lines) && !oldSales.some(function(x){ return x.id===s.id; })) oldSales.push(s); });
    oldSales.sort(function(a,b){ return b.ts-a.ts; });
    if(rows.length<200) oldDone = true;
    oldBusy = false; if(!rows.length) toast('مفيش فواتير أقدم'); renderInv();
  },function(){ oldBusy = false; toast('معرفتش أحمّل. اتأكد من النت وجرّب تاني.',true); renderInv(); });
}
document.addEventListener('click',function(e){
  var b = e.target.closest('[data-iper]');
  if(b){ invPer = b.dataset.iper; invLimit = 50; render(); return; }
  if(e.target.closest('#inv-old')){ loadOldInv(); return; }
  var m = e.target.closest('[data-act="invmore"]');
  if(m){ invLimit += 50; render(); }
});
$('#inv-q').addEventListener('input',function(e){ invQ = e.target.value; invLimit = 50; renderInv(); });

/* ---------- العملاء ---------- */
var selCust = null, custQ = '';
function custInvoices(id){ return sales.filter(function(s){ return s.cust && s.cust.id===id; }).sort(function(a,b){ return b.ts-a.ts; }); }
function renderCustSel(){
  var el = $('#cust'); if(!el) return;
  var pr = $('#paid-row'); if(pr) pr.hidden = !el.value;
  var opts = '<option value="">بدون عميل</option>'+Array.from(customers.values()).sort(byName).map(function(c){ return '<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>'; }).join('');
  if(opts!==el.__o){ var cur = el.value; el.innerHTML = opts; el.__o = opts; if(cur && customers.get(cur)) el.value = cur; }
}
function renderCust(){
  renderCustSel();
  if($('#v-cust').hidden) return;
  var c = selCust ? customers.get(selCust) : null;
  if(selCust && !c) selCust = null;
  $('#cust-list-view').hidden = !!c; $('#cust-detail').hidden = !c;
  var q = custQ.trim().toLowerCase();
  var list = Array.from(customers.values()).filter(function(x){ return !q || x.name.toLowerCase().indexOf(q)>=0 || (x.phone||'').indexOf(q)>=0; }).sort(byName);
  $('#custlist').innerHTML = list.length ? list.map(function(x){
    var inv = custInvoices(x.id), tot = 0; inv.forEach(function(s){ tot += s.total; });
    var cb = custBal(custStats(x).bal);
    return '<li class="item"><button type="button" class="sup-row" data-act="opencust" data-id="'+esc(x.id)+'"><span class="sup-main"><strong>'+esc(x.name)+'</strong>'+(x.phone ? '<span class="pmeta">'+esc(x.phone)+'</span>' : '')+'<span class="pmeta">'+fmt(inv.length)+' فاتورة · '+money(round(tot))+'</span></span><span class="pill '+cb[1]+'">'+cb[0]+'</span></button></li>';
  }).join('') : '<li class="note">'+(q ? 'مفيش عميل بالاسم ده.' : 'لسه ماسجلتش عملاء. ضيف أول عميل من فوق.')+'</li>';
  if(c){
    var inv2 = custInvoices(c.id), t2 = 0; inv2.forEach(function(s){ t2 += s.total; });
    $('#cud-name').textContent = c.name; $('#cud-phone').textContent = c.phone ? 'التليفون: '+c.phone : 'من غير تليفون';
    var cs = custStats(c), cb2 = custBal(cs.bal);
    $('#cud-tiles').innerHTML = '<div class="tile"><span>عدد الفواتير</span><strong>'+fmt(inv2.length)+'</strong></div><div class="tile"><span>إجمالي مشترياته</span><strong>'+money(round(t2))+'</strong></div><div class="tile"><span>اللي دفعه بعدين</span><strong>'+money(cs.paid)+'</strong></div><div class="tile"><span>الرصيد</span><strong>'+cb2[0]+'</strong></div>';
    $('#cud-owner').hidden = !isOwner();
    var en = (c.entries||[]).slice().sort(function(a,b){ return b.ts-a.ts; });
    $('#cud-ledger').innerHTML = en.length ? en.map(function(e){
      var btn = isOwner() ? '<div class="lg-btns"><button type="button" class="btn danger sm" data-act="delcent" data-eid="'+esc(e.id)+'">'+(pendingCEnt===e.id?'متأكد؟ اضغط تاني':'مسح')+'</button></div>' : '';
      var h;
      if(e.type==='sale') h = '<strong>فاتورة آجل '+(e.no?'#'+e.no:'')+' — '+money(e.total)+'</strong><span class="pmeta">دفع '+money(e.paid||0)+' · عليه '+money(round(e.total-(e.paid||0)))+'</span>';
      else if(e.type==='debt') h = '<strong>دين قديم '+money(e.amount)+'</strong>'+(e.note?'<span class="pmeta">'+esc(e.note)+'</span>':'');
      else h = '<strong>دفعة '+money(e.amount)+'</strong>'+(e.note?'<span class="pmeta">'+esc(e.note)+'</span>':'');
      return '<li class="ledger-row"><div class="lg-main">'+h+'<span class="when">'+dt(e.ts)+'</span></div>'+btn+'</li>';
    }).join('') : '<li class="note">مفيش حركات حساب لسه.</li>';
    $('#cud-inv').innerHTML = inv2.length ? inv2.map(function(s){ return invRow(s,false); }).join('') : '<li class="note">مفيش فواتير لسه.</li>';
  }
}
var pendingCEnt = null;
function addCEntry(c,e){ putCustomer(Object.assign({},c,{entries:(c.entries||[]).concat([Object.assign({id:uid(),ts:Date.now(),by:(sess?sess.name:'')},e)])})); }
$('#cp-form').addEventListener('submit',function(e){
  e.preventDefault(); var c = selCust ? customers.get(selCust) : null; if(!c || !isOwner() || !ready()) return;
  var a = parseFloat($('#cp-amount').value); if(!(a>0)){ toast('اكتب مبلغ الدفعة',true); return; }
  addCEntry(c,{type:'payment',amount:round(a),note:$('#cp-note').value.trim()});
  logA('cust','دفعة من '+c.name+': '+money(a)); $('#cp-form').reset(); toast('اتسجلت الدفعة'); render();
});
$('#cdb-form').addEventListener('submit',function(e){
  e.preventDefault(); var c = selCust ? customers.get(selCust) : null; if(!c || !isOwner() || !ready()) return;
  var a = parseFloat($('#cd-amount').value); if(!(a>0)){ toast('اكتب مبلغ الدين',true); return; }
  addCEntry(c,{type:'debt',amount:round(a),note:$('#cd-note').value.trim()});
  logA('cust','دين قديم على '+c.name+': '+money(a)); $('#cdb-form').reset(); toast('اتسجل الدين'); render();
});
$('#cust').addEventListener('change',function(){ $('#paid-row').hidden = !$('#cust').value; if(!$('#cust').value) $('#paid').value = ''; });
function addCustomer(name,phone){
  var c = {id:uid(),name:name,phone:phone||'',created:Date.now()};
  logA('cust','ضاف عميل: '+name);
  putCustomer(c);
  return c;
}
$('#cform').addEventListener('submit',function(e){
  e.preventDefault();
  if(!ready()) return;
  var name = $('#cu-name').value.trim();
  if(!name){ toast('اكتب اسم العميل',true); $('#cu-name').focus(); return; }
  var dup = Array.from(customers.values()).some(function(x){ return x.name===name && x.phone===$('#cu-phone').value.trim(); });
  if(dup){ toast('العميل ده متسجل قبل كده',true); return; }
  var c = addCustomer(name,$('#cu-phone').value.trim());
  $('#cform').reset(); toast('اتضاف العميل: '+name); selCust = c.id; render();
});
$('#cu-q').addEventListener('input',function(e){ custQ = e.target.value; renderCust(); });
document.addEventListener('click',function(e){
  var b = e.target.closest('[data-act]'); if(!b) return;
  var act = b.dataset.act;
  if(act==='opencust'){ selCust = b.dataset.id; pendingCEnt = null; render(); }
  else if(act==='delcent'){
    var cx = selCust ? customers.get(selCust) : null; if(!cx || !isOwner()) return;
    if(pendingCEnt!==b.dataset.eid){ pendingCEnt = b.dataset.eid; render(); return; }
    pendingCEnt = null; logA('cust','مسح حركة حساب عميل: '+cx.name);
    putCustomer(Object.assign({},cx,{entries:(cx.entries||[]).filter(function(e2){ return e2.id!==b.dataset.eid; })})); toast('اتمسحت الحركة'); render();
  }
  else if(act==='custback'){ selCust = null; render(); }
  else if(act==='newcust-sale'){
    if(!ready()) return;
    var n = window.prompt('اسم العميل:'); n = n ? n.trim() : ''; if(!n) return;
    var ph = window.prompt('التليفون (اختياري):') || '';
    var c = addCustomer(n,ph.trim()); renderCustSel(); $('#cust').value = c.id; toast('اتضاف العميل: '+n);
  }
  else if(act==='editcust'){
    var cc = selCust ? customers.get(selCust) : null; if(!cc || !isOwner()) return;
    var nn = window.prompt('اسم العميل:',cc.name); if(nn===null) return; nn = nn.trim(); if(!nn){ toast('الاسم مينفعش يبقى فاضي',true); return; }
    var pp = window.prompt('التليفون:',cc.phone||''); if(pp===null) return;
    logA('cust','تعديل عميل: '+cc.name+' ← '+nn);
    putCustomer(Object.assign({},cc,{name:nn,phone:pp.trim()})); toast('اتحفظ'); render();
  }
  else if(act==='delcust'){
    var dc = selCust ? customers.get(selCust) : null; if(!dc || !isOwner()) return;
    if(!window.confirm('مسح العميل '+dc.name+'؟ فواتيره هتفضل زي ما هي.')) return;
    logA('cust','مسح عميل: '+dc.name); removeCustomer(dc.id); selCust = null; toast('اتمسح العميل'); render();
  }
});

/* اختيار وحدة الصنف: لو وحدة جاية من استيراد وغير موجودة في القايمة بتتضاف */
function setUnitSel(u){
  var s = $('#f-unit'); if(!s) return;
  if(u && !Array.prototype.some.call(s.options,function(o){ return o.value===u; })){ var o = document.createElement('option'); o.textContent = u; s.appendChild(o); }
  s.value = u||'';
}

  /* ---------- بداية ---------- */
  function startLocal(){
    /* على رابط منشور التطبيق دايما سحابي، حتى لو fb.js اتحجب أو اتشال */
    if(!window.CLOUD_ON && /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.CLOUD_ON = true;
    /* السحابي: البيانات بتيجي من السيرفر بعد التحقق من الاشتراك. الوضع المحلي: من الجهاز */
    mode = window.CLOUD_ON ? 'pending' : 'local';
    if(!window.CLOUD_ON) lsLoad();
    secLoad(); if(window.CLOUD_ON){ aud = []; audBase = ''; audBaseN = 0; } else audLoad(); render();
    if(window.CLOUD_ON){ cloudStart(); } else { licenseStart(); gate(); }
  }
  function startDb(c){
    db = c; mode = 'db'; sess = {role:'owner',id:'owner',name:'المالك'}; hideLock();
    var fail = function(err){ toast('مشكلة في الاتصال بالبيانات: '+((err&&err.message)||''),true); };
    db.collection('products').onSnapshot(function(snap){
      var m = new Map();
      snap.docs.forEach(function(d){ var v = d.data(); if(v) m.set(d.id,Object.assign({},v,{id:d.id})); });
      products = m; render();
    },fail);
    db.collection('sales').orderBy('ts','desc').limit(1000).onSnapshot(function(snap){
      sales = snap.docs.map(function(d){ return Object.assign({},d.data(),{id:d.id}); });
      render();
    },fail);
    db.collection('suppliers').onSnapshot(function(snap){
      var m = new Map();
      snap.docs.forEach(function(d){ var v = d.data(); if(v) m.set(d.id,Object.assign({},v,{id:d.id})); });
      suppliers = m; render();
    },fail);
    db.collection('customers').onSnapshot(function(snap){
      var m = new Map();
      snap.docs.forEach(function(d){ var v = d.data(); if(v) m.set(d.id,Object.assign({},v,{id:d.id})); });
      customers = m; render();
    },fail);
    render();
  }
  render();
  loadShopCfg();
  initIdle();
  setInterval(licenseCheck,60000);
  focusQ();
  var dbReq = null;
  try{ dbReq = window.claude ? window.claude.use('db') : null; }catch(e){ dbReq = null; }
  if(dbReq && dbReq.then){
    dbReq.then(function(c){ if(c) startDb(c); else startLocal(); }, function(){ startLocal(); });
  } else {
    startLocal();
  }

/* تلميح الكراتين: عدد الكراتين × القطع في الكرتونة */
(function(){
  function hint(){
    var pk = parseInt($('#f-pack').value,10), c = parseFloat($('#f-ctn').value), h = $('#f-ctn-hint');
    h.textContent = (pk>1 && c>0) ? ('= '+fmt(round(c*pk))+' قطعة هتتضاف') : '';
  }
  $('#f-pack').addEventListener('input',hint); $('#f-ctn').addEventListener('input',hint);
})();