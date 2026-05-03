// PostHog initialization moved to <PostHogProvider> (components/PostHogProvider.tsx)
// so it can also subscribe to App Router pageviews and the auth session for
// identify(). Keeping this file as a no-op so Next 16 doesn't warn about a
// missing instrumentation file in the build output.
export {};
