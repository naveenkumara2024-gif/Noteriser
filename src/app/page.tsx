import { copy } from "@/ui/copy";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold">{copy.productName}</h1>
      <p className="mt-4 max-w-prose">{copy.tagline}</p>
      <p role="note" className="mt-8 border-l-4 border-current pl-4">
        {copy.trustNotice}
      </p>
    </main>
  );
}
