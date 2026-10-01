import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialConversations,filterConversations,validRecipient,canSubmit,deliveryLabel} from '../src/demo/model.ts';
test('SIM and unread filters intersect without mutating source',()=>{const result=filterConversations(initialConversations,'home',true);assert.deepEqual(result.map(c=>c.id),['mobile']);assert.equal(initialConversations.find(c=>c.id==='mobile').unread,true);assert.equal(filterConversations(initialConversations,'all',true).length,3)});
test('recipient requires explicit international country code',()=>{assert.equal(validRecipient('+65 8123 4567'),true);assert.equal(validRecipient('81234567'),false);assert.equal(validRecipient('+01234'),false);assert.equal(validRecipient('+65 <script>'),false)});
test('offline, pending and empty sends cannot be submitted',()=>{assert.equal(canSubmit('Hi',true,false),true);assert.equal(canSubmit('Hi',false,false),false);assert.equal(canSubmit('Hi',true,true),false);assert.equal(canSubmit('  ',true,false),false)});
test('unknown and sent never claim delivery',()=>{assert.match(deliveryLabel('unknown'),/可能已发出/);assert.match(deliveryLabel('sent'),/暂无送达报告/);assert.equal(deliveryLabel('processing'),'正在发送')});

import {conversationTime} from '../src/shared/ui/time.ts';
test('conversation times follow relative thresholds and preserve detail clock',()=>{
 const now=new Date(2026,9,1,18,0).getTime();
 assert.equal(conversationTime(now-59000,now),'刚刚');
 assert.equal(conversationTime(now-60000,now),'1 分钟前');
 assert.equal(conversationTime(now-3600000,now),'1 小时前');
 assert.equal(conversationTime(now-3*3600000,now,true),'3 小时前 · 15:00');
 assert.equal(conversationTime(now-6*3600000,now),'12:00');
 assert.equal(conversationTime(new Date(2026,8,30,20,35).getTime(),now),'昨天 20:35');
 assert.equal(conversationTime(now-24*3600000,now),'9月30日');
 assert.equal(conversationTime(now-24*3600000,now,true),'9月30日 18:00');
 assert.equal(conversationTime(new Date(2025,8,28,14,35).getTime(),now,true),'2025年9月28日 14:35');
 assert.equal(conversationTime(now+60000,now),'10月1日 18:01');
 assert.equal(conversationTime(NaN,now),'时间未知');
});
test('relative labels age without new messages and handle calendar year boundaries',()=>{
 const at=new Date(2025,11,31,20,0).getTime();
 assert.equal(conversationTime(at,at+5*3600000),'5 小时前');
 assert.equal(conversationTime(at,at+6*3600000),'昨天 20:00');
 assert.equal(conversationTime(at,at+24*3600000),'2025年12月31日');
});
