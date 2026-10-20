package com.kub.messenger;

import android.os.Looper;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.ResolveInfo;
import com.getcapacitor.Bridge;
import com.getcapacitor.PluginCall;
import fixture.Queues;
import java.util.concurrent.atomic.AtomicReference;

public final class AndroidUpdatePluginProbe {
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    private static final Bridge bridge = new Bridge();
    private static final AndroidUpdatesPlugin plugin = new AndroidUpdatesPlugin();
    private static final AndroidUpdateRuntime runtime = AndroidUpdateRuntime.INSTANCE;

    private static void invoke(String operation, PluginCall call) throws Exception {
        Queues.run(Looper.PLUGINS, () -> {
            switch (operation) {
                case "status": plugin.status(call); break;
                case "check": plugin.check(call); break;
                case "start": plugin.start(call); break;
                case "cancel": plugin.cancel(call); break;
                case "permission": plugin.permission(call); break;
                case "install": plugin.install(call); break;
                default: throw new AssertionError("UNKNOWN_OPERATION");
            }
        });
    }
    private static void resolved(PluginCall call, String message) {
        check(call.answers == 1 && call.rejection == null && call.result != null, message);
        check("idle".equals(call.result.get("phase")), "RUNTIME_STATUS_NOT_FORWARDED");
    }
    private static void refused(PluginCall call) {
        check(call.answers == 1 && "ANDROID_UPDATE_UNAVAILABLE".equals(call.rejection), "UNTRUSTED_DOCUMENT_NOT_REFUSED");
        check(runtime.gets == 0 && runtime.starts == 0 && runtime.preparations == 0, "REFUSED_DOCUMENT_TOUCHED_RUNTIME");
    }
    private static void installer() {
        ResolveInfo system = new ResolveInfo();
        system.activityInfo.packageName = "com.android.packageinstaller";
        system.activityInfo.name = "SystemInstaller";
        system.activityInfo.applicationInfo.flags = ApplicationInfo.FLAG_SYSTEM;
        ResolveInfo foreign = new ResolveInfo();
        foreign.activityInfo.packageName = "fictional.thirdparty";
        foreign.activityInfo.name = "NotSystem";
        bridge.activity.manager.installers.add(foreign);
        bridge.activity.manager.installers.add(system);
    }
    public static void main(String[] args) throws Exception {
        try {
            plugin.setBridge(bridge);
            Queues.run(Looper.MAIN, plugin::load); Queues.drain();
            String scenario = args[0];
            PluginCall call = new PluginCall();
            if (scenario.equals("webview-control")) {
                Queues.run(Looper.MAIN, () -> check("https://localhost/".equals(bridge.view.getUrl()), "UI_CONTROL_REFUSED"));
                Queues.run(Looper.PLUGINS, () -> {
                    try { bridge.view.getUrl(); throw new AssertionError("OWNER_CHECK_NOT_CALIBRATED"); }
                    catch (RuntimeException expected) { check("WEBVIEW_WRONG_THREAD".equals(expected.getMessage()), "WRONG_OWNER_FAILURE"); }
                });
            } else if (scenario.startsWith("normal-")) {
                String operation = scenario.substring(7);
                if (args.length > 1) bridge.view.page = args[1];
                invoke(operation, call); Queues.drain();
                resolved(call, "STATUS_MUST_RESOLVE_FROM_CAPACITOR_WORKER rejection=" + call.rejection + " wrongThreadReads=" + bridge.view.wrongThreadReads);
                check(bridge.view.wrongThreadReads == 0, "PLUGIN_READ_WEBVIEW_ON_WORKER");
                check(runtime.gets == 1, "RUNTIME_NOT_ADMITTED_ONCE");
                if (operation.equals("check")) check(runtime.checks == 1 && runtime.starts == 0, "CHECK_STARTED_DOWNLOAD");
                if (operation.equals("start")) check(runtime.starts == 1 && runtime.checks == 0, "DOWNLOAD_NOT_STARTED");
                if (operation.equals("cancel")) check(runtime.cancels == 1, "CANCEL_NOT_FORWARDED");
                check(bridge.activity.launches.isEmpty(), "ORDINARY_COMMAND_OPENED_INSTALLER");
            } else if (scenario.startsWith("origin-")) {
                bridge.view.page = args[1]; invoke("start", call); Queues.drain(); refused(call);
                check(bridge.view.wrongThreadReads == 0, "ORIGIN_NOT_CHECKED_ON_UI");
            } else if (scenario.equals("null-activity")) {
                bridge.activity = null; invoke("status", call); Queues.drain(); refused(call);
            } else if (scenario.equals("null-bridge")) {
                plugin.setBridge(null); invoke("status", call); Queues.drain(); refused(call);
            } else if (scenario.equals("stale-before-ui")) {
                invoke("start", call);
                Queues.run(Looper.MAIN, () -> bridge.navigate("https://foreign.invalid/"));
                Queues.drain(); refused(call);
            } else if (scenario.equals("stale-before-worker")) {
                invoke("start", call); check(Queues.step(Looper.MAIN), "UI_ADMISSION_NOT_QUEUED");
                Queues.run(Looper.MAIN, () -> bridge.navigate("https://foreign.invalid/"));
                Queues.drain(); refused(call);
            } else if (scenario.equals("permission")) {
                bridge.activity.manager.canInstall = false;
                invoke("permission", call); Queues.drain(); resolved(call, "PERMISSION_MUST_RESOLVE");
                check(bridge.activity.launches.size() == 1, "PERMISSION_UI_NOT_OPENED");
                Intent intent = bridge.activity.launches.get(0);
                check("android.settings.MANAGE_UNKNOWN_APP_SOURCES".equals(intent.action), "WRONG_PERMISSION_ACTION");
                check("package:com.kub.messenger".equals(intent.data.toString()), "PERMISSION_SCOPE_CHANGED");
            } else if (scenario.equals("install-denied")) {
                bridge.activity.manager.canInstall = false;
                invoke("install", call); Queues.drain(); resolved(call, "DENIED_INSTALL_MUST_RESOLVE_STATUS");
                check(runtime.preparations == 0 && bridge.activity.launches.isEmpty(), "INSTALL_PERMISSION_BYPASSED");
            } else if (scenario.equals("install") || scenario.equals("install-stale") || scenario.equals("install-null-activity") || scenario.equals("install-destroyed")) {
                installer();
                AtomicReference<Runnable> prepared = new AtomicReference<>();
                runtime.preparation = prepared::set;
                invoke("install", call); Queues.drain();
                check(runtime.preparations == 1 && prepared.get() != null, "INSTALL_PREPARATION_NOT_ON_WORKER");
                check(bridge.activity.launches.isEmpty(), "INSTALL_LAUNCHED_BEFORE_VERIFICATION");
                if (scenario.equals("install-stale")) Queues.run(Looper.MAIN, () -> bridge.navigate("https://foreign.invalid/"));
                if (scenario.equals("install-null-activity")) bridge.activity = null;
                if (scenario.equals("install-destroyed")) {
                    Queues.run(Looper.MAIN, () -> { bridge.activity.destroyed = true; plugin.handleOnDestroy(); });
                    bridge.closed = true;
                }
                prepared.get().run(); Queues.drain();
                if (!scenario.equals("install")) {
                    check(runtime.handoffs == 0, "STALE_DOCUMENT_OPENED_INSTALLER");
                    check(!runtime.phase.equals("installing"), "DESTROYED_BRIDGE_STRANDED_INSTALLING");
                    check("ANDROID_UPDATE_UNAVAILABLE".equals(call.rejection), "STALE_INSTALL_NOT_REFUSED");
                    check(runtime.returned == 1, "STALE_INSTALL_OWNER_NOT_RELEASED");
                    if (scenario.equals("install-destroyed")) {
                        Bridge recreated = new Bridge(); AndroidUpdatesPlugin next = new AndroidUpdatesPlugin(); next.setBridge(recreated);
                        PluginCall status = new PluginCall();
                        Queues.run(Looper.PLUGINS, () -> next.status(status)); Queues.drain();
                        check(status.result != null && "ready".equals(status.result.get("phase")), "RECREATED_ACTIVITY_STILL_INSTALLING");
                    }
                } else {
                    check(bridge.activity.launches.size() == 1 && runtime.handoffs == 1, "INSTALL_NOT_HANDED_OFF");
                    Intent intent = bridge.activity.launches.get(0);
                    check("android.intent.action.INSTALL_PACKAGE".equals(intent.action), "WRONG_INSTALL_ACTION");
                    check("com.android.packageinstaller".equals(intent.component.packageName), "NON_SYSTEM_INSTALLER_CHOSEN");
                    check("application/vnd.android.package-archive".equals(intent.mime) && intent.returnResult && intent.clip != null && intent.flags == 1, "INSTALL_GRANTS_CHANGED");
                    check(call.getData().optLong("__androidUpdateOwner", -1) == 7, "INSTALL_OWNER_NOT_RETAINED");
                }
            } else if (scenario.equals("installer-return")) {
                call.getData().put("__androidUpdateOwner", 7L);
                java.lang.reflect.Method callback = AndroidUpdatesPlugin.class.getDeclaredMethod("installerReturned", PluginCall.class, androidx.activity.result.ActivityResult.class);
                callback.setAccessible(true);
                Queues.run(Looper.MAIN, () -> {
                    try { callback.invoke(plugin, call, new androidx.activity.result.ActivityResult(0)); }
                    catch (ReflectiveOperationException failure) { throw new RuntimeException(failure); }
                });
                Queues.drain(); resolved(call, "INSTALLER_RETURN_MUST_RESOLVE");
                check(runtime.returned == 1, "INSTALLER_RETURN_NOT_FORWARDED");
            } else throw new AssertionError("UNKNOWN_SCENARIO");
            System.out.println("PASS_PLUGIN_THREAD " + scenario);
        } finally { Queues.close(); }
    }
}
