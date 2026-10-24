import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-semibold">That page does not exist</h1>
      <p>A run is deleted on request and expires automatically, so this link may be out of date.</p>
      <Link
        href="/"
        className="inline-block rounded bg-accent px-5 py-2 font-semibold text-accent-fg"
      >
        Start a new run
      </Link>
    </div>
  );
}
