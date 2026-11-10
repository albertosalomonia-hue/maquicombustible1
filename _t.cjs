const r=require('./backend/routes/kardex.js');
const capa=r.capas.find(l=>l.metodo==='GET'&&l.patron.regex.test('/cuadre'));
const h=capa.fns[capa.fns.length-1];
(async()=>{for(const q of [{}, {fecha_desde:'2026-01-01',fecha_hasta:'2026-01-31'}, {fecha_desde:'2026-02-01',fecha_hasta:'2026-02-28'},{fecha_desde:'2026-01-01',fecha_hasta:'2026-12-31',almacen_id:'7'}]){
 await h({query:q},{json:d=>console.log(JSON.stringify(q),JSON.stringify(d)),status:c=>({json:e=>console.log('ERR',c,e)})});}
 process.exit(0)})();
