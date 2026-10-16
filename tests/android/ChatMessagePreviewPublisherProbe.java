package com.kub.messenger;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import com.google.firebase.messaging.RemoteMessage;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

public final class ChatMessagePreviewPublisherProbe {
    static final String CHAT="00000000-0000-4000-8000-000000000001", NOTICE="00000000-0000-4000-8000-000000000002";
    static final String MESSAGE="00000000-0000-4000-8000-000000000003", INSTANCE="00000000-0000-4000-8000-000000000004";
    static final String USER="00000000-0000-4000-8000-000000000005", OTHER="00000000-0000-4000-8000-000000000006";
    static final String TAG="message:chat:"+CHAT;
    static final String GENERIC="\u041d\u043e\u0432\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435";
    static final long NOW=1_792_108_800_000L;
    static void check(boolean value,String code){if(!value)throw new AssertionError(code);}
    static final class Manager extends NotificationManager {
        int sent; boolean unavailable,unknown,duplicate,keepCancelled,failNotify;
        Notification delivered; Runnable snapshot=()->{};
        @Override public synchronized void notify(String tag,int id,Notification n){
            sent++;delivered=n;super.notify(tag,id,n);if(failNotify)throw new IllegalStateException("fictional notify uncertainty");
        }
        @Override public synchronized StatusBarNotification[] getActiveNotifications(){
            snapshot.run();if(unavailable)throw new IllegalStateException("fictional snapshot unavailable");if(unknown)return null;
            StatusBarNotification[] rows=super.getActiveNotifications();return duplicate?new StatusBarNotification[]{rows[0],rows[0]}:rows;
        }
        @Override public synchronized void cancel(String tag,int id){if(!keepCancelled)super.cancel(tag,id);}
    }
    static void post(Context context,String notice){
        Map<String,String> data=new HashMap<>();data.put("native_chat_v","1");data.put("type","message");
        data.put("chat_id",CHAT);data.put("message_id",MESSAGE);data.put("notification_id",notice);
        data.put("tag",TAG);data.put("group_tag",TAG);data.put("preview","Fictional provider text must not be used");
        ChatPushNotifications.receive(context,new RemoteMessage(data));
    }
    static ChatNotificationCleanup.Card card(Notification n){return new ChatNotificationCleanup.Card(TAG,0,
        (n.flags&Notification.FLAG_GROUP_SUMMARY)!=0,n.extras.getInt(ChatNotificationCleanup.EXTRA_VERSION,0),
        n.extras.getString(ChatNotificationCleanup.EXTRA_CHAT),n.extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION),
        n.extras.getString(ChatNotificationCleanup.EXTRA_MESSAGE),n.extras.getLong(ChatNotificationCleanup.EXTRA_GENERATION,0));}
    static MessagePreviewContent content(String recipient,String notice,String chat,String message,String level){
        Map<String,Object> row=new HashMap<>();row.put("preview_v",1);row.put("recipient_id",recipient);row.put("session_id",INSTANCE);
        row.put("device_id",OTHER);row.put("notification_id",notice);row.put("chat_id",chat);row.put("message_id",message);
        row.put("preview_level",level);row.put("sender_name","Fictional Sender");row.put("title","Fictional Sender");
        row.put("body",level.equals("sender")?GENERIC:"Fictional readable body");row.put("expires_at",Instant.ofEpochMilli(NOW+10_000).toString());
        MessagePreviewContent result=MessagePreviewContent.parse(List.of(row),recipient,INSTANCE,OTHER,notice,chat,message,level,NOW);
        check(result!=null,"CONTENT_CONTROL");return result;
    }
    static boolean publish(Context context,Manager manager,ChatNotificationCleanup.Owner owner,ChatNotificationCleanup.Card card,
            MessagePreviewContent content,LongSupplier clock)throws Exception{
        Method method;
        try{method=Class.forName("com.kub.messenger.ChatMessagePreviewPublisher").getDeclaredMethod("publish",Context.class,
            NotificationManager.class,ChatNotificationCleanup.Owner.class,ChatNotificationCleanup.Card.class,MessagePreviewContent.class,LongSupplier.class);}
        catch(ClassNotFoundException|NoSuchMethodException missing){throw new AssertionError("NATIVE_CARD_PUBLISHER_ENTRY_REQUIRED");}
        method.setAccessible(true);
        try{return (Boolean)method.invoke(null,context,manager,owner,card,content,clock);}
        catch(InvocationTargetException failure){if(failure.getCause() instanceof RuntimeException)throw (RuntimeException)failure.getCause();throw failure;}
    }
    static void field(MessagePreviewContent content,String name,Object value)throws Exception{
        var field=MessagePreviewContent.class.getDeclaredField(name);field.setAccessible(true);field.set(content,value);
    }
    public static void main(String[] args)throws Exception{
        String scenario=args[0];Context context=new Context();Manager manager=new Manager();Context.manager=manager;
        if(scenario.equals("api24"))Build.VERSION.SDK_INT=24;
        ChatNotificationCleanup.activate(INSTANCE);check(ChatNotificationCleanup.bind(INSTANCE,1,USER,1),"OWNER_CONTROL");
        ChatNotificationCleanup.Owner owner=ChatNotificationCleanup.matches(INSTANCE,1,USER,1);
        post(context,NOTICE);Notification original=manager.cards.get(TAG+":0").getNotification();
        original.extras.putString("fictional.keep","preserved");
        ChatNotificationCleanup.Card expected=card(original);PendingIntent routing=original.contentIntent;
        final Context ownedContext=context;final Manager ownedManager=manager;
        Map<String,String> intentData=new HashMap<>(routing.data);Bundle extras=new Bundle(original.extras);
        long when=original.when,generation=expected.generation;String channel=original.getChannelId();
        MessagePreviewContent projection=content(USER,NOTICE,CHAT,MESSAGE,scenario.equals("sender")?"sender":"message");
        long[] now={NOW};LongSupplier clock=()->now[0];manager.sent=0;boolean positive=false;
        if(scenario.equals("identity")){
            for(String name:new String[]{"recipient","notification","chat","message"}){
                var f=MessagePreviewContent.class.getDeclaredField(name);
                check(java.lang.reflect.Modifier.isFinal(f.getModifiers()),"IMMUTABLE_CONTENT_IDENTITY");
                check(f.get(projection).equals(Map.of("recipient",USER,"notification",NOTICE,"chat",CHAT,"message",MESSAGE).get(name)),"VALIDATED_CONTENT_IDENTITY");
            }
            System.out.println("PASS "+scenario);return;
        }
        switch(scenario){
            case "message":case "sender":case "api24":positive=true;break;
            case "recipient":projection=content(OTHER,NOTICE,CHAT,MESSAGE,"message");break;
            case "notification":projection=content(USER,OTHER,CHAT,MESSAGE,"message");break;
            case "chat":projection=content(USER,NOTICE,OTHER,MESSAGE,"message");break;
            case "message-id":projection=content(USER,NOTICE,CHAT,OTHER,"message");break;
            case "missing":manager.cards.clear();break;
            case "duplicate":manager.duplicate=true;break;
            case "unknown":manager.unknown=true;break;
            case "unavailable":manager.unavailable=true;break;
            case "foreign":manager.cards.get(TAG+":0").packageName="fictional.other.app";break;
            case "retired":ChatNotificationCleanup.bind(INSTANCE,2,null,2);break;
            case "retire-snapshot":manager.snapshot=()->ChatNotificationCleanup.bind(INSTANCE,2,null,2);break;
            case "replaced":post(context,OTHER);manager.sent=0;break;
            case "read":manager.keepCancelled=true;ChatNotificationsPlugin.reconcileRead(context,manager,owner,CHAT,
                List.of(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)));break;
            case "retire-build":Notification.Builder.onRecover=()->ChatNotificationCleanup.bind(INSTANCE,2,null,2);break;
            case "read-build":manager.keepCancelled=true;Notification.Builder.onRecover=()->ChatNotificationsPlugin.reconcileRead(ownedContext,ownedManager,
                ChatNotificationCleanup.matches(INSTANCE,1,USER,1),CHAT,List.of(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)));break;
            case "replace-build":Notification.Builder.onRecover=()->{post(ownedContext,OTHER);ownedManager.sent=0;};break;
            case "dismiss-build":Notification.Builder.onRecover=()->ownedManager.cards.clear();break;
            case "route-build":Notification.Builder.onRecover=()->original.contentIntent=new PendingIntent();break;
            case "when-build":Notification.Builder.onRecover=()->original.when++;break;
            case "channel-build":Notification.Builder.onRecover=()->original.channel="fictional-other-channel";break;
            case "expired":now[0]=NOW+10_000;break;
            case "expire-build":Notification.Builder.onRecover=()->now[0]=NOW+10_000;break;
            case "rollback-build":Notification.Builder.onRecover=()->now[0]=NOW-1;break;
            case "final-clock":clock=new LongSupplier(){int calls;public long getAsLong(){return calls++==0?NOW:NOW+10_000;}};break;
            case "future":field(projection,"expiresAt",NOW+15_001);break;
            case "unknown-level":field(projection,"level","unknown");break;
            case "null-content":projection=null;break;
            case "null-owner":owner=null;break;
            case "null-card":expected=null;break;
            case "null-manager":manager=null;break;
            case "null-context":context=null;break;
            case "null-clock":clock=null;break;
            case "bad-clock":now[0]=-1;break;
            case "overflow-clock":now[0]=Long.MAX_VALUE;break;
            case "clock-error":clock=()->{throw new IllegalStateException("fictional clock unavailable");};break;
            case "no-route":original.contentIntent=null;break;
            case "no-icon":original.icon=null;break;
            case "no-extras":original.extras=null;break;
            case "legacy":original.extras.putInt(ChatNotificationCleanup.EXTRA_VERSION,0);break;
            case "summary":original.flags|=Notification.FLAG_GROUP_SUMMARY;break;
            case "api23":Build.VERSION.SDK_INT=23;break;
            case "unknown-notify":manager.failNotify=true;break;
            default:throw new AssertionError("UNKNOWN_SCENARIO");
        }
        if(scenario.equals("unknown-notify")){
            boolean unknown=false;try{publish(context,manager,owner,expected,projection,clock);}catch(IllegalStateException correct){unknown=true;}
            check(unknown&&manager.sent==1,"NOTIFY_UNCERTAINTY_PROPAGATED_NO_RETRY");
        }else{
            boolean result=publish(context,manager,owner,expected,projection,clock);
            if(!positive)check(!result&&(manager==null||manager.sent==0),"REJECTED_WITHOUT_REPOST");
            else{
                check(result&&manager.sent==1,"EXISTING_CARD_UPDATED");Notification output=manager.delivered;
                check(output!=original&&Notification.Builder.lastRecovered!=original,"ORIGINAL_NOT_RECOVERED_IN_PLACE");
                check("Fictional Sender".equals(output.title)&&projection.body.equals(output.body)&&projection.body.equals(output.bigText)
                    &&"Fictional Sender".equals(output.bigTitle),"READABLE_BIG_TEXT");
                check(output.contentIntent==routing&&routing.data.equals(intentData),"EXACT_PENDING_INTENT_PRESERVED");
                check(output.when==when&&java.util.Objects.equals(output.getChannelId(),channel),"WHEN_CHANNEL_PRESERVED");
                check(output.extras.getInt(ChatNotificationCleanup.EXTRA_VERSION,0)==1
                    &&CHAT.equals(output.extras.getString(ChatNotificationCleanup.EXTRA_CHAT))
                    &&NOTICE.equals(output.extras.getString(ChatNotificationCleanup.EXTRA_NOTIFICATION))
                    &&MESSAGE.equals(output.extras.getString(ChatNotificationCleanup.EXTRA_MESSAGE))
                    &&"preserved".equals(output.extras.getString("fictional.keep"))
                    &&output.extras.getLong(ChatNotificationCleanup.EXTRA_GENERATION,0)==generation,"CLEANUP_GENERATION_PRESERVED");
                check(output.visibility==0&&(output.flags&8)!=0,"PRIVATE_QUIET_UPDATE");
                Notification publicCard=output.publicVersion;
                check(publicCard!=null&&"LETSCUBE".equals(publicCard.title)&&GENERIC.equals(publicCard.body)&&GENERIC.equals(publicCard.bigText)
                    &&!publicCard.extras.containsKey(ChatNotificationCleanup.EXTRA_GENERATION)
                    &&!publicCard.extras.containsKey("fictional.keep")&&publicCard.publicVersion==null,"GENERIC_PUBLIC_VERSION");
                check(publicCard.contentIntent==routing&&publicCard.when==when&&java.util.Objects.equals(publicCard.getChannelId(),channel),"PUBLIC_ROUTING_PRESERVED");
                check("LETSCUBE".equals(original.title)&&GENERIC.equals(original.body)&&original.publicVersion==null&&original.extras.equals(extras)
                    &&original.flags==0,"ORIGINAL_UNCHANGED");
                check(new ChatNotificationIntentStore(context).read(TAG).generation==generation,"NO_NEW_INTENT_GENERATION");
            }
        }
        System.out.println("PASS "+scenario);
    }
}
