package dev.simlink.gateway
import dev.simlink.gateway.commands.*
import org.junit.Assert.*
import org.junit.Test
class CommandExecutorTest {
 @Test fun reportedOrFinishedClaimsNeverExecute() {
  assertTrue(mayExecuteClaim("claimed",0));assertTrue(mayExecuteClaim("unknown",0))
  assertFalse(mayExecuteClaim("unknown",1));assertFalse(mayExecuteClaim("sent",0));assertFalse(mayExecuteClaim("rejected",0))
 }
 @Test fun reserveSurvivesRestartAndBoundaryFailure() {
  var reserved=false;var calls=0
  fun engine()=CommandExecutor({if(reserved)false else {reserved=true;true}},{null},{error("unexpected rejection")},{calls++;throw IllegalStateException("boundary")})
  runCatching{engine().run()};engine().run();assertEquals(1,calls)
 }
 @Test fun expiryPermissionSimAndGenerationRejectBeforeCellular() {
  val reasons=listOf(executionRejection(true,true,true,0),executionRejection(false,true,true,100),executionRejection(true,true,false,100),executionRejection(true,false,true,100))
  assertEquals(listOf("expired","permission_required","sim_changed","connection_changed"),reasons)
  reasons.forEach { reason -> var rejection:String?=null;CommandExecutor({true},{reason},{rejection=it},{error("must not send")}).run();assertEquals(reason,rejection) }
  assertNull(executionRejection(true,true,true,1))
 }
 @Test fun rejectionIsAlsoConsumedAndNeverRetried() {
  var reserved=false;var rejected=0
  val engine=CommandExecutor({if(reserved)false else{reserved=true;true}},{"expired"},{rejected++},{error("send")})
  engine.run();engine.run();assertEquals(1,rejected)
 }
}
