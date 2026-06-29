/**
 * 指定 id の正しいサムネイルURLをDLして public/thumbnails/{id}.jpg に保存する。
 * プレースホルダ(金色WORK/ベージュ/roastbrief)と同一ハッシュ・小サイズは拒否。
 * 使い方: node scripts/place-thumb.mjs <id> <imageUrl>
 */
import https from "https"; import http from "http";
import fs from "fs"; import path from "path"; import crypto from "crypto";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dirname, "../public/thumbnails");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BAD = new Set(["bb29396b91840b2ba5e129c29f64c555","5bbace56884b362a081e835cbabce2bc","b994ce2d3b7ec1c4bafab4edcf687f0e"]);
const [,, id, url] = process.argv;
if (!id || !url) { console.log("ERR usage: <id> <url>"); process.exit(2); }
function get(u, depth=0){ return new Promise((res)=>{
  if(depth>5||!u||!u.startsWith("http")) return res(null);
  const mod=u.startsWith("https")?https:http;
  const req=mod.get(u,{headers:{"User-Agent":UA,Accept:"image/*"}},(r)=>{
    if([301,302,303,307,308].includes(r.statusCode)){req.destroy();return res(get(r.headers.location,depth+1));}
    if(r.statusCode!==200){r.resume();return res(null);}
    const ct=r.headers["content-type"]||""; if(!ct.startsWith("image/")){r.resume();return res(null);}
    const ch=[]; r.on("data",d=>ch.push(d)); r.on("end",()=>res(Buffer.concat(ch)));
  });
  req.on("error",()=>res(null)); req.setTimeout(15000,()=>{req.destroy();res(null);});
});}
const buf = await get(url);
if(!buf){ console.log("FAIL download "+id); process.exit(1); }
if(buf.length<8000){ console.log("FAIL too-small("+buf.length+"B) "+id); process.exit(1); }
const h=crypto.createHash("md5").update(buf).digest("hex");
if(BAD.has(h)){ console.log("FAIL placeholder-hash "+id); process.exit(1); }
fs.writeFileSync(path.join(DIR, id+".jpg"), buf);
console.log("OK "+id+" "+buf.length+"B "+h);
