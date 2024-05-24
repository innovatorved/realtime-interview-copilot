export default function Loading() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gray-100 dark:bg-gray-900">
      <div className="space-y-4 text-center">
        <div className="inline-flex items-center space-x-2">
          <div className="w-8 h-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <span className="text-lg font-medium text-gray-700 dark:text-gray-300">
            Loading...
          </span>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
          Please wait
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {"Content is being loaded, this won't take long."}
        </p>
      </div>
    </div>
  );
}
