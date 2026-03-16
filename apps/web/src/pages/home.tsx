import { Link } from "react-router";

const DONATE_URL = "/purchase/donation";

const sports = [
  {
    name: "Cricket",
    description:
      "Men's, women's, and junior teams competing in the Northumberland & Tyneside Cricket League",
    href: "/leaderboard",
    icon: "\u{1F3CF}",
  },
  {
    name: "Football",
    description:
      "Grassroots football for the local community with Percy Main Amateurs FC",
    href: "#",
    icon: "\u26BD",
  },
  {
    name: "Boxing",
    description:
      "Amateur boxing training and development with BKFC Gym Percy Main",
    href: "#",
    icon: "\u{1F94A}",
  },
  {
    name: "Running",
    description: "Social running group for all abilities",
    href: "#",
    icon: "\u{1F3C3}",
  },
] as const;

export function Component() {
  return (
    <>
      {/* Hero */}
      <section className="bg-primary py-16 text-white md:py-24">
        <div className="container mx-auto px-8 text-center">
          <h1 className="mb-4 text-h1-sm text-white md:text-h1">
            Percy Main Community Sports Club
          </h1>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80">
            Supporting community sport in Percy Main and surrounding areas since
            1884. Cricket, football, boxing, and running for all ages and
            abilities.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              to="/auth/register"
              className="rounded-lg bg-cta px-8 py-3 text-lg font-medium text-white transition hover:bg-cta-dark"
            >
              Join Us
            </Link>
            <Link
              to="/calendar"
              className="rounded-lg border border-white/30 px-8 py-3 text-lg font-medium text-white transition hover:bg-white/10"
            >
              What&apos;s On
            </Link>
          </div>
        </div>
      </section>

      {/* Our Sports */}
      <section className="bg-primary/5 py-12">
        <div className="container mx-auto px-8">
          <h3 className="mb-8 text-center text-h4">Our Sports</h3>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {sports.map((sport) => (
              <Link
                key={sport.name}
                to={sport.href}
                className="rounded-lg bg-white p-6 shadow-sm transition hover:shadow-md"
              >
                <span className="mb-3 block text-3xl">{sport.icon}</span>
                <h4 className="mb-2 text-lg font-bold text-dark">
                  {sport.name}
                </h4>
                <p className="text-sm text-gray-600">{sport.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Support CTA */}
      <section className="bg-primary py-16">
        <div className="container mx-auto px-8 text-center">
          <h3 className="mb-4 text-h3 text-white">
            Support Your Local Sports Club
          </h3>
          <p className="mx-auto mb-8 max-w-2xl text-lg text-white/80">
            As a registered charity, we rely on the generosity of our community
            to maintain our facilities and keep sport accessible for everyone.
          </p>
          <Link
            to={DONATE_URL}
            className="inline-block rounded-lg bg-cta px-8 py-3.5 text-lg font-medium text-white transition-colors hover:bg-cta-dark"
          >
            Donate Now
          </Link>
        </div>
      </section>
    </>
  );
}
