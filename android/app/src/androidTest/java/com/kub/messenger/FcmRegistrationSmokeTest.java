package com.kub.messenger;

import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertEquals;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailabilityLight;
import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Checks FCM transport without logging or returning the registration token. */
@RunWith(AndroidJUnit4.class)
public class FcmRegistrationSmokeTest {
    @Test
    public void playServicesApiIsAvailable() {
        int status = GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(
            InstrumentationRegistry.getInstrumentation().getTargetContext()
        );
        assertEquals("Play Services API availability code", ConnectionResult.SUCCESS, status);
    }

    @Test
    public void obtainsRegistrationToken() throws InterruptedException {
        CountDownLatch completed = new CountDownLatch(1);
        AtomicBoolean tokenPresent = new AtomicBoolean(false);
        AtomicReference<String> failureClass = new AtomicReference<>("none");

        try {
            Task<String> request = FirebaseMessaging.getInstance().getToken();
            request.addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    String value = task.getResult();
                    tokenPresent.set(value != null && !value.isEmpty());
                } else {
                    Exception error = task.getException();
                    failureClass.set(error == null ? "unknown" : error.getClass().getSimpleName());
                }
                completed.countDown();
            });
        } catch (RuntimeException error) {
            failureClass.set(error.getClass().getSimpleName());
            completed.countDown();
        }

        assertTrue("FCM registration timed out", completed.await(60, TimeUnit.SECONDS));
        assertTrue("FCM registration failed: " + failureClass.get(), tokenPresent.get());
    }
}
