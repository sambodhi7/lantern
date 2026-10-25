import { fileURLToPath } from 'node:url';
const env=fileURLToPath(new URL('../bridge/.env.local',import.meta.url));
process.loadEnvFile(env);
const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':process.env.GEMINI_API_KEY},signal:AbortSignal.timeout(15000)});
const body=await response.json();
console.log(JSON.stringify({status:response.status,errorCode:body.error?.status,models:body.models?.filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name)},null,2));
const probe=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}:generateContent`,{method:'POST',headers:{'x-goog-api-key':process.env.GEMINI_API_KEY,'content-type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:'Return only the JSON object {"ok":true}'}]}],generationConfig:{responseMimeType:'application/json'}}),signal:AbortSignal.timeout(20000)});
const result=await probe.json();
console.log(JSON.stringify({generationStatus:probe.status,errorCode:result.error?.status,message:result.error?.message?.replaceAll(process.env.GEMINI_API_KEY,'[hidden]'),text:result.candidates?.[0]?.content?.parts?.map(p=>p.text).join('')},null,2));
