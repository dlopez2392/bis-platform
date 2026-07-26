import Link from "next/link";

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">BIS Platform</h1>
      <p className="max-w-md text-balance text-gray-500">
        The all-in-one client platform by Bespoke Intelligent Solutions.
      </p>
      <Link
        href="/dashboard"
        className="rounded bg-black px-5 py-2.5 text-white transition-opacity hover:opacity-80 dark:bg-white dark:text-black"
      >
        Sign in
      </Link>
    </main>
  );
}
