import { PostHog } from "posthog-node";

export interface PostHogEnv {
    POSTHOG_API_KEY?: string;
    POSTHOG_HOST?: string;
}

export interface LLMAnalyticsParams {
    env: PostHogEnv;
    model: string;
    prompt: string;
    getUser: () => Promise<{ id: string; email?: string; name?: string } | null>;
}

export interface LLMAnalyticsResult {
    onText: (text: string) => void;
    onError: (error: Error | string) => void;
    finalize: () => Promise<void>;
}

/**
 * Initialize LLM analytics tracking for a completion request.
 * Returns callbacks to collect response text and finalize analytics.
 * All operations are non-blocking and run in the background.
 */
export function trackLLMGeneration(params: LLMAnalyticsParams): LLMAnalyticsResult {
    const { env, model, prompt } = params;

    // Early return if PostHog is not configured
    if (!env.POSTHOG_API_KEY) {
        return {
            onText: () => { },
            onError: () => { },
            finalize: async () => { },
        };
    }

    const posthog = new PostHog(env.POSTHOG_API_KEY, {
        host: env.POSTHOG_HOST || "https://eu.i.posthog.com",
        flushAt: 1,
        flushInterval: 0,
    });

    const traceId = crypto.randomUUID();
    const startTime = Date.now();
    let fullResponse = "";
    let isError = false;
    let errorMessage: string | undefined;

    // Start user lookup in background
    const userPromise = params.getUser().catch((e) => {
        console.warn("[PostHog] Failed to get user for analytics:", e);
        return null;
    });

    return {
        onText: (text: string) => {
            fullResponse += text;
        },

        onError: (error: Error | string) => {
            isError = true;
            errorMessage = error instanceof Error ? error.message : error;
        },

        finalize: async () => {
            // Wait for user lookup to complete
            const user = await userPromise;
            const userId = user?.id || "anonymous";

            // Identify user if authenticated
            if (user) {
                posthog.identify({
                    distinctId: userId,
                    properties: {
                        ...(user.email && { email: user.email }),
                        ...(user.name && { name: user.name }),
                    },
                });
            }

            // Capture the LLM generation event
            posthog.capture({
                distinctId: userId,
                event: "$ai_generation",
                properties: {
                    $ai_trace_id: traceId,
                    $ai_model: model,
                    $ai_provider: "gemini",
                    $ai_input: [{ role: "user", content: prompt }],
                    $ai_output_choices: [{ role: "assistant", content: fullResponse }],
                    $ai_latency: (Date.now() - startTime) / 1000,
                    $ai_stream: true,
                    $ai_is_error: isError,
                    ...(errorMessage && { $ai_error: errorMessage }),
                },
            });

            // Flush and shutdown
            await posthog.flush();
            await posthog.shutdown();
        },
    };
}
