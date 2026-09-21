package com.kub.messenger;

import static org.junit.Assert.*;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;
import javax.tools.ToolProvider;
import org.junit.Test;

/** Standalone JDK harness; excluded from Android compilation and shared source edits. */
public class VoiceCallMutationTest {
    @Test public void meaningfulMutationsFailExecutedBehavioralTests() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        String sourcePath = "android/app/src/main/java/com/kub/messenger/";
        while (root != null && !Files.isRegularFile(root.resolve(sourcePath + "VoiceCallState.java"))) root = root.getParent();
        assertNotNull("Repository root", root);
        String contract = Files.readString(root.resolve(sourcePath + "VoiceCallNotificationContract.java"));
        String state = Files.readString(root.resolve(sourcePath + "VoiceCallState.java"));
        String tests = Files.readString(root.resolve("android/app/src/test/java/com/kub/messenger/VoiceCallStateTest.java"));
        String[][] mutations = {
            {"lifetime-45001", "contract", "expiry - start > 45_000", "expiry - start > 45_001", "rejectsMalformedAndNoncanonicalValues"},
            {"recipient-user", "contract", "recipientId.equals(user) && recipientSessionId.equals(session)", "recipientSessionId.equals(session)", "checksBothBindingIds"},
            {"recipient-session", "contract", "recipientId.equals(user) && recipientSessionId.equals(session)", "recipientId.equals(user)", "checksBothBindingIds"},
            {"tombstone-write", "state", "entries.put(event.ringKey, previous);", ";", "cancelBeforeRingSurvivesRestartAndExpires"},
            {"duplicate-alert", "state", "previous != null || entries.size()", "(previous != null && previous.cancelled) || entries.size()", "duplicateRingDoesNotAlertAfterRestart"},
            {"old-cancel", "state", "previous.active = false;", "cancelCards();", "olderCancelCannotRemoveNewerGeneration"},
            {"stale-epoch", "state", "!candidateEpoch.equals(epoch) || ", "", "staleEpochAndWrongCandidatesCannotCommit"},
            {"candidate-user", "state", " || !recipientId.equals(user) || !recipientSessionId.equals(session)", " || !recipientSessionId.equals(session)", "staleEpochAndWrongCandidatesCannotCommit"},
            {"candidate-session", "state", " || !recipientId.equals(user) || !recipientSessionId.equals(session)", " || !recipientId.equals(user)", "staleEpochAndWrongCandidatesCannotCommit"},
            {"unverified-consume", "state", "if (!bound) return null;", ";", "pendingTapWaitsForSameAccountVerifiedRebind"},
            {"calls-disabled", "state", "if (!bound || !callsAllowed || blockedUntil", "if (!bound || blockedUntil", "callsDisabledDropsCardsAndActionsButTrueDoesNotBind"},
            {"wall-rollback", "state", "lastNow = Math.max(clock.wallTime(), lastNow + advance);", "lastNow = clock.wallTime();", "wallRollbackCannotExtendLifetimeEvenAcrossProcessRestart"},
            {"overflow-cancel", "state", "blockedUntil = Math.max(blockedUntil, event.expiresAt);", "blockedUntil = 0;", "overflowCancelFailsClosedWithoutLosingItsSuppression"},
            {"consumed-key", "state", "ringKey == null || !ringKey.equals(consumedKey) || !bound", "ringKey == null || !bound", "revalidationRequiresTheExactConsumedActionNotAnyReceivedRing"},
            {"unverified-revalidation", "state", "!ringKey.equals(consumedKey) || !bound || !callsAllowed", "!ringKey.equals(consumedKey) || !callsAllowed", "consumedTapRevalidatesAfterSamePairReverificationAndRestart"},
            {"mute-restores-consumed-tap", "state", "pendingKey = null;\n            consumedKey = null;\n            for (Entry", "pendingKey = null;\n            for (Entry", "muteReenableCannotRestoreAConsumedAction"}
        };
        Path parent = root.resolve("output/voice-delivery-task4").toRealPath();
        Path directory = Files.createTempDirectory(parent, "native-mutations-");
        try {
            run(directory.resolve("baseline"), contract, state, tests, null);
            for (String[] mutation : mutations) {
                String original = mutation[1].equals("contract") ? contract : state;
                assertEquals(mutation[0] + " single mutation target", 1, original.split(java.util.regex.Pattern.quote(mutation[2]), -1).length - 1);
                String changed = original.replace(mutation[2], mutation[3]);
                run(directory.resolve(mutation[0]), mutation[1].equals("contract") ? changed : contract,
                    mutation[1].equals("state") ? changed : state, tests, mutation[4]);
                System.out.println("KILLED " + mutation[0] + " -> " + mutation[4]);
            }
            System.out.println("MUTATIONS: " + mutations.length + "/" + mutations.length + " killed; isolated baseline passed");
        } finally {
            Path resolved = directory.toRealPath();
            assertTrue("Cleanup is bounded to this run", resolved.startsWith(parent) && !resolved.equals(parent));
            try (java.util.stream.Stream<Path> paths = Files.walk(resolved)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toArray(Path[]::new)) Files.delete(path);
            }
        }
    }

    private static void run(Path directory, String contract, String state, String tests, String failure) throws Exception {
        Files.createDirectories(directory);
        Path contractFile = directory.resolve("VoiceCallNotificationContract.java");
        Path stateFile = directory.resolve("VoiceCallState.java");
        Path testsFile = directory.resolve("VoiceCallStateTest.java");
        Files.writeString(contractFile, contract);
        Files.writeString(stateFile, state);
        Files.writeString(testsFile, tests);
        ByteArrayOutputStream compilerOutput = new ByteArrayOutputStream();
        String cp = Path.of(org.junit.Test.class.getProtectionDomain().getCodeSource().getLocation().toURI())
            + java.io.File.pathSeparator + Path.of(org.hamcrest.Matcher.class.getProtectionDomain().getCodeSource().getLocation().toURI());
        assertNotNull("Tests require the configured JDK", ToolProvider.getSystemJavaCompiler());
        int compiled = ToolProvider.getSystemJavaCompiler().run(null, compilerOutput, compilerOutput,
            "-encoding", "UTF-8", "-cp", cp, "-d", directory.toString(), contractFile.toString(), stateFile.toString(), testsFile.toString());
        assertEquals(compilerOutput.toString(StandardCharsets.UTF_8), 0, compiled);
        String binary = System.getProperty("os.name").startsWith("Windows") ? "java.exe" : "java";
        Process process = new ProcessBuilder(Path.of(System.getProperty("java.home"), "bin", binary).toString(), "-cp",
            directory + java.io.File.pathSeparator + cp, "org.junit.runner.JUnitCore", "com.kub.messenger.VoiceCallStateTest")
            .redirectErrorStream(true).start();
        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        int exit = process.waitFor();
        if (failure == null) {
            assertEquals(output, 0, exit);
            assertTrue(output, output.contains("OK ("));
        } else {
            assertEquals(output, 1, exit);
            assertTrue(output, output.contains("FAILURES!!!"));
            assertTrue(output, output.contains(failure + "(com.kub.messenger.VoiceCallStateTest)"));
        }
    }
}
