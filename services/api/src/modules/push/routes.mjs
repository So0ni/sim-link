import { object, string } from '../../platform/errors.mjs';
export function registerPushRoutes(app,{push,sessions,rate}) {
  app.post('/api/v1/push/lookup',{schema:{body:object({endpoint:string(2048)})}},async req=>push.lookup(sessions.write(req),req.body.endpoint));
  app.post('/api/v1/push/jobs/:id/receipt',{schema:{body:object({
    receivedAt:{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},
    shownAt:{anyOf:[{type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER},{type:'null'}]},
  })}},async req=>{const session=sessions.write(req);rate(`push-receipt:${session.id}`,120);return push.receipt(session,req.params.id,req.body);});
  app.get('/api/v1/push',async req=>push.status(sessions.read(req)));
  app.post('/api/v1/push/subscriptions',{schema:{body:object({
    endpoint:string(2048),keys:object({p256dh:{...string(87,87),pattern:'^[A-Za-z0-9_-]+$'},auth:{...string(22,22),pattern:'^[A-Za-z0-9_-]+$'}}),
  })}},async req=>{const session=sessions.write(req);rate(`push:${session.id}`,20);return push.subscribe(session,req.body);});
  app.patch('/api/v1/push/subscriptions/:id',{schema:{body:object({previewLength:{type:'integer',minimum:0,maximum:200}})}},async req=>push.preferences(sessions.write(req),req.params.id,req.body));
  app.delete('/api/v1/push/subscriptions/:id',async req=>push.remove(sessions.write(req),req.params.id));
  app.post('/api/v1/push/subscriptions/:id/test',async req=>{const session=sessions.write(req);rate(`push-test:${session.id}`,3);return push.test(session,req.params.id);});
}
