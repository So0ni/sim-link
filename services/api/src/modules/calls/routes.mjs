import { object, string } from '../../platform/errors.mjs';
const integer = {type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const nullable = schema => ({anyOf:[schema,{type:'null'}]});
export function registerCallsRoutes(app,{calls,devices,sessions}) {
  const device=req=>devices.authenticate(req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1]);
  app.post('/api/v1/device/calls',{schema:{body:object({eventId:string(128),number:nullable(string(256)),
    outcome:{type:'string',enum:['missed','incoming','rejected','blocked']},startedAt:integer,durationSeconds:{...integer,maximum:31536000},
    simKey:nullable({...string(36,36),pattern:'^[a-f0-9-]{36}$'})})}},async req=>{
      const dev=device(req);const ack=calls.receive(dev,req.body);devices.heartbeat(dev.id);return ack;
    });
  app.post('/api/v1/device/calls/status',{schema:{body:object({enabled:{type:'boolean'},permission:{type:'boolean'},checkedAt:nullable(integer),pending:integer})}},async req=>calls.report(device(req),req.body));
  app.get('/api/v1/calls/status',async req=>{sessions.read(req);return calls.status();});
  app.get('/api/v1/calls',async req=>{sessions.read(req);return calls.list(req.query.before);});
  app.get('/api/v1/calls/:id',async req=>{sessions.read(req);return calls.get(req.params.id);});
  app.post('/api/v1/calls/:id/view',async req=>{sessions.write(req);return calls.view(req.params.id);});
}
