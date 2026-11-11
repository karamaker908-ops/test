import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(new URL('./orders.sqlite', import.meta.url));
db.exec('CREATE TABLE IF NOT EXISTS orders (tenant TEXT, shop TEXT, plan INTEGER, payload TEXT NOT NULL, PRIMARY KEY (tenant, shop, plan))');
const page = readFileSync(new URL('./index.html', import.meta.url),'utf8');
const match = page.match(/const plans=([\s\S]*?);/);
const plans = Function('return '+match[1])();
db.exec('CREATE TABLE IF NOT EXISTS catalog (tenant TEXT, label TEXT, PRIMARY KEY (tenant,label))');
const catalog=tenant=>db.prepare('SELECT label FROM catalog WHERE tenant=? ORDER BY rowid').all(tenant).map(row=>row.label);
const keniya='케니야';
db.exec('PRAGMA foreign_keys=ON');
db.exec('CREATE TABLE IF NOT EXISTS products (tenant TEXT, id INTEGER, name TEXT NOT NULL, unit TEXT, amount REAL, PRIMARY KEY(tenant,id))');
db.exec('CREATE TABLE IF NOT EXISTS recipes (tenant TEXT, id INTEGER, name TEXT NOT NULL, size TEXT NOT NULL, variant TEXT NOT NULL, note TEXT, PRIMARY KEY(tenant,id), UNIQUE(tenant,name,size,variant))');
db.exec('CREATE TABLE IF NOT EXISTS recipe_items (tenant TEXT, recipe INTEGER, line INTEGER, product INTEGER, kind TEXT, quantity REAL CHECK(quantity>0), unit TEXT, PRIMARY KEY(tenant,recipe,line), FOREIGN KEY(tenant,recipe) REFERENCES recipes(tenant,id), FOREIGN KEY(tenant,product) REFERENCES products(tenant,id))');
const seed=JSON.parse(readFileSync(new URL('./keniya-data.json',import.meta.url),'utf8'));
db.exec('BEGIN');
try {
 const product=db.prepare('INSERT OR IGNORE INTO products VALUES (?,?,?,?,?)');
 const recipe=db.prepare('INSERT OR IGNORE INTO recipes VALUES (?,?,?,?,?,?)');
 const item=db.prepare('INSERT OR IGNORE INTO recipe_items VALUES (?,?,?,?,?,?,?)');
 for(const row of seed.products)product.run(keniya,...row);
 for(const [id,name,size,variant,note,lines] of seed.recipes){
  recipe.run(keniya,id,name,size,variant,note);
  lines.forEach((line,index)=>item.run(keniya,id,index+1,...line));
 }
 db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}
const milkUnit=(tenant,p)=>tenant===keniya&&p.id===23?{...p,unit:"1L × 16개/박스"}:p;
const productsFor=tenant=>db.prepare('SELECT id,name,unit,amount FROM products WHERE tenant=? ORDER BY id').all(tenant).map(p=>milkUnit(tenant,p)).map(p=>({...p,label:p.name+(p.unit&&p.unit!=='-'?' ('+p.unit+')':'')+' [품목 '+p.id+']'}));
const accounts = new Map();
for (const [brand,tenant,index] of [['coffee','모닝빈 커피',0],['bakery','오븐데이 베이커리',1],['kennya',keniya,2]]) {
 for (const [suffix,role,shop] of [['hq','본사',null],['city','매장','시청점'],['forest','매장','성수점']]) {
  accounts.set(brand+'-'+suffix,{tenant,index,role,shop});
 }
}
const mainShop='커피랩 케니야 본점';
accounts.set('kennya-main',{tenant:keniya,index:2,role:'매장',shop:mainShop});
const mainDraft=JSON.parse(readFileSync(new URL('./main-store-draft.json',import.meta.url),'utf8'));
db.exec('CREATE TABLE IF NOT EXISTS order_drafts (tenant TEXT, shop TEXT, plan INTEGER, payload TEXT NOT NULL, PRIMARY KEY(tenant,shop,plan))');
db.prepare('INSERT OR IGNORE INTO order_drafts VALUES (?,?,?,?)').run(keniya,mainShop,2,JSON.stringify(mainDraft));
const savedMainDraft=db.prepare('SELECT payload FROM order_drafts WHERE tenant=? AND shop=? AND plan=2').get(keniya,mainShop);
const savedDraft=JSON.parse(savedMainDraft.payload);
const previousMilkLabel="서울우유_바리스타즈 (1L) [품목 23]";
if(Object.hasOwn(savedDraft.quantities,previousMilkLabel)){
 savedDraft.quantities["서울우유_바리스타즈 (1L × 16개/박스) [품목 23]"]=Math.ceil(savedDraft.quantities[previousMilkLabel]/16);
 delete savedDraft.quantities[previousMilkLabel];
 db.prepare('UPDATE order_drafts SET payload=? WHERE tenant=? AND shop=? AND plan=2 AND payload=?').run(JSON.stringify(savedDraft),keniya,mainShop,savedMainDraft.payload);
}
const password = Buffer.from(process.env.ORDER_DESK_PASSWORD || randomBytes(9).toString('base64url'));
const sessions = new Map();
const desktop = process.argv.includes('--desktop');
const port = desktop ? 0 : Number(process.env.ORDER_DESK_PORT || 8787);
let host = '127.0.0.1:'+port;
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){
 let raw='';
 for await(const chunk of req){raw+=chunk;if(raw.length>8192)throw Error('요청이 너무 큽니다.');}
 return JSON.parse(raw);
}
const server = http.createServer(async(req,res)=>{
 try {
  if(req.headers.host!==host)return json(res,403,{error:'잘못된 호스트입니다.'});
  if(req.method==='POST'&&(req.headers.origin!=='http://'+host||!req.headers['content-type']?.startsWith('application/json')))return json(res,403,{error:'허용되지 않은 요청입니다.'});
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(page);}
  const token=req.headers.cookie?.match(/(?:^|; *)sid=([a-f0-9]+)/)?.[1];
  if(req.method==='POST'&&req.url==='/login'){
   const input=await body(req), account=accounts.get(input.user), candidate=Buffer.from(String(input.password??''));
   if(!account||candidate.length!==password.length||!timingSafeEqual(candidate,password))return json(res,401,{error:'계정 또는 비밀번호를 확인하세요.'});
   sessions.delete(token);
   const id=randomBytes(32).toString('hex');
   sessions.set(id,{...account,expires:Date.now()+28800000});
   res.setHeader('Set-Cookie','sid='+id+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800');
   return json(res,200,{ok:true});
  }
  const account=sessions.get(token);
  if(!account||account.expires<=Date.now()){sessions.delete(token);return json(res,401,{error:'로그인하세요.'});}
  if(req.method==='POST'&&req.url==='/logout'){
   sessions.delete(token);res.setHeader('Set-Cookie','sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
   return json(res,200,{ok:true});
  }
  if(req.method==='POST'&&req.url==='/catalog'){
   if(account.shop)return json(res,403,{error:'본사 계정으로 등록하세요.'});
   const {name,unit}=await body(req);
   if(typeof name!=='string'||typeof unit!=='string'||!name.trim()||!unit.trim()||name.length>80||unit.length>40)return json(res,400,{error:'품목명과 주문 단위를 확인하세요.'});
   const result=db.prepare('INSERT OR IGNORE INTO catalog VALUES (?,?)').run(account.tenant,name.trim()+' ('+unit.trim()+')');
   return result.changes?json(res,201,{ok:true}):json(res,409,{error:'이미 등록된 품목입니다.'});
  }
  if(req.method==='GET'&&req.url==='/state'){
   const {tenant,index,role,shop}=account;
   const rows=shop?db.prepare('SELECT * FROM orders WHERE tenant=? AND shop=?').all(tenant,shop):db.prepare('SELECT * FROM orders WHERE tenant=?').all(tenant);
   return json(res,200,{tenant,index,role,shop,shops:tenant===keniya?['시청점','성수점',mainShop]:['시청점','성수점'],draft:shop===mainShop?JSON.parse(db.prepare('SELECT payload FROM order_drafts WHERE tenant=? AND shop=? AND plan=2').get(tenant,shop).payload):null,products:productsFor(tenant),catalog:catalog(tenant),records:Object.fromEntries(rows.map(row=>[JSON.stringify([tenant,row.shop,row.plan,plans[row.plan].cut]),JSON.parse(row.payload)]))});
  }
  if(req.method==='POST'&&req.url==='/draft'){
   const {tenant,shop}=account;
   if(!shop||tenant!==keniya)return json(res,403,{error:'케니야 가맹점 계정이 필요합니다.'});
   const {i,sales}=await body(req);
   if(!Number.isInteger(i)||!plans[i]||!Array.isArray(sales)||!sales.length||sales.length>200)return json(res,400,{error:'판매 내역 또는 주문 회차를 확인하세요.'});
   if(db.prepare('SELECT 1 FROM orders WHERE tenant=? AND shop=? AND plan=?').get(tenant,shop,i))return json(res,409,{error:'이미 제출한 회차입니다.'});
   const find=db.prepare('SELECT id FROM recipes WHERE tenant=? AND name=? AND size=? AND variant=?');
   const ingredients=db.prepare('SELECT product, quantity FROM recipe_items WHERE tenant=? AND recipe=?');
   const usage=new Map(), unmatched=[];
   for(const row of sales){
    if(!Array.isArray(row)||row.length!==4||!row.slice(0,3).every(v=>typeof v==='string')||!Number.isInteger(row[3])||row[3]<1||row[3]>100000)return json(res,400,{error:'상품명, 사이즈, 구분, 판매수량을 확인하세요.'});
    const [name,size,variant,count]=row;
    const recipe=find.get(tenant,name,size,variant);
    if(!recipe){unmatched.push(row);continue;}
    for(const line of ingredients.all(tenant,recipe.id))usage.set(line.product,(usage.get(line.product)||0)+line.quantity*count);
   }
   const sizes=JSON.parse(readFileSync(new URL('./order-pack-sizes.json',import.meta.url),'utf8'));
   const suggestions=productsFor(tenant).filter(p=>usage.has(p.id)).map(p=>{
    const used=usage.get(p.id), pack=sizes[p.id];
    return {label:p.label,used,pack,count:p.amount!==null&&pack>0?Math.ceil(Number((used/pack).toPrecision(14))):null};
   });
   return json(res,200,{suggestions,unmatched});
  }
  if(req.method==='POST'&&req.url==='/orders'){
   const {tenant,index,shop}=account;
   if(!shop)return json(res,403,{error:'매장 계정으로 제출하세요.'});
   const {i,skip,quantities}=await body(req);
   const plan=Number.isInteger(i)&&plans[i];
   if(!plan||(i===2&&shop!==mainShop)||typeof skip!=='boolean')return json(res,400,{error:'잘못된 일정입니다.'});
   let items=[];
   if(!skip){
    const names=new Set([...(plan.items[index]||[]),...catalog(tenant),...productsFor(tenant).filter(p=>p.amount!==null).map(p=>p.label)]);
    if(!quantities||typeof quantities!=='object'||Array.isArray(quantities))return json(res,400,{error:'수량을 확인하세요.'});
    items=Object.entries(quantities);
    if(!items.length||!items.every(([name,q])=>names.has(name)&&Number.isInteger(q)&&q>0&&q<=9999))return json(res,400,{error:'품목과 수량을 확인하세요.'});
   }
   const at=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date());
   const payload={at,status:skip?'주문 없음 확인':'주문 제출',items};
   const result=db.prepare('INSERT OR IGNORE INTO orders VALUES (?,?,?,?)').run(tenant,shop,i,JSON.stringify(payload));
   return result.changes?json(res,201,{ok:true}):json(res,409,{error:'이미 처리된 일정입니다.'});
  }
  json(res,404,{error:'페이지를 찾을 수 없습니다.'});
 }catch(error){if(error instanceof SyntaxError||error.message==='요청이 너무 큽니다.')return json(res,400,{error:'요청 데이터를 확인하세요.'});console.error(error);json(res,500,{error:'서버 오류가 발생했습니다.'});}
});
server.listen(port,'127.0.0.1',()=>{
 host='127.0.0.1:'+server.address().port;
 const url='http://'+host+'/';
 console.log(url+' | 데모 비밀번호: '+password.toString());
 if(desktop){
  console.log('본점: kennya-main | 본사: kennya-hq');
  console.log('사용하는 동안 이 창을 열어두세요.');
  const browser=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
  browser.on('error',()=>console.log('브라우저 주소창에서 위 주소를 열어주세요.'));
 }
});


