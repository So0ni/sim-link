import { object, string } from '../../platform/errors.mjs';
const uuid = { ...string(36,36), pattern:'^[a-f0-9-]{36}$' };
export function registerCommandRoutes(app,{commands,devices,sessions,rate}) {
  const device = req => devices.authenticate(req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1]).id;
  // Accept the deprecated flag from cached clients; queuing is now unconditional.
  app.post('/api/v1/commands',{schema:{body:{...object({requestId:uuid,simId:uuid,recipient:string(40),body:string(1600),waitOffline:{type:'boolean'}}),required:['requestId','simId','recipient','body']}}},async req=>{
    sessions.write(req); rate('commands-create',30); return commands.create(req.body);
  });
  app.get('/api/v1/commands',async req=>{sessions.read(req);return commands.list();});
  app.get('/api/v1/commands/request/:id',async req=>{sessions.read(req);return commands.find(req.params.id);});
  app.post('/api/v1/commands/:id/cancel',async req=>{sessions.write(req);return commands.cancel(req.params.id);});
  app.post('/api/v1/device/send-capability',{schema:{body:object({enabled:{type:'boolean'}})}},async req=>commands.capability(device(req),req.body.enabled));
  app.post('/api/v1/device/commands/claim',{schema:{body:object({requestId:uuid})}},async req=>commands.claim(device(req),req.body.requestId));
  app.post('/api/v1/device/commands/:id/result',{schema:{body:object({claimRequestId:uuid,rejection:{type:['string','null'],enum:[null,'permission_required','sim_changed','expired','connection_changed','execution_interrupted']},parts:{type:'array',maxItems:32,items:{type:['integer','null']}},interrupted:{type:'boolean'}})}},async req=>commands.report(device(req),req.params.id,req.body));
}
