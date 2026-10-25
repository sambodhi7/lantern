import { createServer } from 'node:http';

// Point a public HTTPS tunnel at this port, never at the no-auth bridge API.
const port=Number(process.env.WEBHOOK_PORT || 8788);
const bridgePort=Number(process.env.BRIDGE_PORT || 8787);
createServer(async(req,res)=>{
  if(req.method!=='POST' || req.url!=='/webhooks/onmeta'){res.writeHead(404);return res.end('Not found');}
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>1_000_000){res.writeHead(413);return res.end('Too large');}chunks.push(chunk);}
    const response=await fetch(`http://127.0.0.1:${bridgePort}/webhooks/onmeta`,{method:'POST',headers:{'content-type':'application/json','x-onmeta-signature':String(req.headers['x-onmeta-signature']||'')},body:Buffer.concat(chunks),signal:AbortSignal.timeout(45000)});
    res.writeHead(response.status,{'content-type':'application/json'});res.end(await response.text());
  }catch{res.writeHead(502);res.end('Webhook upstream unavailable; retry');}
}).listen(port,'127.0.0.1',()=>console.log(`Webhook-only gateway: http://127.0.0.1:${port}/webhooks/onmeta`));
