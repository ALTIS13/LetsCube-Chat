package qa.letscube.boot;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.webkit.WebView;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

public final class BootInstrumentation extends Instrumentation {
    private BootActivity activity;
    private final JSONArray results = new JSONArray();
    private int failures;
    private int assertions;
    private int unexpectedRequests;
    private int transientSnapshotReads;
    private final StringBuilder progress = new StringBuilder();
    interface Checked { void run() throws Exception; }

    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }

    @Override public void onStart() {
        JSONObject report = new JSONObject();
        try {
            check(Build.FINGERPRINT.startsWith("google/sdk_gphone"), "owned_google_emulator_required");
            check("1".equals(android.provider.Settings.Global.getString(getTargetContext().getContentResolver(), "airplane_mode_on")), "offline_emulator_required");
            PackageInfo self = getTargetContext().getPackageManager().getPackageInfo("qa.letscube.boot", 4096);
            check(self.requestedPermissions == null || self.requestedPermissions.length == 0, "qa_has_no_permissions");
            report.put("android", Build.VERSION.RELEASE).put("api", Build.VERSION.SDK_INT);

            scenario("healthy_and_post_deadline_cleanup", false, () -> {
                open("healthy", "boot");
                awaitState("ready", 6000);
                PackageInfo engine = WebView.getCurrentWebViewPackage();
                report.put("enginePackage", engine.packageName).put("engineVersion", engine.versionName);
                check(!snapshot().getBoolean("surface"), "healthy_removes_recovery");
                check(!snapshot().getBoolean("style"), "healthy_removes_fallback_style");
                SystemClock.sleep(12500);
                js("setTimeout(function(){throw new Error('qa-after-ready');},0);Promise.reject(new Error('qa-after-ready-rejection'));true");
                SystemClock.sleep(300);
                check("ready".equals(snapshot().getString("state")), "ready_survives_late_errors_and_deadline");
                check(snapshot().getInt("failures") == 0, "no_failure_after_ready");
                check(activity.documents.get() == 1, "healthy_has_no_automatic_reload");
            });
            scenario("failed_module_explicit_retry_preserves_state", false, () -> {
                open("failed", "boot");
                JSONObject failed = awaitState("failed", 6000);
                check(failed.getDouble("failedAt") < 11000, "module_failure_before_deadline");
                check(failed.getBoolean("retryVisible"), "module_failure_exposes_retry");
                js("localStorage.setItem('qa-draft','synthetic-draft');sessionStorage.setItem('qa-session','synthetic-session');true");
                int before = activity.navigations.get();
                SystemClock.sleep(1300);
                check(activity.navigations.get() == before, "failure_does_not_reload_automatically");
                activity.mode = "healthy";
                js("document.getElementById('kub-boot-retry').click();true");
                JSONObject ready = awaitState("ready", 6000);
                check(activity.navigations.get() > before && activity.documents.get() == 2, "retry_loads_a_real_new_document");
                check(BootActivity.URL.equals(ready.getString("url")), "retry_preserves_path_query_hash");
                check("synthetic-draft".equals(ready.getString("draft")), "retry_preserves_local_storage");
                check("synthetic-session".equals(ready.getString("session")), "retry_preserves_session_storage");
                check(ready.getInt("failures") == 0, "retry_has_fresh_controller");
            });
            scenario("stalled_real_deadline_and_late_module_commit", false, () -> {
                open("late", "boot");
                awaitState("loading", 5000);
                JSONObject failed = awaitState("failed", 15000);
                check(failed.getDouble("failedAt") >= 11500 && failed.getDouble("failedAt") < 14000, "real_12_second_deadline");
                check(failed.getBoolean("retryVisible"), "stalled_entry_exposes_retry");
                report.put("deadlineObservedMs", failed.getDouble("failedAt"));
                JSONObject ready = awaitState("ready", 6000);
                check(ready.getDouble("elapsed") >= 14000, "late_module_really_committed_after_failure");
                check(!ready.getBoolean("surface") && !ready.getBoolean("style"), "late_commit_cleans_fallback");
                check(activity.documents.get() == 1, "late_commit_does_not_navigate");
                report.put("lateCommitObservedMs", ready.getDouble("elapsed"));
            });
            scenario("document_load_and_forged_ready_are_not_commit", false, () -> {
                open("stalled", "boot");
                awaitState("loading", 5000);
                waitPageFinished();
                check(snapshot().getBoolean("entryStarted"), "stalled_module_really_evaluated");
                js("window.dispatchEvent(new Event('letscube:app-rendered'));true");
                check("loading".equals(snapshot().getString("state")), "event_without_root_is_not_ready");
                js("document.getElementById('root').dataset.kubAppReady='true';window.dispatchEvent(new Event('letscube:app-rendered'));true");
                check("loading".equals(snapshot().getString("state")), "marker_without_child_is_not_ready");
                js("var r=document.getElementById('root');delete r.dataset.kubAppReady;r.innerHTML='<main>QA</main>';window.dispatchEvent(new Event('letscube:app-rendered'));true");
                check("loading".equals(snapshot().getString("state")), "child_without_marker_is_not_ready");
                js(BootActivity.COMMIT + "true");
                awaitState("ready", 2000);
            });
            scenario("real_javascript_exception", false, () -> {
                open("stalled", "boot"); awaitState("loading", 5000);
                js("setTimeout(function(){throw new Error('qa-runtime');},0);true");
                check(awaitState("failed", 2000).getBoolean("retryVisible"), "runtime_exception_exposes_retry");
            });
            scenario("real_unhandled_rejection", false, () -> {
                open("rejection", "boot");
                JSONObject failed = awaitState("failed", 5000);
                check(failed.getInt("rejections") == 1, "real_document_unhandled_rejection_observed");
                check(failed.getBoolean("retryVisible"), "unhandled_rejection_exposes_retry");
            });
            scenario("native_pause_resume_then_new_document", false, () -> {
                open("healthy", "boot"); awaitState("ready", 5000);
                int before = activity.documents.get();
                int pauses = activity.pauses, resumes = activity.resumes;
                runOnMainSync(() -> callActivityOnPause(activity));
                SystemClock.sleep(500);
                runOnMainSync(() -> callActivityOnResume(activity));
                check(activity.pauses > pauses && activity.resumes > resumes, "actual_activity_callbacks_ran");
                check("ready".equals(snapshot().getString("state")) && activity.documents.get() == before, "resume_retains_current_document");
                activity.mode = "stalled";
                runOnMainSync(() -> activity.web.reload());
                awaitState("loading", 5000);
                check(activity.documents.get() == before + 1, "reload_has_new_document");
                check(snapshot().getBoolean("surface") && snapshot().getInt("children") == 0, "old_ready_cannot_cover_new_document");
                js(BootActivity.COMMIT + "true"); awaitState("ready", 2000);
            });
            scenario("mutation_missing_deadline_is_detected", true, () -> {
                open("stalled", "no-deadline"); awaitState("loading", 5000);
                expectAssertion("state_failed", () -> awaitState("failed", 14000));
            });
            scenario("mutation_missing_ready_guard_is_detected", true, () -> {
                open("stalled", "no-ready-guard"); awaitState("loading", 5000);
                js("window.dispatchEvent(new Event('letscube:app-rendered'));true");
                expectAssertion("event_without_root_is_not_ready", () -> check("loading".equals(snapshot().getString("state")), "event_without_root_is_not_ready"));
            });
            scenario("mutation_missing_reload_is_detected", true, () -> {
                open("failed", "no-reload"); awaitState("failed", 5000);
                activity.mode = "healthy";
                js("document.getElementById('kub-boot-retry').click();true");
                expectAssertion("state_ready", () -> awaitState("ready", 2500));
            });
        } catch (Throwable error) {
            failures++;
            progress.append("setup_failure=").append(error.getClass().getSimpleName()).append('\n');
        }
        try {
            PackageInfo engine = WebView.getCurrentWebViewPackage();
            if (engine != null) report.put("enginePackage", engine.packageName).put("engineVersion", engine.versionName);
            report.put("results", results).put("failures", failures).put("assertions", assertions)
                .put("transientSnapshotReads", transientSnapshotReads)
                .put("unexpectedRequests", unexpectedRequests).put("scenarioCount", results.length())
                .put("network", "No INTERNET permission; WebView network blocked; local request interception only")
                .put("scope", "Extracted HTML controller in Android WebView; synthetic module commit, not React/Capacitor/production APK");
        } catch (Exception ignored) { failures++; }
        Bundle result = new Bundle();
        result.putString("qa_report", report.toString());
        result.putString("stream", progress + "\nQA scenarios=" + results.length() + " failures=" + failures + "\n");
        finish(failures == 0 && results.length() == 10 ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }

    private void scenario(String name, boolean mutation, Checked body) throws Exception {
        long started = SystemClock.elapsedRealtime();
        JSONObject result = new JSONObject().put("name", name).put("mutation", mutation);
        try {
            body.run();
            check(activity.unexpectedRequests.get() == 0, "no_unexpected_resource_requests");
            result.put("status", "passed");
        } catch (Throwable error) {
            failures++;
            result.put("status", "failed").put("errorType", error.getClass().getSimpleName());
            if (error instanceof AssertionError) result.put("assertion", error.getMessage());
        } finally {
            if (activity != null) {
                unexpectedRequests += activity.unexpectedRequests.get();
                runOnMainSync(() -> activity.finish()); waitForIdleSync(); activity = null;
            }
        }
        result.put("durationMs", SystemClock.elapsedRealtime() - started);
        results.put(result);
        Bundle update = new Bundle(); update.putString("stream", name + ": " + result.getString("status") + "\n");
        sendStatus(0, update);
    }

    private void open(String mode, String asset) {
        Intent intent = new Intent(getTargetContext(), BootActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("mode", mode).putExtra("asset", asset);
        activity = (BootActivity) startActivitySync(intent);
        waitForIdleSync();
    }
    private Object js(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        runOnMainSync(() -> activity.web.evaluateJavascript(expression, result -> { value.set(result); done.countDown(); }));
        check(done.await(5, TimeUnit.SECONDS), "javascript_callback_deadline");
        return new JSONTokener(value.get()).nextValue();
    }
    private JSONObject snapshot() throws Exception {
        Object raw = js("window.__qa ? JSON.stringify({state:document.documentElement.dataset.kubBootState||'',"
            + "surface:!!document.getElementById('kub-boot-recovery'),style:!!document.getElementById('kub-boot-style'),"
            + "retryVisible:!!document.getElementById('kub-boot-retry')&&!document.getElementById('kub-boot-retry').hidden,"
            + "children:document.getElementById('root')?.childElementCount||0,url:location.href,"
            + "draft:localStorage.getItem('qa-draft'),session:sessionStorage.getItem('qa-session'),"
            + "failures:window.__qa.failures,rejections:window.__qa.rejections,failedAt:window.__qa.failedAt||0,"
            + "entryStarted:window.__qa.entryStarted,elapsed:performance.now()}) : JSON.stringify({state:''})");
        // Android may return JSON null while navigation replaces the evaluation context.
        // Unknown is never promoted to loading/ready; the bounded state poll must see real DOM.
        if (!(raw instanceof String)) { transientSnapshotReads++; return new JSONObject().put("state", ""); }
        return new JSONObject((String) raw);
    }
    private JSONObject awaitState(String state, long timeout) throws Exception {
        long until = SystemClock.elapsedRealtime() + timeout;
        while (SystemClock.elapsedRealtime() < until) {
            JSONObject snapshot = snapshot();
            if (state.equals(snapshot.getString("state"))) return snapshot;
            SystemClock.sleep(80);
        }
        throw new AssertionError("state_" + state);
    }
    private void waitPageFinished() {
        long until = SystemClock.elapsedRealtime() + 4000;
        while (activity.pageFinished.get() == 0 && SystemClock.elapsedRealtime() < until) SystemClock.sleep(50);
        check(activity.pageFinished.get() > 0, "real_native_page_finished_callback");
    }
    private void expectAssertion(String expected, Checked body) throws Exception {
        try { body.run(); } catch (AssertionError error) {
            check(expected.equals(error.getMessage()), "mutation_failed_for_expected_reason"); return;
        }
        throw new AssertionError("mutation_survived");
    }
    private void check(boolean value, String name) { assertions++; if (!value) throw new AssertionError(name); }
}
