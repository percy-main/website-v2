import { ConstructionIcon } from "lucide-react";

export default function ComingSoon() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-border text-text-secondary">
        <ConstructionIcon className="size-6" strokeWidth={1.8} />
      </div>
      <h1 className="mt-4 text-lg font-semibold tracking-[-0.01em]">
        Coming soon
      </h1>
      <p className="mt-1 text-sm text-text-secondary">
        This surface lands in a later phase. For now it's on the main site.
      </p>
    </div>
  );
}
