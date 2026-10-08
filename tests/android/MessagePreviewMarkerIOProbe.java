package com.kub.messenger;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Looper;
import android.os.UserManager;
import android.system.Os;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.FutureTask;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

// Fictional Android metadata/dir-sync, actual Gate/codec and owned JVM file descriptors.
public final class MessagePreviewMarkerIOProbe {
    private interface Action { void run() throws Exception; }
    private static void check(boolean value, String tag) { if (!value) throw new AssertionError(tag); }
    private static void refused(Action action, String tag) throws Exception {
        try { action.run(); }
        catch (MessagePreviewAtomicBackend.MarkerUnavailable failure) {
            check("UNAVAILABLE".equals(failure.getMessage()) && failure.getCause()==null
                && failure.getStackTrace().length==0 && failure.getSuppressed().length==0,"FIXED_PRIVATE_REFUSAL");
            return;
        }
        throw new AssertionError(tag);
    }
    private static final class Worker implements AutoCloseable {
        final LinkedBlockingQueue<FutureTask<Void>> jobs = new LinkedBlockingQueue<>();
        final FutureTask<Void> stop = new FutureTask<>(() -> null);
        final Thread thread = new Thread(() -> {
            try { while (true) { FutureTask<Void> job=jobs.take(); if(job==stop) return; job.run(); } }
            catch (InterruptedException failure) { throw new AssertionError("WORKER_INTERRUPTED"); }
        });
        Worker() { thread.start(); }
        void on(Action action) throws Exception {
            FutureTask<Void> job=new FutureTask<>(() -> { action.run(); return null; }); jobs.add(job);
            try { job.get(3,TimeUnit.SECONDS); }
            catch (java.util.concurrent.ExecutionException failure) {
                if(failure.getCause() instanceof AssertionError) throw (AssertionError)failure.getCause();
                if(failure.getCause() instanceof Exception) throw (Exception)failure.getCause();
                throw new AssertionError("WORKER_FAILURE");
            }
        }
        @Override public void close() throws Exception { jobs.add(stop); thread.join(3000); check(!thread.isAlive(),"WORKER_FINISHED"); }
    }
    private static final class App extends Context {
        File root;
        final UserManager users=new UserManager();
        final ApplicationInfo info=new ApplicationInfo();
        boolean dp;
        Context application;
        Runnable onUsers;
        App(File root) { this.root=root; }
        @Override public boolean isDeviceProtectedStorage() { return dp; }
        @Override public Context getApplicationContext() { return application==null ? this : application; }
        @Override public File getNoBackupFilesDir() { return root; }
        @Override public Object getSystemService(String name) { if(onUsers!=null) onUsers.run(); return users; }
        @Override public ApplicationInfo getApplicationInfo() { return info; }
    }
    private static final class Fixture implements AutoCloseable {
        final Worker worker=new Worker();
        final App app;
        volatile Object snapshot=new Object();
        volatile long clock;
        final MessagePreviewInitializationGate gate;
        final MessagePreviewInitializationGate.Permit permit;
        final File namespace, marker;
        MessagePreviewAtomicBackend.MarkerIO io;
        MessagePreviewAtomicBackend.MarkerReservation reservation;
        Fixture(File parent) throws Exception {
            File root=Files.createTempDirectory(parent.toPath(),"owned-").toFile();
            app=new App(root); namespace=new File(root,"native-message-previews-v1"); marker=new File(namespace,"installation-v1.bin");
            gate=new MessagePreviewInitializationGate(new MessagePreviewInitializationGate.ForegroundAuthority() {
                public Object capture() { return snapshot; }
                public boolean isCurrent(Object captured) { return captured==snapshot; }
            }, () -> clock, Thread.currentThread(),worker.thread);
            permit=gate.admit(gate.capture());
            Os.events.clear(); Os.fail=null; Os.onEvent=null; Os.wrongDescriptor=false; Os.nonemptyDescriptor=false;
            Os.directoryDescriptorFault=null; Os.directoryFaultTarget=null;
        }
        void open() throws Exception { worker.on(() -> { gate.consume(permit); io=new MessagePreviewAtomicBackend.MarkerIO(app,gate,permit); }); }
        void reserve() throws Exception { worker.on(() -> reservation=io.reserve()); }
        void failed() throws Exception { failed("FAILED_RESERVATION_MUST_REFUSE"); }
        void failed(String tag) throws Exception {
            worker.on(() -> refused(() -> io.reserve(),tag));
            check(reservation==null,"NO_FALSE_RESERVATION"); Os.assertClosed();
            int effects=effects();
            Os.fail=null; Os.onEvent=null;
            worker.on(() -> refused(() -> io.reserve(),"ONE_USE_RESERVE_REQUIRED"));
            check(effects()==effects,"NO_REPLAY_EFFECTS");
        }
        int effects() { return (int)Os.events.stream().filter(e -> e.startsWith("mkdir:") || e.startsWith("open:installation-v1.bin:")).count(); }
        @Override public void close() throws Exception { Os.onEvent=null; Os.fail=null; worker.close(); }
    }
    private static void healthy(File root) throws Exception {
        Looper.getMainLooper();
        try (Worker worker=new Worker()) {
            Object snapshot=new Object();
            MessagePreviewInitializationGate gate=new MessagePreviewInitializationGate(
                new MessagePreviewInitializationGate.ForegroundAuthority() {
                    public Object capture() { return snapshot; }
                    public boolean isCurrent(Object captured) { return captured==snapshot; }
                }, () -> 0, Thread.currentThread(),worker.thread);
            MessagePreviewInitializationGate.Permit permit=gate.admit(gate.capture());
            App app=new App(root);
            worker.on(() -> {
                gate.consume(permit);
                MessagePreviewAtomicBackend.MarkerIO io=new MessagePreviewAtomicBackend.MarkerIO(app,gate,permit);
                MessagePreviewAtomicBackend.MarkerReservation result=io.reserve();
                io.requireCurrent(result);
                byte[] bytes=Files.readAllBytes(new File(root,"native-message-previews-v1/installation-v1.bin").toPath());
                check(bytes.length==28,"EXACT_28_MARKER");
                check(Arrays.equals(Arrays.copyOf(bytes,12),new byte[]{76,67,78,77,80,86,73,49,0,0,0,1}),"LITERAL_MARKER_HEADER");
                check(MessagePreviewInstallationMarker.decode(bytes).equals(result.installation),"ACTUAL_CODEC_NONCE");
                check(Os.events.contains("mkdir:448"),"MODE_0700");
                check(Os.events.contains("open:installation-v1.bin:131265:384"),"EXCLUSIVE_NOFOLLOW_0600");
                check(Os.events.contains("open:"+root.getName()+":131072:0")
                    && Os.events.contains("open:native-message-previews-v1:131072:0"),"DIRECTORY_RDONLY_NOFOLLOW");
                check(Os.events.contains("fsync:native-message-previews-v1") && Os.events.contains("fsync:"+root.getName()),"BOTH_DIRECTORY_SYNCS");
                refused(() -> io.reserve(),"ONE_USE_RESERVE_REQUIRED");
                MessagePreviewAtomicBackend.MarkerIO other=new MessagePreviewAtomicBackend.MarkerIO(app,gate,permit);
                refused(() -> other.requireCurrent(result),"PRIVATE_RESERVATION_REQUIRED");
                Os.assertClosed();
            });
        }
    }
    private static void policy(File parent) throws Exception {
        for(String kind:new String[]{"dp","locked","uid","application","root-owner","root-link"}) {
            try(Fixture f=new Fixture(parent)) {
                if(kind.equals("dp")) f.app.dp=true;
                if(kind.equals("locked")) f.app.users.unlocked=false;
                if(kind.equals("uid")) f.app.info.uid=10124;
                if(kind.equals("application")) {
                    f.app.application=new App(f.app.root); ((App)f.app.application).application=f.app;
                }
                if(kind.equals("root-owner")) Os.owners.put(f.app.root.getPath(),10124);
                if(kind.equals("root-link")) Os.types.put(f.app.root.getPath(),0120000);
                f.worker.on(() -> {
                    f.gate.consume(f.permit);
                    refused(() -> new MessagePreviewAtomicBackend.MarkerIO(f.app,f.gate,f.permit),"APP_CE_OWNER_REQUIRED");
                });
                check(f.effects()==0 && !f.namespace.exists(),"POLICY_BEFORE_MUTATION");
            }
        }
    }
    private static void absence(File parent) throws Exception {
        for(String child:new String[]{"empty","installation-v1.bin","journal-v1.bin","journal-v1.bin.new","journal-v1.bin.bak","unknown","link"}) {
            try(Fixture f=new Fixture(parent)) {
                Files.createDirectory(f.namespace.toPath());
                if(!child.equals("empty") && !child.equals("link")) Files.write(new File(f.namespace,child).toPath(),new byte[]{7});
                if(child.equals("link")) Os.types.put(f.namespace.getPath(),0120000);
                f.open(); f.failed(); check(f.effects()==0,"RAW_RESIDUE_REFUSED_BEFORE_CREATE");
            }
        }
        try(Fixture f=new Fixture(parent)) {
            f.open(); Os.fail="lstat:native-message-previews-v1"; f.failed();
            check(f.effects()==0 && !f.namespace.exists(),"ONLY_ENOENT_IS_ABSENCE");
        }
    }
    private static void permits(File parent) throws Exception {
        try(Fixture f=new Fixture(parent)) {
            f.worker.on(() -> refused(() -> new MessagePreviewAtomicBackend.MarkerIO(f.app,f.gate,f.permit),"CONSUMED_GATE_REQUIRED"));
            f.open(); refused(() -> f.io.reserve(),"EXACT_GATE_WORKER_REQUIRED");
            f.reserve();
            f.gate.invalidate();
            f.worker.on(() -> refused(() -> f.io.requireCurrent(f.reservation),"CURRENT_RESERVATION_REQUIRED"));
        }
        try(Fixture f=new Fixture(parent); Fixture other=new Fixture(parent)) {
            f.worker.on(() -> { f.gate.consume(f.permit);
                refused(() -> new MessagePreviewAtomicBackend.MarkerIO(f.app,other.gate,f.permit),"GATE_ISSUER_REQUIRED"); });
            check(f.effects()==0,"FOREIGN_BEFORE_EFFECT");
        }
    }
    private static void failures(File parent) throws Exception {
        for(String stage:new String[]{"mkdir:448","open:installation-v1.bin:131265:384","fsync:native-message-previews-v1",
            "close:native-message-previews-v1","fsync:ROOT","close:ROOT"}) {
            try(Fixture f=new Fixture(parent)) {
                f.open(); Os.fail=stage.replace("ROOT",f.app.root.getName()); f.failed();
                if(!stage.startsWith("mkdir:")) check(f.namespace.isDirectory(),"NAMESPACE_RESIDUE_RETAINED");
                if(stage.startsWith("fsync:") || stage.startsWith("close:")) check(f.marker.length()==28,"WRITTEN_RESIDUE_RETAINED");
                f.worker.on(() -> f.gate.settleFailure(f.permit));
                try { f.gate.capture(); throw new AssertionError("ATTEMPTED_EFFECT_TERMINAL"); }
                catch(MessagePreviewInitializationGate.Unavailable expected) { }
            }
        }
    }
    private static void readback(File parent) throws Exception {
        for(String kind:new String[]{"byte","truncated","trailing","extra","late-trailing"}) {
            try(Fixture f=new Fixture(parent)) {
                f.open();
                final boolean[] ready={false}; final int[] stats={0};
                Os.onEvent=e -> {
                    try {
                        if(e.equals("close:"+f.app.root.getName()) && !kind.equals("late-trailing")) {
                            byte[] bytes=Files.readAllBytes(f.marker.toPath());
                            if(kind.equals("byte")) { bytes[27]^=1; Files.write(f.marker.toPath(),bytes); }
                            if(kind.equals("truncated")) Files.write(f.marker.toPath(),Arrays.copyOf(bytes,27));
                            if(kind.equals("trailing")) Files.write(f.marker.toPath(),Arrays.copyOf(bytes,29));
                            if(kind.equals("extra")) Files.write(new File(f.namespace,"journal-v1.bin.new").toPath(),new byte[]{1});
                        }
                        if(kind.equals("late-trailing")) {
                            if(e.equals("open:installation-v1.bin:131072:0")) ready[0]=true;
                            if(ready[0] && e.equals("lstat:installation-v1.bin") && ++stats[0]==3)
                                Files.write(f.marker.toPath(),Arrays.copyOf(Files.readAllBytes(f.marker.toPath()),29));
                        }
                    } catch(Exception failure) { throw new AssertionError("FICTIONAL_MUTATION_FAILED"); }
                };
                f.failed(kind.equals("late-trailing") ? "FRESH_28_SIZE_REQUIRED" : "EXACT_MARKER_READBACK_REQUIRED");
                check(f.marker.exists(),"READBACK_FAILURE_RETAINS_MARKER");
            }
        }
    }
    private static void identities(File parent) throws Exception {
        for(String kind:new String[]{"root","namespace","marker","mode","dp","locked","uid","context","deadline"}) {
            try(Fixture f=new Fixture(parent)) {
                f.open(); f.reserve();
                if(kind.equals("root")) Os.replaceIdentity(f.app.root.getPath());
                if(kind.equals("namespace")) Os.replaceIdentity(f.namespace.getPath());
                if(kind.equals("marker")) Os.replaceIdentity(f.marker.getPath());
                if(kind.equals("mode")) Os.modes.put(f.marker.getPath(),0644);
                if(kind.equals("dp")) f.app.dp=true;
                if(kind.equals("locked")) f.app.users.unlocked=false;
                if(kind.equals("uid")) f.app.info.uid=10124;
                if(kind.equals("context")) f.app.application=new App(f.app.root);
                if(kind.equals("deadline")) f.clock=10000;
                f.worker.on(() -> refused(() -> f.io.requireCurrent(f.reservation),"CURRENT_IDENTITY_REQUIRED"));
                Os.assertClosed(); check(f.marker.exists(),"NO_RESET_AFTER_CHANGED_AUTHORITY");
            }
        }
    }
    private static void held(File parent) throws Exception {
        for(boolean afterEffect:new boolean[]{false,true}) {
            try(Fixture f=new Fixture(parent)) {
                f.open(); CountDownLatch held=new CountDownLatch(1), release=new CountDownLatch(1);
                String stage=afterEffect ? "mkdir:448" : "open:"+f.app.root.getName()+":131072:0";
                Os.onEvent=e -> { if(e.equals(stage)) {
                    held.countDown();
                    try { check(release.await(3,TimeUnit.SECONDS),"FINITE_HELD_TIMEOUT"); }
                    catch(InterruptedException failure) { throw new AssertionError("HELD_INTERRUPTED"); }
                } };
                FutureTask<Void> job=new FutureTask<>(() -> { refused(() -> f.io.reserve(),"LATE_CURRENT_REQUIRED"); return null; });
                f.worker.jobs.add(job);
                try {
                    check(held.await(3,TimeUnit.SECONDS),"ACTUAL_WORKER_HELD"); f.gate.invalidate();
                    try { f.gate.admit(f.gate.capture()); throw new AssertionError("HELD_OWNER_NOT_RELEASED"); }
                    catch(MessagePreviewInitializationGate.Unavailable expected) { }
                } finally { release.countDown(); }
                try { job.get(3,TimeUnit.SECONDS); }
                catch(java.util.concurrent.ExecutionException failure) {
                    if(failure.getCause() instanceof AssertionError) throw (AssertionError)failure.getCause();
                    throw new AssertionError("UNEXPECTED_HELD_FAILURE");
                }
                Os.assertClosed(); check(f.reservation==null,"NO_LATE_ACK");
                if(afterEffect) check(f.namespace.exists(),"LATE_CREATE_RESIDUE_RETAINED");
                else check(!f.namespace.exists(),"STALE_BEFORE_CREATE_NO_EFFECT");
                f.worker.on(() -> f.gate.settleFailure(f.permit));
            }
        }
    }
    private static void contextBudget(File parent, boolean constructor) throws Exception {
        if(constructor) { try(Fixture f=new Fixture(parent)) {
            int[] reads={0};
            f.app.onUsers=() -> { if(++reads[0]==3) f.clock=10000; };
            f.worker.on(() -> { f.gate.consume(f.permit);
                refused(() -> new MessagePreviewAtomicBackend.MarkerIO(f.app,f.gate,f.permit),"POST_CONTEXT_CURRENCY_REQUIRED"); });
            check(f.effects()==0,"NO_EFFECT_AFTER_CONTEXT_BUDGET");
        } return; }
        try(Fixture f=new Fixture(parent)) {
            f.open(); boolean[] ready={false}; int[] reads={0};
            Os.onEvent=e -> { if(e.equals("fstat:installation-v1.bin")) ready[0]=true; };
            f.app.onUsers=() -> { if(ready[0] && ++reads[0]==6) f.clock=10000; };
            f.failed(); check(f.marker.exists() && f.marker.length()==0,"NO_WRITE_AFTER_CONTEXT_BUDGET");
        }
    }
    private static void statBudget(File parent, boolean namespace) throws Exception {
            try(Fixture f=new Fixture(parent)) {
                f.open(); int[] stats={0}; String name=namespace ? "native-message-previews-v1" : f.app.root.getName();
                Os.onEvent=e -> { if(e.equals("fstat:"+name) && ++stats[0]==2) f.clock=10000; };
                f.failed(); check(!Os.events.contains("fsync:"+name),namespace ? "POST_NAMESPACE_STAT_CURRENCY_REQUIRED" : "POST_ROOT_STAT_CURRENCY_REQUIRED");
            }
    }
    private static void descriptor(File parent, boolean nonempty) throws Exception {
        try(Fixture f=new Fixture(parent)) {
            f.open(); Os.wrongDescriptor=!nonempty; Os.nonemptyDescriptor=nonempty;
            f.failed(nonempty ? "FRESH_EMPTY_DESCRIPTOR_REQUIRED" : "DIRECT_FD_IDENTITY_REQUIRED");
            check(f.marker.exists() && f.marker.length()==(nonempty ? 1 : 0),"FD_REFUSAL_RETAINS_EXACT_RESIDUE");
        }
    }
    private static void directoryDescriptor(File parent) throws Exception {
        for(boolean namespace:new boolean[]{false,true}) {
            for(String fault:new String[]{"type","dev","inode","owner","mode","lookup"}) {
                try(Fixture f=new Fixture(parent)) {
                    f.open(); String name=namespace ? f.namespace.getName() : f.app.root.getName();
                    if(fault.equals("lookup")) Os.fail="fstat:"+name;
                    else { Os.directoryDescriptorFault=fault; Os.directoryFaultTarget=name; }
                    f.failed("DIRECTORY_FD_CUSTODY_REQUIRED");
                    check(Os.events.stream().noneMatch(e -> e.startsWith("fsync:")),"NO_SYNC_BEFORE_DIRECTORY_CUSTODY");
                    check(!f.marker.exists(),"NO_MARKER_BEFORE_DIRECTORY_CUSTODY");
                    check(f.namespace.exists()==namespace,"EXACT_DIRECTORY_RESIDUE_RETAINED");
                    check(Os.events.contains("close:"+name),"REFUSED_DIRECTORY_FD_CLOSED");
                }
            }
        }
    }
    private static void fileFault(File parent, boolean sync) throws Exception {
        try(Fixture f=new Fixture(parent)) {
            f.open(); boolean[] ready={false}; int[] reads={0};
            Os.onEvent=e -> {
                if(e.equals("fstat:installation-v1.bin")) ready[0]=true;
                if(ready[0] && e.equals("lstat:native-message-previews-v1") && ++reads[0]==(sync ? 4 : 2)) Os.breakFiles();
            };
            f.failed(); check(f.marker.length()==(sync ? 28 : 0),"REAL_FILE_FD_FAILURE_RETAINS_BYTES");
        }
    }
    private static void alias(File parent) throws Exception {
        try(Fixture f=new Fixture(parent)) {
            File canonical=f.app.root;
            File raw=Files.createTempDirectory(parent.toPath(),"parent-spelling-").toFile();
            f.app.root=new File(raw.getPath()) { @Override public File getCanonicalFile() { return canonical; } };
            f.open(); f.reserve(); check(f.marker.length()==28,"NORMALIZED_PLATFORM_ALIAS_ACCEPTED");
            f.worker.on(() -> f.io.requireCurrent(f.reservation));
        }
    }
    private static void mainThread(File parent) throws Exception {
        try(Worker creator=new Worker()) {
            MessagePreviewInitializationGate[] gate={null}; Thread actualMain=Thread.currentThread(); Object snapshot=new Object();
            creator.on(() -> gate[0]=new MessagePreviewInitializationGate(new MessagePreviewInitializationGate.ForegroundAuthority() {
                public Object capture() { return snapshot; }
                public boolean isCurrent(Object captured) { return captured==snapshot; }
            }, () -> 0,Thread.currentThread(),actualMain));
            MessagePreviewInitializationGate.Permit p=gate[0].admit(gate[0].capture()); gate[0].consume(p);
            refused(() -> new MessagePreviewAtomicBackend.MarkerIO(new App(parent),gate[0],p),"ANDROID_MAIN_REFUSED");
        }
    }
    private static void entryFailure(File parent) throws Exception {
        try(Fixture f=new Fixture(parent)) {
            f.open(); f.app.users.unlocked=false;
            f.worker.on(() -> refused(() -> f.io.reserve(),"LOCKED_ENTRY_REFUSED"));
            check(f.effects()==0,"ENTRY_REFUSAL_BEFORE_EFFECT");
            f.app.users.unlocked=true;
            f.worker.on(() -> refused(() -> f.io.reserve(),"ONE_USE_ON_ENTRY_FAILURE"));
            check(f.effects()==0 && !f.namespace.exists(),"NO_ENTRY_REPLAY_CREATE");
        }
    }
    public static void main(String[] args) throws Exception {
        Looper.getMainLooper(); File root=new File(args[1]);
        switch(args[0]) {
            case "healthy": healthy(root); break;
            case "policy": policy(root); break;
            case "absence": absence(root); break;
            case "permits": permits(root); break;
            case "failures": failures(root); break;
            case "readback": readback(root); break;
            case "identities": identities(root); break;
            case "held": held(root); break;
            case "context-return": contextBudget(root,true); break;
            case "context-write": contextBudget(root,false); break;
            case "namespace-stat": statBudget(root,true); break;
            case "root-stat": statBudget(root,false); break;
            case "descriptor": descriptor(root,false); break;
            case "descriptor-size": descriptor(root,true); break;
            case "directory-descriptor": directoryDescriptor(root); break;
            case "file-sync-fault": fileFault(root,true); break;
            case "file-write-fault": fileFault(root,false); break;
            case "root-alias": alias(root); break;
            case "android-main": mainThread(root); break;
            case "entry-failure": entryFailure(root); break;
            default: throw new AssertionError("UNKNOWN_CASE");
        }
        check(android.util.AtomicFile.reads==0 && android.util.AtomicFile.starts==0
            && android.util.AtomicFile.finishes==0 && android.util.AtomicFile.fails==0,"NO_ATOMICFILE_RECOVERY_OR_RESET");
        System.out.println("PASS "+args[0]);
    }
}
