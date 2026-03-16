import type { FC } from "react";
import { Link } from "react-router";
import { Logo } from "./logo.js";
import { SocialLinks } from "./social-links.js";

export const SiteFooter: FC = () => {
  return (
    <footer className="bg-primary text-white">
      <div className="container mx-auto px-8 py-12">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Column 1: About */}
          <div>
            <Logo size="md" />
            <p className="mt-4 text-sm leading-relaxed text-white/80">
              Community sports club providing facilities for cricket, football,
              boxing, and running in Percy Main and surrounding areas.
            </p>
            <p className="mt-3 text-sm text-white/60">
              <a
                href="https://register-of-charities.charitycommission.gov.uk/en/charity-search/-/charity-details/5231516/charity-overview"
                className="text-cta transition hover:text-orange-300"
                target="_blank"
                rel="noopener noreferrer"
              >
                Registered Charity 1206787
              </a>
            </p>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h4 className="mb-4 text-sm font-semibold tracking-wider text-white uppercase">
              Quick Links
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <Link
                  to="/calendar"
                  className="text-white/80 transition hover:text-white"
                >
                  Calendar
                </Link>
              </li>
              <li>
                <Link
                  to="/news/1"
                  className="text-white/80 transition hover:text-white"
                >
                  News
                </Link>
              </li>
              <li>
                <Link
                  to="/person"
                  className="text-white/80 transition hover:text-white"
                >
                  People
                </Link>
              </li>
              <li>
                <Link
                  to="/leaderboard"
                  className="text-white/80 transition hover:text-white"
                >
                  Cricket
                </Link>
              </li>
              <li>
                <Link
                  to="/legal/privacy"
                  className="text-white/80 transition hover:text-white"
                >
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 3: Contact */}
          <div>
            <h4 className="mb-4 text-sm font-semibold tracking-wider text-white uppercase">
              Contact
            </h4>
            <address className="space-y-1 text-sm text-white/80 not-italic">
              <p>St. Johns Terrace</p>
              <p>North Shields</p>
              <p>NE29 6HS</p>
            </address>
            <a
              href="mailto:trustees@percymain.org"
              className="text-cta mt-3 inline-block text-sm transition hover:text-orange-300"
            >
              trustees@percymain.org
            </a>
            <SocialLinks variant="dark" />
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="container mx-auto flex flex-col items-center justify-between gap-3 px-8 py-4 text-sm text-white/60 md:flex-row">
          <p>
            &copy; {new Date().getFullYear()} Percy Main Community Sports Club
          </p>
        </div>
      </div>
    </footer>
  );
};
