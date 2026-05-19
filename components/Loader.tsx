export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-neutral-100 dark:bg-neutral-950">
      <div className="space-y-4 text-center">
        <div className="inline-flex items-center space-x-2">
          <div className="w-8 h-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="text-lg font-medium text-neutral-700 dark:text-neutral-300">
            Loading...
          </span>
        </div>
        <h1 className="text-2xl font-bold text-neutral-800 dark:text-neutral-200">
          Please wait
        </h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          {"Content is being loaded, this won't take long."}
        </p>
      </div>
    </div>
  );
}
