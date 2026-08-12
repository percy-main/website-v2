import type { FC } from "react";
import {
  IoLocation,
  IoLogoFacebook,
  IoLogoGithub,
  IoLogoLinkedin,
  IoLogoTiktok,
} from "react-icons/io5";

interface Props {
  variant?: "light" | "dark";
}

const links = [
  {
    label: "facebook",
    href: "https://www.facebook.com/Percymaincricketclub",
    icon: IoLogoFacebook,
  },
  {
    label: "location",
    href: "https://maps.app.goo.gl/qQ5bFRqxoDYVvzdz9",
    icon: IoLocation,
  },
  {
    label: "linkedin",
    href: "https://www.linkedin.com/company/percy-main-cricket-and-sports-club",
    icon: IoLogoLinkedin,
  },
  {
    label: "github",
    href: "https://github.com/percy-main/web",
    icon: IoLogoGithub,
  },
  {
    label: "tiktok",
    href: "https://www.tiktok.com/@percymaincricketclub",
    icon: IoLogoTiktok,
  },
] as const;

export const SocialLinks: FC<Props> = ({ variant = "light" }) => {
  const linkClass =
    variant === "dark"
      ? "inline-flex size-11 items-center justify-center rounded-full bg-white/20 text-center transition-colors duration-200 hover:bg-cta [&_svg]:fill-white [&>svg]:text-xl"
      : "inline-flex size-11 items-center justify-center rounded-full bg-white text-center transition-colors duration-200 hover:bg-primary [&_svg]:fill-dark [&_path]:transition-colors [&_path]:duration-200 hover:[&_svg]:fill-white [&>svg]:text-xl";

  return (
    <ul className="mt-4 flex gap-2 lg:mt-6">
      {links.map(({ label, href, icon: Icon }) => (
        <li key={label}>
          <a
            aria-label={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={linkClass}
          >
            <Icon />
          </a>
        </li>
      ))}
    </ul>
  );
};
