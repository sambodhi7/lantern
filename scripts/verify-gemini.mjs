import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import sharp from 'sharp';
import { VerificationService } from '../bridge/verification.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
process.loadEnvFile(join(root,'bridge','.env.local'));
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="900"><rect width="1000" height="900" fill="white"/><g fill="black" font-family="Arial" font-size="32"><text x="60" y="80">SYNTHETIC TEST RECEIPT</text><text x="60" y="150">Supplier: Demo Water Supplies</text><text x="60" y="215">Invoice: SYNTHETIC-001</text><text x="60" y="280">Date: 26 October 2026</text><text x="60" y="350">Water pipe fittings: INR 500</text><text x="60" y="420">Total: INR 500</text><text x="60" y="510">Customer: Sample Person</text><text x="60" y="580">Email: sample@example.invalid</text><text x="60" y="650">Phone: 9990001234</text><text x="60" y="760">Not a real invoice or person.</text></g></svg>`);
const bytes=await sharp(svg).jpeg().toBuffer();
const service=new VerificationService({dataDir:join(root,'bridge','.data','gemini-smoke')});
try {
  const input={image:`data:image/jpeg;base64,${bytes.toString('base64')}`,amountInr:500,category:'Water infrastructure'};
  let result;
  if(process.argv.includes('--server')) {
    const response=await fetch('http://127.0.0.1:8787/api/trust/ngos/harbor-hands/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(190000)});
    result=await response.json(); if(!response.ok) throw new Error(result.error);
  } else result=await service.analyze('synthetic-smoke',input,null);
  console.log(JSON.stringify({live:true,model:result.model,status:result.status,privacy:result.privacy,checks:result.checks},null,2));
} catch (error) { console.error(error.message);process.exitCode=1; }
