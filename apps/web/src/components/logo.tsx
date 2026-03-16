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

export const Logo: FC<Props> = ({ size = "md" }) => {
  return (
    <Link to="/" className="block">
      <img
        width={200}
        height={200}
        src="/images/club_logo.png"
        alt="Club logo"
        className={sizeClasses[size]}
        loading="eager"
      />
    </Link>
  );
};
