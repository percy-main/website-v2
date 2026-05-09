import { cn } from "@/lib/utils";

type Variant = "green" | "red" | "gray" | "blue" | "yellow";

const variantClasses: Record<Variant, string> = {
  green: "bg-green-100 text-green-800",
  red: "bg-red-100 text-red-800",
  gray: "bg-stone-100 text-stone-800",
  blue: "bg-blue-100 text-blue-800",
  yellow: "bg-yellow-100 text-yellow-800",
};

export function StatusPill({
  variant,
  children,
  className,
}: {
  variant: Variant;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function getMembershipTypeDisplay(type: string | null): {
  label: string;
  variant: Variant;
} {
  switch (type) {
    case "senior_player":
      return { label: "Senior Player", variant: "blue" };
    case "senior_women_player":
      return { label: "Women's Player", variant: "blue" };
    case "social":
      return { label: "Social", variant: "yellow" };
    case "junior":
      return { label: "Junior", variant: "green" };
    case "concessionary":
      return { label: "Student / Concessionary", variant: "yellow" };
    default:
      return { label: "-", variant: "gray" };
  }
}

export function getMemberCategoryDisplay(category: string | null): {
  label: string;
  variant: Variant;
} {
  switch (category) {
    case "senior":
      return { label: "Senior", variant: "blue" };
    case "junior":
      return { label: "Junior", variant: "green" };
    case "student":
      return { label: "Student", variant: "yellow" };
    case "bursary":
      return { label: "Bursary", variant: "yellow" };
    case "guest":
      return { label: "Guest", variant: "gray" };
    default:
      return { label: "-", variant: "gray" };
  }
}

export function getMembershipStatus(paidUntil: string | null): {
  label: string;
  variant: Variant;
} {
  if (!paidUntil) return { label: "None", variant: "gray" };
  if (new Date(paidUntil) >= new Date())
    return { label: "Active", variant: "green" };
  return { label: "Expired", variant: "red" };
}

export function formatPence(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);
}

export function formatDate(date: string, includeTime = false): string {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  if (!includeTime) return `${day}/${month}/${year}`;
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}
