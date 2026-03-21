import { OptimisedImage } from "@/components/optimised-image.js";
import { getPicture } from "@/lib/image-map.js";
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

const sizePx = {
  sm: 32,
  md: 52,
  lg: 96,
} as const;

const logoPicture = getPicture("/images/club_logo.png");

export const Logo: FC<Props> = ({ size = "md" }) => {
  const px = sizePx[size];

  return (
    <Link to="/" className="block">
      {logoPicture ? (
        <OptimisedImage
          picture={logoPicture}
          alt="Club logo"
          className={sizeClasses[size]}
          loading="eager"
          fetchPriority="high"
          sizes={`${px}px`}
          width={px}
          height={px}
        />
      ) : (
        <img
          width={px}
          height={px}
          src="/images/club_logo.png"
          alt="Club logo"
          className={sizeClasses[size]}
          loading="eager"
          fetchPriority="high"
        />
      )}
    </Link>
  );
};
