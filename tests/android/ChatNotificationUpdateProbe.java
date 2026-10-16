package com.kub.messenger;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

public final class ChatNotificationUpdateProbe {
    static final String CHAT="00000000-0000-0000-0000-000000000001";
    static final String NOTICE="00000000-0000-0000-0000-000000000002";
    static final String MESSAGE="00000000-0000-0000-0000-000000000003";
    static final String INSTANCE="00000000-0000-0000-0000-000000000004";
    static final String USER="00000000-0000-0000-0000-000000000005";
    static final String TAG="message:chat:"+CHAT;
    static void check(boolean value,String code){if(!value)throw new AssertionError(code);}
    static final class Cards implements ChatNotificationCleanup.Cards,ChatNotificationCleanup.IntentStore {
        final Map<String,ChatNotificationCleanup.Posted> stored=new HashMap<>();
        final List<ChatNotificationCleanup.Card> visible=new ArrayList<>();
        Runnable snapshot=()->{};
        @Override public ChatNotificationCleanup.Posted read(String tag){
            ChatNotificationCleanup.Posted value=stored.get(tag);
            return value==null?null:new ChatNotificationCleanup.Posted(value.notificationId,value.messageId,value.generation);
        }
        @Override public boolean write(String tag,ChatNotificationCleanup.Posted intent){
            stored.put(tag,new ChatNotificationCleanup.Posted(intent.notificationId,intent.messageId,intent.generation));return true;
        }
        @Override public ChatNotificationCleanup.IntentStore intents(){return this;}
        @Override public List<ChatNotificationCleanup.Card> active(){snapshot.run();return new ArrayList<>(visible);}
        // Deliberately model asynchronous OS cancellation: the stale card stays visible.
        @Override public void cancel(String tag,int id){}
        ChatNotificationCleanup.Card post(String notice){
            final ChatNotificationCleanup.Card[] card={null};
            check(ChatNotificationCleanup.post(this,TAG,notice,MESSAGE,g->{
                card[0]=new ChatNotificationCleanup.Card(TAG,0,false,1,CHAT,notice,MESSAGE,g);
                visible.clear();visible.add(card[0]);
            }),"POST_CONTROL");return card[0];
        }
    }
    static boolean update(ChatNotificationCleanup.Owner owner,ChatNotificationCleanup.Card card,Cards cards,Runnable action)throws Exception{
        Method method;
        try{method=ChatNotificationCleanup.class.getDeclaredMethod("updateCurrent",ChatNotificationCleanup.Owner.class,
            ChatNotificationCleanup.Card.class,ChatNotificationCleanup.Cards.class,Runnable.class);}
        catch(NoSuchMethodException absent){throw new AssertionError("CURRENT_CARD_PUBLICATION_ENTRY_REQUIRED");}
        try{return (boolean)method.invoke(null,owner,card,cards,action);}
        catch(InvocationTargetException error){if(error.getCause() instanceof RuntimeException)throw (RuntimeException)error.getCause();throw error;}
    }
    public static void main(String[] args)throws Exception{
        String scenario=args[0];Cards cards=new Cards();
        ChatNotificationCleanup.activate(INSTANCE);
        check(ChatNotificationCleanup.bind(INSTANCE,1,USER,1),"OWNER_CONTROL");
        ChatNotificationCleanup.Owner owner=ChatNotificationCleanup.matches(INSTANCE,1,USER,1);
        ChatNotificationCleanup.Card card=cards.post(NOTICE);
        int[] calls={0};Runnable action=()->calls[0]++;
        if(scenario.equals("replacement-serialized")){
            final ChatNotificationCleanup.Card before=card;
            CountDownLatch snapshot=new CountDownLatch(1),release=new CountDownLatch(1);
            AtomicBoolean updated=new AtomicBoolean();AtomicReference<Throwable> error=new AtomicReference<>();
            cards.snapshot=()->{snapshot.countDown();try{check(release.await(3,TimeUnit.SECONDS),"RELEASE_CONTROL");}catch(InterruptedException e){throw new AssertionError(e);}};
            Thread updating=new Thread(()->{try{updated.set(update(owner,before,cards,action));}catch(Throwable e){error.set(e);}});
            Thread replacement=new Thread(()->cards.post(USER));
            updating.start();check(snapshot.await(3,TimeUnit.SECONDS),"SNAPSHOT_CONTROL");replacement.start();
            boolean blocked=false;long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
            try{
                while(replacement.isAlive()&&System.nanoTime()<until){if(replacement.getState()==Thread.State.BLOCKED){blocked=true;break;}Thread.yield();}
            }finally{release.countDown();updating.join(3000);replacement.join(3000);}
            check(blocked,"REPLACEMENT_WAITS_FOR_CURRENT_PUBLICATION");
            check(!updating.isAlive()&&!replacement.isAlive()&&error.get()==null&&updated.get()&&calls[0]==1,"SERIALIZED_PUBLICATION_COMPLETES");
            check(cards.visible.size()==1&&USER.equals(cards.visible.get(0).notificationId),"REPLACEMENT_REMAINS_LATEST");
        }else if(scenario.equals("current")){
            check(update(owner,card,cards,action),"CURRENT_CARD_UPDATED");
            check(calls[0]==1&&cards.read(TAG).generation==card.generation,"NO_NEW_GENERATION");
        }else if(scenario.equals("unknown-effect")){
            boolean unknown=false;
            try{update(owner,card,cards,()->{calls[0]++;throw new IllegalStateException("fictional");});}
            catch(IllegalStateException expected){unknown=true;}
            check(unknown&&calls[0]==1,"THROWING_PUBLICATION_NOT_REPORTED_NO_EFFECT");
        }else{
            if(scenario.equals("replaced"))cards.post(USER);
            else if(scenario.equals("durable-missing"))cards.stored.clear();
            else if(scenario.equals("durable-different"))cards.stored.put(TAG,new ChatNotificationCleanup.Posted(USER,MESSAGE,card.generation));
            else if(scenario.equals("durable-generation"))cards.stored.put(TAG,new ChatNotificationCleanup.Posted(NOTICE,MESSAGE,card.generation+1));
            else if(scenario.equals("lagging-generation")){
                ChatNotificationCleanup.Card old=card;card=cards.post(NOTICE);
                cards.visible.clear();cards.visible.add(old);
            }
            else if(scenario.equals("dismissed"))cards.visible.clear();
            else if(scenario.equals("duplicate"))cards.visible.add(card);
            else if(scenario.equals("retired"))ChatNotificationCleanup.bind(INSTANCE,2,null,2);
            else if(scenario.equals("retire-snapshot"))cards.snapshot=()->ChatNotificationCleanup.bind(INSTANCE,2,null,2);
            else if(scenario.equals("read"))ChatNotificationCleanup.reconcileRead(owner,CHAT,List.of(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)),cards);
            else if(scenario.equals("queued-read")){
                cards.visible.clear();
                check(ChatNotificationCleanup.reconcileRead(owner,CHAT,List.of(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)),cards).pending,"QUEUED_CONTROL");
                cards.visible.add(card);
            }else if(scenario.equals("read-failure")){
                final ChatNotificationCleanup.Card beforeCancel=card;
                ChatNotificationCleanup.Cards failing=new ChatNotificationCleanup.Cards(){
                    public List<ChatNotificationCleanup.Card> active(){return List.of(beforeCancel);}
                    public ChatNotificationCleanup.IntentStore intents(){return cards;}
                    public void cancel(String t,int id){throw new IllegalStateException("fictional");}
                };
                try{ChatNotificationCleanup.reconcileRead(owner,CHAT,List.of(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)),failing);}catch(IllegalStateException ignored){}
            }else if(scenario.equals("new-after-read")){
                ChatNotificationCleanup.reconcileRead(owner,CHAT,List.of(new ChatNotificationCleanup.Read(NOTICE,MESSAGE)),cards);
                card=cards.post(USER);
                check(update(owner,card,cards,action)&&calls[0]==1,"NEW_CARD_NOT_POISONED");
                System.out.println("PASS "+scenario);return;
            }else if(scenario.equals("wrong-message"))card=new ChatNotificationCleanup.Card(TAG,0,false,1,CHAT,NOTICE,USER,card.generation);
            else if(scenario.equals("legacy"))card=new ChatNotificationCleanup.Card(TAG,0,false,0,CHAT,NOTICE,MESSAGE,card.generation);
            else if(scenario.equals("summary"))card=new ChatNotificationCleanup.Card(TAG,0,true,1,CHAT,NOTICE,MESSAGE,card.generation);
            else throw new AssertionError("UNKNOWN_SCENARIO");
            check(!update(owner,card,cards,action)&&calls[0]==0,"STALE_OR_READ_CARD_NOT_UPDATED");
        }
        System.out.println("PASS "+scenario);
    }
}
