import { getImageUrl } from "@/lib/image-map.js";
import type { FC } from "react";
import { Link } from "react-router";

interface Props {
  size?: "sm" | "md" | "lg";
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-[52px] w-[52px]",
  lg: "h-24 w-24",
} as const;

const logoUrl = getImageUrl("/images/club_logo.png");

export const Logo: FC<Props> = ({ size = "md" }) => {
  return (
    <Link to="/" className="block">
      <img
        width={200}
        height={200}
        src={logoUrl}
        alt="Club logo"
        className={sizeClasses[size]}
        loading="eager"
      />
    </Link>
  );
};
