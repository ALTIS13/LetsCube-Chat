import assert from "node:assert/strict";
import test from "node:test";
import {messageActionKind,desktopMessageActions,phoneMessageActions} from "../../artifacts/kub/src/lib/messageActions.ts";

test("cold object-backed media keeps its actual kind and visible save actions without a temporary URL",()=>{
  const can={reply:true,edit:false,pin:false,forward:false,delete:false,select:true,retry:false,editFailed:false,discard:false};
  for(const [type,kind] of [["image","photo"],["video","video"],["audio","voice"],["file","file"]] as const){
    const cold={type,media_url:null,media_bucket:"chat-media",media_path:"synthetic/original.png"};
    assert.equal(messageActionKind(cold),kind);
    const context={kind:messageActionKind(cold),own:false,localSend:false,failed:false,pinned:false,hasText:false,captionEditable:false,can};
    assert.ok(desktopMessageActions(context).includes("saveAs"));
    if(type==="image"||type==="video")assert.ok(phoneMessageActions(context).list.includes("saveAs"));
    assert.equal(messageActionKind({...cold,media_bucket:null}),"text");
    assert.equal(messageActionKind({...cold,media_path:""}),"text");
  }
});
