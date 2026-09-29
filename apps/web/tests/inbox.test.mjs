import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialConversations,filterConversations,validRecipient,canSubmit,deliveryLabel} from '../src/demo/model.ts';
test('SIM and unread filters intersect without mutating source',()=>{const result=filterConversations(initialConversations,'home',true);assert.deepEqual(result.map(c=>c.id),['mobile']);assert.equal(initialConversations.find(c=>c.id==='mobile').unread,true);assert.equal(filterConversations(initialConversations,'all',true).length,3)});
test('recipient requires explicit international country code',()=>{assert.equal(validRecipient('+65 8123 4567'),true);assert.equal(validRecipient('81234567'),false);assert.equal(validRecipient('+01234'),false);assert.equal(validRecipient('+65 <script>'),false)});
test('offline, pending and empty sends cannot be submitted',()=>{assert.equal(canSubmit('Hi',true,false),true);assert.equal(canSubmit('Hi',false,false),false);assert.equal(canSubmit('Hi',true,true),false);assert.equal(canSubmit('  ',true,false),false)});
test('unknown and sent never claim delivery',()=>{assert.match(deliveryLabel('unknown'),/可能已发出/);assert.match(deliveryLabel('sent'),/暂无送达报告/);assert.equal(deliveryLabel('processing'),'正在发送')});
