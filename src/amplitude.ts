import pLimit from "p-limit";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function calculateBackoff(attempt: number, baseMs = 1000, capMs = 15000): number {
  const jitter = Math.random() * 250;
  return Math.min(capMs, baseMs * Math.pow(2, attempt)) + jitter;
}

export type AmplitudeResult = {
  id: string;
  ok: boolean;
  error?: string;
};

export type AmplitudeOptions = {
  batchSize?: number;
  concurrentBatches?: number;
  maxAttempts?: number;
};

/**
 * Deletes users from Amplitude with bounded concurrency and exponential backoff.
 * Handles retries for transient failures (5xx) but not for client errors (4xx).
 */
export async function deleteUsersAmplitude(
  publicIds: string[],
  apiKey: string,
  options: AmplitudeOptions = {}
): Promise<AmplitudeResult[]> {
  const {
    batchSize = 300,
    concurrentBatches = 4,
    maxAttempts = 5,
  } = options;

  if (!apiKey) {
    throw new Error("Missing Amplitude API key");
  }

  // Split IDs into batches
  const chunks: string[][] = [];
  for (let i = 0; i < publicIds.length; i += batchSize) {
    chunks.push(publicIds.slice(i, i + batchSize));
  }

  const limit = pLimit(concurrentBatches);
  const results: AmplitudeResult[] = [];

  // Process batches with bounded concurrency
  await Promise.all(
    chunks.map((chunk, idx) =>
      limit(async () => {
        console.log(`[Amplitude] Processing batch ${idx + 1}/${chunks.length} (${chunk.length} users)`);

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const res = await fetch("https://amplitude.com/api/2/userdeletion/users", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
              },
              body: JSON.stringify({
                user_ids: chunk.map((id) => ({ user_id: id })),
              }),
            });

            // Success
            if (res.ok) {
              for (const id of chunk) {
                results.push({ id, ok: true });
              }
              console.log(`[Amplitude] ✓ Batch ${idx + 1} succeeded`);
              return;
            }

            // Non-retryable client error (4xx)
            if (res.status < 500) {
              const text = await res.text();
              const errorMsg = `Amplitude ${res.status}: ${text}`;
              console.error(`[Amplitude] ✗ Batch ${idx + 1} failed (non-retryable): ${errorMsg}`);
              for (const id of chunk) {
                results.push({ id, ok: false, error: errorMsg });
              }
              return;
            }

            // Server error (5xx) - retry with backoff
            console.warn(
              `[Amplitude] Batch ${idx + 1} failed with ${res.status}, retrying (attempt ${attempt + 1}/${maxAttempts})`
            );
            await sleep(calculateBackoff(attempt));
          } catch (err) {
            console.error(`[Amplitude] Batch ${idx + 1} network error:`, err);
            if (attempt === maxAttempts - 1) {
              // Exhausted retries
              for (const id of chunk) {
                results.push({
                  id,
                  ok: false,
                  error: `Network error after ${maxAttempts} attempts: ${err}`,
                });
              }
            } else {
              await sleep(calculateBackoff(attempt));
            }
          }
        }

        // Exhausted all retries
        console.error(`[Amplitude] ✗ Batch ${idx + 1} failed after ${maxAttempts} attempts`);
        for (const id of chunk) {
          if (!results.find((r) => r.id === id)) {
            results.push({ id, ok: false, error: "Retry exhausted" });
          }
        }
      })
    )
  );

  return results;
}
